#define BREVIA_AUDIO_TEST
#include "AudioCapture.cpp"
#include "MeetingApps.hpp"
#include <cassert>
#include <fstream>
#include <functional>
#include <sstream>

static Track &addTrack(Capture &capture, const std::string &name) {
  auto track = std::make_unique<Track>();
  track->owner = &capture;
  track->name = name;
  track->device.pUserData = track.get();
  capture.tracks.push_back(std::move(track));
  return *capture.tracks.back();
}
static void audio(Track &track) {
  const std::vector<int16_t> samples(320, 16384);
  Capture::audio(&track.device, nullptr, samples.data(), samples.size());
}
static std::vector<JSON> collect(const std::function<void()> &run) {
  std::ostringstream output;
  auto *original = std::cout.rdbuf(output.rdbuf());
  run(); // Capture 析构等待 writer 排空后才读取输出，避免测试本身的数据竞争。
  std::cout.rdbuf(original);
  std::istringstream input(output.str());
  std::string line;
  std::vector<JSON> events;
  while (std::getline(input, line)) {
    auto value = JSON::parse(line);
    if (value["type"] != "level")
      events.push_back(std::move(value));
  }
  return events;
}
static void expectAudio(const JSON &value, size_t bytes, double startMs) {
  assert(value["type"] == "audio" && value["sample_rate"] == 16000);
  assert(value["start_ms"] == startMs);
  const auto pcm = base64::decode(value["pcm"].get<std::string>());
  assert(pcm.size() == bytes);
  for (size_t i = 0; i < pcm.size(); i += 2)
    assert(pcm[i] == 0 && pcm[i + 1] == 64);
}
int main() {
  const auto selected =
      std::filesystem::u8path(u8"C:\\Enterprise\\会议\\Call.exe");
  assert(same_meeting_program(selected, u8"c:\\enterprise\\会议\\call.exe"));
  assert(!same_meeting_program(selected, u8"C:\\Other\\会议\\Call.exe"));
  assert(!same_meeting_program(selected, "Call.exe"));
  assert(std::string(meeting_app(L"iflymeeting.exe", {})) == "讯飞会议");
  assert(std::string(meeting_app(L"iflychat.exe", {})) == "i讯飞");
  assert(std::string(meeting_app(L"i讯飞.exe", {})) == "i讯飞");
  assert(!meeting_app(L"iflyrecclient.exe", {}));
  assert(std::string(meeting_app(L"feishu.exe", {})) == "飞书");
  assert(std::string(meeting_app(L"lark.exe", {})) == "Lark");
  assert(std::string(meeting_app(L"dingtalk.exe", {})) == "钉钉");
  assert(std::string(meeting_app(L"wxwork.exe", {})) == "企业微信");
  assert(std::string(meeting_app(L"wwmapp.exe", {})) == "企业微信");
  assert(std::string(meeting_app(L"slack.exe", {})) == "Slack");
  assert(std::string(meeting_app(L"huaweimeeting.exe", {})) == "华为云会议");
  assert(!meeting_app(L"notfeishu.exe", {}) && !meeting_app(L"hwmsdk.exe", {}));
  const auto dir =
      std::filesystem::temp_directory_path() /
      ("brevia-meeting-sdk-" + std::to_string(GetCurrentProcessId()));
  std::filesystem::create_directory(dir);
  const auto sdk = dir / "video_conference_sdk.exe";
  assert(!meeting_app(L"video_conference_sdk.exe", sdk));
  std::ofstream(dir / "Feishu.exe").put('F');
  assert(std::string(meeting_app(L"video_conference_sdk.exe", sdk)) == "飞书");
  std::ofstream(dir / "Lark.exe").put('L');
  assert(!meeting_app(L"video_conference_sdk.exe", sdk));
  std::filesystem::remove(dir / "Feishu.exe");
  assert(std::string(meeting_app(L"video_conference_sdk.exe", sdk)) == "Lark");
  std::filesystem::remove(dir / "Lark.exe");
  std::ofstream(dir / "iflychat.exe").put('I');
  assert(std::string(meeting_app(L"video_conference_sdk.exe", sdk)) == "i讯飞");
  std::filesystem::remove(dir / "iflychat.exe");
  std::filesystem::remove(dir);
  assert(is_meet_title(L"Meet - abc-defg-hij"));
  assert(is_meet_title(L"Meet \u2013 abc-defg-hij - Google Chrome"));
  assert(is_meet_title(L"https://meet.google.com/abc-defg-hij"));
  for (auto title :
       {L"YouTube Music", L"Google Meet tips - YouTube - Google Chrome",
        L"Meet - abc-defg-hij - YouTube", L"Google Meet tutorial _bilibili",
        L"meet.google.com/abc-defg-hij - Bilibili", L"Google Meet",
        L"Meet - video"})
    assert(!is_meet_title(title));
  const auto packetRate = collect([] {
    Capture capture(false);
    Track mic;
    mic.owner = &capture;
    mic.name = "mic";
    mic.device.pUserData = &mic;
    capture.command("start");
    for (int i = 0; i < 8; ++i)
      audio(mic);
    capture.command("stop");
  });
  assert(packetRate.size() == 3);
  expectAudio(packetRate[1], 5120, 0);

  // 真实采集回调和控制逻辑；未初始化的 Track 不调用系统设备停启。
  const auto batches = collect([] {
    Capture capture(false);
    auto &mic = addTrack(capture, "mic");
    capture.command("start");
    for (int i = 0; i < 9; ++i)
      audio(mic);
    capture.started = Clock::now();
    capture.command("pause");
    audio(mic);
    ma_device_notification notification{};
    notification.pDevice = &mic.device;
    notification.type = ma_device_notification_type_stopped;
    Capture::notification(&notification);
    capture.command("resume");
    audio(mic);
    capture.command("stop");
  });
  assert(batches.size() == 7);
  assert(batches[0]["command"] == "start");
  expectAudio(batches[1], 5120, 0);
  expectAudio(batches[2], 640, 160); // pause 的不足一包音频在确认前落盘。
  assert(batches[3]["command"] == "pause");
  assert(batches[4]["command"] == "resume");
  expectAudio(batches[5], 640, 180);
  assert(batches[6]["command"] == "stop");

  const auto disconnected = collect([] {
    Capture capture(false);
    auto &mic = addTrack(capture, "mic");
    auto &system = addTrack(capture, "system");
    capture.command("start");
    audio(mic);
    audio(system);
    ma_device_notification notification{};
    notification.pDevice = &mic.device;
    notification.type = ma_device_notification_type_interruption_began;
    Capture::notification(&notification);
    audio(system);
    Capture::notification(&notification);
    capture.command("stop");
  });
  assert(disconnected.size() == 5);
  expectAudio(disconnected[1], 640, 0);
  expectAudio(disconnected[2], 640, 0);
  assert(disconnected[1]["track"] == "mic");
  assert(disconnected[2]["track"] == "system");
  assert(disconnected[3]["type"] == "error");
  assert(disconnected[4]["command"] == "stop");

  const auto gap = collect([] {
    Capture capture(false);
    auto &mic = addTrack(capture, "mic");
    capture.command("start");
    audio(mic);
    capture.started = Clock::now() - std::chrono::milliseconds(500);
    audio(mic);
    capture.command("stop");
  });
  assert(gap.size() == 4);
  expectAudio(gap[1], 640, 0);
  assert(gap[2]["start_ms"].get<double>() >= 480);
  expectAudio(gap[2], 640, gap[2]["start_ms"]);
  assert(gap[3]["command"] == "stop");

  const auto eof = collect([] {
    Capture capture(false);
    auto &mic = addTrack(capture, "mic");
    capture.command("start");
    audio(mic);
  });
  assert(eof.size() == 2);
  expectAudio(eof[1], 640, 0);

  const auto preview = collect([] {
    Capture capture(true);
    auto &mic = addTrack(capture, "mic");
    for (int i = 0; i < 9; ++i)
      audio(mic);
    capture.command("stop");
  });
  assert(preview.size() == 1 && preview[0]["command"] == "stop");
}
