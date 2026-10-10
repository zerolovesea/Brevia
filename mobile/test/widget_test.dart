import 'dart:io';
import 'dart:async';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/translations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter/services.dart';
import 'package:brevia_mobile/recorder.dart';
import 'package:brevia_mobile/startup.dart';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:brevia_mobile/main.dart';
import 'package:brevia_mobile/swipe_delete.dart';
import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/storage.dart';
import 'package:brevia_mobile/connection.dart';

void main() {
  setUp(() => uiLanguage = 'zh');

  testWidgets(
    'transcription activity stops for inactive states and reduced motion',
    (tester) async {
      final meeting = <String, dynamic>{
        'state': 'recording',
        'connected': true,
      };
      Future<void> show(
        Map<String, dynamic> value, {
        bool reduced = false,
      }) async {
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(disableAnimations: reduced),
              child: TranscriptionActivity(meeting: value),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 200));
      }

      final dots = find.descendant(
        of: find.byType(TranscriptionActivity),
        matching: find.byType(Opacity),
      );
      List<double> opacities() =>
          tester.widgetList<Opacity>(dots).map((dot) => dot.opacity).toList();
      await show(meeting);
      expect(dots, findsNWidgets(3));
      final before = opacities();
      expect(before.toSet().length, greaterThan(1));
      await tester.pump(const Duration(milliseconds: 200));
      expect(opacities(), isNot(before));
      await show({...meeting, 'state': 'ended'});
      expect(dots, findsNWidgets(3));
      for (final inactive in [
        {'connected': false},
        {'localOnly': true},
        {'finished': true},
        {'remoteDeleted': true},
        {'error': 'failed'},
        {
          'snapshot': {'error': 'failed'},
        },
        {'state': 'paused'},
      ]) {
        await show({...meeting, ...inactive});
        expect(dots, findsNothing);
        await tester.pumpAndSettle();
      }
      await show(meeting, reduced: true);
      expect(dots, findsNWidgets(3));
      expect(opacities(), [0.6, 0.6, 0.6]);
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      expect(tester.binding.transientCallbackCount, 0);
    },
  );

  test(
    'waiting includes follow-up tasks and uses the original computer connection',
    () {
      final model = AppModel()
        ..desktop = DesktopConnection(
          address: 'https://192.168.1.2',
          fingerprint: 'pc',
        )
        ..desktopOnline = true;
      final meeting = <String, dynamic>{
        'state': 'ended',
        'finished': true,
        'computer': 'pc',
        'snapshot': {
          'task': {'state': 'running'},
        },
      };
      expect(waitingForComputer(meeting, model), true);
      expect(
        waitingForComputer({
          ...meeting,
          'finished': false,
          'state': 'paused',
          'snapshot': {'next': 3, 'processed': 2},
        }, model),
        true,
      );
      expect(
        waitingForComputer({...meeting, 'computer': 'another'}, model),
        false,
      );
      expect(
        waitingForComputer({
          ...meeting,
          'snapshot': {
            'task': {'state': 'done'},
          },
        }, model),
        false,
      );
      model.desktopOnline = false;
      expect(waitingForComputer(meeting, model), false);
      for (final language in languageNames.keys) {
        uiLanguage = language;
        expect(mobileSpeakerName('Local user'), tr('发言人'));
        expect(mobileSpeakerName('local-user'), tr('发言人'));
        expect(mobileSpeakerName('Alice'), 'Alice');
      }
    },
  );

  testWidgets(
    'partial transcript and notes retain dots without empty placeholders',
    (tester) async {
      final model = AppModel()..serviceRunning = true;
      model.live = {
        'id': 'live',
        'title': 'Test',
        'state': 'recording',
        'connected': true,
        'snapshot': <String, dynamic>{'segments': []},
      };
      await tester.pumpWidget(
        MaterialApp(
          home: MeetingPage(model: model, id: 'live'),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));
      final dots = find.descendant(
        of: find.byType(TranscriptionActivity),
        matching: find.byType(Opacity),
      );
      expect(dots, findsNWidgets(3));
      expect(find.text('暂无转写。电脑处理后的文字会显示在这里。'), findsNothing);
      model.live!['snapshot'] = {
        'segments': [
          {'text': 'Partial transcript', 'speaker_name': 'Local user'},
        ],
        'notes': 'Partial notes',
      };
      model.notifyListeners();
      await tester.pump();
      expect(find.text('Partial transcript'), findsOneWidget);
      expect(find.textContaining('发言人'), findsOneWidget);
      expect(dots, findsNWidgets(3));
      await tester.tap(find.text('笔记'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Partial notes'), findsOneWidget);
      expect(dots, findsNWidgets(3));
      model.live!['finished'] = true;
      model.notifyListeners();
      await tester.pumpAndSettle();
      expect(dots, findsNothing);
    },
  );

  testWidgets(
    'long press offline meeting offers upload through existing preparation',
    (tester) async {
      final model = MenuModel()
        ..desktop = UploadMenuConnection()
        ..desktopOnline = true;
      model.meetings = [
        {
          'id': 'offline',
          'title': 'Offline recording',
          'state': 'ended',
          'localOnly': true,
        },
      ];
      await tester.pumpWidget(BreviaApp(model: model));
      await tester.pumpAndSettle();
      await tester.longPress(find.text('Offline recording'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('上传到电脑'));
      await tester.pumpAndSettle();
      expect(find.byType(PrepareMeetingPage), findsOneWidget);
      expect(find.text('上传到这台电脑'), findsOneWidget);
      expect(find.byType(SwitchListTile), findsNothing);
      expect(find.text('录音前请告知参与者。'), findsNothing);
    },
  );

  testWidgets('privacy policy is available offline in every app language', (
    tester,
  ) async {
    for (final language in languageNames.keys) {
      uiLanguage = language;
      await tester.pumpWidget(
        MaterialApp(
          key: ValueKey(language),
          home: Scaffold(body: SettingsPage(model: AppModel())),
        ),
      );
      await tester.scrollUntilVisible(find.text(tr('隐私与关于')), 400);
      await tester.tap(find.text(tr('隐私与关于')));
      await tester.pumpAndSettle();
      final policy = tester
          .widget<SelectableText>(find.byType(SelectableText))
          .data!;
      expect(policy, contains('2026-10-10'));
      expect(policy, contains('https://brevia.work/privacy.html'));
      expect(policy, contains('https://github.com/zerolovesea/Brevia/issues'));
      expect(policy, isNot(contains('Brevia Mobile 0.1')));
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets(
    'offline preparation keeps language and participant choices without a computer',
    (tester) async {
      Map<String, dynamic>? result;
      await tester.pumpWidget(
        MaterialApp(
          theme: breviaTheme(Brightness.light),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await Navigator.push<Map<String, dynamic>>(
                    context,
                    MaterialPageRoute(
                      builder: (_) => PrepareMeetingPage(
                        options: {},
                        computer: '',
                        initial: {'language': 'en', 'num_speakers': 3},
                      ),
                    ),
                  );
                },
                child: Text('prepare'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('prepare'));
      await tester.pumpAndSettle();
      expect(find.text('仅保存在手机'), findsWidgets);
      expect(find.byType(SwitchListTile), findsNothing);
      expect(find.text('录音前请告知参与者。'), findsNothing);
      await tester.tap(find.text('开始录音'));
      await tester.pumpAndSettle();
      expect(result?['offline'], true);
      expect(result?['language'], 'en');
      expect(result?['num_speakers'], 3);
      expect(result?.containsKey('refined_model_id'), false);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('system locale, stored choice and all translation placeholders', (
    tester,
  ) async {
    uiLanguage = 'system';
    tester.platformDispatcher.localesTestValue = [const Locale('ja')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    expect(languageCode, 'ja');
    expect(defaultMeetingTitle(DateTime(2026, 10, 7)), '会議 20261007');
    for (final language in languageNames.keys.where((l) => l != 'zh')) {
      expect(
        translations[language]!.keys.toSet(),
        translations['en']!.keys.toSet(),
      );
      for (final entry in translations[language]!.entries) {
        final placeholders = RegExp(r'\{\d+\}');
        expect(
          placeholders.allMatches(entry.value).map((m) => m[0]).toSet(),
          placeholders.allMatches(entry.key).map((m) => m[0]).toSet(),
          reason: '$language: ${entry.key}',
        );
      }
    }
    SharedPreferences.setMockInitialValues({});
    uiLanguage = 'zh';
    final model = AppModel()
      ..desktop = DesktopConnection(
        address: 'https://192.168.1.2',
        fingerprint: 'test',
      );
    await tester.pumpWidget(BreviaApp(model: model));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.settings_outlined).last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('界面语言'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(find.text('App language'), findsOneWidget);
    expect(
      (await SharedPreferences.getInstance()).getString('uiLanguage'),
      'en',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('long press deletes directly without a confirmation dialog', (
    tester,
  ) async {
    final model = MenuModel()
      ..desktop = DesktopConnection(
        address: 'https://192.168.1.2',
        fingerprint: 'test',
      )
      ..desktopOnline = true;
    model.meetings = [
      {
        'id': 'record',
        'title': '可删除会议',
        'computer': 'test',
        'created': '2026-10-07T10:00:00',
        'state': 'ended',
        'finished': true,
        'samples': 16000,
      },
    ];
    await tester.pumpWidget(BreviaApp(model: model));
    await tester.pumpAndSettle();
    await tester.longPress(find.text('可删除会议'));
    await tester.pumpAndSettle();
    expect(find.text('重新精修'), findsOneWidget);
    expect(find.text('翻译'), findsOneWidget);
    expect(find.text('移动到工作区'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('删除本机记录'),
      160,
      scrollable: find.descendant(
        of: find.byType(BottomSheet),
        matching: find.byType(Scrollable),
      ),
    );
    await tester.tap(find.text('删除本机记录'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(model.meetings, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'right swipe reveals delete; reverse swipe and active rows do not delete',
    (tester) async {
      var deleted = 0;
      Future<void> showRow(bool enabled) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SwipeDelete(
              enabled: enabled,
              onDelete: () async {
                deleted++;
              },
              child: ListTile(title: Text('record')),
            ),
          ),
        ),
      );
      await showRow(true);
      await tester.drag(find.text('record'), const Offset(300, 0));
      await tester.pumpAndSettle();
      expect(deleted, 0);
      expect(find.text('删除'), findsOneWidget);
      await tester.drag(find.text('record'), const Offset(-300, 0));
      await tester.pumpAndSettle();
      expect(find.text('删除'), findsNothing);
      await tester.drag(find.text('record'), const Offset(300, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.text('删除'));
      await tester.pumpAndSettle();
      expect(deleted, 1);
      expect(find.byType(AlertDialog), findsNothing);
      await showRow(false);
      await tester.drag(find.text('record'), const Offset(300, 0));
      await tester.pumpAndSettle();
      expect(find.text('删除'), findsNothing);
      expect(deleted, 1);
    },
  );

  testWidgets('end saves directly and ignores repeated taps while saving', (
    tester,
  ) async {
    final model = EndModel()
      ..live = {
        'id': 'live',
        'title': 'Meeting',
        'state': 'recording',
        'samples': 16000,
        'localOnly': true,
      };
    await tester.pumpWidget(
      MaterialApp(
        theme: breviaTheme(Brightness.light),
        home: MeetingPage(model: model, id: 'live'),
      ),
    );
    await tester.pump();
    await tester.tap(find.text('结束'));
    await tester.pump();
    expect(model.ends, 1);
    expect(find.byType(BottomSheet), findsNothing);
    await tester.tap(find.text('结束'));
    expect(model.ends, 1);
    model.saved.complete();
    await tester.pumpAndSettle();
    expect(find.byType(SavedMeetingPage), findsOneWidget);
    expect(find.text('录音已结束'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test(
    'remote stop stops capture before final upload acknowledgement',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-stop-');
      try {
        final store = RecordingStore(dir, {
          'id': 'test',
          'title': 'Meeting',
          'state': 'recording',
        });
        final connection = StopConnection();
        final engine = StopEngine(store, connection);
        await engine.sync();
        expect(engine.stopped, isTrue);
        expect(store.meta['state'], 'ended');
        expect(connection.calls.last, '/meetings/test/end');
      } finally {
        await dir.delete(recursive: true);
      }
    },
  );

  testWidgets('eight languages fit recording screens on a small phone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final model = AppModel()..serviceRunning = true;
    model.live = {
      'id': 'live',
      'title': 'Design review',
      'state': 'recording',
      'connected': true,
      'samples': 16000,
      'snapshot': {'segments': []},
    };
    for (final language in languageNames.keys) {
      uiLanguage = language;
      await tester.pumpWidget(
        MaterialApp(
          key: ValueKey(language),
          locale: Locale(language),
          supportedLocales: languageNames.keys.map(Locale.new),
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          theme: breviaTheme(Brightness.light),
          home: MeetingPage(model: model, id: 'live'),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(tester.takeException(), isNull, reason: language);
    }
  });
  testWidgets(
    'background notification reflects recording, connection and interruption',
    (tester) async {
      const channel = MethodChannel('flutter_foreground_task/methods');
      final updates = <Map>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        if (call.method == 'isRunningService') return true;
        if (call.method == 'updateService') updates.add(call.arguments as Map);
        return null;
      });
      final store = RecordingStore(Directory.systemTemp, {
        'id': 'test',
        'state': 'recording',
      })..samples = 16000 * 42;
      final engine = RecordingEngine(
        store,
        DesktopConnection(
          address: 'https://192.168.1.2:43187',
          fingerprint: 'test',
          name: 'Computer',
        ),
        (_) {},
      );
      final task = RecordingTask()..engine = engine;
      task.onRepeatEvent(DateTime.now());
      await tester.pump();
      expect(updates.last.toString(), contains('等待电脑连接'));
      expect(updates.last.toString(), contains('暂停'));
      engine.connected = true;
      engine.snapshot = {'samples': 16000 * 40};
      store.meta['state'] = 'paused';
      task.onRepeatEvent(DateTime.now());
      await tester.pump();
      expect(updates.last.toString(), contains('已传到电脑 00:40'));
      expect(updates.last['buttons'].toString(), isNot(contains('pause')));
      expect(updates.last['buttons'].toString(), contains('return'));
      store.meta['state'] = 'interrupted';
      task.onRepeatEvent(DateTime.now());
      await tester.pump();
      expect(updates.last.toString(), contains('录音已中断'));
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      );
    },
  );

  testWidgets(
    'startup waits for the first animation frame and never hides slow initialization',
    (tester) async {
      final ready = Completer<void>();
      await tester.pumpWidget(
        MaterialApp(
          home: Startup(
            initialize: () => ready.future,
            child: const Text('会议列表'),
          ),
        ),
      );
      final image = tester.widget<Image>(find.byType(Image));
      expect(
        (image.image as AssetImage).assetName,
        'assets/brevia-logo-reveal.gif',
      );
      image.frameBuilder!(
        tester.element(find.byType(Image)),
        const SizedBox(),
        0,
        false,
      );
      await tester.pump(const Duration(milliseconds: 1500));
      expect(find.text('会议列表'), findsNothing);
      ready.complete();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('会议列表'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('startup waits for initialization and supports reduced motion', (
    tester,
  ) async {
    final ready = Completer<void>();
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: Startup(
            initialize: () => ready.future,
            child: const Text('已就绪'),
          ),
        ),
      ),
    );
    expect(find.text('已就绪'), findsNothing);
    ready.complete();
    await tester.pumpAndSettle();
    expect(find.text('已就绪'), findsOneWidget);
  });
  testWidgets(
    'offline recording is available before pairing and PIN uses one editable field',
    (tester) async {
      await tester.pumpWidget(BreviaApp(model: AppModel()));
      await tester.pumpAndSettle();
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.text('新建录音'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.laptop_outlined).last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('输入配对码'));
      await tester.tap(find.text('输入配对码'));
      await tester.pumpAndSettle();
      expect(find.byType(TextField), findsNWidgets(2));
      await tester.enterText(find.byType(TextField).last, '123456');
      expect(find.text('连接电脑'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  test(
    'recover committed audio with stale metadata and ignore an unfinished write',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-test-');
      try {
        final store = RecordingStore(dir, {
          'id': 'meeting',
          'state': 'recording',
        });
        await store.save();
        await store.append(Uint8List.fromList([1, 0, 2, 0]));
        await File('${dir.path}/1.pcm.tmp').writeAsBytes([3]);
        final recovered = await RecordingStore.load(dir);
        expect(recovered.samples, 2);
        expect(recovered.offsets, [0]);
        await recovered.append(Uint8List.fromList([3, 0]));
        final wav = await recovered.wav(dir);
        final bytes = await wav.readAsBytes();
        expect(bytes.length, 50);
        expect(bytes.sublist(44), [1, 0, 2, 0, 3, 0]);
        expect(ByteData.sublistView(bytes).getUint32(40, Endian.little), 6);
        await expectLater(recovered.append(Uint8List(1)), throwsArgumentError);
      } finally {
        await dir.delete(recursive: true);
      }
    },
  );
  test('local deletion protects unsynced recordings', () async {
    final dir = await Directory.systemTemp.createTemp('brevia-delete-');
    final store = RecordingStore(dir, {'state': 'ended', 'finished': false});
    await store.save();
    await expectLater(store.deleteLocal(), throwsStateError);
    expect(await dir.exists(), isTrue);
    store.meta['finished'] = true;
    await store.deleteLocal();
    expect(await dir.exists(), isFalse);
  });
  testWidgets(
    'meeting preparation includes desktop configuration at large text',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.textScaleFactorTestValue = 1.4;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await tester.pumpWidget(
        MaterialApp(
          theme: breviaTheme(Brightness.light),
          home: PrepareMeetingPage(
            computer: 'MacBook',
            options: {
              'workspaces': [
                {'id': 'workspace', 'name': '产品研发'},
              ],
              'models': [
                {
                  'id': 'test',
                  'name': '本地识别模型',
                  'status': 'ready',
                  'languages': ['zh'],
                  'default_for_languages': ['zh'],
                },
              ],
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('会议语言'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('录音选项'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('录音选项'));
      await tester.pumpAndSettle();
      expect(find.text('工作区'), findsOneWidget);
      expect(find.text('识别模型'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        find.text('开始录音'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(tester.takeException(), isNull);
    },
  );
  test('pairing only accepts private IPv4 HTTPS endpoints', () {
    expect(DesktopConnection.endpoint('192.168.1.2:43187').scheme, 'https');
    for (final value in [
      'http://192.168.1.2',
      'https://example.com',
      'https://8.8.8.8',
      'https://user@10.0.0.1',
      'https://10.0.0.1/a',
      'https://10.0.0.1?token=x',
    ]) {
      expect(() => DesktopConnection.endpoint(value), throwsFormatException);
    }
  });
  testWidgets('small phone navigation and large text have no layout overflow', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.platformDispatcher.textScaleFactorTestValue = 1.4;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final model = AppModel()
      ..desktop = DesktopConnection(
        address: 'https://192.168.1.2',
        fingerprint: 'test',
        name: 'MacBook',
      );
    await tester.pumpWidget(BreviaApp(model: model));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.byIcon(Icons.laptop_outlined).last);
    await tester.pumpAndSettle();
    expect(find.text('重新扫码连接'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byIcon(Icons.settings_outlined).last);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
  testWidgets('recording and review fit small phones', (tester) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final model = AppModel();
    model.serviceRunning = true;
    model.live = {
      'id': 'test',
      'title': '项目周会',
      'samples': 640000,
      'state': 'recording',
      'connected': false,
      'count': 40,
      'uploaded': 32,
      'marks': [],
      'snapshot': {
        'segments': [
          {'start_ms': 0, 'text': '先确认本周的工作安排。'},
        ],
      },
    };
    await tester.pumpWidget(
      MaterialApp(
        theme: breviaTheme(Brightness.light),
        home: MeetingPage(model: model, id: 'test'),
      ),
    );
    await tester.pump(Duration(milliseconds: 300));
    expect(find.text('暂停'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('笔记'));
    await tester.pump(Duration(milliseconds: 300));
    expect(tester.takeException(), isNull);
  });
}

class MenuModel extends AppModel {
  @override
  Future<void> deleteMeeting(String id) async {
    meetings.removeWhere((m) => m['id'] == id);
    notifyListeners();
  }
}

class StopConnection extends DesktopConnection {
  final calls = <String>[];
  StopConnection() : super(address: 'https://192.168.1.2', fingerprint: 'test');
  @override
  Future<dynamic> call(String method, String route, [Object? data]) async {
    calls.add(route);
    if (route.endsWith('/snapshot')) {
      return {
        'next': 0,
        'samples': 0,
        'stopRequested': true,
        'ended': false,
        'finished': false,
      };
    }
    return {};
  }
}

class StopEngine extends RecordingEngine {
  bool stopped = false;
  StopEngine(RecordingStore store, DesktopConnection connection)
    : super(store, connection, (_) {});
  @override
  Future<void> command(Map<String, dynamic> value) async {
    if (value['action'] == 'end') {
      stopped = true;
      store.meta['state'] = 'ended';
    }
  }
}

class EndModel extends AppModel {
  int ends = 0;
  final saved = Completer<void>();
  @override
  Future<void> command(
    String id,
    String action, {
    String note = '',
    int? sample,
  }) async {
    if (action == 'end') {
      ends++;
      await saved.future;
      live!['state'] = 'ended';
      notifyListeners();
    }
  }
}

class UploadMenuConnection extends DesktopConnection {
  UploadMenuConnection()
    : super(address: 'https://192.168.1.2', fingerprint: 'pc', name: 'Mac');
  @override
  Future<dynamic> call(String method, String route, [Object? data]) async => {
    'models': [
      {
        'id': 'model',
        'status': 'ready',
        'name': 'Model',
        'languages': ['zh'],
      },
    ],
    'workspaces': [],
  };
}
