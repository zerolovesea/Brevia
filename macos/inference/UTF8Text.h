#pragma once
#include <algorithm>
#include <string>

static bool validUTF8(const std::string &value) {
  for (size_t i = 0; i < value.size();) {
    auto first = static_cast<unsigned char>(value[i++]);
    if (first < 0x80) continue;
    int n = first >= 0xF0 ? 3 : first >= 0xE0 ? 2 : first >= 0xC2 ? 1 : -1;
    if (n < 0 || first > 0xF4 || i + n > value.size()) return false;
    auto second = static_cast<unsigned char>(value[i]);
    if ((first == 0xE0 && second < 0xA0) || (first == 0xED && second >= 0xA0) ||
        (first == 0xF0 && second < 0x90) || (first == 0xF4 && second >= 0x90)) return false;
    for (int j = 0; j < n; ++j)
      if ((static_cast<unsigned char>(value[i++]) & 0xC0) != 0x80) return false;
  }
  return true;
}

// 生成上限可能落在 UTF-8 字符中间；只去掉末尾残片，保留此前完整文本。
static std::string completeUTF8Prefix(const std::string &value) {
  for (size_t missing = 0; missing <= std::min<size_t>(3, value.size()); ++missing) {
    auto result = value.substr(0, value.size() - missing);
    if (validUTF8(result)) return result;
  }
  return "";
}
