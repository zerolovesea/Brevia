#include "EnginePCM.h"
#include "FireRed.h"
#include "Nano.h"
#include "Parakeet.h"
#include "QwenASR.h"
#include "Whisper.h"
#include <iostream>

int main() {
  std::unique_ptr<SpeechModel> model;
  std::string language;
  std::vector<std::string> hotwords;
  int maximumSeconds = 20;
  bool oversized;
  std::string line;
  while (readCommandLine(std::cin, line, oversized)) {
    JSON id;
    try {
      if (oversized)
        throw std::runtime_error("Inference command too large");
      auto req = JSON::parse(line);
      id = req.at("id");
      const auto &payload = req.at("payload");
      JSON result;
      if (req.at("type") == "engine.check") {
        using namespace mlx::core;
        auto device = payload.value("device", "cpu");
        if (device != "cpu" && device != "gpu")
          throw std::runtime_error("Unknown device");
        auto target = device == "cpu" ? Device::cpu : Device::gpu;
        if (!is_available(target))
          throw std::runtime_error("MLX device unavailable");
        auto value = add(array(2), array(3), Device(target));
        result = {{"value", value.item<int>()}};
      } else if (req.at("type") == "asr.load") {
        if (payload.at("kind") != "funasr-nano" &&
            payload.at("kind") != "qwen3" && payload.at("kind") != "whisper" &&
            payload.at("kind") != "nemo-transducer" &&
            payload.at("kind") != "fireredasr2")
          throw std::runtime_error("Unsupported MLX model family");
        auto device = payload.value("device", "auto");
        using namespace mlx::core;
        if (device != "auto" && device != "cpu" && device != "gpu")
          throw std::runtime_error("Unknown device");
        auto d =
            device == "cpu" || (device == "auto" && !is_available(Device::gpu))
                ? Device::cpu
                : Device::gpu;
        if (!is_available(d))
          throw std::runtime_error("MLX device unavailable");
        std::unique_ptr<SpeechModel> next;
        model.reset();
        set_default_device(d);
        language = payload.value("language", "auto");
        hotwords = payload.value("hotwords", std::vector<std::string>{});
        auto path =
            std::filesystem::u8path(payload.at("path").get<std::string>());
        if (payload.at("kind") == "qwen3")
          next = std::make_unique<QwenASR>(path);
        else if (payload.at("kind") == "whisper")
          next = std::make_unique<Whisper>(path);
        else if (payload.at("kind") == "fireredasr2")
          next = std::make_unique<FireRed>(path);
        else if (payload.at("kind") == "nemo-transducer")
          next = std::make_unique<Parakeet>(path,
                                            payload.value("quantize_bits", 0));
        else
          next = std::make_unique<Nano>(path);
        const auto &kind = payload.at("kind");
        int limit = kind == "qwen3"         ? 50
                    : kind == "whisper"     ? 30
                    : kind == "funasr-nano" ? 22
                                            : 20;
        maximumSeconds = ::integer(payload, "max_speech_seconds", 20, 1, limit);
        if (d == Device::cpu)
          next->prepareCpuWeights();
        model = std::move(next);
        result = {{"max_speech_seconds", maximumSeconds},
                  {"device", d == Device::cpu ? "cpu" : "gpu"}};
      } else if (req.at("type") == "asr.decode") {
        if (!model)
          throw std::runtime_error("Load a model first");
        auto samples = pcm(payload);
        if (samples.size() > static_cast<size_t>(maximumSeconds) * 16000)
          throw std::runtime_error("Segment exceeds model duration");
        if (samples.size() < 400)
          result = {{"text", ""}, {"words", JSON::array()}};
        else
          result = model->decode(
              samples, language, hotwords, [&](const auto &value) {
                std::cout << JSON({{"type", "asr.partial"},
                                   {"payload", {{"id", id}, {"text", value}}}})
                                 .dump()
                          << std::endl;
              });

      } else
        throw std::runtime_error("Unknown inference command");
      std::cout << JSON({{"id", id}, {"ok", true}, {"result", result}}).dump()
                << std::endl;
    } catch (const std::exception &e) {
      std::cout << JSON({{"id", id}, {"ok", false}, {"error", e.what()}})
                       .dump(-1, ' ', false, JSON::error_handler_t::replace)
                << std::endl;
    }
  }
}
