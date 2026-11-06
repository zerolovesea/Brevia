#define NOMINMAX
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <stdexcept>
#include <string>
#include <windows.h>
#include <wrl/client.h>
using Microsoft::WRL::ComPtr;
static void check(HRESULT hr) {
  if (FAILED(hr))
    throw std::runtime_error("Windows audio decode failed: " +
                             std::to_string(static_cast<unsigned long>(hr)));
}
// Media Foundation 提供 AAC/M4A/MP4 等系统编解码器；不支持的容器交给
// miniaudio。
bool decode_windows_audio(const char *source, const char *destination, int rate,
                          int channels) {
  // N 版可能没有系统媒体组件；不能让可选解码器阻断所有本地推理。
  struct Module {
    HMODULE value;
    ~Module() {
      if (value)
        FreeLibrary(value);
    }
  } platform{
      LoadLibraryExW(L"mfplat.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32)},
      readwrite{LoadLibraryExW(L"mfreadwrite.dll", nullptr,
                               LOAD_LIBRARY_SEARCH_SYSTEM32)};
  if (!platform.value || !readwrite.value)
    return false;
  auto startup = reinterpret_cast<decltype(&MFStartup)>(
      GetProcAddress(platform.value, "MFStartup"));
  auto shutdown = reinterpret_cast<decltype(&MFShutdown)>(
      GetProcAddress(platform.value, "MFShutdown"));
  auto createType = reinterpret_cast<decltype(&MFCreateMediaType)>(
      GetProcAddress(platform.value, "MFCreateMediaType"));
  auto createReader = reinterpret_cast<decltype(&MFCreateSourceReaderFromURL)>(
      GetProcAddress(readwrite.value, "MFCreateSourceReaderFromURL"));
  if (!startup || !shutdown || !createType || !createReader)
    return false;
  HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(initialized) && initialized != RPC_E_CHANGED_MODE)
    check(initialized);
  struct COM {
    bool owned;
    ~COM() {
      if (owned)
        CoUninitialize();
    }
  } com{SUCCEEDED(initialized)};
  check(startup(MF_VERSION, MFSTARTUP_LITE));
  struct MF {
    decltype(&MFShutdown) shutdown;
    ~MF() { shutdown(); }
  } mf{shutdown};
  ComPtr<IMFSourceReader> reader;
  if (FAILED(createReader(std::filesystem::u8path(source).c_str(), nullptr,
                          &reader)))
    return false;
  check(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE));
  check(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, TRUE));
  ComPtr<IMFMediaType> type;
  check(createType(&type));
  check(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio));
  check(type->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM));
  check(type->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, channels));
  check(type->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, rate));
  check(type->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16));
  check(type->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, channels * 2));
  check(type->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, rate * channels * 2));
  if (FAILED(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM,
                                         nullptr, type.Get())))
    return false;
  FILE *output = _wfopen(std::filesystem::u8path(destination).c_str(), L"wb");
  if (!output)
    throw std::runtime_error("Cannot create decoded audio");
  struct File {
    FILE *f;
    ~File() { fclose(f); }
  } file{output};
  unsigned char header[44] = {'R', 'I', 'F', 'F', 0,   0,  0, 0, 'W', 'A', 'V',
                              'E', 'f', 'm', 't', ' ', 16, 0, 0, 0,   1,   0};
  auto write32 = [&](int offset, uint32_t value) {
    for (int i = 0; i < 4; i++)
      header[offset + i] = value >> (8 * i);
  };
  header[22] = channels;
  write32(24, rate);
  write32(28, rate * channels * 2);
  header[32] = channels * 2;
  header[34] = 16;
  memcpy(header + 36, "data", 4);
  if (fwrite(header, 1, 44, output) != 44)
    throw std::runtime_error("Cannot write audio header");
  uint64_t bytes = 0;
  for (;;) {
    DWORD flags = 0;
    ComPtr<IMFSample> sample;
    check(reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, nullptr,
                             &flags, nullptr, &sample));
    if (flags & MF_SOURCE_READERF_ERROR)
      throw std::runtime_error("Windows audio stream error");
    if (flags & MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED)
      throw std::runtime_error("Audio format changed while decoding");
    if (sample) {
      ComPtr<IMFMediaBuffer> buffer;
      check(sample->ConvertToContiguousBuffer(&buffer));
      BYTE *data = nullptr;
      DWORD length = 0;
      check(buffer->Lock(&data, nullptr, &length));
      struct Lock {
        IMFMediaBuffer *buffer;
        ~Lock() { buffer->Unlock(); }
      } lock{buffer.Get()};
      bytes += length;
      if (bytes > UINT32_MAX - 44)
        throw std::runtime_error("Audio exceeds WAV size limit");
      if (fwrite(data, 1, length, output) != length)
        throw std::runtime_error("Cannot write decoded audio");
    }
    if (flags & MF_SOURCE_READERF_ENDOFSTREAM)
      break;
  }
  if (!bytes)
    throw std::runtime_error("Audio file contains no samples");
  write32(4, static_cast<uint32_t>(bytes) + 36);
  write32(40, static_cast<uint32_t>(bytes));
  if (fseek(output, 0, SEEK_SET) || fwrite(header, 1, 44, output) != 44 ||
      fflush(output))
    throw std::runtime_error("Cannot finish decoded audio");
  return true;
}
