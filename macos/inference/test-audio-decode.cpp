#include <cassert>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>
extern void decode_audio(const char *, const char *, int, int);

int main() {
  const auto directory =
      std::filesystem::temp_directory_path() /
      ("brevia-decoder-test-" +
       std::to_string(
           std::chrono::steady_clock::now().time_since_epoch().count()));
  std::filesystem::create_directory(directory);
  struct Cleanup {
    std::filesystem::path path;
    ~Cleanup() { std::filesystem::remove_all(path); }
  } cleanup{directory};
  const auto source = directory / std::filesystem::u8path("中文录音.wav");
  const auto alias = directory / "same-recording.wav";
  const auto destination = directory / std::filesystem::u8path("转码.wav");
  std::vector<unsigned char> bytes(44 + 4800 * 4);
  auto put = [&](size_t at, uint32_t value, int size = 4) {
    for (int i = 0; i < size; ++i)
      bytes[at + i] = value >> (i * 8);
  };
  auto literal = [&](size_t at, const std::string &value) {
    for (size_t i = 0; i < value.size(); ++i)
      bytes[at + i] = value[i];
  };
  literal(0, "RIFF");
  put(4, bytes.size() - 8);
  literal(8, "WAVEfmt ");
  put(16, 16);
  put(20, 1, 2);
  put(22, 2, 2);
  put(24, 48000);
  put(28, 192000);
  put(32, 4, 2);
  put(34, 16, 2);
  literal(36, "data");
  put(40, bytes.size() - 44);
  std::ofstream input(source, std::ios::binary);
  input.write(reinterpret_cast<const char *>(bytes.data()), bytes.size());
  input.close();
  std::filesystem::create_hard_link(source, alias);
  bool rejected = false;
  try {
    decode_audio(source.u8string().c_str(), alias.u8string().c_str(), 16000, 1);
  } catch (const std::exception &) {
    rejected = true;
  }
  assert(rejected && std::filesystem::file_size(source) == bytes.size());
  decode_audio(source.u8string().c_str(), destination.u8string().c_str(), 16000,
               1);
  std::ifstream output(destination, std::ios::binary);
  std::vector<unsigned char> decoded{std::istreambuf_iterator<char>(output),
                                     {}};
  assert(decoded.size() > 44 && decoded[0] == 'R' && decoded[22] == 1);
  assert((uint32_t(decoded[24]) | uint32_t(decoded[25]) << 8 |
          uint32_t(decoded[26]) << 16 | uint32_t(decoded[27]) << 24) == 16000);
  assert(std::filesystem::file_size(source) == bytes.size());
}
