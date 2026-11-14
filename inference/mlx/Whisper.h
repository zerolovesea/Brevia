#pragma once
#include "SpeechModel.h"

class Whisper final : public SpeechModel {
public:
  explicit Whisper(const std::filesystem::path &path);
  nlohmann::json decode(
      const std::vector<float> &samples, const std::string &language,
      const std::vector<std::string> &words,
      const std::function<void(const std::string &)> &partial) const override;

private:
  nlohmann::json generation;
  Tensor encode(const Tensor &audio) const;
  Tensor attention(const Tensor &x, const Tensor &source, const std::string &p,
                   int heads, Cache *cache, int layer, bool cross) const;
};
