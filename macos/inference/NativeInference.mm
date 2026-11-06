#include "UTF8Text.h"
#import <Foundation/Foundation.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <llama.h>
#include <memory>
#include <sherpa-onnx/c-api/c-api.h>
#include <stdexcept>
#include <string>
#include <tuple>
#include <unistd.h>
#include <vector>

static FILE *protocol;
static void emit(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value
                                                 options:0
                                                   error:nil];
  if (!data || fwrite(data.bytes, 1, data.length, protocol) != data.length ||
      fputc('\n', protocol) < 0)
    exit(1);
  fflush(protocol);
}
static NSString *text(const char *value) {
  return value ? [NSString stringWithUTF8String:value] ?: @"" : @"";
}
static std::string string(NSDictionary *p, NSString *key,
                          std::string fallback = "") {
  id value = p[key];
  if (!value)
    return fallback;
  if (![value isKindOfClass:NSString.class])
    throw std::runtime_error("Expected a string");
  return [value UTF8String];
}
static double number(NSDictionary *p, NSString *key, double fallback) {
  id value = p[key];
  if (!value)
    return fallback;
  if (![value isKindOfClass:NSNumber.class] ||
      !std::isfinite([value doubleValue]))
    throw std::runtime_error("Expected a finite number");
  return [value doubleValue];
}
static std::string file(const std::string &base, const std::string &name = "") {
  std::string path = base + (name.empty() ? "" : "/" + name);
  if (path.empty() || access(path.c_str(), R_OK))
    throw std::runtime_error("Model file not installed: " + path);
  return path;
}
static std::vector<float> pcm(NSDictionary *p) {
  if (number(p, @"sample_rate", 16000) != 16000)
    throw std::runtime_error("Expected 16 kHz mono PCM16");
  NSString *encoded = p[@"pcm"];
  if (![encoded isKindOfClass:NSString.class])
    throw std::runtime_error("Missing PCM");
  NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
  if (!data || !data.length || data.length % 2 || data.length > 16000 * 2 * 600)
    throw std::runtime_error("Invalid or oversized PCM");
  std::vector<float> samples(data.length / 2);
  const uint8_t *bytes = (const uint8_t *)data.bytes;
  for (size_t i = 0; i < samples.size(); ++i)
    samples[i] = (int16_t)(bytes[2 * i] | bytes[2 * i + 1] << 8) / 32768.f;
  return samples;
}
static NSString *encode(const float *samples, size_t size) {
  std::vector<int16_t> values(size);
  for (size_t i = 0; i < size; ++i)
    values[i] =
        (int16_t)std::clamp(std::lround(samples[i] * 32768), -32768L, 32767L);
  return [[NSData dataWithBytes:values.data() length:values.size() * 2]
      base64EncodedStringWithOptions:0];
}
static const SherpaOnnxOfflineRecognizer *recognizer = nullptr;
static const SherpaOnnxVoiceActivityDetector *vad = nullptr;
static std::vector<float> vadPending;
static int64_t vadTotal = 0, vadProcessed = 0, vadHead = 0, vadStart = -1;
static int vadMinSpeech = 4000;
static int vadWindowOverlap = 64;
static bool vadFlushed = false;
static std::string asrKind, asrLanguage;
static llama_model *model = nullptr;
static llama_context *context = nullptr;
static std::tuple<std::string, int, int, int> loadedLlama;
static bool llamaInitialized = false;
static std::unique_ptr<const SherpaOnnxSpeakerEmbeddingExtractor,
                       decltype(&SherpaOnnxDestroySpeakerEmbeddingExtractor)>
    speakerExtractor(nullptr, SherpaOnnxDestroySpeakerEmbeddingExtractor);
static std::unique_ptr<const SherpaOnnxOfflineSpeakerDiarization,
                       decltype(&SherpaOnnxDestroyOfflineSpeakerDiarization)>
    speakerDiarizer(nullptr, SherpaOnnxDestroyOfflineSpeakerDiarization);
static std::pair<std::string, int> loadedEmbedding;
static std::tuple<std::string, std::string, int, double, double, double>
    loadedDiarizer;
extern void decode_audio(const char *, const char *, int, int);

