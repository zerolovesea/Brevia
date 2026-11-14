#pragma once
#include "SpeechModel.h"
class Parakeet final : public SpeechModel {
public:
  explicit Parakeet(const std::filesystem::path &path, int quantizeBits);
  nlohmann::json decode(
      const std::vector<float> &samples, const std::string &,
      const std::vector<std::string> &,
      const std::function<void(const std::string &)> &partial) const override;

private:
  Tensor encode(const Tensor &audio) const;
};
