import 'package:flutter/widgets.dart';
import 'translations.dart';

const languageNames = {
  'zh': '简体中文',
  'en': 'English',
  'es': 'Español',
  'ja': '日本語',
  'ko': '한국어',
  'fr': 'Français',
  'de': 'Deutsch',
  'ru': 'Русский',
};
String uiLanguage = 'system';
String get languageCode {
  if (languageNames.containsKey(uiLanguage)) return uiLanguage;
  for (final locale in WidgetsBinding.instance.platformDispatcher.locales) {
    if (languageNames.containsKey(locale.languageCode)) {
      return locale.languageCode;
    }
  }
  return 'en';
}

String tr(String key, [List<Object?> args = const []]) {
  final text = languageCode == 'zh'
      ? key
      : translations[languageCode]?[key] ?? translations['en']?[key] ?? key;
  return text.replaceAllMapped(RegExp(r'\{(\d+)\}'), (m) {
    final i = int.parse(m[1]!);
    return i < args.length ? '${args[i]}' : m[0]!;
  });
}

String defaultMeetingTitle([DateTime? date]) {
  final d = date ?? DateTime.now();
  const names = {
    'zh': '会议',
    'en': 'Meeting',
    'es': 'Reunión',
    'ja': '会議',
    'ko': '회의',
    'fr': 'Réunion',
    'de': 'Besprechung',
    'ru': 'Встреча',
  };
  return '${names[languageCode]} ${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
}

String remoteError(String message) {
  if (languageCode == 'zh' ||
      translations[languageCode]?.containsKey(message) == true) {
    return tr(message);
  }
  return tr('电脑操作失败，请在电脑查看详情。');
}
