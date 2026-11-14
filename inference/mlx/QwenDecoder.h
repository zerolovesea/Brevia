#pragma once
#include "SpeechModel.h"
class QwenDecoder : public SpeechModel {
protected:
  nlohmann::json textConfig;
  std::string textPrefix;
  std::string
  generate(const std::string &before, const Tensor &audio,
           const std::string &after,
           const std::function<void(const std::string &)> &partial) const;
  Tensor logits(Tensor hidden, Cache &cache, int offset) const;
};
