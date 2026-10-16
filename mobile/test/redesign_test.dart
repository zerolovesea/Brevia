import 'dart:async';

import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/connection.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart';
import 'package:brevia_mobile/onboarding.dart';
import 'package:brevia_mobile/recording_controls.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    uiLanguage = 'zh';
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(() => uiLanguage = 'system');

  testWidgets(
    'first run prioritizes desktop download and requires approved pairing',
    (tester) async {
      final model = AppModel();
      addTearDown(model.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: breviaTheme(Brightness.light),
          home: OnboardingGate(
            model: model,
            pairingBuilder: (approved) => Center(
              child: FilledButton(
                onPressed: () {
                  model.desktop = DesktopConnection(
                    address: 'https://192.168.1.2',
                    fingerprint: 'paired',
                    name: 'My computer',
                  );
                  approved();
                },
                child: const Text('approve on desktop'),
              ),
            ),
            child: const Text('meeting-library'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('先在电脑安装 Brevia，再用手机扫码配对。'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, '复制电脑端下载地址'), findsOneWidget);
      await tester.tap(find.text('电脑已安装，开始配对'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('已打开二维码，开始扫码'));
      await tester.pumpAndSettle();
      expect(find.text('meeting-library'), findsNothing);
      expect(
        (await SharedPreferences.getInstance()).getBool('onboardingComplete'),
        isNull,
      );
      await tester.tap(find.text('approve on desktop'));
      await tester.pumpAndSettle();
      expect(find.text('配对成功'), findsOneWidget);
      expect(find.text('My computer'), findsOneWidget);
      expect(model.live, isNull);
      expect(
        (await SharedPreferences.getInstance()).getBool('onboardingComplete'),
        isNull,
      );
      await tester.tap(find.text('进入会议'));
      await tester.pumpAndSettle();
      expect(find.text('meeting-library'), findsOneWidget);
      expect(
        (await SharedPreferences.getInstance()).getBool('onboardingComplete'),
        isTrue,
      );
    },
  );

  testWidgets('source selection announces preview without claiming recording', (
    tester,
  ) async {
    final model = AppModel()
      ..desktop = DesktopConnection(
        address: 'https://192.168.1.2',
        fingerprint: 'paired',
        name: 'My computer',
      );
    addTearDown(model.dispose);
    await tester.pumpWidget(BreviaApp(model: model));
    await tester.pumpAndSettle();
    expect(find.text('电脑已选择此手机为声源'), findsNothing);
    model.desktopMicrophoneSelected = true;
    model.notifyListeners();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('电脑已选择此手机为声源'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.link_outlined).last);
    await tester.pumpAndSettle();
    expect(find.text('等待电脑开始录音'), findsOneWidget);
    expect(find.text('尚未开始录音'), findsOneWidget);
    expect(find.byType(MeetingPage), findsNothing);
    expect(model.live, isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'long computer names keep connection status and recording reachable',
    (tester) async {
      tester.view.physicalSize = const Size(393, 852);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final model = AppModel()
        ..desktop = DesktopConnection(
          address: 'https://192.168.1.2',
          fingerprint: 'paired',
          name: 'design-studio-team-MacBook-Pro-30273.local',
        );
      addTearDown(model.dispose);
      await tester.pumpWidget(BreviaApp(model: model));
      await tester.pumpAndSettle();
      expect(find.text('离线').hitTestable(), findsOneWidget);
      expect(find.widgetWithText(FilledButton, '开始录音'), findsNothing);
      await tester.tap(find.widgetWithText(FilledButton, '新建录音'));
      await tester.pumpAndSettle();
      expect(find.byType(PrepareMeetingPage), findsOneWidget);
      expect(find.text('开始录音').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('settings keep primary entries visible inside phone safe areas', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 59, bottom: 34);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPadding);
    final model = AppModel();
    addTearDown(model.dispose);
    await tester.pumpWidget(BreviaApp(model: model));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.settings_outlined).last);
    await tester.pumpAndSettle();
    for (final title in ['界面语言', '外观', '录音与后台', '连接与设备', '本地存储', '隐私与关于']) {
      expect(find.text(title).hitTestable(), findsOneWidget, reason: title);
    }
    expect(find.text('麦克风权限'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('desktop microphone separates paused and disconnected capture', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final model = AppModel()..serviceRunning = true;
    addTearDown(model.dispose);
    final meeting = <String, dynamic>{
      'id': 'desktop',
      'title': 'Meeting',
      'desktopCapture': true,
      'state': 'recording',
      'connected': true,
      'samples': 16000,
      'inputLevel': .5,
      'snapshot': {'samples': 8000, 'notes': 'desktop-private'},
    };
    model.live = meeting;
    await tester.pumpWidget(
      MaterialApp(
        theme: breviaTheme(Brightness.light),
        home: MeetingPage(model: model, id: 'desktop'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('录音说明'), findsOneWidget);
    expect(
      tester
          .state<ScrollableState>(find.byType(Scrollable).first)
          .position
          .pixels,
      0,
    );
    expect(find.text('已传电脑'), findsOneWidget);
    expect(find.text('desktop-private'), findsNothing);
    meeting['state'] = 'paused';
    model.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text('暂停期间不采集音频'), findsOneWidget);
    expect(find.byTooltip('继续'), findsOneWidget);
    meeting['state'] = 'recording';
    meeting['connected'] = false;
    model.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text('离线'), findsOneWidget);
    expect(find.text('仍在本机录音'), findsOneWidget);
    expect(find.byTooltip('暂停'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('button feedback preserves touch bounds and reduces movement', (
    tester,
  ) async {
    for (final reduced in [false, true]) {
      await tester.pumpWidget(
        MaterialApp(
          key: UniqueKey(),
          theme: breviaTheme(Brightness.light),
          home: MediaQuery(
            data: MediaQueryData(disableAnimations: reduced),
            child: Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () {},
                  child: const Text('press'),
                ),
              ),
            ),
          ),
        ),
      );
      final button = find.widgetWithText(FilledButton, 'press');
      final bounds = tester.getRect(button);
      final gesture = await tester.startGesture(tester.getCenter(button));
      await tester.pump(const Duration(milliseconds: 140));
      final scale = tester.widget<AnimatedScale>(
        find.descendant(of: button, matching: find.byType(AnimatedScale)),
      );
      expect(scale.scale, reduced ? 1 : .96);
      expect(tester.getRect(button), bounds);
      expect(bounds.height, greaterThanOrEqualTo(48));
      await gesture.up();
      await tester.pumpAndSettle();
    }
  });

  testWidgets('microphone meter paints segments with a visible height', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MicrophoneLevel(level: .5))),
    );
    final paint = find.descendant(
      of: find.byType(MicrophoneLevel),
      matching: find.byType(CustomPaint),
    );
    expect(tester.getSize(paint), const Size(160, 12));
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MicrophoneLevel(level: .8))),
    );
    await tester.pump(const Duration(milliseconds: 30));
    expect(tester.takeException(), isNull);
  });

  testWidgets('model options reject uninstalled choices and retain selection', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: breviaTheme(Brightness.light),
        home: PrepareMeetingPage(
          computer: 'My computer',
          options: {
            'languages': ['zh'],
            'workspaces': <Map<String, dynamic>>[],
            'models': [
              {
                'id': 'ready',
                'name': 'Installed model',
                'status': 'ready',
                'languages': ['zh'],
              },
              {
                'id': 'missing',
                'name': 'Missing model',
                'status': 'missing',
                'languages': ['zh'],
              },
            ],
          },
        ),
      ),
    );
    final selector = find.widgetWithText(OutlinedButton, 'Installed model');
    await tester.scrollUntilVisible(
      selector,
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(selector);
    await tester.pumpAndSettle();
    final missing = find.widgetWithText(ListTile, 'Missing model · 未安装');
    expect(tester.widget<ListTile>(missing).enabled, isFalse);
    await tester.tap(missing);
    await tester.pumpAndSettle();
    expect(find.text('识别模型'), findsWidgets);
    expect(find.widgetWithText(ListTile, 'Installed model'), findsOneWidget);
    await tester.tap(find.widgetWithText(ListTile, 'Installed model'));
    await tester.pumpAndSettle();
    expect(selector, findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, '开始录音'))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets(
    'iOS page transitions retain edge swipe and reduce spatial motion',
    (tester) async {
      for (final reduced in [false, true]) {
        await tester.pumpWidget(
          MaterialApp(
            key: UniqueKey(),
            theme: breviaTheme(
              Brightness.light,
            ).copyWith(platform: TargetPlatform.iOS),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
              child: child!,
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => unawaited(
                    Navigator.push<void>(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const Scaffold(body: Text('detail')),
                      ),
                    ),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        expect(find.text('detail'), findsOneWidget);
        if (reduced) {
          final position = tester.getTopLeft(find.text('detail'));
          final gesture = await tester.startGesture(const Offset(1, 250));
          await gesture.moveBy(const Offset(400, 0));
          await tester.pump();
          expect(tester.getTopLeft(find.text('detail')), position);
          await gesture.up();
        } else {
          await tester.dragFrom(const Offset(1, 250), const Offset(720, 0));
        }
        await tester.pumpAndSettle();
        expect(find.text('detail'), findsNothing);
        expect(find.text('open'), findsOneWidget);
      }
    },
  );
}
