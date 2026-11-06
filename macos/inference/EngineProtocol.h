#pragma once
#include "nlohmann/json.hpp"
#include <algorithm>
#include <cmath>
#include <istream>
#include <stdexcept>
#include <string>

using JSON = nlohmann::json;

static double number(const JSON &payload, const char *key, double fallback) {
  if (!payload.contains(key))
    return fallback;
  const auto &value = payload[key];
  if (!value.is_number() && !value.is_boolean())
    throw std::runtime_error("Expected a finite number");
  const double result =
      value.is_boolean() ? (value.get<bool>() ? 1 : 0) : value.get<double>();
  if (!std::isfinite(result))
    throw std::runtime_error("Expected a finite number");
  return result;
}

static int integer(const JSON &payload, const char *key, int fallback, int low,
                   int high) {
  // 先限制浮点范围再转整数，避免巨大 JSON 数字触发未定义行为。
  return static_cast<int>(
      std::clamp(number(payload, key, fallback), double(low), double(high)));
}

static bool readCommandLine(std::istream &input, std::string &line,
                            bool &oversized, size_t limit = 32 * 1024 * 1024) {
  line.clear();
  oversized = false;
  auto *buffer = input.rdbuf();
  for (;;) {
    auto value = buffer->sbumpc();
    if (std::char_traits<char>::eq_int_type(value,
                                            std::char_traits<char>::eof()))
      return !line.empty() || oversized;
    char character = std::char_traits<char>::to_char_type(value);
    if (character == '\n')
      return true;
    if (line.size() < limit)
      line.push_back(character);
    else
      oversized = true;
  }
}
