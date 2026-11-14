#pragma once
#include "EngineProtocol.h"
#include "base64.hpp"
#include <vector>

static std::vector<float> pcm(const JSON &p) {
  if (number(p, "sample_rate", 16000) != 16000)
    throw std::runtime_error("Expected 16 kHz mono PCM16");
  if (!p.contains("pcm") || !p["pcm"].is_string())
    throw std::runtime_error("Expected a string");
  const auto &encoded = p["pcm"].get_ref<const std::string &>();
  std::string data;
  try {
    data = base64::decode(encoded);
  } catch (const base64_error &) {
    throw std::runtime_error("Invalid or oversized PCM");
  }
  if (data.empty() || data.size() % 2 || data.size() > 16000 * 2 * 600 ||
      base64::encode(data) != encoded)
    throw std::runtime_error("Invalid or oversized PCM");
  std::vector<float> samples(data.size() / 2);
  const auto *bytes = reinterpret_cast<const uint8_t *>(data.data());
  for (size_t i = 0; i < samples.size(); ++i)
    samples[i] = (int16_t)(bytes[2 * i] | bytes[2 * i + 1] << 8) / 32768.f;
  return samples;
}
