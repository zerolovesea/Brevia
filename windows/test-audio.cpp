#define BREVIA_AUDIO_TEST
#include "AudioCapture.cpp"
#include <cassert>
#include <sstream>

int main() {
  // 无设备测试只驱动真实回调；硬件断连与驱动重启由 Windows 实机回归验证。
  std::ostringstream output;
  auto *original = std::cout.rdbuf(output.rdbuf());
  {
    Capture capture(false);
    Track track;
    track.owner = &capture;
    track.name = "mic";
    track.device.pUserData = &track;
    std::vector<int16_t> samples(320, 16384);
    capture.command("start");
    Capture::audio(&track.device, nullptr, samples.data(), samples.size());
    capture.command("pause");
    Capture::audio(&track.device, nullptr, samples.data(), samples.size());
    ma_device_notification notification{};
    notification.pDevice = &track.device;
    notification.type = ma_device_notification_type_stopped;
    Capture::notification(&notification);
    capture.command("resume");
    Capture::audio(&track.device, nullptr, samples.data(), samples.size());
    Capture::notification(&notification);
    Capture::audio(&track.device, nullptr, samples.data(), samples.size());
    capture.command("stop");
  }
  std::cout.rdbuf(original);
  std::istringstream input(output.str());
  std::string line;
  std::vector<JSON> frames;
  std::vector<std::string> events;
  int errors = 0;
  while (std::getline(input, line)) {
    auto value = JSON::parse(line);
    if (value["type"] == "level")
      continue;
    events.push_back(value["type"] == "ack"
                         ? value["command"].get<std::string>()
                         : value["type"].get<std::string>());
    if (value["type"] == "audio")
      frames.push_back(value);
    if (value["type"] == "error")
      ++errors;
  }
  assert(
      (events == std::vector<std::string>{"start", "audio", "pause", "resume",
                                          "audio", "error", "stop"}));
  assert(errors == 1 && frames.size() == 2);
  assert(frames[0]["start_ms"] == 0 && frames[1]["start_ms"] == 20);
  auto bytes = base64::decode(frames[0]["pcm"].get<std::string>());
  assert(bytes.size() == 640 && bytes[0] == 0 && bytes[1] == 64);
}
