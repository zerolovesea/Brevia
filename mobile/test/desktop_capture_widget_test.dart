import 'dart:async';

import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('desktop start opens recording from another page only once', (
    tester,
  ) async {
    final model = AppModel()..serviceRunning = true;
    await tester.pumpWidget(
      MaterialApp(
        theme: breviaTheme(Brightness.light),
        home: Home(model: model),
      ),
    );
    final navigator = Navigator.of(tester.element(find.byType(Home)));
    unawaited(
      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('Settings page')),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    final meeting = <String, dynamic>{
      'id': 'desktop',
      'title': 'Desktop meeting',
      'desktopCapture': true,
      'state': 'recording',
      'samples': 0,
    };
    model.receive(meeting);
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(MeetingPage), findsOneWidget);
    expect(model.viewedMeetingId, 'desktop');
    navigator.pop();
    await tester.pumpAndSettle();
    model.receive({...meeting, 'samples': 16000});
    await tester.pump();
    expect(find.byType(MeetingPage), findsNothing);
    expect(find.text('Settings page'), findsOneWidget);
    model.receive({...meeting, 'id': 'next-desktop'});
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(MeetingPage), findsOneWidget);
    expect(model.viewedMeetingId, 'next-desktop');
    await tester.pumpWidget(const SizedBox());
    model.dispose();
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'desktop meetings show phone audio without transcript or note tabs',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(() => uiLanguage = 'system');
      for (final language in languageNames.keys) {
        uiLanguage = language;
        for (final state in ['recording', 'ended']) {
          final model = AppModel()..serviceRunning = state == 'recording';
          final meeting = <String, dynamic>{
            'id': 'desktop',
            'title': 'Desktop meeting',
            'state': state,
            'desktopCapture': true,
            'samples': 16000,
            'finished': state == 'ended',
            'snapshot': {
              'segments': [
                {'text': 'Private desktop transcript'},
              ],
              'notes': 'Private desktop notes',
            },
          };
          model.meetings = [meeting];
          if (state == 'recording') model.live = meeting;
          await tester.pumpWidget(
            MaterialApp(
              theme: breviaTheme(Brightness.light),
              home: MeetingPage(
                key: ValueKey('$language-$state'),
                model: model,
                id: 'desktop',
              ),
            ),
          );
          await tester.pump();
          if (state == 'ended') {
            await tester.scrollUntilVisible(
              find.text(tr('电脑会议的手机录音')),
              200,
              scrollable: find
                  .descendant(
                    of: find.byType(ListView),
                    matching: find.byType(Scrollable),
                  )
                  .first,
            );
          } else {
            expect(find.byTooltip(tr('录音说明')).hitTestable(), findsOneWidget);
            expect(find.byTooltip(tr('结束')).hitTestable(), findsOneWidget);
          }
          if (state == 'ended') {
            expect(find.text(tr('电脑会议的手机录音')), findsOneWidget);
          }
          expect(find.text('Private desktop transcript'), findsNothing);
          expect(find.text('Private desktop notes'), findsNothing);
          expect(find.text(tr('仅保存在手机')), findsNothing);
          expect(tester.takeException(), isNull, reason: '$language / $state');
          await tester.pumpWidget(const SizedBox());
          model.dispose();
        }
      }
    },
  );
}
