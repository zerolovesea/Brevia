#pragma once
#include "SpeechModel.h"
class FireRed final : public SpeechModel {
public:
  explicit FireRed(const std::filesystem::path &path);
  nlohmann::json
  decode(const std::vector<float> &samples, const std::string &,
         const std::vector<std::string> &,
         const std::function<void(const std::string &)> &) const override;

private:
  std::vector<float> means, inverseStd;
  std::vector<std::string> vocab;
  Tensor encode(const Tensor &audio) const;
  Tensor predict(int id, int position, const Tensor &encoder, Cache &self,
                 const Cache &cross) const;
};
