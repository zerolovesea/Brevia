import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/connection.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart';
import 'package:brevia_mobile/onboarding.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native mobile layouts use safe areas and production controls', (
    tester,
  ) async {
    uiLanguage = 'zh';
    SharedPreferences.setMockInitialValues({});
    final model = AppModel()..appearance = 'light';
    addTearDown(model.dispose);
    Future<void> capture(String name) async {
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.takeException(), isNull, reason: name);
      // 原生截图需要等GPU完成当前帧，避免捕获前一个状态。
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await binding.takeScreenshot(name);
    }

    Future<void> show(
      Widget child, {
      Brightness brightness = Brightness.light,
    }) async {
      final pushed = child is! OnboardingGate;
      await tester.pumpWidget(
        MaterialApp(
          key: UniqueKey(),
          debugShowCheckedModeBanner: false,
          theme: breviaTheme(brightness),
          home: pushed ? const SizedBox() : child,
        ),
      );
      if (pushed) {
        tester
            .state<NavigatorState>(find.byType(Navigator).first)
            .push(MaterialPageRoute<void>(builder: (_) => child));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
      }
    }

    await show(const OnboardingGate(child: SizedBox()));
    await capture('ios-welcome');
    await tester.tap(find.text('电脑已安装，开始配对'));
    await capture('ios-onboarding-privacy');
    await tester.tap(find.text('已打开二维码，开始扫码'));
    await capture('ios-onboarding-permissions');
    await tester.pumpWidget(BreviaApp(model: model));
    await capture('ios-library-empty');
    model.meetings = [
      {
        'id': 'visual',
        'title': '产品周会',
        'samples': 40512000,
        'state': 'ended',
        'finished': true,
        'count': 80,
        'uploaded': 80,
        'localOnly': false,
        'created': DateTime.now()
            .copyWith(hour: 10, minute: 0)
            .toIso8601String(),
        'marks': <Map<String, dynamic>>[],
        'snapshot': {
          'notes': '## 决定\n\n核对新用户引导。',
          'segments': [
            {'start_ms': 0, 'text': '先回顾项目进展。'},
          ],
        },
      },
    ];
    model.meetings.add({
      'id': 'visual-local',
      'title': '客户访谈',
      'samples': 8064000,
      'state': 'ended',
      'finished': false,
      'count': 16,
      'uploaded': 0,
      'localOnly': true,
      'created': DateTime.now().copyWith(hour: 14, minute: 0).toIso8601String(),
      'marks': <Map<String, dynamic>>[],
    });
    model.notifyListeners();
    await capture('ios-library');
    await tester.tap(find.byIcon(Icons.add).first);
    await capture('ios-prepare');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.laptop_outlined).last);
    await capture('ios-connection');
    await tester.tap(find.byIcon(Icons.settings_outlined).last);
    await capture('ios-settings');
    await show(MeetingPage(model: model, id: 'visual'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('笔记'));
    await capture('ios-review-notes');
    await tester.tap(find.text('转写'));
    await capture('ios-review-transcript');
    model.live = {
      'id': 'native-live',
      'title': '产品周会',
      'samples': 12096000,
      'state': 'recording',
      'connected': true,
      'localOnly': false,
      'count': 24,
      'uploaded': 24,
      'marks': <Map<String, dynamic>>[],
      'snapshot': {
        'samples': 10000000,
        'notes': '## 决定\n\n下周确认发布计划。',
        'segments': [
          {'start_ms': 0, 'text': '我们先回顾上周的进展。'},
          {'start_ms': 12000, 'text': '设计稿已经完成，周四交付测试版本。周五前完成验收，下周一小范围发布。'},
        ],
      },
    };
    model.serviceRunning = true;
    await show(MeetingPage(model: model, id: 'native-live'));
    await capture('ios-live');
    await tester.tap(find.text('笔记'));
    await capture('ios-live-notes');
    await tester.tap(find.byTooltip('重点'));
    await capture('ios-bookmark');
    await tester.tap(find.byTooltip('取消'));
    await tester.pump(const Duration(milliseconds: 500));
    model.live!['localOnly'] = true;
    model.inputLevel.value = .55;
    model.live!['snapshot'] = <String, dynamic>{};
    model.notifyListeners();
    await capture('ios-offline');
    model.live!['localOnly'] = false;
    model.live!['snapshot'] = {
      'samples': 12096000,
      'notes': '## 决定\n\n下周确认发布计划。',
      'segments': [
        {'start_ms': 0, 'text': '先回顾项目进展，再确认下一步计划。'},
      ],
    };
    await show(
      MeetingPage(model: model, id: 'native-live'),
      brightness: Brightness.dark,
    );
    await capture('ios-live-dark');
    model.desktop = DesktopConnection(
      address: 'https://192.168.1.24:43187',
      fingerprint: 'native-fixture',
      name: 'MacBook Pro',
    );
    model.desktopMicrophoneSelected = true;
    await show(Scaffold(body: ConnectionPage(model: model)));
    await capture('ios-mic-ready');
    model.live!['desktopCapture'] = true;
    model.live!['inputLevel'] = .5;
    await show(MeetingPage(model: model, id: 'native-live'));
    await capture('ios-mic-active');
    model.live!['state'] = 'paused';
    model.notifyListeners();
    await capture('ios-mic-paused');
    model.live!['state'] = 'recording';
    model.live!['connected'] = false;
    model.notifyListeners();
    await capture('ios-mic-disconnected');
    await show(
      PrepareMeetingPage(
        computer: 'MacBook Pro',
        options: {
          'languages': ['zh'],
          'workspaces': [
            {'id': 'product', 'name': '产品'},
          ],
          'models': [
            {
              'id': 'fun-asr',
              'name': 'Fun-ASR-Nano',
              'status': 'ready',
              'languages': ['zh'],
            },
          ],
        },
      ),
    );
    await capture('ios-prepare-connected');
    await show(
      MediaQuery(
        data: MediaQueryData.fromView(
          tester.view,
        ).copyWith(textScaler: TextScaler.linear(2)),
        child: MeetingPage(model: model, id: 'native-live'),
      ),
    );
    await capture('ios-mic-large-text');
    model.live = null;
    model.serviceRunning = false;
    model.desktopMicrophoneSelected = false;
    model.desktopOnline = false;
    model.desktop!.name = 'design-studio-team-MacBook-Pro-30273.local';
    final saved = model.meetings;
    model.meetings = [];
    await tester.pumpWidget(BreviaApp(model: model));
    await tester.pumpAndSettle();
    await capture('ios-aligned-library-empty');
    await tester.tap(find.byIcon(Icons.link_outlined).last);
    await tester.pumpAndSettle();
    expect(find.text('取消信任此电脑').hitTestable(), findsOneWidget);
    await capture('ios-aligned-connection-long');
    await tester.tap(find.byIcon(Icons.settings_outlined).last);
    await tester.pumpAndSettle();
    await capture('ios-aligned-settings');
    model.desktop!.name = 'MacBook Pro';
    model.desktopOnline = true;
    model.meetings = [
      ...saved,
      {
        ...saved.first,
        'id': 'visual-design',
        'title': '设计评审',
        'created': DateTime.now().copyWith(hour: 14).toIso8601String(),
      },
      {
        ...saved.first,
        'id': 'visual-offline',
        'title': '灵感记录',
        'localOnly': true,
        'created': DateTime.now()
            .subtract(const Duration(days: 1))
            .toIso8601String(),
      },
    ];
    model.notifyListeners();
    await tester.tap(find.byIcon(Icons.article_outlined).last);
    await tester.pumpAndSettle();
    await capture('ios-aligned-library');
    await tester.tap(find.byIcon(Icons.link_outlined).last);
    await tester.pumpAndSettle();
    await capture('ios-aligned-connection');
    model.appearance = 'dark';
    model.notifyListeners();
    await tester.pumpAndSettle();
    await capture('ios-aligned-connection-dark');
    await tester.tap(find.byIcon(Icons.settings_outlined).last);
    await tester.pumpAndSettle();
    await capture('ios-aligned-settings-dark');
    model.appearance = 'light';
    await tester.pumpWidget(
      MaterialApp(
        key: UniqueKey(),
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(2)),
          child: child!,
        ),
        home: Home(model: model),
      ),
    );
    await tester.tap(find.byIcon(Icons.settings_outlined).last);
    await tester.pumpAndSettle();
    await capture('ios-aligned-settings-large');
    await tester.tap(find.byIcon(Icons.link_outlined).last);
    await tester.pumpAndSettle();
    await capture('ios-aligned-connection-large');
    await tester.pumpWidget(const SizedBox());
  });
}
