#include "Nano.h"
#include <cmath>
#include <fstream>
#include <regex>

using namespace mlx::core;
using std::string;

Nano::Nano(const std::filesystem::path &path) {
  std::ifstream(path / "config.json") >> config;
  if (config.at("model_type") == "funasr") {
    const auto &enc = config.at("encoder");
    if (config.at("sample_rate") != 16000 || config.at("n_mels") != 80 ||
        config.at("lfr_m") != 7 || config.at("lfr_n") != 6 ||
        enc.at("num_encoders0") != 1 ||
        config.at("adaptor").at("downsample_rate") != 1)
      throw std::invalid_argument("Unsupported quantized Nano configuration");
    config["audio_encoder_conf"] = {
        {"output_size", enc.at("encoder_dim")},
        {"attention_heads", enc.at("num_heads")},
        {"num_blocks", enc.at("num_encoders").get<int>() + 1},
        {"tp_blocks", enc.at("num_tp_encoders")}};
    config["audio_adaptor_conf"] = config.at("adaptor");
    textConfig = config.at("llm");
    textPrefix = "llm.model";
    load(path, path / "tokenizer.json");
    for (auto &[key, weight] : weights)
      if (weight.dtype() == float16)
        weight = astype(weight, bfloat16);
    return;
  }
  if (config.at("model_type") != "fun_asr_nano")
    throw std::invalid_argument("Expected FunASR Nano weights");
  const auto &front = config.at("frontend_conf");
  if (front.at("fs") != 16000 || front.at("window") != "hamming" ||
      front.at("frame_length") != 25 || front.at("frame_shift") != 10 ||
      front.at("n_mels") != 80 || front.at("lfr_m") != 7 ||
      front.at("lfr_n") != 6 ||
      config.at("audio_adaptor_conf").at("downsample_rate") != 1 ||
      config.at("audio_encoder_conf").at("sanm_shift") != 0)
    throw std::invalid_argument("Unsupported Nano frontend configuration");
  textConfig = config.at("text_config");
  textPrefix = "llm.model";
  load(path, path / "Qwen3-0.6B" / "tokenizer.json");
}

static array features(const array &pcm) {
  const int count = 1 + (pcm.size() - 400) / 160;
  auto frames = as_strided(pcm * 32768.f, {count, 400}, {160, 1}, 0);
  frames = frames - mean(frames, 1, true);
  frames = concatenate({slice(frames, {0, 0}, {count, 1}),
                        slice(frames, {0, 1}, {count, 400}) -
                            0.97f * slice(frames, {0, 0}, {count, 399})},
                       1);
  frames = frames * (0.54f - 0.46f * cos(arange(400, float32) *
                                         float(2 * std::acos(-1.) / 399)));
  auto spectrum = square(abs(fft::rfft(frames, 512, 1)));
  auto freq = arange(256, float32) * (16000.f / 512);
  auto mel = 1127.f * log(1.f + freq / 700);
  auto low = 1127.f * log(array(float(1. + 20. / 700)));
  auto high = 1127.f * log(array(float(1. + 8000. / 700)));
  auto step = (high - low) / 81;
  auto bins = reshape(arange(80, float32), {80, 1});
  auto left = low + bins * step, center = low + (bins + 1) * step,
       right = low + (bins + 2) * step;
  auto filters = maximum(array(0.f), minimum((mel - left) / (center - left),
                                             (right - mel) / (right - center)));
  filters = pad(filters, {{0, 0}, {0, 1}});
  auto bank = log(maximum(matmul(spectrum, transpose(filters)), array(1e-8f)));
  int stacks = (count + 5) / 6;
  auto indices = clip(reshape(arange(stacks) * 6, {stacks, 1}) + arange(7) - 3,
                      array(0), array(count - 1));
  return reshape(take(bank, indices, 0), {1, stacks, 560});
}

