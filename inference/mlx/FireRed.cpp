#include "FireRed.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>
using namespace mlx::core;
using std::string;

FireRed::FireRed(const std::filesystem::path &path) {
  std::ifstream(path / "config.json") >> config;
  if (config.at("model_type") != "fireredasr2")
    throw std::runtime_error("Expected FireRedASR2 AED weights");
  nlohmann::json cmvn;
  std::ifstream(path / "cmvn.json") >> cmvn;
  means = cmvn.at("means").get<std::vector<float>>();
  inverseStd = cmvn.at("istd").get<std::vector<float>>();
  std::ifstream dict(path / "dict.txt");
  string line, piece;
  while (std::getline(dict, line)) {
    std::istringstream row(line);
    if (row >> piece)
      vocab.push_back(piece == "<space>" ? " " : piece);
  }
  if (means.size() != 80 || inverseStd.size() != 80 ||
      vocab.size() != config.at("odim").get<size_t>())
    throw std::runtime_error("Invalid FireRedASR2 vocabulary or CMVN");
  loadWeights(path);
  for (auto &[key, value] : weights) {
    if (value.ndim() == 4 &&
        key.find("input_preprocessor.conv") != string::npos)
      value = transpose(value, {0, 2, 3, 1});
    else if (value.ndim() == 3 && key.find("conv.weight") != string::npos)
      value = transpose(value, {0, 2, 1});
    else if (value.ndim() == 3 && key.find("pointwise_conv") != string::npos)
      value = transpose(value, {0, 2, 1});
  }
}
static array positionEncoding(const array &positions, int dim) {
  auto angles =
      reshape(positions, {-1, 1}) *
      exp(arange(0, dim, 2, float32) * float(-std::log(10000.) / dim));
  return reshape(stack({sin(angles), cos(angles)}, -1), {1, -1, dim});
}
array FireRed::encode(const array &audio) const {
  int frames = 1 + (audio.size() - 400) / 160;
  auto f = as_strided(audio * 32768.f, {frames, 400}, {160, 1}, 0);
  f = f - mean(f, 1, true);
  f = concatenate({slice(f, {0, 0}, {frames, 1}) * (1.f - 0.97f),
                   slice(f, {0, 1}, {frames, 400}) -
                       0.97f * slice(f, {0, 0}, {frames, 399})},
                  1);
  auto spectrum = square(
      abs(fft::rfft(f * (0.54f - 0.46f * cos(arange(400, float32) *
                                             float(2 * std::acos(-1.) / 399))),
                    512, 1)));
  auto lo = std::log1p(20. / 700), hi = std::log1p(8000. / 700);
  auto bins = arange(82, float32);
  auto hz = 700.f * (exp(float(lo) + bins * float((hi - lo) / 81)) - 1.f);
  auto left = reshape(slice(hz, {0}, {80}), {80, 1}),
       center = reshape(slice(hz, {1}, {81}), {80, 1}),
       right = reshape(slice(hz, {2}, {82}), {80, 1});
  auto freq = arange(257, float32) * (16000.f / 512);
  auto filters =
      maximum(array(0.f), minimum((freq - left) / (center - left),
                                  (right - freq) / (right - center)));
  auto features =
      log(maximum(matmul(spectrum, transpose(filters)), array(1e-10f)));
  features = (features - array(means.begin(), {80}, float32)) *
             array(inverseStd.begin(), {80}, float32);
  auto x = reshape(pad(features, {{0, 6}, {0, 0}}), {1, frames + 6, 80, 1});
  for (int i : {0, 2}) {
    auto p = "encoder.input_preprocessor.conv." + std::to_string(i);
    x = maximum(conv2d(x, weights.at(p + ".weight"), {2, 2}) +
                    weights.at(p + ".bias"),
                array(0.f));
  }
  int t = x.shape(1);
  x = linear(reshape(transpose(x, {0, 1, 3, 2}), {1, t, -1}),
             "encoder.input_preprocessor.out");
  int dim = x.shape(2), h = config.at("encoder").at("n_head");
  auto pos = positionEncoding(arange(t - 1, -t, -1, float32), dim);
  for (int i = 0; i < config.at("encoder").at("n_layers").get<int>(); ++i) {
    auto p = "encoder.layer_stack." + std::to_string(i) + ".";
    auto ff = [&](const array &y, const string &key) {
      auto z = linear(norm(y, key + ".net.0"), key + ".net.1");
      return y + 0.5f * linear(z * sigmoid(z), key + ".net.4");
    };
    x = ff(x, p + "ffn1");
    auto a = p + "mhsa.";
    auto q = heads(linear(norm(x, a + "layer_norm_q"), a + "w_qs"), h);
    auto k = heads(linear(norm(x, a + "layer_norm_k"), a + "w_ks"), h);
    auto v = heads(linear(norm(x, a + "layer_norm_v"), a + "w_vs"), h);
    auto u = q + reshape(weights.at(a + "pos_bias_u"), {1, h, 1, -1});
    auto b = q + reshape(weights.at(a + "pos_bias_v"), {1, h, 1, -1});
    auto r =
        matmul(b, swapaxes(heads(linear(pos, a + "linear_pos"), h), -1, -2));
    r = reshape(pad(r, {{0, 0}, {0, 0}, {0, 0}, {1, 0}}), {1, h, 2 * t, t});
    r = reshape(slice(r, {0, 0, 1, 0}, {1, h, 2 * t, t}), {1, h, t, 2 * t - 1});
    r = slice(r, {0, 0, 0, 0}, {1, h, t, t});
    auto out = matmul(softmax((matmul(u, swapaxes(k, -1, -2)) + r) /
                                  std::sqrt(float(dim / h)),
                              -1),
                      v);
    x = x +
        linear(reshape(transpose(out, {0, 2, 1, 3}), {1, t, dim}), a + "fc");
    auto c = p + "conv.";
    auto g = split(conv1d(norm(x, c + "pre_layer_norm"),
                          weights.at(c + "pointwise_conv1.weight")),
                   2, 2);
    auto kernel = weights.at(c + "depthwise_conv.weight");
    auto z = norm(conv1d(g[0] * sigmoid(g[1]), kernel, 1, kernel.shape(1) / 2,
                         1, kernel.shape(0)),
                  c + "batch_norm");
    x = x + conv1d(z * sigmoid(z), weights.at(c + "pointwise_conv2.weight"));
    x = norm(ff(x, p + "ffn2"), p + "layer_norm");
  }
  return x;
}
array FireRed::predict(int id, int position, const array &encoder, Cache &self,
                       const Cache &cross) const {
  int dim = encoder.shape(2), h = config.at("decoder").at("n_head");
  auto x =
      reshape(take(weights.at("decoder.tgt_word_emb.weight"), array(id), 0),
              {1, 1, dim}) *
          std::sqrt(float(dim)) +
      positionEncoding(array(float(position)), dim);
  for (int i = 0; i < config.at("decoder").at("n_layers").get<int>(); ++i) {
    auto p = "decoder.layer_stack." + std::to_string(i) + ".";
    auto a = p + "self_attn.";
    auto y = norm(x, p + "self_attn_norm");
    auto k = heads(linear(y, a + "w_ks"), h),
         v = heads(linear(y, a + "w_vs"), h);
    if (position) {
      k = concatenate({self.at(i).first, k}, 2);
      v = concatenate({self.at(i).second, v}, 2);
      self[i] = {k, v};
    } else
      self.emplace_back(k, v);
    x = x + linear(attend(heads(linear(y, a + "w_qs"), h), k, v), a + "fc");
    a = p + "cross_attn.";
    x = x +
        linear(
            attend(heads(linear(norm(x, p + "cross_attn_norm"), a + "w_qs"), h),
                   cross[i].first, cross[i].second),
            a + "fc");
    x = x + linear(gelu(linear(norm(x, p + "mlp_norm"), p + "mlp.w_1")),
                   p + "mlp.w_2");
  }
  auto logits = matmul(norm(x, "decoder.layer_norm_out"),
                       transpose(weights.at("decoder.tgt_word_emb.weight")));
  return reshape(log(softmax(logits / 1.25f, -1) + 1e-10f), {-1});
}
nlohmann::json
FireRed::decode(const std::vector<float> &samples, const string &,
                const std::vector<string> &,
                const std::function<void(const string &)> &) const {
  if (samples.size() < 400 || samples.size() > 320000)
    throw std::invalid_argument("Expected 25 ms to 20 seconds of audio");
  auto encoder = encode(array(samples.begin(), {int(samples.size())}, float32));
  Cache cross;
  int h = config.at("decoder").at("n_head"), eos = config.at("eos_id");
  for (int i = 0; i < config.at("decoder").at("n_layers").get<int>(); ++i) {
    auto p = "decoder.layer_stack." + std::to_string(i) + ".cross_attn.";
    cross.emplace_back(heads(linear(encoder, p + "w_ks"), h),
                       heads(linear(encoder, p + "w_vs"), h));
  }
  struct Beam {
    std::vector<int> ids;
    Cache cache;
    float score;
  };
  std::vector<Beam> beams{{{config.at("sos_id").get<int>()}, {}, 0.f}};
  for (int step = 0; step < 512; ++step) {
    std::vector<Beam> next;
    bool allDone = true;
    for (auto &beam : beams) {
      if (beam.ids.back() == eos) {
        next.push_back(beam);
        continue;
      }
      allDone = false;
      auto scores = predict(beam.ids.back(), step, encoder, beam.cache, cross);
      auto order = argsort(-scores);
      auto ids = slice(order, {0}, {3});
      auto top = take(scores, ids, 0);
      eval(ids, top);
      for (int j = 0; j < 3; ++j) {
        Beam candidate = beam;
        candidate.ids.push_back(ids.data<uint32_t>()[j]);
        candidate.score += top.data<float>()[j];
        next.push_back(std::move(candidate));
      }
    }
    if (allDone)
      break;
    std::stable_sort(
        next.begin(), next.end(),
        [](const Beam &a, const Beam &b) { return a.score > b.score; });
    next.resize(3);
    beams = std::move(next);
  }
  auto rank = [&](const Beam &b) {
    return b.score /
           std::pow((5.f + b.ids.size() - (b.ids.back() == eos)) / 6.f, 0.6f);
  };
  auto &best =
      *std::max_element(beams.begin(), beams.end(),
                        [&](auto &a, auto &b) { return rank(a) < rank(b); });
  string text;
  for (size_t i = 1; i < best.ids.size() && best.ids[i] != eos; ++i) {
    auto piece = vocab.at(best.ids[i]);
    if (piece == "<blank>" || piece == "<sil>")
      continue;
    size_t pos;
    while ((pos = piece.find("▁")) != string::npos)
      piece.replace(pos, 3, " ");
    for (char &c : piece)
      if (c >= 'A' && c <= 'Z')
        c += 'a' - 'A';
    text += piece;
  }
  auto first = text.find_first_not_of(' ');
  return {{"text",
           first == string::npos
               ? ""
               : text.substr(first, text.find_last_not_of(' ') - first + 1)},
          {"words", nlohmann::json::array()}};
}
