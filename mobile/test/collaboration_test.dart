import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:brevia_mobile/app_model.dart';
import 'package:brevia_mobile/collaboration.dart';
import 'package:brevia_mobile/connection.dart';
import 'package:brevia_mobile/desktop_library.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:brevia_mobile/main.dart' show connectPairedComputer;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class Host extends DesktopConnection {
  Host({super.token = 'device-token'})
    : super(address: '192.168.1.1', fingerprint: 'desktop-cert');

  List<Map<String, dynamic>> catalogue = [
    {'id': 'one', 'title': 'Launch', 'state': 'recording'},
  ];
  Map<String, dynamic> detail = {
    'id': 'one',
    'title': 'Launch',
    'state': 'recording',
    'notes': 'First draft',
    'revision': 'initial',
    'segments': [
      {'id': 1, 'start_ms': 12000, 'end_ms': 16100, 'text': 'Ship Friday'},
    ],
  };
  List<Object?> actions = [];
  Completer<void>? gate;
  int snapshots = 0;
  final downloads = <String>[];
  int imageReads = 0;
  bool failSave = false;
  bool offlineAfterSubmit = false;
  @override
  Future<void> save() async {
    if (failSave) throw FileSystemException('disk full');
  }

  @override
  Future<void> downloadFile(String route, File temporary) async {
    downloads.add(route);
    await temporary.writeAsBytes([37, 80, 68, 70]);
  }

  @override
  Future<dynamic> call(String method, String route, [Object? data]) async {
    if (route == '/desktop-meetings') return catalogue;
    if (route.endsWith('/snapshot')) {
      snapshots++;
      if (offlineAfterSubmit) throw const SocketException('Wi-Fi disconnected');
      await gate?.future;
      return {...detail};
    }
    if (route.endsWith('/images/abc.jpg')) {
      imageReads++;
      return {'base64': '/9j/AQ=='};
    }
    actions.add(data);
    if (route.endsWith('/proposals')) {
      detail['proposal'] = {'id': (data as Map)['id'], 'state': 'pending'};
      return detail['proposal'];
    }
    if (route.endsWith('/action')) {
      detail['task'] = {
        'id': 'job',
        'action': (data as Map)['action'],
        'state': 'running',
      };
      return {'task': detail['task']};
    }
    throw StateError(route);
  }
}

class MemoryLibrary extends DesktopLibrary {
  MemoryLibrary(Host host) : super(host) {
    meetings = host.catalogue;
  }
  @override
  bool get authoritative => true;
  @override
  Future<MeetingData> cached(String id) async => {};
  @override
  Future<MeetingData> draft(String id) async => {};
  @override
  Future<void> saveDraft(String id, MeetingData value) async {}
  @override
  Future<MeetingData> snapshot(String id) async => Map<String, dynamic>.from(
    await connection.call('GET', '/desktop-meetings/$id/snapshot'),
  );
}

class Phone extends AppModel {
  Phone(this.library);
  final DesktopLibrary library;
  @override
  DesktopLibrary get desktopLibrary => library;
  void revoke() {
    library.meetings = [];
    notifyListeners();
  }
}

class PairingPhone extends Phone {
  PairingPhone(super.library);
  @override
  Future<void> refresh({bool localOnly = false}) async {}
  @override
  Future<void> refreshLibrary() async {}
}