static id loadASR(NSDictionary *p) {
  std::string base = file(string(p, @"path"));
  std::string kind = string(p, @"kind"), language = string(p, @"language");
  NSArray *hotwords = p[@"hotwords"] ?: @[];
  if (![hotwords isKindOfClass:NSArray.class])
    throw std::runtime_error("Invalid hotwords");
  for (id word in hotwords)
    if (![word isKindOfClass:NSString.class])
      throw std::runtime_error("Invalid hotword");
  std::string hot = [[hotwords componentsJoinedByString:@","] UTF8String];
  SherpaOnnxOfflineRecognizerConfig config{};
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.provider = "cpu";
  config.model_config.num_threads =
      std::clamp((int)number(p, @"threads", 4), 1, 32);
  config.decoding_method = "greedy_search";
  std::string encoder, decoder, embedding, tokens, tokenizer, conv, hint;
  NSDictionary *hints = @{
    @"zh" : @"中文",
    @"en" : @"英文",
    @"yue" : @"粤语",
    @"ja" : @"日语",
    @"ko" : @"韩语",
    @"fr" : @"法语",
    @"de" : @"德语",
    @"es" : @"西班牙语",
    @"ru" : @"俄语"
  };
  if (kind == "funasr-nano") {
    encoder = file(base, "encoder_adaptor.int8.onnx");
    decoder = file(base, "llm.int8.onnx");
    embedding = file(base, "embedding.int8.onnx");
    tokenizer = file(base, "Qwen3-0.6B");
    hint = [hints[text(language.c_str())] ?: @"" UTF8String];
    auto &m = config.model_config.funasr_nano;
    m.encoder_adaptor = encoder.c_str();
    m.llm = decoder.c_str();
    m.embedding = embedding.c_str();
    m.tokenizer = tokenizer.c_str();
    m.language = hint.c_str();
    m.hotwords = hot.c_str();
    m.max_new_tokens = 512;
    m.top_p = 0.8;
    m.itn = 1;
  } else if (kind == "qwen3") {
    conv = file(base, "conv_frontend.onnx");
    encoder = file(base, "encoder.int8.onnx");
    decoder = file(base, "decoder.int8.onnx");
    tokenizer = file(base, "tokenizer");
    auto &m = config.model_config.qwen3_asr;
    m.conv_frontend = conv.c_str();
    m.encoder = encoder.c_str();
    m.decoder = decoder.c_str();
    m.tokenizer = tokenizer.c_str();
    m.hotwords = hot.c_str();
    m.max_total_len = 1024;
    m.max_new_tokens = 512;
    m.top_p = 0.8;
  } else if (kind == "nemo-transducer" || kind == "whisper") {
    NSArray *files = p[@"files"];
    if (![files isKindOfClass:NSArray.class] ||
        files.count < (kind == "whisper" ? 3U : 4U))
      throw std::runtime_error("Model files are required");
    for (id value in files)
      if (![value isKindOfClass:NSString.class])
        throw std::runtime_error("Invalid model file");
    encoder = file(base, [files[0] UTF8String]);
    decoder = file(base, [files[1] UTF8String]);
    tokens = file(base, [files[kind == "whisper" ? 2 : 3] UTF8String]);
    config.model_config.tokens = tokens.c_str();
    if (kind == "whisper") {
      hint = language == "auto" ? "" : language;
      config.model_config.whisper.encoder = encoder.c_str();
      config.model_config.whisper.decoder = decoder.c_str();
      config.model_config.whisper.language = hint.c_str();
      config.model_config.whisper.task = "transcribe";
    } else {
      embedding = file(base, [files[2] UTF8String]);
      config.model_config.transducer.encoder = encoder.c_str();
      config.model_config.transducer.decoder = decoder.c_str();
      config.model_config.transducer.joiner = embedding.c_str();
      config.model_config.model_type = "nemo_transducer";
    }
  } else
    throw std::runtime_error("Unsupported ASR family");
  if (recognizer)
    SherpaOnnxDestroyOfflineRecognizer(recognizer);
  recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
  if (!recognizer)
    throw std::runtime_error("Could not load recognition model");
  asrKind = kind;
  asrLanguage = language;
  return @{
    @"max_speech_seconds" : @(kind == "qwen3"         ? 50
                              : kind == "funasr-nano" ? 22
                              : kind == "whisper"     ? 30
                                                      : 20)
  };
}
static id decodeASR(NSDictionary *p) {
  if (!recognizer)
    throw std::runtime_error("Load an ASR model first");
  auto samples = pcm(p);
  if (samples.empty())
    return @{@"text" : @"", @"words" : @[]};
  auto stream = std::unique_ptr<const SherpaOnnxOfflineStream,
                                decltype(&SherpaOnnxDestroyOfflineStream)>(
      SherpaOnnxCreateOfflineStream(recognizer),
      SherpaOnnxDestroyOfflineStream);
  if (!stream)
    throw std::runtime_error("Could not create recognition stream");
  if (asrKind == "qwen3" && !asrLanguage.empty() && asrLanguage != "auto") {
    NSDictionary *hints = @{
      @"zh" : @"Chinese",
      @"en" : @"English",
      @"yue" : @"Cantonese",
      @"ja" : @"Japanese",
      @"ko" : @"Korean",
      @"fr" : @"French",
      @"de" : @"German",
      @"es" : @"Spanish",
      @"ru" : @"Russian"
    };
    SherpaOnnxOfflineStreamSetOption(
        stream.get(), "language",
        [hints[text(asrLanguage.c_str())] ?: text(asrLanguage.c_str())
            UTF8String]);
  }
  SherpaOnnxAcceptWaveformOffline(stream.get(), 16000, samples.data(),
                                  (int)samples.size());
  SherpaOnnxDecodeOfflineStream(recognizer, stream.get());
  auto result =
      std::unique_ptr<const SherpaOnnxOfflineRecognizerResult,
                      decltype(&SherpaOnnxDestroyOfflineRecognizerResult)>(
          SherpaOnnxGetOfflineStreamResult(stream.get()),
          SherpaOnnxDestroyOfflineRecognizerResult);
  if (!result)
    throw std::runtime_error("Recognition failed");
  NSMutableArray *words = [NSMutableArray array];
  if (result->timestamps && result->tokens_arr) {
    for (int i = 0; i < result->count; ++i) {
      NSString *token = [text(result->tokens_arr[i])
          stringByReplacingOccurrencesOfString:@"▁"
                                    withString:@" "];
      if ([token hasPrefix:@"<|"] || !token.length)
        continue;
      float end = result->durations
                      ? result->timestamps[i] + result->durations[i]
                  : i + 1 < result->count ? result->timestamps[i + 1]
                                          : samples.size() / 16000.f;
      if (!std::isfinite(result->timestamps[i]) || !std::isfinite(end))
        continue;
      long duration = std::max(1L, (long)std::ceil(samples.size() / 16.));
      long start = std::clamp(std::lround(result->timestamps[i] * 1000), 0L,
                              duration - 1);
      long stop = std::clamp(std::lround(end * 1000), start + 1, duration);
      [words addObject:@{
        @"text" : token,
        @"start_ms" : @(start),
        @"end_ms" : @(stop)
      }];
    }
  }
  return @{@"text" : text(result->text), @"words" : words};
}
static id loadVAD(NSDictionary *p) {
  auto path = file(string(p, @"path"));
  SherpaOnnxVadModelConfig config{};
  config.sample_rate = 16000;
  config.num_threads = 1;
  config.provider = "cpu";
  auto &m = config.silero_vad;
  m.model = path.c_str();
  m.window_size = 512;
  m.threshold = number(p, @"threshold", 0.5);
  m.min_silence_duration = number(p, @"min_silence_duration", 0.5);
  m.min_speech_duration = number(p, @"min_speech_duration", 0.25);
  m.max_speech_duration = number(p, @"max_speech_duration", 20);
  if (m.threshold <= 0 || m.threshold >= 1 || m.min_silence_duration <= 0 ||
      m.max_speech_duration <= 0 || m.max_speech_duration > 600)
    throw std::runtime_error("Invalid VAD settings");
  if (vad)
    SherpaOnnxDestroyVoiceActivityDetector(vad);
  vad = SherpaOnnxCreateVoiceActivityDetector(&config,
                                              m.max_speech_duration + 10);
  if (!vad)
    throw std::runtime_error("Could not load VAD");
  vadPending.clear();
  vadTotal = vadProcessed = vadHead = 0;
  vadStart = -1;
  vadMinSpeech = m.min_speech_duration * 16000;
  // 目录固定 Silero V5；V4 接入时可明确传入 window_overlap:0。
  vadWindowOverlap = number(p, @"window_overlap", 64);
  if (vadWindowOverlap != 0 && vadWindowOverlap != 64)
    throw std::runtime_error("Invalid Silero window overlap");
  vadFlushed = false;
  return @{};
}
static void drainVAD(NSMutableArray *result) {
  while (!SherpaOnnxVoiceActivityDetectorEmpty(vad)) {
    const auto *segment = SherpaOnnxVoiceActivityDetectorFront(vad);
    vadHead = segment->start + segment->n;
    auto end = std::min(vadHead, vadTotal);
    if (end > segment->start)
      [result addObject:@{
        @"start_ms" : @(segment->start / 16.),
        @"end_ms" : @(end / 16.),
        @"pcm" : encode(segment->samples, end - segment->start)
      }];
    SherpaOnnxDestroySpeechSegment(segment);
    SherpaOnnxVoiceActivityDetectorPop(vad);
  }
}
static void acceptVADFrame(const float *samples, NSMutableArray *result) {
  bool previous = SherpaOnnxVoiceActivityDetectorDetected(vad);
  SherpaOnnxVoiceActivityDetectorAcceptWaveform(vad, samples, 512);
  vadProcessed += 512;
  bool detected = SherpaOnnxVoiceActivityDetectorDetected(vad);
  // C API 没有暴露 current_segment；与固定 2.0.1 的环形缓冲公式一致。
  int64_t tail = vadProcessed - (vadWindowOverlap ? 512 : 0);
  int64_t earliest = tail - 2 * (512 + vadWindowOverlap) - vadMinSpeech;
  if (detected && !previous)
    vadStart = std::max(earliest, vadHead);
  if (!detected) {
    vadStart = -1;
    if (!previous)
      vadHead = std::max(vadHead, earliest);
  }
  drainVAD(result);
}
static id resetVAD() {
  if (!vad)
    throw std::runtime_error("Load VAD first");
  SherpaOnnxVoiceActivityDetectorReset(vad);
  vadPending.clear();
  vadTotal = vadProcessed = vadHead = 0;
  vadStart = -1;
  vadFlushed = false;
  return @{};
}
static id feedVAD(NSDictionary *p, bool flush) {
  if (!vad)
    throw std::runtime_error("Load VAD first");
  NSMutableArray *result = [NSMutableArray array];
  if (flush) {
    if (!vadPending.empty()) {
      vadPending.resize(512, 0);
      acceptVADFrame(vadPending.data(), result);
      vadPending.clear();
    }
    // V5 的 64 采样前瞻使末帧仍在库内等待；补一帧后按 vadTotal 截断。
    if (vadWindowOverlap && !vadFlushed) {
      float padding[512] = {};
      acceptVADFrame(padding, result);
    }
    SherpaOnnxVoiceActivityDetectorFlush(vad);
    drainVAD(result);
    vadStart = -1;
    vadFlushed = true;
  } else {
    if (vadFlushed)
      throw std::runtime_error("Reset VAD after flushing its tail");
    auto samples = pcm(p);
    vadTotal += samples.size();
    vadPending.insert(vadPending.end(), samples.begin(), samples.end());
    size_t offset = 0;
    for (; offset + 512 <= vadPending.size(); offset += 512)
      acceptVADFrame(vadPending.data() + offset, result);
    vadPending.erase(vadPending.begin(), vadPending.begin() + offset);
  }
  if ([p[@"with_state"] boolValue])
    return @{
      @"segments" : result,
      @"speech_detected" : @(SherpaOnnxVoiceActivityDetectorDetected(vad) != 0),
      @"current_segment_start" : @(vadStart)
    };
  return result;
}
static id embed(NSDictionary *p) {
  auto path = file(string(p, @"path"));
  auto samples = pcm(p);
  SherpaOnnxSpeakerEmbeddingExtractorConfig config{};
  config.model = path.c_str();
  config.num_threads = std::clamp((int)number(p, @"threads", 4), 1, 32);
  config.provider = "cpu";
  auto key = std::make_pair(path, config.num_threads);
  if (!speakerExtractor || key != loadedEmbedding) {
    speakerExtractor.reset(SherpaOnnxCreateSpeakerEmbeddingExtractor(&config));
    loadedEmbedding = key;
  }
  auto &extractor = speakerExtractor;
  if (!extractor)
    throw std::runtime_error("Could not load speaker embedding");
  auto stream = std::unique_ptr<const SherpaOnnxOnlineStream,
                                decltype(&SherpaOnnxDestroyOnlineStream)>(
      SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractor.get()),
      SherpaOnnxDestroyOnlineStream);
  if (!stream)
    throw std::runtime_error("Could not create embedding stream");
  SherpaOnnxOnlineStreamAcceptWaveform(stream.get(), 16000, samples.data(),
                                       (int)samples.size());
  SherpaOnnxOnlineStreamInputFinished(stream.get());
  if (!SherpaOnnxSpeakerEmbeddingExtractorIsReady(extractor.get(),
                                                  stream.get()))
    throw std::runtime_error("Speaker audio is too short");
  const float *values = SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(
      extractor.get(), stream.get());
  if (!values)
    throw std::runtime_error("Could not compute speaker embedding");
  NSMutableArray *result = [NSMutableArray array];
  for (int i = 0; i < SherpaOnnxSpeakerEmbeddingExtractorDim(extractor.get());
       ++i)
    [result addObject:@(values[i])];
  SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(values);
  return @{@"embedding" : result};
}
static id diarize(NSDictionary *p) {
  auto segmentation = file(string(p, @"segmentation_path")),
       embedding = file(string(p, @"embedding_path"));
  auto samples = pcm(p);
  SherpaOnnxOfflineSpeakerDiarizationConfig config{};
  config.segmentation.pyannote.model = segmentation.c_str();
  config.segmentation.num_threads = 4;
  config.segmentation.provider = "cpu";
  config.embedding.model = embedding.c_str();
  config.embedding.num_threads = 4;
  config.embedding.provider = "cpu";
  config.clustering.num_clusters = number(p, @"num_speakers", -1);
  config.clustering.threshold = number(p, @"threshold", 0.5);
  config.min_duration_on = number(p, @"min_duration_on", 0.2);
  config.min_duration_off = number(p, @"min_duration_off", 0.1);
  auto key =
      std::make_tuple(segmentation, embedding, config.clustering.num_clusters,
                      config.clustering.threshold, config.min_duration_on,
                      config.min_duration_off);
  if (!speakerDiarizer || key != loadedDiarizer) {
    speakerDiarizer.reset(SherpaOnnxCreateOfflineSpeakerDiarization(&config));
    loadedDiarizer = key;
  }
  auto &engine = speakerDiarizer;
  if (!engine)
    throw std::runtime_error("Could not load speaker segmentation");
  auto result = std::unique_ptr<
      const SherpaOnnxOfflineSpeakerDiarizationResult,
      decltype(&SherpaOnnxOfflineSpeakerDiarizationDestroyResult)>(
      SherpaOnnxOfflineSpeakerDiarizationProcess(engine.get(), samples.data(),
                                                 (int)samples.size()),
      SherpaOnnxOfflineSpeakerDiarizationDestroyResult);
  if (!result)
    throw std::runtime_error("Speaker segmentation failed");
  auto segments =
      SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime(result.get());
  NSMutableArray *output = [NSMutableArray array];
  for (int i = 0; i < SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(
                          result.get());
       ++i)
    [output addObject:@{
      @"start_ms" : @(std::lround(segments[i].start * 1000)),
      @"end_ms" : @(std::lround(segments[i].end * 1000)),
      @"speaker" : @(segments[i].speaker)
    }];
  SherpaOnnxOfflineSpeakerDiarizationDestroySegment(segments);
  return @{@"segments" : output};
}
static id loadLlama(NSDictionary *p) {
  auto path = file(string(p, @"path"));
  if (!llamaInitialized) {
    llama_log_set(
        [](enum ggml_log_level level, const char *message, void *) {
          if (level == GGML_LOG_LEVEL_WARN || level == GGML_LOG_LEVEL_ERROR ||
              getenv("BREVIA_ENGINE_DEBUG"))
            fputs(message, stderr);
        },
        nullptr);
    llama_backend_init();
    llamaInitialized = true;
  }
  int size = std::clamp((int)number(p, @"context_size", 8192), 512, 65536);
  int threads = std::clamp((int)number(p, @"threads", 4), 1, 32);
  int layers = (int)number(p, @"gpu_layers", 99);
  auto key = std::make_tuple(path, size, threads, layers);
  if (context && loadedLlama == key)
    return @{};
  if (context) {
    llama_free(context);
    context = nullptr;
  }
  if (model) {
    llama_model_free(model);
    model = nullptr;
  }
  auto settings = llama_model_default_params();
  settings.n_gpu_layers = layers;
  model = llama_model_load_from_file(path.c_str(), settings);
  if (!model)
    throw std::runtime_error("Could not load GGUF model");
  auto params = llama_context_default_params();
  params.n_ctx = size;
  params.n_batch = 512;
  params.n_threads = threads;
  params.n_threads_batch = threads;
  context = llama_init_from_model(model, params);
  if (!context)
    throw std::runtime_error("Could not create GGUF context");
  loadedLlama = key;
  return @{};
}
static id generate(NSDictionary *p, id requestID) {
  if (!context)
    throw std::runtime_error("Load GGUF model first");
  auto prompt = string(p, @"prompt");
  int maximum = std::clamp((int)number(p, @"max_tokens", 2048), 1, 16384);
  if ([p[@"chat"] boolValue]) {
    llama_chat_message message = {"user", prompt.c_str()};
    const char *format = llama_model_chat_template(model, nullptr);
    int size = llama_chat_apply_template(format, &message, 1, true, nullptr, 0);
    if (size <= 0)
      throw std::runtime_error("Unsupported model chat template");
    std::vector<char> formatted(size + 1);
    llama_chat_apply_template(format, &message, 1, true, formatted.data(),
                              size);
    prompt.assign(formatted.data(), size);
    // Qwen 的模板默认开启思考；产品的本地纪要/翻译只接收最终回答。
    if (![p[@"enable_thinking"] boolValue] && format &&
        strstr(format, "enable_thinking") && strstr(format, "<think>"))
      prompt += "<think>\n\n</think>\n";
  }
  const auto *vocab = llama_model_get_vocab(model);
  int size = -llama_tokenize(vocab, prompt.c_str(), prompt.size(), nullptr, 0,
                             true, true);
  if (size <= 0 || size + maximum > llama_n_ctx(context))
    throw std::runtime_error("Prompt and output exceed model context");
  std::vector<llama_token> tokens(size);
  llama_tokenize(vocab, prompt.c_str(), prompt.size(), tokens.data(), size,
                 true, true);
  llama_memory_clear(llama_get_memory(context), true);
  for (int offset = 0; offset < size; offset += 512) {
    auto batch = llama_batch_get_one(tokens.data() + offset,
                                     std::min(512, size - offset));
    if (llama_decode(context, batch))
      throw std::runtime_error("GGUF prompt evaluation failed");
  }
  auto sampler = std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)>(
      llama_sampler_chain_init(llama_sampler_chain_default_params()),
      llama_sampler_free);
  double temperature = number(p, @"temperature", 0.3);
  if (temperature <= 0)
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_greedy());
  else {
    llama_sampler_chain_add(
        sampler.get(), llama_sampler_init_top_k((int)number(p, @"top_k", 40)));
    llama_sampler_chain_add(
        sampler.get(), llama_sampler_init_top_p(number(p, @"top_p", 0.95), 1));
    llama_sampler_chain_add(sampler.get(),
                            llama_sampler_init_temp(temperature));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_dist(0));
  }
  NSArray *stops = p[@"stop_tokens"] ?: @[];
  if (![stops isKindOfClass:NSArray.class])
    throw std::runtime_error("Invalid stop tokens");
  for (id stop in stops)
    if (![stop isKindOfClass:NSString.class])
      throw std::runtime_error("Invalid stop token");
  std::string output;
  for (int i = 0; i < maximum; ++i) {
    llama_token token = llama_sampler_sample(sampler.get(), context, -1);
    if (llama_vocab_is_eog(vocab, token))
      break;
    char buffer[256];
    int count =
        llama_token_to_piece(vocab, token, buffer, sizeof(buffer), 0, false);
    if (count < 0) {
      std::vector<char> large(-count);
      count = llama_token_to_piece(vocab, token, large.data(), large.size(), 0,
                                   false);
      output.append(large.data(), count);
    } else
      output.append(buffer, count);
    bool stopped = false;
    for (NSString *stop in stops) {
      auto marker = std::string(stop.UTF8String);
      auto at = output.find(marker);
      if (!marker.empty() && at != std::string::npos) {
        output.resize(at);
        stopped = true;
        break;
      }
    }
    NSString *partial = [[NSString alloc] initWithBytes:output.data()
                                                 length:output.size()
                                               encoding:NSUTF8StringEncoding];
    if (partial)
      emit(@{
        @"type" : @"llama.partial",
        @"payload" : @{@"id" : requestID, @"text" : partial}
      });
    if (stopped)
      break;
    auto batch = llama_batch_get_one(&token, 1);
    if (llama_decode(context, batch))
      throw std::runtime_error("GGUF generation failed");
  }
  return @{@"text" : completeUTF8Prefix(output)};
}
int main() {
  protocol = fdopen(dup(STDOUT_FILENO), "w");
  dup2(STDERR_FILENO, STDOUT_FILENO);
  std::string line;
  while (std::getline(std::cin, line))
    @autoreleasepool {
      id identifier = NSNull.null;
      try {
        if (line.size() > 32 * 1024 * 1024)
          throw std::runtime_error("Inference command too large");
        id request = [NSJSONSerialization
            JSONObjectWithData:[NSData dataWithBytes:line.data()
                                              length:line.size()]
                       options:0
                         error:nil];
        if (![request isKindOfClass:NSDictionary.class] || !request[@"id"] ||
            ![request[@"payload"] isKindOfClass:NSDictionary.class])
          throw std::runtime_error("Invalid inference command");
        identifier = request[@"id"];
        NSDictionary *payload = request[@"payload"];
        auto type = string(request, @"type");
        id result;
        if (type == "asr.load")
          result = loadASR(payload);
        else if (type == "asr.decode")
          result = decodeASR(payload);
        else if (type == "vad.load")
          result = loadVAD(payload);
        else if (type == "vad.feed" || type == "vad.flush")
          result = feedVAD(payload, type == "vad.flush");
        else if (type == "vad.reset")
          result = resetVAD();
        else if (type == "speaker.embed")
          result = embed(payload);
        else if (type == "speaker.diarize")
          result = diarize(payload);
        else if (type == "llama.load")
          result = loadLlama(payload);
        else if (type == "llama.generate")
          result = generate(payload, identifier);
        else if (type == "audio.decode") {
          auto source = file(string(payload, @"source")),
               destination = string(payload, @"destination");
          decode_audio(source.c_str(), destination.c_str(),
                       number(payload, @"sample_rate", 16000),
                       number(payload, @"channels", 1));
          result = @{@"path" : text(destination.c_str())};
        } else
          throw std::runtime_error("Unknown inference command");
        emit(@{@"id" : identifier, @"ok" : @YES, @"result" : result});
      } catch (const std::exception &e) {
        emit(@{@"id" : identifier, @"ok" : @NO, @"error" : text(e.what())});
      }
    }
  if (recognizer)
    SherpaOnnxDestroyOfflineRecognizer(recognizer);
  if (vad)
    SherpaOnnxDestroyVoiceActivityDetector(vad);
  speakerExtractor.reset();
  speakerDiarizer.reset();
  if (context)
    llama_free(context);
  if (model)
    llama_model_free(model);
  if (llamaInitialized)
    llama_backend_free();
  fclose(protocol);
}
