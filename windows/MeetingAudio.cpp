#include "MeetingApps.hpp"
#include "nlohmann/json.hpp"
#include <algorithm>
#include <audiopolicy.h>
#include <cwctype>
#include <endpointvolume.h>
#include <mmdeviceapi.h>
#include <string>
#include <vector>
#include <windows.h>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;

static std::filesystem::path process_path(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process)
    return {};
  wchar_t name[32768];
  DWORD size = ARRAYSIZE(name);
  bool found = QueryFullProcessImageNameW(process, 0, name, &size);
  CloseHandle(process);
  if (!found)
    return {};
  return std::wstring(name, size);
}

static std::wstring executable_name(const std::filesystem::path &path) {
  auto base = path.filename().wstring();
  std::transform(base.begin(), base.end(), base.begin(), towlower);
  return base;
}

struct BrowserWindow {
  std::wstring exe;
  bool meeting = false;
};
static BOOL CALLBACK find_meeting_window(HWND hwnd, LPARAM context) {
  if (!IsWindowVisible(hwnd) || IsIconic(hwnd))
    return TRUE;
  wchar_t title[512];
  if (!GetWindowTextW(hwnd, title, ARRAYSIZE(title)))
    return TRUE;
  if (!is_meet_title(title))
    return TRUE;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  auto &browser = *reinterpret_cast<BrowserWindow *>(context);
  browser.meeting = executable_name(process_path(pid)) == browser.exe;
  return !browser.meeting;
}

static const char *meeting_name(DWORD pid, const nlohmann::json &apps) {
  const auto path = process_path(pid);
  const auto name = executable_name(path);
  if (const char *app = meeting_app(name, path))
    return app;
  if (name == L"chrome.exe" || name == L"msedge.exe" ||
      name == L"firefox.exe" || name == L"brave.exe") {
    BrowserWindow browser{name};
    EnumWindows(find_meeting_window, reinterpret_cast<LPARAM>(&browser));
    return browser.meeting ? "Google Meet" : nullptr;
  }
  for (const auto &[id, label] : apps.items()) {
    if (same_meeting_program(path, id))
      return label.get_ref<const std::string &>().c_str();
  }
  return nullptr;
}

// Only read per-session peak meters. No loopback stream or microphone is
// opened.
nlohmann::json meeting_audio(const std::vector<std::string> &excluded,
                             const nlohmann::json &apps) {
  struct Meter {
    std::string name;
    ComPtr<IAudioMeterInformation> peak;
  };
  nlohmann::json result = {{"active", nlohmann::json::array()}};
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED)))
    return result;
  struct Cleanup {
    ~Cleanup() { CoUninitialize(); }
  } cleanup;
  std::vector<Meter> meters;
  ComPtr<IMMDeviceEnumerator> enumerator;
  ComPtr<IMMDeviceCollection> devices;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                              IID_PPV_ARGS(&enumerator))) ||
      FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE,
                                            &devices)))
    return result;
  UINT count = 0;
  devices->GetCount(&count);
  for (UINT d = 0; d < count; ++d) {
    ComPtr<IMMDevice> device;
    ComPtr<IAudioSessionManager2> manager;
    ComPtr<IAudioSessionEnumerator> sessions;
    if (FAILED(devices->Item(d, &device)) ||
        FAILED(device->Activate(
            __uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
            reinterpret_cast<void **>(manager.GetAddressOf()))) ||
        FAILED(manager->GetSessionEnumerator(&sessions)))
      continue;
    int total = 0;
    sessions->GetCount(&total);
    for (int i = 0; i < total; ++i) {
      ComPtr<IAudioSessionControl> session;
      ComPtr<IAudioSessionControl2> control;
      ComPtr<IAudioMeterInformation> peak;
      AudioSessionState state;
      DWORD pid = 0;
      if (FAILED(sessions->GetSession(i, &session)) ||
          FAILED(session->GetState(&state)) ||
          state != AudioSessionStateActive || FAILED(session.As(&control)) ||
          FAILED(control->GetProcessId(&pid)) || !pid ||
          FAILED(session.As(&peak)))
        continue;
      if (const char *name = meeting_name(pid, apps)) {
        result["active"].push_back(name);
        if (std::find(excluded.begin(), excluded.end(), name) == excluded.end())
          meters.push_back({name, peak});
      }
    }
  }
  for (int n = 0; !meters.empty() && n < 6; ++n) {
    if (n)
      Sleep(80);
    for (const auto &meter : meters) {
      float level = 0;
      if (SUCCEEDED(meter.peak->GetPeakValue(&level)) && level > 0.00001f) {
        result["audible"] = meter.name;
        return result;
      }
    }
  }
  return result;
}
