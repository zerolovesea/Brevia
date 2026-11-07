import 'dart:js_interop';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart';

@JS('window.previewFont')
external JSPromise<JSArrayBuffer> get previewFont;

@JS('window.showMeetingPreview')
external set showMeetingPreview(JSFunction callback);

@JS('window.playMobilePreview')
external set playMobilePreview(JSFunction callback);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  uiLanguage = Uri.base.queryParameters['lang'] == 'en' ? 'en' : 'zh';
  const family = 'Brevia Preview';
  final theme = breviaTheme(Brightness.dark, fontFamily: family);
  await (FontLoader(
        family,
      )..addFont(previewFont.toDart.then((bytes) => bytes.toDart.asByteData())))
      .load();
  final playing = ValueNotifier(false);
  playMobilePreview = ((bool enabled) => playing.value = enabled).toJS;
  final model = AppModel()..serviceRunning = true;
  final title = uiLanguage == 'en' ? 'Product design weekly' : '产品设计周会';
  final stage = ValueNotifier('scan');
  showMeetingPreview =
      ((String screen, String caption, String translation, int seconds) {
        model.live = {
          'id': 'preview',
          'title': title,
          'state': 'recording',
          'connected': true,
          'samples': 16000 * seconds,
          'snapshot': {
            'segments': [
              if (caption.isNotEmpty)
                {
                  'start_ms': 0,
                  'speaker_name': uiLanguage == 'en' ? 'Alex' : '林晓',
                  'text': caption,
                  if (uiLanguage == 'en') 'translation': translation,
                },
            ],
          },
        };
        stage.value = screen;
        model.notifyListeners();
      }).toJS;
  runApp(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      locale: Locale(uiLanguage),
      supportedLocales: languageNames.keys.map(Locale.new),
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: theme,
      builder: (_, child) => ValueListenableBuilder(
        valueListenable: playing,
        child: child,
        builder: (_, enabled, child) =>
            TickerMode(enabled: enabled, child: child!),
      ),
      home: ValueListenableBuilder(
        valueListenable: stage,
        builder: (_, screen, _) => switch (screen) {
          'scan' => ScannerPage(
            camera: Center(
              child: Image.network(
                Uri.base.resolve('../assets/pair-demo.png').toString(),
                width: 215,
                height: 215,
              ),
            ),
          ),
          'start' => PrepareMeetingPage(
            computer: 'MacBook Pro',
            options: {
              'workspaces': [],
              'models': [
                {
                  'id': uiLanguage == 'en' ? 'qwen3-asr' : 'sensevoice',
                  'name': uiLanguage == 'en' ? 'Qwen3-ASR' : 'SenseVoice Small',
                  'languages': uiLanguage == 'en' ? ['es', 'en'] : ['zh', 'en'],
                  'status': 'ready',
                },
              ],
            },
            initial: {
              'title': title,
              'language': uiLanguage == 'en' ? 'es' : 'zh',
              if (uiLanguage == 'en') 'target_language': 'en',
            },
          ),
          _ => MeetingPage(model: model, id: 'preview'),
        },
      ),
    ),
  );
}
