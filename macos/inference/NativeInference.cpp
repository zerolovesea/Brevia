#include "EnginePCM.h"
#include "UTF8Text.h"
#include "base64.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <limits>
#include <llama.h>
#include <memory>
#include <sherpa-onnx/c-api/c-api.h>
#include <stdexcept>
#include <string>
#include <tuple>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#define dup _dup
#define dup2 _dup2
#define fdopen _fdopen
#define STDOUT_FILENO 1
#define STDERR_FILENO 2
#else
#include <unistd.h>
#endif
using JSON = nlohmann::json;
#include <vector>

static FILE *protocol;
static void emit(const JSON &value) {
  auto data = value.dump(-1, ' ', false, JSON::error_handler_t::replace);
  if (fwrite(data.data(), 1, data.size(), protocol) != data.size() ||
      fputc('\n', protocol) < 0)
    exit(1);
  fflush(protocol);
}
static std::string text(const char *value) { return value ? value : ""; }
static std::string string(const JSON &p, const char *key,
                          std::string fallback = "") {
  if (!p.contains(key))
    return fallback;
  if (!p[key].is_string())
    throw std::runtime_error("Expected a string");
  return p[key].get<std::string>();
}
static bool flag(const JSON &p, const char *key) {
  return p.contains(key) && p[key].is_boolean() && p[key].get<bool>();
}
static std::string file(const std::string &base, const std::string &name = "") {
  auto path = std::filesystem::u8path(base);
  if (!name.empty())
    path /= std::filesystem::u8path(name);
  if (base.empty() || !std::filesystem::exists(path))
    throw std::runtime_error("Model file not installed: " + path.u8string());
  return path.u8string();
}
#ifdef BREVIA_SHERPA_CUDA
static constexpr const char *sherpaProvider = "cuda";
#else
static constexpr const char *sherpaProvider = "cpu";
#endif
#if defined(_WIN32) && !defined(BREVIA_SHERPA_CUDA)
static std::string nanoCPUProvider() {
  std::wstring executable(32768, L'\0');
  const auto length = GetModuleFileNameW(nullptr, executable.data(),
                                       static_cast<DWORD>(executable.size()));
  if (!length || length >= executable.size())
    throw std::runtime_error("Could not locate bundled inference configuration");
  executable.resize(length);
  // Nano 的 encoder 使用 S8 权重；无 VNNI 的 x86 CPU 需要避免 U8S8 中间饱和。
  // 固定配置随引擎提供；sherpa 按 UTF-8/UTF-16 读取，兼容中文安装目录。
  return "cpu:" + file(std::filesystem::path(executable).parent_path().u8string(),
                       "funasr-cpu.conf");
}
#endif
static std::string encode(const float *samples, size_t size) {
  std::string values(size * 2, '\0');
  for (size_t i = 0; i < size; ++i) {
    auto value =
        (int16_t)std::clamp(std::lround(samples[i] * 32768), -32768L, 32767L);
    values[2 * i] = value & 255;
    values[2 * i + 1] = (uint16_t)value >> 8;
  }
  return base64::encode(values);
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

static JSON loadASR(const JSON &p) {
  std::string base = file(string(p, "path"));
  std::string kind = string(p, "kind"), language = string(p, "language");
  auto hotwords = p.value("hotwords", JSON::array());
  if (!hotwords.is_array())
    throw std::runtime_error("Invalid hotwords");
  std::string hot;
  for (const auto &word : hotwords) {
    if (!word.is_string())
      throw std::runtime_error("Invalid hotword");
    if (!hot.empty())
      hot += ",";
    hot += word.get<std::string>();
  }
  SherpaOnnxOfflineRecognizerConfig config{};
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  std::string provider = sherpaProvider;
#if defined(_WIN32) && !defined(BREVIA_SHERPA_CUDA)
  if (kind == "funasr-nano")
    provider = nanoCPUProvider();
#endif
  config.model_config.provider = provider.c_str();
  config.model_config.num_threads = integer(p, "threads", 4, 1, 32);
  config.decoding_method = "greedy_search";
  std::string encoder, decoder, embedding, tokens, tokenizer, conv, hint;
  const JSON hints = {{"zh", "中文"}, {"en", "英文"},     {"yue", "粤语"},
                      {"ja", "日语"}, {"ko", "韩语"},     {"fr", "法语"},
                      {"de", "德语"}, {"es", "西班牙语"}, {"ru", "俄语"}};
  if (kind == "funasr-nano") {
    encoder = file(base, "encoder_adaptor.int8.onnx");
    decoder = file(base, "llm.int8.onnx");
    embedding = file(base, "embedding.int8.onnx");
    tokenizer = file(base, "Qwen3-0.6B");
    hint = hints.value(language, "");
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
    auto files = p.value("files", JSON::array());
    if (!files.is_array() || files.size() < (kind == "whisper" ? 3U : 4U))
      throw std::runtime_error("Model files are required");
    for (const auto &value : files)
      if (!value.is_string())
        throw std::runtime_error("Invalid model file");
    encoder = file(base, files[0].get<std::string>());
    decoder = file(base, files[1].get<std::string>());
    tokens = file(base, files[kind == "whisper" ? 2 : 3].get<std::string>());
    config.model_config.tokens = tokens.c_str();
    if (kind == "whisper") {
      hint = language == "auto" ? "" : language;
      config.model_config.whisper.encoder = encoder.c_str();
      config.model_config.whisper.decoder = decoder.c_str();
      config.model_config.whisper.language = hint.c_str();
      config.model_config.whisper.task = "transcribe";
    } else {
      embedding = file(base, files[2].get<std::string>());
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
  return {{"max_speech_seconds", kind == "qwen3"         ? 50
                                 : kind == "funasr-nano" ? 22
                                 : kind == "whisper"     ? 30
                                                         : 20}};
}
static JSON decodeASR(const JSON &p) {
  if (!recognizer)
    throw std::runtime_error("Load an ASR model first");
  auto samples = pcm(p);
  if (samples.empty())
    return {{"text", ""}, {"words", JSON::array()}};
  auto stream = std::unique_ptr<const SherpaOnnxOfflineStream,
                                decltype(&SherpaOnnxDestroyOfflineStream)>(
      SherpaOnnxCreateOfflineStream(recognizer),
      SherpaOnnxDestroyOfflineStream);
  if (!stream)
    throw std::runtime_error("Could not create recognition stream");
  if (asrKind == "qwen3" && !asrLanguage.empty() && asrLanguage != "auto") {
    const JSON hints = {
        {"zh", "Chinese"},  {"en", "English"}, {"yue", "Cantonese"},
        {"ja", "Japanese"}, {"ko", "Korean"},  {"fr", "French"},
        {"de", "German"},   {"es", "Spanish"}, {"ru", "Russian"}};
    SherpaOnnxOfflineStreamSetOption(
        stream.get(), "language",
        hints.value(asrLanguage, asrLanguage).c_str());
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
  JSON words = JSON::array();
  if (result->timestamps && result->tokens_arr) {
    for (int i = 0; i < result->count; ++i) {
      std::string token = text(result->tokens_arr[i]);
      for (size_t at = 0; (at = token.find("▁", at)) != std::string::npos; ++at)
        token.replace(at, std::string("▁").size(), " ");
      if (token.rfind("<|", 0) == 0 || token.empty())
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
      words.push_back({{"text", token}, {"start_ms", start}, {"end_ms", stop}});
    }
  }
  return {{"text", text(result->text)}, {"words", words}};
}
static JSON loadVAD(const JSON &p) {
  auto path = file(string(p, "path"));
  SherpaOnnxVadModelConfig config{};
  config.sample_rate = 16000;
  config.num_threads = 1;
  config.provider = "cpu";
  auto &m = config.silero_vad;
  m.model = path.c_str();
  m.window_size = 512;
  m.threshold = number(p, "threshold", 0.5);
  m.min_silence_duration = number(p, "min_silence_duration", 0.5);
  m.min_speech_duration = number(p, "min_speech_duration", 0.25);
  m.max_speech_duration = number(p, "max_speech_duration", 20);
  if (m.threshold <= 0 || m.threshold >= 1 || m.min_silence_duration <= 0 ||
      m.min_silence_duration > 600 || m.min_speech_duration < 0 ||
      m.min_speech_duration > 600 || m.max_speech_duration <= 0 ||
      m.max_speech_duration > 600)
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
  const auto overlap = number(p, "window_overlap", 64);
  if (overlap != 0 && overlap != 64)
    throw std::runtime_error("Invalid Silero window overlap");
  vadWindowOverlap = static_cast<int>(overlap);
  vadFlushed = false;
  return JSON::object();
}
static void drainVAD(JSON &result) {
  while (!SherpaOnnxVoiceActivityDetectorEmpty(vad)) {
    const auto *segment = SherpaOnnxVoiceActivityDetectorFront(vad);
    vadHead = segment->start + segment->n;
    auto end = std::min(vadHead, vadTotal);
    if (end > segment->start)
      result.push_back(
          {{"start_ms", segment->start / 16.},
           {"end_ms", end / 16.},
           {"pcm", encode(segment->samples, end - segment->start)}});
    SherpaOnnxDestroySpeechSegment(segment);
    SherpaOnnxVoiceActivityDetectorPop(vad);
  }
}
static void acceptVADFrame(const float *samples, JSON &result) {
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
static JSON resetVAD() {
  if (!vad)
    throw std::runtime_error("Load VAD first");
  SherpaOnnxVoiceActivityDetectorReset(vad);
  vadPending.clear();
  vadTotal = vadProcessed = vadHead = 0;
  vadStart = -1;
  vadFlushed = false;
  return JSON::object();
}
static JSON feedVAD(const JSON &p, bool flush) {
  if (!vad)
    throw std::runtime_error("Load VAD first");
  JSON result = JSON::array();
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
  if (flag(p, "with_state"))
    return {
        {"segments", result},
        {"speech_detected", SherpaOnnxVoiceActivityDetectorDetected(vad) != 0},
        {"current_segment_start", vadStart}};
  return result;
}
static JSON embed(const JSON &p) {
  auto path = file(string(p, "path"));
  auto samples = pcm(p);
  SherpaOnnxSpeakerEmbeddingExtractorConfig config{};
  config.model = path.c_str();
  config.num_threads = integer(p, "threads", 4, 1, 32);
  config.provider = sherpaProvider;
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
  JSON result = JSON::array();
  for (int i = 0; i < SherpaOnnxSpeakerEmbeddingExtractorDim(extractor.get());
       ++i)
    result.push_back(values[i]);
  SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(values);
  return {{"embedding", result}};
}
static JSON diarize(const JSON &p) {
  auto segmentation = file(string(p, "segmentation_path")),
       embedding = file(string(p, "embedding_path"));
  auto samples = pcm(p);
  SherpaOnnxOfflineSpeakerDiarizationConfig config{};
  config.segmentation.pyannote.model = segmentation.c_str();
  config.segmentation.num_threads = 4;
  config.segmentation.provider = sherpaProvider;
  config.embedding.model = embedding.c_str();
  config.embedding.num_threads = 4;
  config.embedding.provider = sherpaProvider;
  auto speakers = number(p, "num_speakers", -1);
  if (speakers != -1 &&
      (speakers < 1 || speakers > 100 || speakers != std::trunc(speakers)))
    throw std::runtime_error("Invalid speaker count");
  config.clustering.num_clusters = static_cast<int>(speakers);
  config.clustering.threshold = number(p, "threshold", 0.5);
  config.min_duration_on = number(p, "min_duration_on", 0.2);
  config.min_duration_off = number(p, "min_duration_off", 0.1);
  if (config.clustering.threshold < 0 || config.clustering.threshold > 1 ||
      config.min_duration_on < 0 || config.min_duration_on > 600 ||
      config.min_duration_off < 0 || config.min_duration_off > 600)
    throw std::runtime_error("Invalid speaker segmentation settings");
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
  JSON output = JSON::array();
  for (int i = 0; i < SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(
                          result.get());
       ++i)
    output.push_back({{"start_ms", std::lround(segments[i].start * 1000)},
                      {"end_ms", std::lround(segments[i].end * 1000)},
                      {"speaker", segments[i].speaker}});
  SherpaOnnxOfflineSpeakerDiarizationDestroySegment(segments);
  return {{"segments", output}};
}
static JSON loadLlama(const JSON &p) {
  auto path = file(string(p, "path"));
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
  int size = integer(p, "context_size", 8192, 512, 65536);
  int threads = integer(p, "threads", 4, 1, 32);
  int layers =
      integer(p, "gpu_layers", 99, -1, std::numeric_limits<int>::max());
  auto key = std::make_tuple(path, size, threads, layers);
  if (context && loadedLlama == key)
    return JSON::object();
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
  return JSON::object();
}
static JSON generate(const JSON &p, const JSON &requestID) {
  if (!context)
    throw std::runtime_error("Load GGUF model first");
  auto prompt = string(p, "prompt");
  int maximum = integer(p, "max_tokens", 2048, 1, 16384);
  if (flag(p, "chat")) {
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
    if (!flag(p, "enable_thinking") && format &&
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
  double temperature = number(p, "temperature", 0.3);
  if (temperature <= 0)
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_greedy());
  else {
    llama_sampler_chain_add(
        sampler.get(),
        llama_sampler_init_top_k(
            integer(p, "top_k", 40, 0, std::numeric_limits<int>::max())));
    llama_sampler_chain_add(
        sampler.get(), llama_sampler_init_top_p(number(p, "top_p", 0.95), 1));
    llama_sampler_chain_add(sampler.get(),
                            llama_sampler_init_temp(temperature));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_dist(0));
  }
  auto stops = p.value("stop_tokens", JSON::array());
  if (!stops.is_array())
    throw std::runtime_error("Invalid stop tokens");
  for (const auto &stop : stops)
    if (!stop.is_string())
      throw std::runtime_error("Invalid stop token");
  std::string output;
  bool complete = false;
  for (int i = 0; i < maximum; ++i) {
    llama_token token = llama_sampler_sample(sampler.get(), context, -1);
    if (llama_vocab_is_eog(vocab, token)) {
      complete = true;
      break;
    }
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
    for (const auto &stop : stops) {
      auto marker = stop.get<std::string>();
      auto at = output.find(marker);
      if (!marker.empty() && at != std::string::npos) {
        output.resize(at);
        stopped = true;
        break;
      }
    }
    if (validUTF8(output))
      emit({{"type", "llama.partial"},
            {"payload", {{"id", requestID}, {"text", output}}}});
    if (stopped) {
      complete = true;
      break;
    }
    auto batch = llama_batch_get_one(&token, 1);
    if (llama_decode(context, batch))
      throw std::runtime_error("GGUF generation failed");
  }
  if (flag(p, "require_complete") && !complete)
    throw std::runtime_error("Translation exceeded output token limit; no "
                             "complete result was produced");
  return {{"text", completeUTF8Prefix(output)}};
}
int main() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  protocol = fdopen(dup(STDOUT_FILENO), "wb");
  if (!protocol || dup2(STDERR_FILENO, STDOUT_FILENO) < 0)
    return 1;
  std::string line;
  bool oversized;
  while (readCommandLine(std::cin, line, oversized)) {
    JSON identifier = nullptr;
    try {
      if (oversized)
        throw std::runtime_error("Inference command too large");
      auto request = JSON::parse(line);
      if (!request.is_object() || !request.contains("id") ||
          !request.contains("payload") || !request["payload"].is_object())
        throw std::runtime_error("Invalid inference command");
      identifier = request["id"];
      const auto &payload = request["payload"];
      auto type = string(request, "type");
      JSON result;
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
        auto source = file(string(payload, "source")),
             destination = string(payload, "destination");
        auto rate = number(payload, "sample_rate", 16000),
             channels = number(payload, "channels", 1);
        if (rate < 8000 || rate > 192000 || rate != std::trunc(rate) ||
            (channels != 1 && channels != 2))
          throw std::runtime_error("Invalid decode format");
        decode_audio(source.c_str(), destination.c_str(),
                     static_cast<int>(rate), static_cast<int>(channels));
        result = {{"path", destination}};
      } else
        throw std::runtime_error("Unknown inference command");
      emit({{"id", identifier}, {"ok", true}, {"result", result}});
    } catch (const std::exception &e) {
      emit({{"id", identifier}, {"ok", false}, {"error", text(e.what())}});
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
