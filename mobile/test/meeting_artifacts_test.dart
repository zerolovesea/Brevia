import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/meeting_artifacts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('note formatting preserves surrounding text and selection', () {
    final editor = TextEditingController(text: '前文选中文字后文')
      ..selection = const TextSelection(baseOffset: 2, extentOffset: 6);
    insertNoteFormat(editor, '**', '**');
    expect(editor.text, '前文**选中文字**后文');
    expect(editor.selection.baseOffset, 8);
    editor.selection = const TextSelection.collapsed(offset: -1);
    insertNoteFormat(editor, '\n- [ ] ');
    expect(editor.text, '前文**选中文字**后文\n- [ ] ');
    editor.dispose();
  });

  testWidgets(
    'minutes menu fits large translated text and blocks busy actions',
    (tester) async {
      tester.view.physicalSize = const Size(320, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      uiLanguage = 'de';
      addTearDown(() => uiLanguage = 'system');
      var calls = 0;
      Future<void> show(bool busy) => tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(2)),
            child: Scaffold(
              body: MeetingArtifactActions(
                hasSummary: true,
                busy: busy,
                onGenerate: () => calls++,
                onRefine: () => calls++,
              ),
            ),
          ),
        ),
      );
      await show(false);
      await tester.tap(find.byTooltip(tr('更多')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text(tr('重新生成纪要')));
      await tester.pumpAndSettle();
      expect(calls, 1);
      await show(true);
      expect(
        tester
            .widget<PopupMenuButton<String>>(
              find.byType(PopupMenuButton<String>),
            )
            .enabled,
        isFalse,
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );
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
