#define STB_VORBIS_HEADER_ONLY
#include "stb_vorbis.c"
#define MA_NO_DEVICE_IO
#define MA_NO_ENGINE
#define MA_NO_RESOURCE_MANAGER
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#undef STB_VORBIS_HEADER_ONLY
#include "extras/decoders/libopus/miniaudio_libopus.h"
#include "stb_vorbis.c"
#include <array>
#include <cstdio>
#include <filesystem>
#include <memory>
#include <stdexcept>

#ifdef _WIN32
extern bool decode_windows_audio(const char *, const char *, int, int);
#endif

void decode_audio(const char *source, const char *destination, int rate,
                  int channels) {
  if (rate < 8000 || rate > 192000 || channels < 1 || channels > 2)
    throw std::runtime_error("Invalid decode format");
  const auto inputPath = std::filesystem::u8path(source);
  const auto outputPath = std::filesystem::u8path(destination);
  if (std::filesystem::weakly_canonical(inputPath) ==
          std::filesystem::weakly_canonical(outputPath) ||
      (std::filesystem::exists(outputPath) &&
       std::filesystem::equivalent(inputPath, outputPath)))
    throw std::runtime_error("Audio source must be preserved");
#ifdef _WIN32
  if (decode_windows_audio(source, destination, rate, channels))
    return;
#endif
  ma_decoder_config config =
      ma_decoder_config_init(ma_format_s16, channels, rate);
  ma_decoding_backend_vtable *backends[] = {ma_decoding_backend_libopus};
  config.ppCustomBackendVTables = backends;
  config.customBackendCount = 1;
  ma_decoder decoder;
#ifdef _WIN32
  const auto decoded =
      ma_decoder_init_file_w(inputPath.c_str(), &config, &decoder);
#else
  const auto decoded = ma_decoder_init_file(source, &config, &decoder);
#endif
  if (decoded != MA_SUCCESS)
    throw std::runtime_error("The native decoder cannot read this audio file");
  struct Cleanup {
    ma_decoder *decoder;
    ~Cleanup() { ma_decoder_uninit(decoder); }
  } cleanup{&decoder};
  ma_encoder_config output_config = ma_encoder_config_init(
      ma_encoding_format_wav, ma_format_s16, channels, rate);
  ma_encoder output;
#ifdef _WIN32
  const auto encoded =
      ma_encoder_init_file_w(outputPath.c_str(), &output_config, &output);
#else
  const auto encoded =
      ma_encoder_init_file(destination, &output_config, &output);
#endif
  if (encoded != MA_SUCCESS)
    throw std::runtime_error("Cannot create decoded audio");
  struct OutputCleanup {
    ma_encoder *encoder;
    ~OutputCleanup() { ma_encoder_uninit(encoder); }
  } output_cleanup{&output};
  std::array<int16_t, 16384> buffer;
  uint64_t frames_written = 0;
  for (;;) {
    ma_uint64 frames = 0;
    auto result = ma_decoder_read_pcm_frames(&decoder, buffer.data(),
                                             buffer.size() / channels, &frames);
    if (result != MA_SUCCESS && result != MA_AT_END)
      throw std::runtime_error("Audio decoding failed");
    if (!frames)
      break;
    frames_written += frames;
    if (frames_written * channels * 2 > UINT32_MAX - 44)
      throw std::runtime_error("Audio exceeds WAV size limit");
    ma_uint64 written = 0;
    if (ma_encoder_write_pcm_frames(&output, buffer.data(), frames, &written) !=
            MA_SUCCESS ||
        written != frames)
      throw std::runtime_error("Could not write decoded audio");
  }
  if (!frames_written)
    throw std::runtime_error("Audio file contains no samples");
}
