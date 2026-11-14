#pragma once
#include "mlx/mlx.h"
#include <filesystem>
#include <functional>
#include <nlohmann/json.hpp>
#include <tokenizers_cpp.h>

class SpeechModel {
public:
  virtual ~SpeechModel() = default;
  void prepareCpuWeights();
  virtual nlohmann::json
  decode(const std::vector<float> &samples, const std::string &language,
         const std::vector<std::string> &hotwords,
         const std::function<void(const std::string &)> &partial) const = 0;

protected:
  using Tensor = mlx::core::array;
  using Cache = std::vector<std::pair<Tensor, Tensor>>;
  nlohmann::json config;
  std::unordered_map<std::string, Tensor> weights;
  std::unique_ptr<tokenizers::Tokenizer> tokenizer;
  void loadWeights(const std::filesystem::path &path);
  void load(const std::filesystem::path &path,
            const std::filesystem::path &tokenizerPath);
  Tensor linear(const Tensor &x, const std::string &name) const;
  Tensor norm(const Tensor &x, const std::string &name) const;
  Tensor feedForward(const Tensor &x, const std::string &block) const;
  static Tensor heads(const Tensor &x, int count);
  static Tensor attend(const Tensor &q, const Tensor &k, const Tensor &v,
                       const std::string &mask = "");
  static Tensor logMel(const Tensor &audio, int bins);
  static Tensor slaneyFilters(int fftSize, int bins);
  static Tensor gelu(const Tensor &x);
};
