import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/meeting_artifacts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final meeting = {
    'id': 'review',
    'title': '发布评审',
    'notes': '手机草稿',
    'summary': {
      'data': {
        'markdown': '已完成验收。',
        'claims': [
          {
            'id': 'one',
            'kind': 'cause',
            'section': '发布原因',
            'text': '完成 "A" 验收',
            'edited': true,
            'original_text': '等待验收',
            'sources': [
              {'start_ms': 65000, 'speaker': '林', 'text': '验收已通过。'},
              {
                'start_ms': 1000,
                'seekable': true,
                'current_segment_id': null,
                'text': '原话已重新分段。',
              },
            ],
          },
        ],
      },
    },
    'segments': [
      {
        'start_ms': 3601234,
        'end_ms': 3602999,
        'text': 'Done',
        'translation': '完成',
      },
    ],
  };
  setUp(() => uiLanguage = 'zh');

  test(
    'editable cause tree preserves source quotes and valid audio references',
    () {
      final markdown = causeMarkdown(meeting);
      expect(markdown, contains('flowchart TD'));
      expect(markdown, contains('p0 --- c1'));
      expect(markdown, contains('#34;A#34;'));
      expect(markdown, contains('01:05 · 林 · 验收已通过。'));
      expect(markdown, contains('原话已重新分段。'));
      expect(markdown, isNot(contains('00:01')));
      expect(causeMarkdown(meeting, plain: true), isNot(contains('mermaid')));
      expect(causeMarkdown({'summary': null}), isEmpty);
    },
  );

  test(
    'subtitle exports preserve milliseconds, hours and translated lines',
    () {
      expect(
        transcriptExport(meeting, 'srt'),
        '1\n01:00:01,234 --> 01:00:02,999\nDone\n完成',
      );
      expect(
        transcriptExport(meeting, 'vtt'),
        'WEBVTT\n\n1\n01:00:01.234 --> 01:00:02.999\nDone\n完成',
      );
    },
  );

  testWidgets('phone evidence expands and plays the selected source', (
    tester,
  ) async {
    int? position;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 320,
            child: SingleChildScrollView(
              child: MeetingEvidenceTree(
                snapshot: meeting,
                onSeek: (ms) => position = ms,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('完成 "A" 验收'));
    await tester.pumpAndSettle();
    expect(find.textContaining('等待验收'), findsOneWidget);
    expect(find.text('原话已重新分段。'), findsOneWidget);
    await tester.tap(find.text('01:05'));
    expect(position, 65000);
    expect(find.text('00:01'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'export sheet offers available artifacts and does not require network to open',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: MeetingExportButton(snapshot: meeting)),
        ),
      );
      await tester.tap(find.byTooltip('导出'));
      await tester.pumpAndSettle();
      for (final label in ['会议纪要', '我的笔记', '原因分析', '逐字稿']) {
        expect(find.text(label), findsOneWidget);
      }
      expect(find.text('会议录音'), findsNothing);
    },
  );
  testWidgets('removing a shared meeting dismisses its open export sheet', (
    tester,
  ) async {
    final granted = ValueNotifier(true);
    addTearDown(granted.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ValueListenableBuilder<bool>(
            valueListenable: granted,
            builder: (_, allowed, _) => allowed
                ? MeetingExportButton(snapshot: meeting)
                : const SizedBox(),
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('导出'));
    await tester.pumpAndSettle();
    expect(find.text('我的笔记'), findsOneWidget);
    granted.value = false;
    await tester.pumpAndSettle();
    expect(find.text('我的笔记'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('legacy plain-text summary remains exportable', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: MeetingExportButton(
            snapshot: {'id': 'legacy', 'summary': '已完成验收。'},
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('导出'));
    await tester.pumpAndSettle();
    expect(find.text('会议纪要'), findsOneWidget);
  });
}
