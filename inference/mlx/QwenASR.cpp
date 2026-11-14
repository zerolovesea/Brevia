#include "QwenASR.h"
#include <cmath>
#include <fstream>
using namespace mlx::core;
using std::string;

QwenASR::QwenASR(const std::filesystem::path &path) {
  std::ifstream(path / "config.json") >> config;
  if (config.at("model_type") != "qwen3_asr")
    throw std::invalid_argument("Expected Qwen3-ASR weights");
  textConfig = config.at("thinker_config").at("text_config");
  textPrefix = "model";
  load(path, path / "tokenizer.json");
}
array QwenASR::audioEmbedding(const array &audio) const {
  const auto &cfg = config.at("thinker_config").at("audio_config");
  int bins = cfg.at("num_mel_bins"), chunk = cfg.at("n_window").get<int>() * 2;
  auto mel = logMel(audio, bins);
  int frames = mel.shape(0), chunks = (frames + chunk - 1) / chunk;
  auto x = pad(mel, {{0, chunks * chunk - frames}, {0, 0}});
  x = expand_dims(transpose(reshape(x, {chunks, chunk, bins}), {0, 2, 1}), -1);
  for (int i = 1; i <= 3; ++i) {
    auto p = "audio_tower.conv2d" + std::to_string(i);
    x = gelu(conv2d(x, weights.at(p + ".weight"), {2, 2}, {1, 1}) +
             weights.at(p + ".bias"));
  }
  int steps = x.shape(2);
  x = linear(reshape(transpose(x, {0, 2, 3, 1}), {chunks, steps, -1}),
             "audio_tower.conv_out");
  int dim = x.shape(2);
  auto phases =
      reshape(arange(steps, float32), {steps, 1}) *
      exp(arange(dim / 2, float32) * float(-std::log(10000.) / (dim / 2 - 1)));
  x = x + concatenate({sin(phases), cos(phases)}, 1);
  int valid = (chunks - 1) * steps + ((frames - (chunks - 1) * chunk + 7) / 8);
  x = slice(reshape(x, {1, chunks * steps, dim}), {0, 0, 0}, {1, valid, dim});
  int window = std::max(1, cfg.at("n_window_infer").get<int>() / chunk) * steps;
  std::vector<array> windows;
  for (int t = 0; t < valid; t += window) {
    auto y = slice(x, {0, t, 0}, {1, std::min(valid, t + window), dim});
    for (int i = 0; i < cfg.at("encoder_layers").get<int>(); ++i) {
      auto p = "audio_tower.layers." + std::to_string(i) + ".";
      auto z = norm(y, p + "self_attn_layer_norm");
      auto proj = p + "self_attn.";
      int h = cfg.at("encoder_attention_heads");
      y = y + linear(attend(heads(linear(z, proj + "q_proj"), h),
                            heads(linear(z, proj + "k_proj"), h),
                            heads(linear(z, proj + "v_proj"), h)),
                     proj + "out_proj");
      y = y + linear(gelu(linear(norm(y, p + "final_layer_norm"), p + "fc1")),
                     p + "fc2");
    }
    windows.push_back(y);
  }
  return linear(
      gelu(linear(norm(concatenate(windows, 1), "audio_tower.ln_post"),
                  "audio_tower.proj1")),
      "audio_tower.proj2");
}
nlohmann::json
QwenASR::decode(const std::vector<float> &samples, const string &language,
                const std::vector<string> &words,
                const std::function<void(const string &)> &partial) const {
  if (samples.size() < 400 || samples.size() > 800000)
    throw std::invalid_argument("Expected 25 ms to 50 seconds of audio");
  string context;
  for (const auto &word : words) {
    if (!context.empty())
      context += ",";
    context += word;
  }
  string before = "<|im_start|>system\n" + context +
                  "<|im_end|>\n<|im_start|>user\n<|audio_start|>";
  string after = "<|audio_end|><|im_end|>\n<|im_start|>assistant\n";
  static const std::unordered_map<string, string> names{
      {"zh", "Chinese"},
      {"chinese", "Chinese"},
      {"mandarin", "Chinese"},
      {"yue", "Cantonese"},
      {"cantonese", "Cantonese"},
      {"en", "English"},
      {"english", "English"},
      {"de", "German"},
      {"german", "German"},
      {"es", "Spanish"},
      {"spanish", "Spanish"},
      {"fr", "French"},
      {"french", "French"},
      {"it", "Italian"},
      {"italian", "Italian"},
      {"pt", "Portuguese"},
      {"portuguese", "Portuguese"},
      {"ru", "Russian"},
      {"russian", "Russian"},
      {"ko", "Korean"},
      {"korean", "Korean"},
      {"ja", "Japanese"},
      {"japanese", "Japanese"},
  };
  bool forced = !language.empty() && language != "auto";
  if (forced) {
    string code = language;
    for (char &c : code)
      if (c >= 'A' && c <= 'Z')
        c += 'a' - 'A';
    auto name = names.find(code);
    after += "language " + (name == names.end() ? language : name->second) +
             "<asr_text>";
  }
  auto extract = [&](const string &text) {
    auto pos = text.find("<asr_text>");
    return !forced && pos != string::npos ? text.substr(pos + 10) : text;
  };
  auto text = generate(
      before,
      audioEmbedding(array(samples.begin(), {int(samples.size())}, float32)),
      after, [&](const auto &text) {
        if (forced || text.find("<asr_text>") != string::npos)
          partial(extract(text));
      });
  text = extract(text);
  auto first = text.find_first_not_of(" \t\r\n");
  string result =
      first == string::npos
          ? ""
          : text.substr(first, text.find_last_not_of(" \t\r\n") - first + 1);
  return {{"text", result}, {"words", nlohmann::json::array()}};
}
