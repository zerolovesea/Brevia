#include "QwenDecoder.h"
#include <unordered_set>
using namespace mlx::core;
using std::string;
array QwenDecoder::logits(array x, Cache &cache, int offset) const {
  const auto &cfg = textConfig;
  auto rms = [&](const array &y, const string &p) {
    return fast::rms_norm(y, weights.at(p + ".weight"),
                          cfg.at("rms_norm_eps").get<float>());
  };
  for (int i = 0; i < cfg.at("num_hidden_layers").get<int>(); ++i) {
    auto name = textPrefix + ".layers." + std::to_string(i);
    auto y = rms(x, name + ".input_layernorm");
    auto p = name + ".self_attn.";
    auto rotate = [&](const array &t) {
      return fast::rope(t, t.shape(3), false, cfg.at("rope_theta").get<float>(),
                        1.f, offset);
    };
    auto q = rotate(
        rms(heads(linear(y, p + "q_proj"), cfg.at("num_attention_heads")),
            p + "q_norm"));
    auto k = rotate(
        rms(heads(linear(y, p + "k_proj"), cfg.at("num_key_value_heads")),
            p + "k_norm"));
    auto v = heads(linear(y, p + "v_proj"), cfg.at("num_key_value_heads"));
    const int end = offset + k.shape(2);
    if (!offset) {
      auto shape = k.shape();
      shape[2] = ((end + 127) / 128) * 128;
      cache.emplace_back(zeros(shape, k.dtype()), zeros(shape, v.dtype()));
    }
    auto update = [&](array &storage, const array &part) {
      if (end > storage.shape(2))
        storage =
            pad(storage, {{0, 0},
                          {0, 0},
                          {0, ((end - storage.shape(2) + 127) / 128) * 128},
                          {0, 0}});
      auto stop = part.shape();
      stop[2] = end;
      storage = slice_update(storage, part, {0, 0, offset, 0}, stop);
      return slice(storage, {0, 0, 0, 0}, stop);
    };
    k = update(cache.at(i).first, k);
    v = update(cache.at(i).second, v);
    x = x +
        linear(attend(q, k, v, q.shape(2) > 1 ? "causal" : ""), p + "o_proj");
    y = rms(x, name + ".post_attention_layernorm");
    auto gate = linear(y, name + ".mlp.gate_proj");
    x = x + linear(gate * sigmoid(gate) * linear(y, name + ".mlp.up_proj"),
                   name + ".mlp.down_proj");
  }
  auto last = slice(x, {0, x.shape(1) - 1, 0}, {1, x.shape(1), x.shape(2)});
  return linear(rms(last, textPrefix + ".norm"),
                weights.count("llm.lm_head.weight")
                    ? "llm.lm_head"
                    : textPrefix + ".embed_tokens");
}

string QwenDecoder::generate(
    const string &before, const array &audio, const string &after,
    const std::function<void(const string &)> &partial) const {
  auto pre = tokenizer->Encode(before), post = tokenizer->Encode(after);
  const auto &table = weights.at(textPrefix + ".embed_tokens.weight");
  auto embed = [&](const std::vector<int32_t> &ids) {
    auto indices = array(ids.begin(), {int(ids.size())}, int32);
    auto rows = take(table, indices, 0);
    auto p = textPrefix + ".embed_tokens.";
    if (weights.count(p + "scales")) {
      auto &quant = config.at("quantization");
      rows = dequantize(rows, take(weights.at(p + "scales"), indices, 0),
                        take(weights.at(p + "biases"), indices, 0),
                        quant.at("group_size").get<int>(),
                        quant.at("bits").get<int>());
    }
    return expand_dims(rows, 0);
  };
  auto prefix = embed(pre);
  auto x = concatenate({prefix, astype(audio, prefix.dtype()), embed(post)}, 1);
  int offset = x.shape(1);
  Cache cache;
  if (offset + 512 > textConfig.at("max_position_embeddings").get<int>())
    throw std::invalid_argument("Prompt exceeds model context length");
  int consumed = 0;
  while (offset - consumed > 1) {
    int end = std::min(offset - 1, consumed + 2048);
    auto part = slice(x, {0, consumed, 0}, {1, end, x.shape(2)});
    eval(logits(part, cache, consumed));
    consumed = end;
  }
  auto scores = logits(slice(x, {0, consumed, 0}, {1, offset, x.shape(2)}),
                       cache, consumed);
  std::vector<int32_t> generated;
  for (int i = 0; i < 512; ++i) {
    int id = argmax(scores).item<int>();
    if (id == 151643 || id == 151645)
      break;
    generated.push_back(id);
    if (textPrefix == "model" && generated.size() >= 24 &&
        std::unordered_set<int32_t>(generated.end() - 24, generated.end())
                .size() <= 3)
      break;
    auto text = tokenizer->Decode(generated);
    if (text.find("�") == string::npos)
      partial(text);
    scores = logits(embed({id}), cache, offset++);
  }
  return tokenizer->Decode(generated);
}
