#include "SpeechModel.h"
#include <cmath>
#include <fstream>
using namespace mlx::core;
using std::string;
// The distributed Qwen archives contain the split BPE assets.
static std::unique_ptr<tokenizers::Tokenizer>
qwenTokenizer(const std::filesystem::path &path) {
  using J = nlohmann::json;
  J vocab, metadata;
  std::ifstream(path / "vocab.json") >> vocab;
  std::ifstream(path / "tokenizer_config.json") >> metadata;
  std::vector<J> added;
  for (auto &[id, token] : metadata.at("added_tokens_decoder").items()) {
    auto item = token;
    item["id"] = std::stoi(id);
    added.push_back(item);
  }
  std::sort(added.begin(), added.end(),
            [](const J &a, const J &b) { return a.at("id") < b.at("id"); });
  std::ifstream file(path / "merges.txt");
  std::vector<string> merges;
  string line;
  while (std::getline(file, line)) {
    if (!line.empty() && line.back() == '\r')
      line.pop_back();
    if (!line.empty() && line.rfind("#version:", 0) != 0)
      merges.push_back(line);
  }
  if (merges.empty())
    throw std::runtime_error("Missing Qwen BPE merges");
  auto config = J::parse(
      R"MODELJSON({"version":"1.0","truncation":null,"padding":null,"normalizer":{"type":"NFC"},"pre_tokenizer":{"type":"Sequence","pretokenizers":[{"type":"Split","pattern":{"Regex":"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+"},"behavior":"Isolated","invert":false},{"type":"ByteLevel","add_prefix_space":false,"trim_offsets":true,"use_regex":false}]},"post_processor":null,"decoder":{"type":"ByteLevel","add_prefix_space":true,"trim_offsets":true,"use_regex":true}})MODELJSON");
  config["model"] = {{"type", "BPE"},
                     {"vocab", std::move(vocab)},
                     {"merges", std::move(merges)},
                     {"fuse_unk", false},
                     {"byte_fallback", false},
                     {"continuing_subword_prefix", ""},
                     {"end_of_word_suffix", ""}};
  config["added_tokens"] = std::move(added);
  return tokenizers::Tokenizer::FromBlobJSON(config.dump());
}

#ifdef _WIN32
#include <mutex>
// The MLX filename overload uses the process ANSI code page on Windows.
class WeightReader final : public io::Reader {
  std::ifstream file;
  std::mutex mutex;

public:
  explicit WeightReader(const std::filesystem::path &p)
      : file(p, std::ios::binary) {
    file.exceptions(std::ios::badbit | std::ios::failbit);
  }
  bool is_open() const override { return file.is_open(); }
  bool good() const override { return file.good(); }
  size_t tell() override { return static_cast<size_t>(file.tellg()); }
  void seek(int64_t off, std::ios_base::seekdir dir) override {
    file.seekg(off, dir);
  }
  void read(char *out, size_t n) override { file.read(out, n); }
  void read(char *out, size_t n, size_t off) override {
    std::lock_guard<std::mutex> lock(mutex);
    file.seekg(off);
    file.read(out, n);
  }
  string label() const override { return "model weights"; }
};
#endif

void SpeechModel::loadWeights(const std::filesystem::path &path) {
  auto file = path / "model.safetensors";
#ifdef _WIN32
  weights = load_safetensors(std::make_shared<WeightReader>(file)).first;
#else
  weights = load_safetensors(file.string()).first;
#endif
}

