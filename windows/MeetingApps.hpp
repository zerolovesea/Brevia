#pragma once
#include <filesystem>
#include <regex>
#include <string>

inline bool is_meet_title(const std::wstring &title) {
  static const std::wregex pattern = [] {
    const std::wstring code = L"[a-z]{3}-[a-z]{4}-[a-z]{3}";
    const std::wstring separator = LR"(\s*[-\u2013\u2014]\s*)";
    const std::wstring meet = L"(?:google )?meet";
    const auto titles = meet + separator + code + L"|" + code + separator +
                        meet + LR"(|(?:https://)?meet\.google\.com/)" + code;
    const auto browser =
        L"(?:google chrome|microsoft edge|mozilla firefox|brave|safari)";
    return std::wregex(LR"(^\s*(?:)" + titles + L")(?:" + separator + browser +
                           LR"()?\s*$)",
                       std::regex::icase);
  }();
  return std::regex_match(title, pattern);
}

// The conferencing SDK filename is shared by multiple desktop products.
inline const char *meeting_app(const std::wstring &name,
                               const std::filesystem::path &path) {
  if (name == L"zoom.exe" || name == L"caphost.exe")
    return "Zoom";
  if (name == L"wemeetapp.exe" || name == L"wemeet.exe")
    return "Tencent Meeting";
  if (name == L"discord.exe" || name == L"discordptb.exe" ||
      name == L"discordcanary.exe")
    return "Discord";
  if (name == L"teams.exe" || name == L"ms-teams.exe")
    return "Microsoft Teams";
  if (name == L"webex.exe" || name == L"webexmta.exe")
    return "Webex";
  if (name == L"iflymeeting.exe")
    return "讯飞会议";
  if (name == L"iflychat.exe" || name == L"i讯飞.exe")
    return "i讯飞";
  if (name == L"feishu.exe")
    return "飞书";
  if (name == L"lark.exe")
    return "Lark";
  if (name == L"dingtalk.exe")
    return "钉钉";
  if (name == L"wxwork.exe" || name == L"wwmapp.exe")
    return "企业微信";
  if (name == L"slack.exe")
    return "Slack";
  if (name == L"huaweimeeting.exe")
    return "华为云会议";
  if (name != L"video_conference_sdk.exe" || !path.has_parent_path())
    return nullptr;
  const auto installed = [&](const char *file) {
    std::error_code error;
    return std::filesystem::is_regular_file(
        path.parent_path() / std::filesystem::u8path(file), error);
  };
  const bool feishu = installed("Feishu.exe"), lark = installed("Lark.exe"),
             ifly = installed("iflychat.exe") || installed("i讯飞.exe");
  if (static_cast<int>(feishu) + lark + ifly != 1)
    return nullptr;
  if (feishu)
    return "飞书";
  return lark ? "Lark" : "i讯飞";
}

#ifdef _WIN32
#include <windows.h>

inline bool same_meeting_program(const std::filesystem::path &running,
                                 const std::string &selected) {
  if (running.empty())
    return false;
  const auto expected = std::filesystem::u8path(selected);
  return expected.is_absolute() &&
         CompareStringOrdinal(running.c_str(), -1, expected.c_str(), -1,
                              TRUE) == CSTR_EQUAL;
}
#endif
