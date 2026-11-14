import 'dart:convert';
import 'dart:io';

import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('phone notes save on background before the debounce fires', (
    tester,
  ) async {
    uiLanguage = 'zh';
    const id = 'b46cbe75-c097-436b-9322-55c336203f38';
    final root = (await tester.runAsync(
      () => Directory.systemTemp.createTemp('brevia-phone-notes-'),
    ))!;
    addTearDown(() => root.delete(recursive: true));
    const channel = MethodChannel('plugins.flutter.io/path_provider');
    final messenger = tester.binding.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(channel, (_) async => root.path);
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
    final file = File('${root.path}/recordings/$id/phone-notes.json');
    await tester.runAsync(() async {
      await file.parent.create(recursive: true);
      await file.writeAsString(jsonEncode({'text': 'before', 'base': ''}));
    });
    final model = AppModel()
      ..meetings = [
        {
          'id': id,
          'title': 'Local notes',
          'state': 'ended',
          'localOnly': true,
          'samples': 0,
          'snapshot': {'segments': []},
        },
      ];
    addTearDown(model.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: breviaTheme(Brightness.light),
        home: MeetingPage(model: model, id: id, initialTab: 1),
      ),
    );
    for (var i = 0; i < 12 && find.byType(TextField).evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 30));
      });
    }
    await tester.pump();
    await tester.enterText(find.byType(TextField).first, 'before + last edit');
    model.didChangeAppLifecycleState(AppLifecycleState.paused);
    Map? saved;
    for (var i = 0; i < 12 && saved?['text'] != 'before + last edit'; i++) {
      await tester.pump();
      saved = await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 30));
        return jsonDecode(await file.readAsString()) as Map;
      });
    }
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    });
    expect(saved?['text'], 'before + last edit');
    expect(tester.takeException(), isNull);
  });
}