// x86 MLX uses BLAS for float32 GEMM. Expand each projection once per load.
void SpeechModel::prepareCpuWeights() {
  for (auto &[name, value] : weights) {
    if (!name.ends_with(".weight"))
      continue;
    auto prefix = name.substr(0, name.size() - 6);
    auto scales = weights.find(prefix + "scales");
    if (scales != weights.end()) {
      auto &quant = config.at("quantization");
      auto biases = weights.at(prefix + "biases");
      value = dequantize(
          value, astype(scales->second, float32), astype(biases, float32),
          quant.at("group_size").get<int>(), quant.at("bits").get<int>());
      eval(value);
    } else if (value.dtype() == float16 || value.dtype() == bfloat16) {
      value = astype(value, float32);
      eval(value);
    }
  }
  std::erase_if(weights, [](const auto &entry) {
    return entry.first.ends_with(".scales") || entry.first.ends_with(".biases");
  });
}
void SpeechModel::load(const std::filesystem::path &path,
                       const std::filesystem::path &tokenizerPath) {
  std::ifstream stream(tokenizerPath);
  if (stream) {
    tokenizer = tokenizers::Tokenizer::FromBlobJSON(
        string(std::istreambuf_iterator<char>(stream),
               std::istreambuf_iterator<char>()));
  } else if (config.at("model_type") == "qwen3_asr") {
    tokenizer = qwenTokenizer(path);
  }
  if (!tokenizer)
    throw std::runtime_error("Missing or invalid tokenizer");
  loadWeights(path);
}
array SpeechModel::linear(const array &x, const string &name) const {
  const auto &weight = weights.at(name + ".weight");
  auto bias = weights.find(name + ".bias");
  if (weights.count(name + ".scales")) {
    const auto &quant = config.at("quantization");
    auto result = quantized_matmul(
        x, weight, weights.at(name + ".scales"), weights.at(name + ".biases"),
        true, quant.at("group_size").get<int>(), quant.at("bits").get<int>());
    return bias == weights.end() ? result : result + bias->second;
  }
  return bias == weights.end() ? matmul(x, transpose(weight))
                               : addmm(bias->second, x, transpose(weight));
}
array SpeechModel::norm(const array &x, const string &name) const {
  return fast::layer_norm(x, weights.at(name + ".weight"),
                          weights.at(name + ".bias"), 1e-5f);
}
array SpeechModel::feedForward(const array &x, const string &block) const {
  return linear(maximum(linear(x, block + ".w_1"), array(0.f)), block + ".w_2");
}
array SpeechModel::heads(const array &x, int count) {
  return transpose(reshape(x, {1, x.shape(1), count, -1}), {0, 2, 1, 3});
}
array SpeechModel::attend(const array &q, const array &k, const array &v,
                          const string &mask) {
  auto out = fast::scaled_dot_product_attention(
      q, k, v, 1.f / std::sqrt(float(q.shape(3))), mask);
  return reshape(transpose(out, {0, 2, 1, 3}), {1, q.shape(2), -1});
}
array SpeechModel::logMel(const array &audio, int bins) {
  int n = audio.size(), frames = n / 160;
  auto padded = concatenate({take(audio, arange(200, 0, -1)), audio,
                             take(audio, arange(n - 2, n - 202, -1))});
  auto hann =
      0.5f *
      (1.f - cos(arange(400, float32) * (float(2 * std::acos(-1.) / 400))));
  auto spectrum = square(abs(fft::rfft(
      as_strided(padded, {frames, 400}, {160, 1}, 0) * hann, 400, 1)));
  auto mel =
      log10(maximum(matmul(spectrum, slaneyFilters(400, bins)), array(1e-10f)));
  return (maximum(mel, max(mel) - 8.f) + 4.f) / 4.f;
}
array SpeechModel::gelu(const array &x) {
  return x * (1.f + erf(x * float(1. / std::sqrt(2.)))) * 0.5f;
}

array SpeechModel::slaneyFilters(int fftSize, int bins) {
  std::vector<float> filters((fftSize / 2 + 1) * bins);
  const double logStep = std::log(6.4) / 27;
  const double highest = 15 + std::log(8.) / logStep;
  auto hz = [&](int i) {
    double mel = highest * i / (bins + 1);
    return mel < 15 ? mel * 200 / 3 : 1000 * std::exp(logStep * (mel - 15));
  };
  for (int m = 0; m < bins; ++m) {
    double left = hz(m), center = hz(m + 1), right = hz(m + 2);
    for (int f = 0; f <= fftSize / 2; ++f) {
      double freq = f * 16000. / fftSize;
      filters[f * bins + m] =
          2 / (right - left) *
          std::max(0., std::min((freq - left) / (center - left),
                                (right - freq) / (right - center)));
    }
  }
  return array(filters.begin(), {fftSize / 2 + 1, bins}, float32);
}
