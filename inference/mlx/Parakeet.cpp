#include "Parakeet.h"
#include <cmath>
#include <fstream>
using namespace mlx::core;
using std::string;
Parakeet::Parakeet(const std::filesystem::path &path, int quantizeBits) {
  std::ifstream(path / "config.json") >> config;
  if (config.at("encoder").at("subsampling") != "dw_striding" ||
      config.at("encoder").at("subsampling_factor") != 8)
    throw std::invalid_argument("Expected Parakeet TDT v3 weights");
  loadWeights(path);
  if (quantizeBits != 0 && quantizeBits != 8)
    throw std::invalid_argument("Unsupported TDT quantization");
  std::unordered_map<string, array> quantParams;
  for (auto &[k, v] : weights) {
    v = astype(v, bfloat16);
    if (quantizeBits && v.ndim() == 2 && v.shape(1) % 64 == 0 &&
        k.ends_with(".weight") && k != "decoder.prediction.embed.weight") {
      auto packed = quantize(v, 64, 8);
      eval(packed);
      auto p = k.substr(0, k.size() - 6);
      v = packed[0];
      quantParams.emplace(p + "scales", packed[1]);
      quantParams.emplace(p + "biases", packed[2]);
    }
  }
  if (quantizeBits) {
    config["quantization"] = {{"bits", 8}, {"group_size", 64}};
    weights.merge(quantParams);
  }
}
array Parakeet::encode(const array &audio) const {
  const int n = audio.size(), frames = n / 160 + 1;
  auto pcm = concatenate(
      {slice(audio, {0}, {1}),
       slice(audio, {1}, {n}) - 0.97f * slice(audio, {0}, {n - 1})});
  pcm = pad(pcm, 256);
  auto window = pad(0.5f * (1.f - cos(arange(400, float32) *
                                      float(2 * std::acos(-1.) / 399))),
                    56);
  auto spec = square(abs(
      fft::rfft(as_strided(pcm, {frames, 512}, {160, 1}, 0) * window, 512, 1)));
  auto mel =
      log(matmul(spec, slaneyFilters(512, 128)) + float(std::pow(2., -24)));
  auto centered = mel - mean(mel, 0, true);
  auto x = reshape(astype(centered / (sqrt(sum(square(centered), 0, true) /
                                           std::max(1, frames - 1)) +
                                      1e-5f),
                          bfloat16),
                   {1, frames, 128, 1});
  for (int i : {0, 2, 3, 5, 6}) {
    auto p = "encoder.pre_encode.conv." + std::to_string(i);
    int stride = i == 3 || i == 6 ? 1 : 2;
    int pad = stride == 2 ? 1 : 0;
    x = conv2d(x, weights.at(p + ".weight"), {stride, stride}, {pad, pad},
               {1, 1}, i == 2 || i == 5 ? x.shape(3) : 1) +
        weights.at(p + ".bias");
    if (i != 2 && i != 5)
      x = maximum(x, array(0, x.dtype()));
  }
  int t = x.shape(1);
  x = linear(reshape(transpose(x, {0, 1, 3, 2}), {1, t, -1}),
             "encoder.pre_encode.out");
  auto &enc = config.at("encoder");
  int dim = x.shape(2), h = enc.at("n_heads");
  auto phase = reshape(arange(t - 1, -t, -1, float32), {2 * t - 1, 1}) *
               exp(arange(0, dim, 2, float32) * float(-std::log(10000.) / dim));
  auto pos =
      astype(reshape(stack({sin(phase), cos(phase)}, -1), {1, 2 * t - 1, dim}),
             x.dtype());
  for (int i = 0; i < enc.at("n_layers").get<int>(); ++i) {
    string p = "encoder.layers." + std::to_string(i) + ".";
    auto ff = [&](array y, const string &which) {
      auto z = linear(norm(y, p + "norm_feed_forward" + which),
                      p + "feed_forward" + which + ".linear1");
      return y + 0.5f * linear(z * sigmoid(z),
                               p + "feed_forward" + which + ".linear2");
    };
    x = ff(x, "1");
    auto z = norm(x, p + "norm_self_att");
    auto att = p + "self_attn.";
    auto q = heads(linear(z, att + "linear_q"), h);
    auto k = heads(linear(z, att + "linear_k"), h);
    auto v = heads(linear(z, att + "linear_v"), h);
    auto positions = heads(linear(pos, att + "linear_pos"), h);
    auto u = q + reshape(weights.at(att + "pos_bias_u"), {1, h, 1, -1});
    auto b = q + reshape(weights.at(att + "pos_bias_v"), {1, h, 1, -1});
    auto rel = matmul(b, swapaxes(positions, -1, -2));
    rel = reshape(pad(rel, {{0, 0}, {0, 0}, {0, 0}, {1, 0}}), {1, h, 2 * t, t});
    rel = reshape(slice(rel, {0, 0, 1, 0}, {1, h, 2 * t, t}),
                  {1, h, t, 2 * t - 1});
    float scale = 1.f / std::sqrt(float(dim / h));
    rel = slice(rel, {0, 0, 0, 0}, {1, h, t, t}) * scale;
    auto a = fast::scaled_dot_product_attention(u, k, v, scale, "", rel);
    x = x + linear(reshape(transpose(a, {0, 2, 1, 3}), {1, t, dim}),
                   att + "linear_out");
    auto c = p + "conv.";
    auto pw = split(conv1d(norm(x, p + "norm_conv"),
                           weights.at(c + "pointwise_conv1.weight")),
                    2, 2);
    z = conv1d(pw[0] * sigmoid(pw[1]), weights.at(c + "depthwise_conv.weight"),
               1, 4, 1, dim);
    auto bn = c + "batch_norm.";
    z = (z - weights.at(bn + "running_mean")) *
            rsqrt(weights.at(bn + "running_var") + 1e-5f) *
            weights.at(bn + "weight") +
        weights.at(bn + "bias");
    x = x + conv1d(z * sigmoid(z), weights.at(c + "pointwise_conv2.weight"));
    x = norm(ff(x, "2"), p + "norm_out");
  }
  return linear(x, "joint.enc");
}
nlohmann::json
Parakeet::decode(const std::vector<float> &samples, const string &,
                 const std::vector<string> &,
                 const std::function<void(const string &)> &partial) const {
  if (samples.empty() || samples.size() > 320000)
    throw std::invalid_argument("Expected up to 20 seconds of audio");
  auto x = encode(array(samples.begin(), {int(samples.size())}, float32));
  auto &vocab = config.at("joint").at("vocabulary");
  int blank = vocab.size(), last = blank, t = 0, symbols = 0;
  auto &cfg = config.at("decoder").at("prednet");
  int hidden = cfg.at("pred_hidden"), layers = cfg.at("pred_rnn_layers");
  std::vector<array> h(layers, zeros({1, hidden}, x.dtype())), c = h;
  nlohmann::json words = nlohmann::json::array();
  string text;
  while (t < x.shape(1)) {
    auto pred =
        last == blank
            ? zeros({1, hidden}, x.dtype())
            : reshape(take(weights.at("decoder.prediction.embed.weight"),
                           array(last), 0),
                      {1, hidden});
    auto nh = h, nc = c;
    for (int l = 0; l < layers; ++l) {
      auto p = "decoder.prediction.dec_rnn.lstm." + std::to_string(l) + ".";
      auto gates = split(
          addmm(weights.at(p + "bias"), pred, transpose(weights.at(p + "Wx"))) +
              matmul(h[l], transpose(weights.at(p + "Wh"))),
          4, 1);
      nc[l] = sigmoid(gates[1]) * c[l] + sigmoid(gates[0]) * tanh(gates[2]);
      nh[l] = sigmoid(gates[3]) * tanh(nc[l]);
      pred = nh[l];
    }
    auto joint = slice(x, {0, t, 0}, {1, t + 1, x.shape(2)}) +
                 linear(pred, "joint.pred");
    auto scores = reshape(
        linear(maximum(joint, array(0, joint.dtype())), "joint.joint_net.2"),
        {-1});
    int id = argmax(slice(scores, {0}, {blank + 1})).item<int>();
    int bucket =
        argmax(slice(scores, {blank + 1}, {scores.shape(0)})).item<int>();
    int jump = config.at("decoding").at("durations").at(bucket);
    if (id != blank) {
      h = nh;
      c = nc;
      last = id;
      string piece = vocab.at(id);
      if (piece != "<unk>" && piece != "<pad>" && piece.rfind("<|", 0) != 0) {
        size_t p;
        while ((p = piece.find("▁")) != string::npos)
          piece.replace(p, 3, " ");
        text += piece;
        words.push_back({{"text", piece},
                         {"start_ms", 80 * t},
                         {"end_ms", 80 * (t + jump)}});
        partial(text);
      }
    }
    t += jump;
    if (jump != 0)
      symbols = 0;
    else if (++symbols >=
             config.at("decoding").at("greedy").at("max_symbols").get<int>()) {
      ++t;
      symbols = 0;
    }
  }
  auto first = text.find_first_not_of(' ');
  return {{"text",
           first == string::npos
               ? ""
               : text.substr(first, text.find_last_not_of(' ') - first + 1)},
          {"words", words}};
}
