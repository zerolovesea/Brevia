import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/connection.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

// 使用当前生产控件和虚构会议内容，不启动麦克风、不访问用户会议。
void main() {
  testWidgets('capture store scenes from production widgets', (tester) async {
    final language = Platform.environment['BREVIA_STORE_LANGUAGE'] ?? 'zh';
    final output = Directory(Platform.environment['BREVIA_STORE_CAPTURE_DIR']!);
    output.createSync(recursive: true);
    uiLanguage = language;
    String copy(String zh, String en) => language == 'zh' ? zh : en;
    SharedPreferences.setMockInitialValues({});
    await tester.runAsync(() async {
      final bytes = File(Platform.environment['BREVIA_CAPTURE_FONT']!)
          .readAsBytesSync();
      for (final family in ['Roboto', 'Ahem', '.SF Pro Text']) {
        await (FontLoader(
          family,
        )..addFont(Future.value(ByteData.sublistView(bytes)))).load();
      }
      await (FontLoader(
        'MaterialIcons',
      )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
    });
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 48, bottom: 24);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPadding);
    final boundary = GlobalKey();
    final files = <String>[];
    final model = AppModel()..appearance = 'light';
    final title = copy('设计周会', 'Design review');
    final notes = copy(
      '## 本周决定\n\n周五发布新的引导页面。\n\n## 下一步\n\n- 完成文案核对。\n- 准备用户访谈。',
      '## Decisions\n\nShip the new onboarding on Friday.\n\n## Next steps\n\n- Review the copy.\n- Prepare user interviews.',
    );
    final segments = [
      {
        'start_ms': 0,
        'text': copy(
          '我们先看一下这周的设计进展。',
          'Let’s review this week’s design progress.',
        ),
      },
      {
        'start_ms': 12000,
        'text': copy(
          '新的引导页面已经准备好了，计划周五发布。',
          'The new onboarding is ready. Let’s ship it on Friday.',
        ),
      },
      {
        'start_ms': 28000,
        'text': copy(
          '好，接下来一起核对文案，再安排下一轮用户访谈。',
          'Great. We’ll review the copy, then plan the next round of interviews.',
        ),
      },
    ];
    model.meetings = [
      {
        'id': 'review',
        'title': title,
        'samples': 12096000,
        'state': 'ended',
        'finished': true,
        'count': 24,
        'uploaded': 24,
        'localOnly': false,
        'created': '2026-10-15T10:00:00',
        'marks': [
          {
            'sample': 192000,
            'note': copy('周五发布引导页面', 'Ship onboarding on Friday'),
          },
        ],
        'snapshot': {'notes': notes, 'segments': segments},
      },
      {
        'id': 'offline',
        'title': copy('客户访谈', 'Customer interview'),
        'samples': 8064000,
        'state': 'ended',
        'finished': false,
        'count': 16,
        'uploaded': 0,
        'localOnly': true,
        'created': '2026-10-15T09:00:00',
        'marks': <Map<String, dynamic>>[],
      },
    ];
    Future<void> capture(String name, Widget page, {bool app = false}) async {
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: app
              ? page
              : MaterialApp(
                  key: UniqueKey(),
                  debugShowCheckedModeBanner: false,
                  theme: breviaTheme(Brightness.light),
                  locale: Locale(language),
                  home: page,
                ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 600));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 80)),
      );
      expect(tester.takeException(), isNull, reason: name);
      await tester.runAsync(() async {
        final image =
            await (boundary.currentContext!.findRenderObject()
                    as RenderRepaintBoundary)
                .toImage(pixelRatio: 4);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await File('${output.path}/$name.png')
            .writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      files.add('$name.png');
    }

    await capture('01-library', BreviaApp(model: model), app: true);
    model.desktop = DesktopConnection(
      address: 'https://192.168.1.24:43187',
      fingerprint: 'store-fixture',
      name: 'MacBook Pro',
    );
    model.desktopOnline = true;
    await capture(
      '02-connection',
      Scaffold(
        appBar: AppBar(title: Text(tr('连接电脑'))),
        body: ConnectionPage(model: model),
      ),
    );
    model.live = {
      'id': 'live',
      'title': title,
      'samples': 12096000,
      'state': 'recording',
      'connected': true,
      'localOnly': false,
      'count': 24,
      'uploaded': 24,
      'marks': <Map<String, dynamic>>[],
      'snapshot': {'samples': 12096000, 'notes': notes, 'segments': segments},
    };
    model.serviceRunning = true;
    await capture(
      '03-live',
      MeetingPage(key: UniqueKey(), model: model, id: 'live'),
    );
    await tester.tap(find.text(tr('笔记')));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.runAsync(() async {
      final image =
          await (boundary.currentContext!.findRenderObject()
                  as RenderRepaintBoundary)
              .toImage(pixelRatio: 4);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await File('${output.path}/04-notes.png')
          .writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
    files.add('04-notes.png');
    model.live = {
      ...model.live!,
      'title': copy('客户访谈', 'Customer interview'),
      'samples': 8064000,
      'localOnly': true,
      'connected': false,
      'snapshot': <String, dynamic>{},
    };
    await capture(
      '05-offline',
      MeetingPage(key: UniqueKey(), model: model, id: 'live'),
    );
    model.live = {
      ...model.live!,
      'title': title,
      'samples': 12096000,
      'desktopCapture': true,
      'connected': true,
      'localOnly': false,
    };
    await capture(
      '06-desktop-mic',
      MeetingPage(key: UniqueKey(), model: model, id: 'live'),
    );
    model.live = null;
    model.serviceRunning = false;
    await capture(
      '07-upload',
      MeetingPage(key: UniqueKey(), model: model, id: 'offline'),
    );
    await tester.pumpWidget(const SizedBox());
    model.dispose();
    File('${output.path}/capture-manifest.json').writeAsStringSync(
      const JsonEncoder.withIndent('  ').convert({
        'language': language,
        'method': 'Current Flutter production widgets; fictional fixture; no system or hardware capture',
        'size': [1560, 3376],
        'files': files,
      }),
    );
  });
}