class ConfirmationPhone extends AppModel {
  final attempts = <bool>[];
  @override
  Future<void> connect(
    DesktopConnection candidate, {
    bool discardSharedDrafts = false,
  }) async {
    attempts.add(discardSharedDrafts);
    if (!discardSharedDrafts) throw UnsyncedDesktopDraftsException();
    desktop = candidate;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => uiLanguage = 'zh');
  testWidgets('changing computers confirms before discarding unsynced notes', (
    tester,
  ) async {
    final phone = ConfirmationPhone(), candidate = Host();
    addTearDown(phone.dispose);
    bool? switched;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (ctx) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                switched = await connectPairedComputer(ctx, phone, candidate);
              },
              child: const Text('Pair'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Pair'));
    await tester.pumpAndSettle();
    expect(find.text('更换配对电脑？'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(switched, false);
    expect(phone.attempts, [false]);
    expect(phone.desktop, isNull);
    await tester.tap(find.text('Pair'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('更换电脑'));
    await tester.pumpAndSettle();
    expect(switched, true);
    expect(phone.attempts, [false, false, true]);
    expect(phone.desktop, same(candidate));
  });

  test(
    'phone recording keeps desktop task receipt and full captions on connection loss',
    () async {
      final root = await Directory.systemTemp.createTemp('brevia-owned-job-');
      addTearDown(() => root.delete(recursive: true));
      const channel = MethodChannel('plugins.flutter.io/path_provider');
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(channel, (_) async => root.path);
      addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
      final dir = await Directory(
        '${root.path}/recordings/one',
      ).create(recursive: true);
      final file = File('${dir.path}/snapshot.json');
      const caption = {'text': 'Ship Friday', 'start_ms': 12000};
      await file.writeAsString(
        jsonEncode({
          'segments': [caption],
        }),
      );
      final host = Host()..offlineAfterSubmit = true;
      final phone = AppModel()..desktop = host;
      addTearDown(phone.dispose);
      phone.meetings = [
        {'id': 'one', 'finished': true, 'computer': host.fingerprint},
      ];
      await expectLater(
        phone.meetingAction('one', 'summary', consent: true),
        throwsA(isA<SocketException>()),
      );
      final saved = jsonDecode(await file.readAsString());
      expect(saved['segments'], [caption]);
      expect(saved['task']['state'], 'running');
      expect(phone.meeting('one')?['snapshot']['task']['id'], 'job');
    },
  );
  test(
    'incoming notes do not overwrite the draft, including edits after sending',
    () {
      final draft = SharedNoteDraft();
      draft.reconcile({'notes': 'first', 'revision': '1'});
      draft.text = 'first + mobile';
      final id = draft.prepare();
      final restored = SharedNoteDraft.restore(draft.toJson());
      restored.text += ' + later';
      restored.reconcile({'notes': 'desktop edit', 'revision': '2'});
      expect(restored.revision, '1');
      expect(restored.text, 'first + mobile + later');
      restored.reconcile({
        'notes': 'first + mobile',
        'revision': '3',
        'proposal': {'id': id, 'state': 'accepted'},
      });
      expect(restored.base, 'first + mobile');
      expect(restored.text, 'first + mobile + later');
      expect(restored.dirty, true);
      expect(restored.proposalId, isNull);
      final second = restored.prepare();
      restored.reconcile({
        'notes': 'other',
        'revision': '4',
        'proposal': {'id': second, 'state': 'declined'},
      });
      expect(restored.text, 'first + mobile + later');
      restored.resolve({'notes': 'other', 'revision': '4'}, keepLocal: false);
      expect(restored.dirty, false);
      expect(restored.text, 'other');
    },
  );

  test(
    'a running request is reused, and an ended job syncs after restarting the phone',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-desktop-job-');
      addTearDown(() => dir.delete(recursive: true));
      final host = Host();
      host.catalogue.first['state'] = 'ended';
      host.detail['state'] = 'ended';
      final library = DesktopLibrary(host, directory: dir);
      await library.refresh();
      host.gate = Completer();
      final first = library.snapshot('one');
      final second = library.snapshot('one');
      expect(identical(first, second), true);
      host.gate!.complete();
      await first;
      expect(host.snapshots, 1);
      await library.process('one', 'summary', 'job');
      expect(host.actions.single, {
        'action': 'summary',
        'request_id': 'job',
        'consent': true,
      });
      host.detail['task'] = {'id': 'job', 'state': 'done'};
      host.detail['summary'] = {
        'data': {'markdown': 'Completed'},
      };
      final reopened = DesktopLibrary(host, directory: dir);
      await reopened.refresh();
      expect(
        (await reopened.cached('one'))['summary']['data']['markdown'],
        'Completed',
      );
      await reopened.refresh();
      expect(host.snapshots, 2);
      await reopened.saveDraft('one', {'text': 'my edit'});
      final differentPair = DesktopLibrary(
        Host(token: 'different'),
        directory: dir,
      );
      await differentPair.load();
      expect(differentPair.meetings, isEmpty);
      expect(await differentPair.draft('one'), isEmpty);
      host.catalogue = [];
      await reopened.refresh();
      expect(await reopened.cached('one'), isEmpty);
      expect(await reopened.draft('one'), isEmpty);
      host.catalogue = [
        {'id': 'one', 'state': 'ended'},
      ];
      await reopened.refresh();
      expect(await reopened.cached('one'), isEmpty);
    },
  );

  test(
    'document export uses supported formats and a new file on each request',
    () async {
      final dir = await Directory.systemTemp.createTemp(
        'brevia-desktop-export-',
      );
      addTearDown(() => dir.delete(recursive: true));
      final host = Host();
      const id = 'c02a85a8-8ee4-40b5-b7f7-790c098c5f0f';
      host.catalogue.first['id'] = id;
      final library = DesktopLibrary(host, directory: dir);
      await library.refresh();
      final first = await library.document(id, 'notes', 'pdf');
      final second = await library.document(id, 'notes', 'pdf');
      expect(await first.readAsBytes(), [37, 80, 68, 70]);
      expect(second.path, isNot(first.path));
      expect(host.downloads.last, '/desktop-meetings/$id/document/notes/pdf');
      await expectLater(
        library.document(id, 'notes', '../other'),
        throwsArgumentError,
      );
      host.catalogue = [];
      await library.refresh();
      await expectLater(
        library.document(id, 'notes', 'docx'),
        throwsStateError,
      );
      expect(host.downloads, hasLength(2));
    },
  );

  test(
    'switching pairing checks unsent drafts before changing credentials and purges after save',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-switch-');
      addTearDown(() => dir.delete(recursive: true));
      final previous = Host();
      final library = DesktopLibrary(previous, directory: dir);
      await library.refresh();
      await library.saveDraft('one', {'base': 'prior', 'text': 'unpublished'});
      final phone = PairingPhone(library)..desktop = previous;
      final next = Host(token: 'new');
      addTearDown(phone.dispose);
      await expectLater(
        phone.connect(next),
        throwsA(isA<UnsyncedDesktopDraftsException>()),
      );
      expect(phone.desktop, same(previous));
      next.failSave = true;
      await expectLater(
        phone.connect(next, discardSharedDrafts: true),
        throwsA(isA<FileSystemException>()),
      );
      expect((await library.draft('one'))['text'], 'unpublished');
      expect(phone.desktop, same(previous));
      next.failSave = false;
      await phone.connect(next, discardSharedDrafts: true);
      expect(phone.desktop, same(next));
      expect(await library.draft('one'), isEmpty);
      final reopened = DesktopLibrary(previous, directory: dir);
      await reopened.load();
      expect(reopened.meetings, isEmpty);
      expect(await reopened.hasUnsyncedDrafts(), false);
    },
  );

  test(
    'a newer desktop job retires a superseded mobile request after archiving the result',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-next-job-');
      addTearDown(() => dir.delete(recursive: true));
      final host = Host();
      host.catalogue.first['state'] = 'ended';
      host.detail['state'] = 'ended';
      final library = DesktopLibrary(host, directory: dir);
      await library.refresh();
      await library.process('one', 'summary', 'job');
      host.detail['task'] = {'id': 'newer', 'state': 'running'};
      host.detail['summary'] = {
        'data': {'markdown': 'Finished job'},
      };
      await library.refresh();
      final reopened = DesktopLibrary(host, directory: dir);
      await reopened.refresh();
      expect(host.snapshots, 1);
      expect(
        (await reopened.cached('one'))['summary']['data']['markdown'],
        'Finished job',
      );
    },
  );

