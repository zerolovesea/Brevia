#pragma once
#include "QwenDecoder.h"
class QwenASR final : public QwenDecoder {
public:
  explicit QwenASR(const std::filesystem::path &path);
  nlohmann::json decode(
      const std::vector<float> &samples, const std::string &language,
      const std::vector<std::string> &hotwords,
      const std::function<void(const std::string &)> &partial) const override;

private:
  Tensor audioEmbedding(const Tensor &audio) const;
};
