import 'package:brevia_mobile/design_system.dart';
import 'package:brevia_mobile/swipe_delete.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'page handoff retains visible content without exposing old controls',
    (tester) async {
      late StateSetter update;
      var next = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) {
                update = setState;
                return AnimatedSwitcher(
                  duration: BreviaMotion.state,
                  layoutBuilder: breviaPageLayout,
                  child: TextField(
                    key: ValueKey(next),
                    decoration: InputDecoration(hintText: next ? '下一页' : '当前页'),
                  ),
                );
              },
            ),
          ),
        ),
      );
      await tester.enterText(find.byType(TextField), '未提交草稿');
      update(() => next = true);
      await tester.pump();
      final old = find.byKey(const ValueKey(false));
      final current = find.byKey(const ValueKey(true));
      expect(find.text('未提交草稿'), findsOneWidget);
      expect(
        tester
            .widget<FadeTransition>(
              find
                  .ancestor(of: old, matching: find.byType(FadeTransition))
                  .first,
            )
            .opacity
            .value,
        1,
      );
      expect(
        tester
            .widget<FadeTransition>(
              find
                  .ancestor(of: current, matching: find.byType(FadeTransition))
                  .first,
            )
            .opacity
            .value,
        0,
      );
      expect(
        tester
            .widgetList<ExcludeSemantics>(
              find.ancestor(of: old, matching: find.byType(ExcludeSemantics)),
            )
            .any((widget) => widget.excluding),
        isTrue,
      );
      expect(
        tester
            .widgetList<IgnorePointer>(
              find.ancestor(of: old, matching: find.byType(IgnorePointer)),
            )
            .any((widget) => widget.ignoring),
        isTrue,
      );
      await tester.pumpAndSettle();
      expect(old, findsNothing);
      expect(current, findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a changing status exposes only the current state and keeps its bounds',
    (tester) async {
      late StateSetter update;
      var saved = false;
      var reduced = false;
      await tester.pumpWidget(
        MaterialApp(
          theme: breviaTheme(Brightness.light),
          home: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(disableAnimations: reduced),
                child: Scaffold(
                  body: Center(
                    child: SizedBox(
                      width: 200,
                      height: 48,
                      child: BreviaStateChange(
                        child: Text(
                          saved ? '已保存' : '正在保存',
                          key: ValueKey(saved),
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      );
      final bounds = tester.getRect(find.byType(BreviaStateChange));
      update(() => saved = true);
      await tester.pump();
      expect(find.text('正在保存'), findsNothing);
      expect(find.text('已保存'), findsOneWidget);
      expect(tester.getRect(find.byType(BreviaStateChange)), bounds);
      update(() => reduced = true);
      await tester.pump();
      expect(
        tester
            .widget<AnimatedSwitcher>(find.byType(AnimatedSwitcher).last)
            .duration,
        Duration.zero,
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'swipe follows the finger immediately and cancellation never deletes',
    (tester) async {
      var deletions = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: breviaTheme(Brightness.light),
          home: Scaffold(
            body: SwipeDelete(
              enabled: true,
              onDelete: () async {
                deletions++;
              },
              child: const ListTile(title: Text('产品周会')),
            ),
          ),
        ),
      );
      final gesture = await tester.startGesture(
        tester.getCenter(find.text('产品周会')),
      );
      await gesture.moveBy(const Offset(25, 0));
      await tester.pump();
      await gesture.moveBy(const Offset(35, 0));
      await tester.pump();
      final container = find.descendant(
        of: find.byType(SwipeDelete),
        matching: find.byType(AnimatedContainer),
      );
      expect(
        tester.widget<AnimatedContainer>(container).duration,
        Duration.zero,
      );
      expect(
        tester.widget<AnimatedContainer>(container).transform!.storage[12],
        greaterThan(0),
      );
      await gesture.cancel();
      await tester.pump();
      expect(
        tester.widget<AnimatedContainer>(container).transform!.storage[12],
        0,
      );
      await tester.pumpAndSettle();
      expect(deletions, 0);
    },
  );

  testWidgets(
    'sheets can be dismissed during entry with normal and reduced motion',
    (tester) async {
      for (final reduced in [false, true]) {
        var closed = false;
        await tester.pumpWidget(
          MaterialApp(
            key: UniqueKey(),
            theme: breviaTheme(Brightness.light),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
              child: child!,
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () async {
                    await showModalBottomSheet<void>(
                      context: context,
                      sheetAnimationStyle: BreviaMotion.sheet(context),
                      builder: (context) => SizedBox(
                        height: 200,
                        child: TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('关闭'),
                        ),
                      ),
                    );
                    closed = true;
                  },
                  child: const Text('打开'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('打开'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));
        await tester.tap(find.text('关闭'));
        await tester.pumpAndSettle();
        expect(closed, isTrue);
        expect(find.text('关闭'), findsNothing);
        expect(tester.takeException(), isNull);
      }
    },
  );
}
