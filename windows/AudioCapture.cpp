#define NOMINMAX
#define MA_NO_DECODING
#define MA_NO_ENCODING
#define MA_NO_ENGINE
#define MA_NO_RESOURCE_MANAGER
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#define MA_ENABLE_WASAPI
#define MINIAUDIO_IMPLEMENTATION
#include "base64.hpp"
#include "miniaudio.h"
#include "nlohmann/json.hpp"
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#endif
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <deque>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
using JSON = nlohmann::json;
using Clock = std::chrono::steady_clock;
static void emit(const JSON &value) {
  std::cout << value.dump() << '\n' << std::flush;
}
static void check(ma_result result) {
  if (result != MA_SUCCESS)
    throw std::runtime_error("WASAPI audio error: " + std::to_string(result));
}
#ifndef BREVIA_AUDIO_TEST
static std::string device_id(const ma_device_id &id) {
  auto size = WideCharToMultiByte(CP_UTF8, 0, id.wasapi, -1, nullptr, 0,
                                  nullptr, nullptr);
  if (!size)
    throw std::runtime_error("Invalid audio device ID");
  std::string value(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, id.wasapi, -1, value.data(), size, nullptr,
                      nullptr);
  value.pop_back();
  return value;
}
static bool microphone_allowed() {
  // 桌面应用没有单独的权限弹窗，Windows 设置中的总开关与桌面开关都必须允许。
  for (HKEY hive : {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE})
    for (const wchar_t *suffix : {L"", L"\\NonPackaged"}) {
      auto key =
          std::wstring(L"Software\\Microsoft\\Windows\\CurrentVersion\\Capabili"
                       L"tyAccessManager\\ConsentStore\\microphone") +
          suffix;
      wchar_t value[32] = {};
      DWORD bytes = sizeof(value);
      if (RegGetValueW(hive, key.c_str(), L"Value", RRF_RT_REG_SZ, nullptr,
                       value, &bytes) == ERROR_SUCCESS &&
          _wcsicmp(value, L"Deny") == 0)
        return false;
    }
  return true;
}
#endif
struct Context {
  ma_context value{};
  Context() {
    ma_backend backend = ma_backend_wasapi;
    check(ma_context_init(&backend, 1, nullptr, &value));
  }
  ~Context() { ma_context_uninit(&value); }
};
struct Capture;
struct Track {
  Capture *owner;
  std::string name;
  ma_device device{};
  bool initialized = false;
  int64_t next = 0, start = 0;
  std::string samples;
  Clock::time_point last_level{};
  ~Track() {
    if (initialized)
      ma_device_uninit(&device);
  }
};
struct Capture {
  std::mutex mutex;
  std::condition_variable available;
  std::deque<JSON> output;
  std::thread writer;
  std::vector<std::unique_ptr<Track>> tracks;
  bool active = false, preview = false, finished = false, failed = false,
       expectedStop = false;
  int64_t elapsed = 0;
  Clock::time_point started;
  Capture(bool value) : preview(value) {
    writer = std::thread([this] {
      for (;;) {
        JSON item;
        {
          std::unique_lock<std::mutex> lock(mutex);
          available.wait(lock, [&] { return !output.empty() || finished; });
          if (output.empty())
            return;
          item = std::move(output.front());
          output.pop_front();
        }
        emit(item);
        if (!std::cout)
          std::_Exit(1);
      }
    });
  }
  ~Capture() {
    {
      std::lock_guard<std::mutex> lock(mutex);
      expectedStop = true;
      active = false;
      preview = false;
      flush();
    }
    tracks.clear();
    {
      std::lock_guard<std::mutex> lock(mutex);
      finished = true;
      available.notify_one();
    }
    writer.join();
  }
  void queue(JSON value) {
    output.push_back(std::move(value));
    available.notify_one();
  }
  void flush(Track &track) {
    if (track.samples.empty())
      return;
    queue({{"type", "audio"},
           {"track", track.name},
           {"sample_rate", 16000},
           {"start_ms", track.start / 16.},
           {"pcm", base64::encode(track.samples)}});
    track.samples.clear();
  }
  void flush() {
    for (auto &track : tracks)
      flush(*track);
  }
  static void notification(const ma_device_notification *event) {
    if (event->type != ma_device_notification_type_stopped &&
        event->type != ma_device_notification_type_interruption_began)
      return;
    auto &track = *static_cast<Track *>(event->pDevice->pUserData);
    auto &self = *track.owner;
    std::lock_guard<std::mutex> lock(self.mutex);
    if (self.expectedStop || self.failed)
      return;
    self.failed = true;
    self.active = false;
    self.flush();
    self.queue({{"type", "error"},
                {"message", "Audio input disconnected: " + track.name}});
  }
  static void audio(ma_device *device, void *, const void *input,
                    ma_uint32 frames) {
    auto &track = *static_cast<Track *>(device->pUserData);
    auto &self = *track.owner;
    std::lock_guard<std::mutex> lock(self.mutex);
    if (self.failed || !frames || (!self.active && !self.preview))
      return;
    // 合并后单包更大，相应缩小队列，管道阻塞时仍只保留有限音频。
    if (self.output.size() >= 512) {
      self.failed = true;
      self.active = false;
      self.flush();
      self.queue(
          {{"type", "error"}, {"message", "Audio storage cannot keep up"}});
      return;
    }
    const auto now = Clock::now();
    std::string pcm(frames * 2, '\0');
    if (input)
      memcpy(pcm.data(), input, pcm.size());
    if (now - track.last_level >= std::chrono::milliseconds(160)) {
      double power = 0;
      for (size_t i = 0; i < pcm.size(); i += 2) {
        auto sample =
            static_cast<int16_t>(static_cast<unsigned char>(pcm[i]) |
                                 static_cast<unsigned char>(pcm[i + 1]) << 8) /
            32768.;
        power += sample * sample;
      }
      self.queue({{"type", "level"},
                  {"track", track.name},
                  {"level", std::sqrt(power / frames)}});
      track.last_level = now;
    }
    if (!self.active || self.preview)
      return;
    auto position = self.elapsed +
                    std::chrono::duration_cast<std::chrono::microseconds>(
                        now - self.started)
                            .count() *
                        16 / 1000 -
                    frames;
    // 两路共用单调时钟；只补真实的设备间隙，不把每次回调抖动写进音轨。
    if (position - track.next > 1600) {
      self.flush(track);
      track.next = std::max<int64_t>(0, position);
    }
    if (track.samples.empty())
      track.start = track.next;
    track.samples.append(pcm);
    track.next += frames;
    // 与 macOS 一样累计约 160 ms，避免双轨 20 ms 回调挤占业务 RPC 限额。
    if (track.samples.size() >= 5120)
      self.flush(track);
  }
  void add(Context &context, const std::string &name, const ma_device_id *id) {
    auto track = std::make_unique<Track>();
    track->owner = this;
    track->name = name;
    auto config = ma_device_config_init(
        name == "mic" ? ma_device_type_capture : ma_device_type_loopback);
    config.capture.pDeviceID = id;
    config.capture.format = ma_format_s16;
    config.capture.channels = 1;
    config.sampleRate = 16000;
    config.periodSizeInMilliseconds = 20;
    config.dataCallback = audio;
    config.notificationCallback = notification;
    config.pUserData = track.get();
    config.wasapi.noAutoConvertSRC = MA_FALSE;
    check(ma_device_init(&context.value, &config, &track->device));
    track->initialized = true;
    check(ma_device_start(&track->device));
    std::lock_guard<std::mutex> lock(mutex);
    tracks.push_back(std::move(track));
  }
  void command(const std::string &name) {
    const bool starting = name == "start" || name == "resume";
    if (!starting && name != "pause" && name != "stop")
      throw std::runtime_error("Unknown audio command");
    {
      std::lock_guard<std::mutex> lock(mutex);
      if (failed && name != "stop")
        throw std::runtime_error("Audio capture has failed");
      if (starting) {
        if (!active) {
          started = Clock::now();
          for (auto &track : tracks)
            track->next = elapsed;
          active = true;
        }
        expectedStop = false;
      } else {
        if (active)
          elapsed += std::chrono::duration_cast<std::chrono::microseconds>(
                         Clock::now() - started)
                         .count() *
                     16 / 1000;
        // 已发送帧可能略领先回调时钟；恢复时不能覆盖上一段末尾。
        for (auto &track : tracks)
          elapsed = std::max(elapsed, track->next);
        active = false;
        expectedStop = true;
        flush();
        if (name == "stop")
          preview = false;
      }
    }
    // WASAPI 停启会等待音频线程；持有回调锁会死锁。
    for (auto &track : tracks)
      if (track->initialized)
        check(starting ? ma_device_start(&track->device)
                       : ma_device_stop(&track->device));
    std::lock_guard<std::mutex> lock(mutex);
    if (failed && name != "stop")
      throw std::runtime_error("Audio capture has failed");
    queue({{"type", "ack"}, {"command", name}});
  }
};
#ifndef BREVIA_AUDIO_TEST
int main(int argc, char **argv) {
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  try {
    std::vector<std::string> args(argv + 1, argv + argc);
    if (args.empty())
      throw std::runtime_error("Missing audio command");
    auto has = [&](const std::string &value) {
      return std::find(args.begin(), args.end(), value) != args.end();
    };
    if (args[0] == "permissions") {
      emit({{"microphone", microphone_allowed() ? "granted" : "denied"},
            {"screen", "granted"},
            {"systemAudioSupported", true}});
      return 0;
    }
    if (args[0] == "request-screen") {
      emit(true);
      return 0;
    }
    if (args[0] == "request-microphone") {
      if (!microphone_allowed()) {
        emit(false);
        return 0;
      }
      try {
        // 权限查询只返回一个 JSON 值，不能混入预览的电平事件。
        Context context;
        Track track;
        auto config = ma_device_config_init(ma_device_type_capture);
        config.capture.format = ma_format_s16;
        config.capture.channels = 1;
        config.sampleRate = 16000;
        check(ma_device_init(&context.value, &config, &track.device));
        track.initialized = true;
        check(ma_device_start(&track.device));
        check(ma_device_stop(&track.device));
        emit(true);
      } catch (const std::exception &) {
        emit(false);
      }
      return 0;
    }
    Context context;
    ma_device_info *inputs = nullptr;
    ma_uint32 count = 0;
    check(ma_context_get_devices(&context.value, nullptr, nullptr, &inputs,
                                 &count));
    if (args[0] == "devices") {
      auto result = JSON::array();
      for (ma_uint32 i = 0; i < count; i++)
        result.push_back(
            {{"deviceId", device_id(inputs[i].id)}, {"label", inputs[i].name}});
      emit(result);
      return 0;
    }
    if (args[0] != "capture" || (!has("--mic") && !has("--system")))
      throw std::runtime_error("Select an audio input");
    bool fallback = false;
    ma_device_id selected;
    const ma_device_id *id = nullptr;
    auto pos = std::find(args.begin(), args.end(), "--device");
    if (pos != args.end()) {
      if (++pos == args.end())
        throw std::runtime_error("Missing audio device ID");
      for (ma_uint32 i = 0; i < count; i++)
        if (device_id(inputs[i].id) == *pos) {
          selected = inputs[i].id;
          id = &selected;
          break;
        }
      fallback = !id;
    }
    Capture capture(has("--preview"));
    if (has("--mic")) {
      if (!microphone_allowed())
        throw std::runtime_error("Microphone access denied");
      capture.add(context, "mic", id);
    }
    if (has("--system"))
      capture.add(context, "system", nullptr);
    {
      std::lock_guard<std::mutex> lock(capture.mutex);
      capture.queue({{"type", "ready"}, {"micFellBack", fallback}});
    }
    std::string command;
    while (std::getline(std::cin, command)) {
      if (!command.empty() && command.back() == '\r')
        command.pop_back();
      capture.command(command);
      if (command == "stop")
        break;
    }
  } catch (const std::exception &e) {
    emit({{"type", "error"}, {"message", e.what()}});
    return 1;
  }
}

#endif