array Nano::audioEmbedding(const array &audio) const {
  const auto &enc = config.at("audio_encoder_conf");
  auto x = features(audio) * std::sqrt(float(enc.at("output_size").get<int>()));
  const int time = x.shape(1), half = x.shape(2) / 2;
  auto angles =
      reshape(arange(1, time + 1, 1, float32), {time, 1}) *
      exp(arange(half, float32) * float(-std::log(10000.) / (half - 1)));
  x = x + concatenate({sin(angles), cos(angles)}, 1);
  auto layer = [&](const string &name) {
    auto p = name + ".self_attn";
    auto qkv =
        split(linear(norm(x, name + ".norm1"), p + ".linear_q_k_v"), 3, 2);
    auto h = enc.at("attention_heads").get<int>();
    auto value = qkv[2];
    auto a = attend(heads(qkv[0], h), heads(qkv[1], h), heads(value, h));
    auto kernel = weights.at(p + ".fsmn_block.weight");
    auto y = linear(a, p + ".linear_out") +
             (conv1d(value, kernel, 1, kernel.shape(1) / 2, 1, value.shape(2)) +
              value);
    if (x.shape(2) == y.shape(2))
      y = x + y;
    x = y + feedForward(norm(y, name + ".norm2"), name + ".feed_forward");
  };
  layer("audio_encoder.encoders0.0");
  for (int i = 0; i < enc.at("num_blocks").get<int>() - 1; ++i)
    layer("audio_encoder.encoders." + std::to_string(i));
  x = norm(x, "audio_encoder.after_norm");
  for (int i = 0; i < enc.at("tp_blocks").get<int>(); ++i)
    layer("audio_encoder.tp_encoders." + std::to_string(i));
  x = norm(x, "audio_encoder.tp_norm");
  x = linear(maximum(linear(x, "audio_adaptor.linear1"), array(0.f)),
             "audio_adaptor.linear2");
  const auto &adaptor = config.at("audio_adaptor_conf");
  for (int i = 0; i < adaptor.at("n_layer").get<int>(); ++i) {
    auto name = "audio_adaptor.blocks." + std::to_string(i);
    auto y = norm(x, name + ".norm1");
    auto p = name + ".self_attn.linear_";
    int h = adaptor.at("attention_heads");
    x = x + linear(attend(heads(linear(y, p + "q"), h),
                          heads(linear(y, p + "k"), h),
                          heads(linear(y, p + "v"), h)),
                   p + "out");
    x = x + feedForward(norm(x, name + ".norm2"), name + ".feed_forward");
  }
  return slice(x, {0, 0, 0}, {1, (time + 7) / 8, x.shape(2)});
}

nlohmann::json
Nano::decode(const std::vector<float> &samples, const string &language,
             const std::vector<string> &words,
             const std::function<void(const string &)> &partial) const {
  if (samples.size() < 400 || samples.size() > 352000)
    throw std::invalid_argument("Expected 25 ms to 22 seconds of audio");
  string prompt = "<|im_start|>system\nYou are a helpful "
                  "assistant.<|im_end|>\n<|im_start|>user\n";
  // ECMAScript std::regex treats \s as ASCII; include the Unicode White_Space
  // characters.
  static const string space =
      "(?:\\s|\u0085|\u00a0|\u1680|\u2000|\u2001|\u2002|\u2003|\u2004|\u2005|"
      "\u2006|\u2007|\u2008|\u2009|\u200a|\u2028|\u2029|\u202f|\u205f|\u3000)";
  static const std::regex ends("^" + space + "+|" + space + "+$");
  static const std::regex separators("(?:/sil|" + space + ")+");
  const auto trim = [](const string &value) {
    return std::regex_replace(value, ends, "");
  };
  string hotwords;
  for (const auto &word : words) {
    auto item = trim(word);
    if (item.empty())
      continue;
    if (!hotwords.empty())
      hotwords += ", ";
    hotwords += item;
  }
  if (!hotwords.empty()) {
    prompt += "请结合上下文信息，更加准确地完成语音转写任务。如果没有相关信息，"
              "我们会留空。\n\n\n**上下文信息：**\n\n\n热词列表：[" +
              hotwords + "]\n";
  }
  prompt += "语音转写";
  string label = trim(language), code = label;
  for (char &c : code) {
    if (c == '_')
      c = '-';
    else if (c >= 'A' && c <= 'Z')
      c += 'a' - 'A';
  }
  if (!code.empty() && code != "auto") {
    static const std::unordered_map<string, string> labels{
        {"zh", "中文"},    {"zh-cn", "中文"},   {"zh-hans", "中文"},
        {"zh-tw", "中文"}, {"zh-hant", "中文"}, {"cmn", "中文"},
        {"cjy", "中文"},   {"gan", "中文"},     {"hak", "中文"},
        {"hsn", "中文"},   {"nan", "中文"},     {"wuu", "中文"},
        {"yue", "中文"},   {"chinese", "中文"}, {"en", "英文"},
        {"eng", "英文"},   {"english", "英文"}, {"ja", "日文"},
        {"jpn", "日文"},   {"jp", "日文"},      {"japanese", "日文"}};
    auto it = labels.find(code);
    const bool cantonese = code == "yue" && config.at("model_type") == "funasr";
    prompt += "成" + (cantonese            ? string("粤语")
                      : it == labels.end() ? label
                                           : it->second);
  }
  auto generatedText = generate(
      prompt + "：",
      audioEmbedding(array(samples.begin(), {int(samples.size())}, float32)),
      "<|im_end|>\n<|im_start|>assistant\n", partial);
  auto result = trim(std::regex_replace(generatedText, separators, " "));
  return {{"text", result}, {"words", nlohmann::json::array()}};
}
