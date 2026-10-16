import 'package:brevia_mobile/main.dart';
import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/recording_controls.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('recording explanation fits a small phone with large text', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 568);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(() => uiLanguage = 'system');
    uiLanguage = 'de';
    final level = ValueNotifier<double>(0);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(2)),
          child: child!,
        ),
        home: Scaffold(
          body: RecordingFocus(
            meeting: {
              'desktopCapture': true,
              'state': 'paused',
              'samples': 16000,
            },
            desktopName: List.filled(4, 'Alexandria MacBook Pro ').join(),
            live: true,
            pending: false,
            level: level,
            onPause: () {},
            onEnd: () {},
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip(tr('录音说明')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text(tr('暂停期间不采集音频')), findsWidgets);
    await tester.pumpWidget(const SizedBox());
    level.dispose();
  });
  testWidgets(
    'recording controls remain accessible across phone sizes and languages',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPadding);
      addTearDown(() => uiLanguage = 'system');
      final overflow = <String>[];
      for (final mode in ['desktop', 'online', 'local']) {
        for (final size in [const Size(320, 568), const Size(393, 852)]) {
          tester.view.physicalSize = size;
          tester.view.padding = FakeViewPadding(
            top: 20,
            bottom: size.height > 700 ? 34 : 0,
          );
          for (final language in languageNames.keys) {
            uiLanguage = language;
            for (final scale in [1.0, 2.0]) {
              final model = AppModel()..serviceRunning = true;
              model.live = {
                'id': 'recording',
                'title': 'Meeting',
                'desktopCapture': mode == 'desktop',
                'localOnly': mode == 'local',
                'connected': true,
                'state': 'recording',
                'samples': 16000,
                'snapshot': {'samples': 8000},
              };
              await tester.pumpWidget(
                MaterialApp(
                  key: UniqueKey(),
                  theme: breviaTheme(Brightness.light),
                  builder: (context, child) => MediaQuery(
                    data: MediaQuery.of(
                      context,
                    ).copyWith(textScaler: TextScaler.linear(scale)),
                    child: child!,
                  ),
                  home: MeetingPage(model: model, id: 'recording'),
                ),
              );
              await tester.pump();
              final failure = tester.takeException();
              expect(failure, isNull, reason: '$size / $language / $scale');
              expect(
                find.byTooltip(tr('结束')).hitTestable(),
                findsOneWidget,
                reason: '$size / $language / $scale',
              );
              if (scale == 1) {
                final scrollable = tester.state<ScrollableState>(
                  find.descendant(
                    of: find.byKey(const ValueKey('recording-focus-scroll')),
                    matching: find.byType(Scrollable),
                  ),
                );
                if (scrollable.position.maxScrollExtent > 0) {
                  overflow.add(
                    '$mode / $size / $language: ${scrollable.position.maxScrollExtent}',
                  );
                }
              }
              await tester.pumpWidget(const SizedBox());
              model.dispose();
            }
          }
        }
      }
      expect(overflow, isEmpty);
    },
  );
  testWidgets(
    'active and paused recording replace both new recording entries',
    (tester) async {
      uiLanguage = 'en';
      addTearDown(() => uiLanguage = 'system');
      for (final state in ['recording', 'paused']) {
        final model = AppModel()..serviceRunning = true;
        model.live = {
          'id': 'live',
          'title': 'Active meeting',
          'localOnly': true,
          'state': state,
          'samples': 16000,
        };
        await tester.pumpWidget(
          MaterialApp(
            key: UniqueKey(),
            theme: breviaTheme(Brightness.light),
            home: Home(model: model),
          ),
        );
        await tester.pump();
        expect(find.text(tr('新建录音')), findsNothing);
        expect(find.byTooltip(tr('新建录音')), findsNothing);
        await tester.tap(find.byKey(const ValueKey('recording-return')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(find.byType(MeetingPage), findsOneWidget);
        expect(model.viewedMeetingId, 'live');
        Navigator.of(tester.element(find.byType(MeetingPage))).pop();
        await tester.pump(const Duration(milliseconds: 400));
        model.live!['state'] = 'ended';
        model.notifyListeners();
        await tester.pump();
        expect(find.byKey(const ValueKey('recording-return')), findsNothing);
        expect(find.text(tr('新建录音')), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
        model.dispose();
      }
    },
  );
}