  test(
    'saved images are available offline and are removed on sharing revocation',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-images-');
      addTearDown(() => dir.delete(recursive: true));
      final host = Host();
      final library = DesktopLibrary(host, directory: dir);
      await library.refresh();
      expect(await library.image('one', 'abc.jpg'), [255, 216, 255, 1]);
      final reopened = DesktopLibrary(host, directory: dir);
      await reopened.load();
      expect(await reopened.image('one', 'abc.jpg'), [255, 216, 255, 1]);
      expect(host.imageReads, 1);
      await expectLater(
        reopened.image('one', '../private.jpg'),
        throwsFormatException,
      );
      host.catalogue = [];
      await reopened.refresh();
      expect(
        await dir
            .list(recursive: true)
            .where((e) => e.path.endsWith('.jpg'))
            .toList(),
        isEmpty,
      );
      await expectLater(reopened.image('one', 'abc.jpg'), throwsStateError);
    },
  );

  test(
    'only images belonging to this meeting resolve to attachment downloads',
    () {
      expect(
        DesktopLibrary.attachmentName(
          'one',
          Uri.parse('brevia-note://one/abc.jpg'),
        ),
        'abc.jpg',
      );
      for (final uri in [
        'brevia-note://other/abc.jpg',
        'https://one/abc.jpg',
        'brevia-note://one/%2E%2E%2Fprivate.jpg',
      ]) {
        expect(DesktopLibrary.attachmentName('one', Uri.parse(uri)), isNull);
      }
      expect(
        DesktopLibrary.imageType(Uint8List.fromList([255, 216, 255, 1])),
        'image/jpeg',
      );
      expect(
        () => DesktopLibrary.imageType(Uint8List(8)),
        throwsFormatException,
      );
      expect(
        () => DesktopLibrary.imageType(Uint8List(4 * 1024 * 1024 + 1)),
        throwsFormatException,
      );
    },
  );

  testWidgets(
    'revoking sharing closes the open comparison and erases the editor',
    (tester) async {
      final host = Host();
      final model = Phone(MemoryLibrary(host));
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopMeetingPage(model: model, id: 'one'),
        ),
      );
      await tester.pumpAndSettle();
      host.detail.addAll({'revision': '2', 'notes': 'Private changed note'});
      await tester.pump(const Duration(seconds: 2));
      await tester.pump();
      await tester.tap(find.text('查看更新'));
      await tester.pumpAndSettle();
      expect(find.text('Private changed note'), findsOneWidget);
      model.revoke();
      await tester.pumpAndSettle();
      expect(find.text('Private changed note'), findsNothing);
      expect(find.text('这场会议已停止共享'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      model.dispose();
    },
  );

  testWidgets(
    'a live caption becomes a source-linked note only when sent for desktop review',
    (tester) async {
      final host = Host();
      final model = Phone(MemoryLibrary(host));
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopMeetingPage(model: model, id: 'one'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Ship Friday'), findsOneWidget);
      await tester.tap(find.byTooltip('标记到笔记'));
      await tester.pumpAndSettle();
      expect(host.actions, isEmpty);
      await tester.tap(find.text('发送至电脑'));
      await tester.pumpAndSettle();
      expect(
        (host.actions.single as Map)['notes'],
        contains('[00:12](#brevia-highlight-12000) Ship Friday'),
      );
      expect(find.text('等待电脑确认'), findsOneWidget);
      host.detail.addAll({
        'revision': 'second',
        'notes': 'From desktop',
        'proposal': null,
      });
      await tester.pump(const Duration(seconds: 2));
      await tester.pump();
      expect(find.text('查看更新'), findsOneWidget);
      await tester.tap(find.text('查看更新'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('使用电脑版本'));
      await tester.pumpAndSettle();
      expect(find.textContaining('From desktop'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      model.dispose();
    },
  );
}
