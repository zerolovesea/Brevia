import 'dart:io';
import 'dart:ui' as ui;

import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/connection.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart';
import 'package:brevia_mobile/onboarding.dart';
import 'package:brevia_mobile/mobile_errors.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'visual_capture_provenance.dart';

// 显式启用才输出实际 Flutter 页面；字体路径由本机提供，不影响 CI。
void main() {
  final output = Platform.environment['BREVIA_MOBILE_CAPTURE_DIR'];
  testWidgets('capture implemented mobile surfaces without overflow', (
    tester,
  ) async {
    final sources = captureSources();
    final screenshots = <String>[];
    final runFile = File('$output/capture-run.json');
    if (runFile.existsSync()) runFile.deleteSync();
    await tester.runAsync(() async {
      final font = Platform.environment['BREVIA_CAPTURE_FONT'];
      if (font != null) {
        for (final family in ['Roboto', 'Ahem']) {
          await (FontLoader(family)..addFont(
                Future.value(
                  ByteData.sublistView(File(font).readAsBytesSync()),
                ),
              ))
              .load();
        }
      }
      await (FontLoader(
        'MaterialIcons',
      )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
    });
    uiLanguage = 'zh';
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final boundary = GlobalKey();
    Future<void> capture(String name) async {
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.takeException(), isNull, reason: name);
      await tester.runAsync(() async {
        final image =
            await (boundary.currentContext!.findRenderObject()
                    as RenderRepaintBoundary)
                .toImage(pixelRatio: 2);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await File(
          '$output/$name.png',
        ).writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
        screenshots.add('$name.png');
      });
    }

    Future<void> show(Widget child) async {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      final page = child is MaterialApp ? child.home : null;
      final pushed =
          page is MeetingPage ||
          page is PrepareMeetingPage ||
          page is SavedMeetingPage ||
          page is MobileRecoveryPage;
      if (pushed) {
        child = MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: (child as MaterialApp).theme,
          home: const SizedBox(),
        );
      }
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: KeyedSubtree(key: UniqueKey(), child: child),
        ),
      );
      if (pushed) {
        tester
            .state<NavigatorState>(find.byType(Navigator).first)
            .push(MaterialPageRoute<void>(builder: (_) => page!));
        await tester.pump();
      }
      await tester.pump(const Duration(milliseconds: 500));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
    }

    Directory(output!).createSync(recursive: true);
    final model = AppModel()..appearance = 'light';
    model.meetings.addAll([
      {
        'id': 'review',
        'title': '产品周会',
        'samples': 40512000,
        'state': 'ended',
        'finished': true,
        'count': 80,
        'uploaded': 80,
        'localOnly': false,
        'marks': [
          {'sample': 12096000, 'note': '核对新用户引导与下载入口'},
        ],
        'created': DateTime.now()
            .copyWith(hour: 10, minute: 0)
            .toIso8601String(),
        'snapshot': {
          'notes':
              '## 决定\n\n下周五发布新用户引导。\n\n## 待办\n\n- 核对语言选项。\n- 验证 Android 下载二维码。',
          'segments': [
            {'start_ms': 0, 'text': '我们先回顾上周的进展。'},
          ],
        },
      },
      {
        'id': 'pending',
        'title': '客户访谈',
        'samples': 8064000,
        'state': 'ended',
        'finished': false,
        'count': 16,
        'uploaded': 0,
        'localOnly': true,
        'marks': [],
        'created': DateTime.now()
            .copyWith(hour: 14, minute: 0)
            .toIso8601String(),
      },
    ]);
    await show(BreviaApp(model: model));
    await capture('mobile-library');
    final meetings = [...model.meetings];
    model.meetings = [];
    model.notifyListeners();
    await tester.pump();
    await capture('mobile-library-empty');
    model.meetings = meetings;
    model.notifyListeners();
    await tester.pump();
    await tester.tap(find.byIcon(Icons.add).first);
    await tester.pumpAndSettle();
    await capture('mobile-prepare');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.laptop_outlined).last);
    await tester.pumpAndSettle();
    await capture('mobile-connection');
    await tester.ensureVisible(find.text(tr('输入配对码')));
    await tester.tap(find.text(tr('输入配对码')));
    await tester.pumpAndSettle();
    await capture('mobile-manual');
    await tester.enterText(find.byType(TextField).last, '123456');
    await tester.pump();
    expect(find.text('1'), findsOneWidget);
    expect(find.text('6'), findsOneWidget);
    await capture('mobile-manual-entered');
    final dynamic connection = tester.state(find.byType(ConnectionPage));
    connection.setState(() {
      connection.loading = true;
      connection.verification = '72A9BC18';
    });
    await capture('mobile-pairing-verification');
    connection.setState(() {
      connection.loading = false;
      connection.verification = null;
    });
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text(tr('连接帮助')));
    await tester.tap(find.text(tr('连接帮助')));
    await tester.pumpAndSettle();
    await capture('mobile-connection-help');
    expect(find.byType(ConnectionHelpPage), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.settings_outlined).last);
    await tester.pumpAndSettle();
    await capture('mobile-settings');
    await tester.scrollUntilVisible(
      find.text(tr('界面语言')),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text(tr('界面语言')));
    await tester.pumpAndSettle();
    await capture('mobile-language');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text(tr('外观')));
    await tester.pumpAndSettle();
    await capture('mobile-appearance');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    for (final (label, name) in [
      ('录音与后台', 'mobile-background'),
      ('本地存储', 'mobile-storage'),
      ('隐私与关于', 'mobile-about'),
    ]) {
      await tester.ensureVisible(find.text(tr(label)));
      await tester.tap(find.text(tr(label)));
      await tester.pumpAndSettle();
      await capture(name);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
    }
    final desktopOptions = {
      'languages': ['zh', 'en'],
      'workspaces': [
        {'id': 'product', 'name': '产品'},
      ],
      'models': [
        {
          'id': 'fun-asr',
          'name': 'Fun-ASR-Nano',
          'status': 'ready',
          'languages': ['zh', 'en'],
        },
      ],
    };
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: PrepareMeetingPage(
          options: desktopOptions,
          computer: 'MacBook Pro',
        ),
      ),
    );
    expect(
      tester.getBottomRight(find.text('手机采集音频，电脑完成转写')).dy,
      lessThan(tester.getTopLeft(find.text('开始录音')).dy),
    );
    await capture('mobile-prepare-connected');
    for (final (choice, name) in [
      ('中文', 'mobile-meeting-language'),
      ('不指定工作区', 'mobile-workspace'),
      ('不翻译', 'mobile-translation'),
      ('Fun-ASR-Nano', 'mobile-recognition-model'),
    ]) {
      final button = find.widgetWithText(OutlinedButton, tr(choice));
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pumpAndSettle();
      await capture(name);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
    }
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: PrepareMeetingPage(
          options: desktopOptions,
          computer: 'MacBook Pro',
          upload: true,
          initial: model.meetings.first,
        ),
      ),
    );
    await capture('mobile-upload-prepare');

    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: SavedMeetingPage(model: model, id: 'review'),
      ),
    );
    await capture('mobile-review');
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: MeetingPage(model: model, id: 'review'),
      ),
    );
    await tester.tap(find.text(tr('转写')));
    await tester.pump();
    expect(find.text('我们先回顾上周的进展。'), findsOneWidget);
    await capture('mobile-review-transcript');
    await tester.tap(find.text(tr('笔记')));
    await tester.pump();
    await capture('mobile-review-notes');
    await tester.tap(find.text(tr('重点')));
    await tester.pump();
    await capture('mobile-review-marks');
    model.desktop = DesktopConnection(
      address: 'https://192.168.1.24:43187',
      fingerprint: 'fixture',
      name: 'MacBook Pro',
    );
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: Scaffold(
          appBar: AppBar(title: Text(tr('连接电脑'))),
          body: ConnectionPage(model: model),
        ),
      ),
    );
    await capture('mobile-device-manage');
    await tester.tap(find.text(tr('更新电脑地址')));
    await tester.pumpAndSettle();
    await capture('mobile-address-update');
    await tester.enterText(
      find.byType(TextField),
      'https://192.168.1.25:43187',
    );
    await tester.tap(find.text(tr('取消')));
    await tester.pumpAndSettle();
    expect(model.desktop!.address, 'https://192.168.1.24:43187');
    model.desktopMicrophoneSelected = true;
    model.desktopOnline = true;
    model.notifyListeners();
    await capture('mobile-mic-ready');
    model.desktopMicrophoneSelected = false;
    model.desktop = null;

    model.live = {
      'id': 'live',
      'title': '产品周会',
      'samples': 12096000,
      'state': 'recording',
      'connected': true,
      'localOnly': false,
      'count': 24,
      'uploaded': 24,
      'marks': [],
      'snapshot': {
        'samples': 10000000,
        'notes': model.meetings.first['snapshot']['notes'],
        'segments': [
          {'start_ms': 0, 'text': '我们先回顾上周的进展。'},
          {'start_ms': 12000, 'text': 'Android 测试版已就绪。接下来核对下载二维码，完成新用户引导评审。'},
        ],
      },
    };
    model.serviceRunning = true;
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: MeetingPage(model: model, id: 'live'),
      ),
    );
    await capture('mobile-live');
    await tester.tap(find.byTooltip(tr('笔记')));
    await tester.pump();
    await capture('mobile-live-notes');
    await tester.tap(find.text(tr('转写')));
    await tester.pump();
    model.live!['state'] = 'paused';
    model.notifyListeners();
    await capture('mobile-paused');
    model.live!['connected'] = false;
    model.notifyListeners();
    await capture('mobile-disconnected');
    model.live!['state'] = 'recording';
    model.live!['connected'] = true;
    model.live!['uploaded'] = 20;
    model.notifyListeners();
    await capture('mobile-reconnected');
    await tester.tap(find.byTooltip(tr('返回录音')));
    await tester.pump(const Duration(milliseconds: 500));
    await capture('mobile-reconnected-transcript');

    await tester.tap(find.byTooltip(tr('结束')));
    await tester.pump(const Duration(milliseconds: 500));
    await capture('mobile-end-confirmation');
    await tester.tap(find.text(tr('继续录音')));
    await tester.pump(const Duration(milliseconds: 500));
    final liveSnapshot = model.live!['snapshot'];
    model.live!['localOnly'] = true;
    model.live!['snapshot'] = <String, dynamic>{};
    model.notifyListeners();
    await tester.pump();
    expect(find.textContaining('已传到电脑'), findsNothing);
    await capture('mobile-offline');
    model.live!['state'] = 'paused';
    model.serviceRunning = false;
    model.notifyListeners();
    await tester.pump();
    await capture('mobile-interrupted');
    model.live!['state'] = 'recording';
    model.serviceRunning = true;
    model.live!['localOnly'] = false;
    model.live!['connected'] = true;
    model.live!['uploaded'] = model.live!['count'];
    model.live!['snapshot'] = liveSnapshot;
    model.notifyListeners();
    await tester.pump();
    await tester.tap(find.byTooltip(tr('重点')));
    await tester.pump(const Duration(milliseconds: 500));
    await capture('mobile-bookmark');
    Navigator.of(tester.element(find.text(tr('保存重点')))).pop();
    await tester.pump(const Duration(milliseconds: 500));
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.dark),
        home: MeetingPage(model: model, id: 'live'),
      ),
    );
    await capture('mobile-live-dark');
    model.live!['desktopCapture'] = true;
    model.live!['inputLevel'] = .5;
    model.inputLevel.value = .5;
    model.desktop = DesktopConnection(
      address: 'https://192.168.1.24:43187',
      fingerprint: 'fixture',
      name: 'MacBook Pro',
    );
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: MeetingPage(model: model, id: 'live'),
      ),
    );
    await capture('mobile-mic-active');
    model.live!['state'] = 'paused';
    model.notifyListeners();
    await capture('mobile-mic-paused');
    model.live!['state'] = 'recording';
    model.live!['connected'] = false;
    model.notifyListeners();
    await capture('mobile-mic-disconnected');
    model.live!.remove('desktopCapture');
    model.desktop = null;
    model.live!['state'] = 'interrupted';
    model.live!['error'] = FileSystemException(
      'write failed',
      '/saved/chunk',
      OSError('No space left on device', 28),
    ).toString();
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: MeetingPage(model: model, id: 'live'),
      ),
    );
    expect(find.text(tr('导出已有录音')), findsOneWidget);
    await capture('mobile-storage-full');
    await tester.tap(find.text(tr('管理存储')));
    await tester.pumpAndSettle();
    await capture('mobile-storage-recovery');
    model.live!.remove('error');
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => report(context, () async {
                throw StateError(tr('需要麦克风权限，请前往系统设置'));
              }),
              child: Text('request-recording'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('request-recording'));
    await tester.pumpAndSettle();
    await capture('mobile-microphone-denied');
    MobileErrorKind? pairingKind;
    try {
      DesktopConnection(
        address: 'https://192.168.1.24',
        fingerprint: '',
      ).decodeResponse(403, {'error': '配对已过期或尝试过多，请在电脑重新开启配对'});
    } on HttpException catch (error) {
      pairingKind = mobileErrorKind(error);
    }
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: MobileRecoveryPage(
          kind: pairingKind!,
          onPrimary: () {},
          onSecondary: () {},
        ),
      ),
    );
    await capture('mobile-pairing-unavailable');
    await show(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: breviaTheme(Brightness.light),
        home: const OnboardingGate(child: SizedBox()),
      ),
    );
    await tester.pumpAndSettle();
    await capture('mobile-welcome');
    await tester.tap(find.text(tr('电脑已安装，开始配对')));
    await tester.pumpAndSettle();
    await capture('mobile-onboarding-connection');
    await tester.tap(find.text(tr('已打开二维码，开始扫码')));
    await tester.pumpAndSettle();
    await capture('mobile-permissions');
    await tester.pumpWidget(const SizedBox());
    model.dispose();
    writeCaptureRun(Directory(output), sources, screenshots, {
      'method': 'Flutter widget RepaintBoundary, isolated fixtures',
      'logicalSize': [390, 844],
      'pixelSize': [780, 1688],
      'font': Platform.environment['BREVIA_CAPTURE_FONT'],
      'animationsSettledMs': 500,
    });
  }, skip: output == null);
}
