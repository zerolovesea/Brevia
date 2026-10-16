import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/connection.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart';
import 'package:brevia_mobile/recording_controls.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

/// 原生截图与组件测试共用相同状态序列和几何断言。
Future<void> verifyMeetingStability(
  WidgetTester tester, {
  required Brightness brightness,
  required double scale,
  required String language,
  TargetPlatform platform = TargetPlatform.iOS,
  Future<void> Function(String)? capture,
}) async {
  uiLanguage = language;
  Future<void> show(Widget child) async {
    await tester.pumpWidget(
      MaterialApp(
        key: UniqueKey(),
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(brightness).copyWith(platform: platform),
        locale: Locale(languageCode),
        supportedLocales: languageNames.keys.map(Locale.new).toList(),
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: child,
      ),
    );
    await tester.pump(const Duration(milliseconds: 240));
  }

  for (final mode in ['online', 'local', 'desktop']) {
    final model = AppModel()
      ..serviceRunning = true
      ..desktop = DesktopConnection(
        address: 'https://192.168.1.24:43187',
        fingerprint: 'stability-fixture',
        name: 'MacBook Pro',
      );
    model.live = {
      'id': 'stability',
      'title': '产品周会',
      'state': 'recording',
      'localOnly': mode == 'local',
      'desktopCapture': mode == 'desktop',
      'connected': true,
      'samples': 12096000,
      'count': 100,
      'uploaded': 100,
      'inputLevel': .5,
      'marks': <Map<String, dynamic>>[],
      'snapshot': {
        'samples': 12096000,
        'segments': [
          {'start_ms': 0, 'text': '保留的转写'},
        ],
      },
    };
    await show(MeetingPage(model: model, id: 'stability'));
    final clock = find.byWidgetPredicate(
      (w) => w is Text && w.data == '12:36' && w.style?.fontSize == 48,
    );
    if (mode != 'online') {
      await tester.scrollUntilVisible(
        clock,
        150,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
        maxScrolls: 30,
      );
      await tester.pumpAndSettle();
    }
    final controls = tester.getRect(find.byType(RecordingControls));
    final tabs = mode == 'online' ? tester.getRect(find.text(tr('转写'))) : null;
    final clockTop = mode == 'online' ? null : tester.getTopLeft(clock).dy;
    for (final (state, connected, count, uploaded) in [
      ('recording', true, 100, 100),
      ('paused', true, 100, 100),
      ('recording', true, 101, 100),
      ('recording', true, 101, 101),
      ('recording', false, 102, 101),
      ('paused', false, 102, 101),
      ('paused', true, 102, 102),
      ('recording', true, 103, 102),
      ('recording', true, 103, 103),
    ]) {
      final label = '$mode-$state-$connected-$count-$uploaded';
      model.live!.addAll({
        'state': state,
        'connected': connected,
        'count': count,
        'uploaded': uploaded,
        'inputLevel': state == 'paused' ? 0.0 : .8,
      });
      model.notifyListeners();
      await tester.pump(const Duration(milliseconds: 240));
      expect(tester.takeException(), isNull, reason: label);
      expect(
        tester.getRect(find.byType(RecordingControls)),
        controls,
        reason: label,
      );
      expect(
        find.byTooltip(tr(state == 'paused' ? '继续' : '暂停')).hitTestable(),
        findsOneWidget,
        reason: label,
      );
      expect(
        find.byTooltip(tr('结束')).hitTestable(),
        findsOneWidget,
        reason: label,
      );
      expect(find.text(tr('已恢复连接')), findsNothing);
      expect(find.text(tr('音频已传输')), findsNothing);
      if (tabs != null) {
        expect(tester.getRect(find.text(tr('转写'))), tabs, reason: label);
        expect(find.text(tr(connected ? '● 已连接' : '正在重新连接')), findsOneWidget);
        if (brightness == Brightness.dark && state == 'paused') {
          final red = find.byWidgetPredicate(
            (w) =>
                w is RichText &&
                w.text is TextSpan &&
                (w.text as TextSpan).children?.any(
                      (s) =>
                          s is TextSpan &&
                          s.text == '● ' &&
                          s.style?.color == const Color(0xffff3b30),
                    ) ==
                    true,
          );
          expect(red, findsNothing);
        }
      } else {
        expect(
          tester.getTopLeft(clock).dy,
          closeTo(clockTop!, .01),
          reason: label,
        );
      }
      if (capture != null &&
          (count == 100 || !connected || (count == 103 && uploaded == 103))) {
        await capture(label);
      }
    }
    await tester.pumpWidget(const SizedBox());
    model.dispose();
  }
  final model = AppModel()
    ..desktopOnline = true
    ..desktop = DesktopConnection(
      address: 'https://192.168.1.24:43187',
      fingerprint: 'stability-fixture',
      name: 'MacBook Pro',
    );
  await show(
    Scaffold(
      body: SafeArea(child: ConnectionPage(model: model)),
    ),
  );
  final row = find.text(tr('自动重连'));
  await tester.scrollUntilVisible(
    row,
    150,
    scrollable: find.byType(Scrollable).first,
    maxScrolls: 30,
  );
  await tester.pumpAndSettle();
  final position = tester.getTopLeft(row);
  for (final connected in [true, false, true]) {
    model.desktopOnline = connected;
    model.notifyListeners();
    await tester.pump(const Duration(milliseconds: 240));
    expect(tester.takeException(), isNull);
    expect(tester.getTopLeft(row), position);
    if (capture != null) await capture('connection-$connected');
  }
  await tester.pumpWidget(const SizedBox());
  model.dispose();
}

void main() {
  for (final width in [320.0, 393.0]) {
    for (final brightness in Brightness.values) {
      for (final scale in [1.0, 2.0]) {
        for (final language in languageNames.keys) {
          for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
            testWidgets(
              '$width ${brightness.name} $scale $language ${platform.name}',
              (tester) async {
                tester.view.physicalSize = Size(
                  width,
                  width == 320 ? 640 : 852,
                );
                tester.view.devicePixelRatio = 1;
                tester.view.padding = const FakeViewPadding(
                  top: 59,
                  bottom: 34,
                );
                addTearDown(tester.view.resetPhysicalSize);
                addTearDown(tester.view.resetDevicePixelRatio);
                addTearDown(tester.view.resetPadding);
                addTearDown(() => uiLanguage = 'system');
                await verifyMeetingStability(
                  tester,
                  brightness: brightness,
                  scale: scale,
                  language: language,
                  platform: platform,
                );
              },
            );
          }
        }
      }
    }
  }
}
