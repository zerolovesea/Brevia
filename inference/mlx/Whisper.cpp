#include "Whisper.h"
#include <cmath>
#include <fstream>
using namespace mlx::core;
using std::string;
Whisper::Whisper(const std::filesystem::path &path) {
  std::ifstream(path / "config.json") >> config;
  std::ifstream(path / "generation_config.json") >> generation;
  if (config.at("model_type") != "whisper")
    throw std::invalid_argument("Expected Whisper weights");
  load(path, path / "tokenizer.json");
}
array Whisper::attention(const array &x, const array &source, const string &p,
                         int count, Cache *kv, int layer, bool cross) const {
  auto q = heads(linear(x, p + "query"), count);
  if (cross && kv && layer < int(kv->size())) {
    return linear(attend(q, (*kv)[layer].first, (*kv)[layer].second),
                  p + "out");
  }
  auto k = heads(linear(source, p + "key"), count),
       v = heads(linear(source, p + "value"), count);
  if (kv) {
    if (layer < int(kv->size())) {
      k = concatenate({(*kv)[layer].first, k}, 2);
      v = concatenate({(*kv)[layer].second, v}, 2);
      (*kv)[layer] = {k, v};
    } else
      kv->emplace_back(k, v);
  }
  return linear(attend(q, k, v, kv && !cross && x.shape(1) > 1 ? "causal" : ""),
                p + "out");
}
array Whisper::encode(const array &audio) const {
  auto mel =
      logMel(pad(audio, std::pair<int, int>{0, 480000 - int(audio.size())}),
             config.at("num_mel_bins"));
  auto x = expand_dims(mel, 0);
  for (int i = 1; i <= 2; ++i) {
    auto p = "encoder.conv" + std::to_string(i);
    x = gelu(conv1d(x, weights.at(p + ".weight"), i, 1) +
             weights.at(p + ".bias"));
  }
  int half = x.shape(2) / 2;
  auto phases =
      reshape(arange(x.shape(1), float32), {x.shape(1), 1}) *
      exp(arange(half, float32) * float(-std::log(10000.) / (half - 1)));
  x = x + concatenate({sin(phases), cos(phases)}, 1);
  for (int i = 0; i < config.at("encoder_layers").get<int>(); ++i) {
    auto p = "encoder.blocks." + std::to_string(i) + ".";
    auto y = norm(x, p + "attn_ln");
    x = x + attention(y, y, p + "attn.", config.at("encoder_attention_heads"),
                      nullptr, i, false);
    x = x + linear(gelu(linear(norm(x, p + "mlp_ln"), p + "mlp1")), p + "mlp2");
  }
  return norm(x, "encoder.ln_post");
}
nlohmann::json
Whisper::decode(const std::vector<float> &samples, const string &language,
                const std::vector<string> &words,
                const std::function<void(const string &)> &partial) const {
  if (samples.empty() || samples.size() > 480000)
    throw std::invalid_argument("Expected up to 30 seconds of audio");
  const int end = generation.at("eos_token_id"),
            noTime = generation.at("no_timestamps_token_id");
  std::vector<int32_t> ids;
  string prompt;
  for (auto &word : words) {
    if (!prompt.empty())
      prompt += ", ";
    prompt += word;
  }
  if (!prompt.empty()) {
    auto tokens = tokenizer->Encode(" " + prompt);
    ids.push_back(tokenizer->TokenToId("<|startofprev|>"));
    ids.insert(ids.end(), tokens.end() - std::min<size_t>(223, tokens.size()),
               tokens.end());
  }
  ids.push_back(generation.at("decoder_start_token_id"));
  string code = language;
  code.erase(0, code.find_first_not_of(" \t\r\n"));
  code.erase(code.find_last_not_of(" \t\r\n") + 1);
  for (char &c : code)
    if (c >= 'A' && c <= 'Z')
      c += 'a' - 'A';
  if (code.size() >= 4 && code.starts_with("<|") && code.ends_with("|>"))
    code = code.substr(2, code.size() - 4);
  static const std::unordered_map<string, string> aliases{
      {"english", "en"},    {"chinese", "zh"},    {"mandarin", "zh"},
      {"cantonese", "yue"}, {"japanese", "ja"},   {"korean", "ko"},
      {"french", "fr"},     {"german", "de"},     {"spanish", "es"},
      {"italian", "it"},    {"portuguese", "pt"}, {"russian", "ru"},
      {"polish", "pl"},     {"turkish", "tr"},    {"dutch", "nl"},
      {"arabic", "ar"},     {"hindi", "hi"},      {"indonesian", "id"},
      {"vietnamese", "vi"}, {"thai", "th"},       {"ukrainian", "uk"},
      {"swedish", "sv"},    {"czech", "cs"},      {"romanian", "ro"},
      {"hungarian", "hu"},  {"danish", "da"},     {"finnish", "fi"},
      {"norwegian", "no"},  {"hebrew", "he"},     {"greek", "el"},
      {"tagalog", "tl"},    {"filipino", "tl"},   {"malay", "ms"},
      {"tamil", "ta"},      {"telugu", "te"},     {"bengali", "bn"},
      {"urdu", "ur"}};
  if (auto it = aliases.find(code); it != aliases.end())
    code = it->second;
  auto lang = generation.at("lang_to_id").find("<|" + code + "|>");
  if (lang != generation.at("lang_to_id").end())
    ids.push_back(lang.value().get<int>());
  ids.push_back(generation.at("task_to_id").at("transcribe"));
  ids.push_back(noTime);
  auto hidden = encode(array(samples.begin(), {int(samples.size())}, float32));
  const auto &embedding = weights.at("decoder.token_embedding.weight");
  Cache self, cross;
  std::vector<int32_t> output;
  int offset = 0, limit = config.at("max_target_positions").get<int>() -
                          int(ids.size()) - 1;
  for (int step = 0; step < limit; ++step) {
    int length = ids.size();
    auto pos = slice(weights.at("decoder.positional_embedding"), {offset, 0},
                     {offset + length, embedding.shape(1)});
    auto x = expand_dims(
        take(embedding, array(ids.begin(), {length}, int32), 0) + pos, 0);
    for (int i = 0; i < config.at("decoder_layers").get<int>(); ++i) {
      auto p = "decoder.blocks." + std::to_string(i) + ".";
      int h = config.at("decoder_attention_heads");
      auto y = norm(x, p + "attn_ln");
      x = x + attention(y, y, p + "attn.", h, &self, i, false);
      x = x + attention(norm(x, p + "cross_attn_ln"), hidden, p + "cross_attn.",
                        h, &cross, i, true);
      x = x +
          linear(gelu(linear(norm(x, p + "mlp_ln"), p + "mlp1")), p + "mlp2");
    }
    auto last = slice(x, {0, length - 1, 0}, {1, length, x.shape(2)});
    auto logits =
        reshape(matmul(norm(last, "decoder.ln"), transpose(embedding)), {-1});
    auto allowed = slice(logits, {0}, {noTime + 1});
    auto blocked = generation.at("suppress_tokens").get<std::vector<int>>();
    if (!step)
      for (int token : generation.at("begin_suppress_tokens"))
        blocked.push_back(token);
    blocked.erase(std::remove_if(blocked.begin(), blocked.end(),
                                 [&](int i) { return i < 0 || i > noTime; }),
                  blocked.end());
    if (!blocked.empty())
      allowed = put_along_axis(
          allowed, array(blocked.begin(), {int(blocked.size())}, int32),
          array(-std::numeric_limits<float>::infinity()), 0);
    int id = argmax(allowed).item<int>();
    if (id == end)
      break;
    if (id < end)
      output.push_back(id);
    auto text = tokenizer->Decode(output);
    if (text.find("�") == string::npos)
      partial(text);
    offset += length;
    ids = {id};
  }
  auto text = tokenizer->Decode(output);
  auto start = text.find_first_not_of(" \r\t\n");
  string result =
      start == string::npos
          ? ""
          : text.substr(start, text.find_last_not_of(" \r\t\n") - start + 1);
  return {{"text", result}, {"words", nlohmann::json::array()}};
}
