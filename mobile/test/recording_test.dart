import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:brevia_mobile/app_model.dart';
import 'package:record/record.dart';
import 'package:brevia_mobile/recorder.dart';
import 'package:brevia_mobile/storage.dart';
import 'package:brevia_mobile/connection.dart';
import 'package:brevia_mobile/i18n.dart';

class FakeRecorder implements AudioRecorder {
  @override
  Stream<RecordState> onStateChanged() => const Stream.empty();
  bool stopped = false;
  int starts = 0;
  final stream = StreamController<Uint8List>();
  @override
  Future<bool> isPaused() async => false;
  @override
  Future<String?> stop() async {
    stopped = true;
    return null;
  }

  @override
  Future<void> pause() async {}
  @override
  Future<void> resume() async {}
  @override
  Future<bool> isRecording() async => !stopped;
  @override
  Future<Stream<Uint8List>> startStream(RecordConfig config) async {
    starts++;
    stopped = false;
    return stream.stream;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class BrokenStore extends RecordingStore {
  BrokenStore(super.directory, super.meta);
  bool broken = true;
  @override
  Future<void> append(Uint8List bytes) async {
    if (broken) throw FileSystemException('disk full');
    await super.append(bytes);
  }
}

class Engine extends RecordingEngine {
  final FakeRecorder fake = FakeRecorder();
  Engine(RecordingStore s)
    : super(
        s,
        DesktopConnection(address: 'https://192.168.1.2', fingerprint: 'test'),
        (_) {},
      );
  @override
  AudioRecorder get recorder => fake;
  @override
  Future<void> sync() async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'recovered transport wakes a pending sender without waiting for backoff',
    () async {
      final connection = DesktopConnection(
        address: 'https://192.168.1.2',
        fingerprint: 'test',
      );
      final sender = RecoverySender(
        RecordingStore(Directory('/unused'), {'id': 'test', 'state': 'ended'}),
        connection,
      );
      sender.retryAt = DateTime.now().add(Duration(seconds: 15));
      connection.available.add(true);
      await Future<void>.delayed(Duration.zero);
      expect(sender.syncs, 1);
      expect(sender.retryAt.isBefore(DateTime.now()), isTrue);
      await sender.dispose();
      connection.available.add(true);
      await Future<void>.delayed(Duration.zero);
      expect(sender.syncs, 1);
      await connection.available.close();
    },
  );

  test(
    'unpaired offline recording survives reload and uploads only after explicit binding',
    () async {
      final root = await Directory.systemTemp.createTemp('brevia-offline-');
      const channel = MethodChannel('plugins.flutter.io/path_provider');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => root.path);
      final previous = RecordPlatform.instance;
      final platform = LocalRecordPlatform();
      RecordPlatform.instance = platform;
      final model = AppModel();
      try {
        final id = await model.start(
          'Offline',
          offline: true,
          settings: {'language': 'en', 'num_speakers': 3},
        );
        expect(model.engine!.connection, isNull);
        platform.bytes.add(Uint8List.fromList([1, 0, 2, 0]));
        await Future<void>.delayed(Duration.zero);
        await model.command(id, 'end');
        expect(model.engine!.store.meta['state'], 'ended');
        await model.refresh();
        expect(model.engine, isNull);
        final record = await RecordingStore.load(
          Directory('${root.path}/recordings/$id'),
        );
        expect(record.samples, 2);
        expect(record.meta['num_speakers'], 3);
        expect(record.meta['computer'], isNull);
        final connection = SyncConnection();
        model.desktop = connection;
        await model.refresh();
        expect(connection.calls.where((v) => v.startsWith('POST')), isEmpty);
        connection.rejectPrepare = true;
        await expectLater(
          model.upload(id, {'language': 'en'}),
          throwsA(isA<HttpException>()),
        );
        expect(
          (await RecordingStore.metadata(record.directory))['localOnly'],
          true,
        );
        connection.rejectPrepare = false;
        await model.upload(id, {
          'title': 'Offline',
          'language': 'en',
          'num_speakers': 3,
          'refined_model_id': 'test',
        });
        final bound = await RecordingStore.metadata(record.directory);
        expect(bound['computer'], 'test');
        expect(bound['localOnly'], false);
        expect(connection.calls, contains('POST /prepare'));
        expect(connection.calls, contains('POST /meetings'));
        final registration =
            connection.payloads[connection.calls.indexOf('POST /meetings')]
                as Map;
        expect(registration['language'], 'en');
        expect(registration['num_speakers'], 3);
        expect(connection.samples, 2);
      } finally {
        await model.releaseEngines();
        model.dispose();
        await platform.bytes.close();
        RecordPlatform.instance = previous;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
        await root.delete(recursive: true);
      }
    },
  );

  test(
    'late audio reopens a desktop-finished session and synchronization reuses registration',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-sync-');
      final store = RecordingStore(dir, {'id': 'test', 'state': 'ended'});
      await store.append(Uint8List.fromList([1, 0]));
      final connection = SyncConnection();
      final engine = RecordingEngine(store, connection, (_) {});
      try {
        await engine.sync();
        expect(store.meta['finished'], false);
        expect(connection.calls.last, 'POST /meetings/test/end');
        await engine.sync();
        expect(store.meta['finished'], true);
        expect(
          connection.calls.where((v) => v == 'POST /meetings'),
          hasLength(1),
        );
        expect(
          connection.calls.where((v) => v.endsWith('/state')),
          hasLength(1),
        );
      } finally {
        await engine.dispose();
        await dir.delete(recursive: true);
      }
    },
  );
  test(
    'desktop deletion stops retrying and preserves the local copy until explicit deletion',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-deleted-');
      final store = RecordingStore(dir, {'id': 'test', 'state': 'ended'});
      await store.append(Uint8List.fromList([1, 0]));
      final connection = SyncConnection()..deleted = true;
      final engine = RecordingEngine(store, connection, (_) {});
      try {
        await engine.sync();
        await engine.sync();
        expect(connection.calls, hasLength(1));
        expect(store.meta['remoteDeleted'], true);
        expect(await store.chunk(0).exists(), true);
        await store.deleteLocal();
        expect(await dir.exists(), false);
      } finally {
        await engine.dispose();
        if (await dir.exists()) await dir.delete(recursive: true);
      }
    },
  );
  test(
    'foreground commands wait for acknowledgement and propagate rejection',
    () async {
      const channel = MethodChannel('flutter_foreground_task/methods');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => null);
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );
      final model = AppModel();
      final command = model.sendCommand({'action': 'end'});
      expect(model.pendingCommands, hasLength(1));
      final expected = expectLater(command, throwsStateError);
      model.receive({
        'commandId': model.pendingCommands.keys.single,
        'commandError': 'disk full',
      });
      await expected;
      expect(model.pendingCommands, isEmpty);
      final retry = model.sendCommand({'action': 'end'});
      model.receive({'commandId': model.pendingCommands.keys.single});
      await retry;
      model.dispose();
    },
  );

  setUp(() {
    uiLanguage = 'en';
  });
  test(
    'failed final flush rejects end and can be retried without losing audio',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-audit-');
      try {
        final e = Engine(BrokenStore(dir, {'state': 'recording'}));
        e.pending = [1, 0];
        await expectLater(
          e.command({'action': 'end'}),
          throwsA(isA<FileSystemException>()),
        );
        expect(e.error, contains('disk full'));
        expect(e.store.meta['state'], 'interrupted');
        expect(e.pending, [1, 0]);
        (e.store as BrokenStore).broken = false;
        await e.command({'action': 'end'});
        expect(e.store.meta['state'], 'ended');
        expect(e.store.samples, 1);
        expect(e.pending, isEmpty);
        await e.dispose();
      } finally {
        await dir.delete(recursive: true);
      }
    },
  );
  test('resume restarts a stopped microphone', () async {
    final dir = await Directory.systemTemp.createTemp('brevia-audit-');
    try {
      final e = Engine(RecordingStore(dir, {'state': 'recording'}));
      e.fake.stopped = true;
      await e.interrupted('microphone stopped');
      await e.command({'action': 'resume'});
      expect(e.fake.starts, 1);
      expect(e.store.meta['state'], 'recording');
      expect(e.error, isNull);
      e.closing = true;
      await e.fake.stream.close();
      await e.dispose();
    } finally {
      await dir.delete(recursive: true);
    }
  });
  test(
    'forgetting desktop disposes completed engine and cancels synchronization',
    () async {
      const channel = MethodChannel(
        'plugins.it_nomads.com/flutter_secure_storage',
      );
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => null);
      final dir = await Directory.systemTemp.createTemp('brevia-audit-');
      final e = Engine(
        RecordingStore(dir, {
          'id': 'audit',
          'state': 'ended',
          'finished': true,
        }),
      );
      final model = AppModel()
        ..desktop = e.connection
        ..engine = e
        ..meetings = [
          {'computer': 'test', 'finished': true},
        ];
      try {
        await e.initialize(capture: false);
        await model.forget();
        expect(model.desktop, isNull);
        expect(model.engine, isNull);
        expect(e.disposed, isTrue);
        expect(e.timer!.isActive, isFalse);
      } finally {
        await e.dispose();
        model.dispose();
        await dir.delete(recursive: true);
      }
    },
  );
}

class SyncConnection extends DesktopConnection {
  final List<String> calls = [];
  bool deleted = false, rejectPrepare = false;
  int next = 0, samples = 0;
  final List<Object?> payloads = [];
  SyncConnection() : super(address: 'https://192.168.1.2', fingerprint: 'test');
  @override
  Future<dynamic> call(String method, String route, [Object? data]) async {
    calls.add('$method $route');
    payloads.add(data);
    if (rejectPrepare && route == '/prepare') throw HttpException('not ready');
    if (deleted) throw MeetingDeletedException();
    if (route.endsWith('/snapshot')) {
      return {
        'next': next,
        'samples': samples,
        'ended': true,
        'finished': true,
      };
    }
    if (route.endsWith('/chunks')) {
      next++;
      samples += base64Decode((data as Map)['pcm']).length ~/ 2;
      return {'next': next, 'samples': samples};
    }
    return {};
  }
}

class LocalRecordPlatform extends RecordPlatform {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  final bytes = StreamController<Uint8List>();
  @override
  Future<void> create(String id) async {}
  @override
  Future<bool> hasPermission(String id, {bool request = true}) async => true;
  @override
  Stream<RecordState> onStateChanged(String id) => const Stream.empty();
  @override
  Future<Stream<Uint8List>> startStream(String id, RecordConfig config) async =>
      bytes.stream;
  @override
  Future<String?> stop(String id) async => null;
  @override
  Future<void> dispose(String id) async {}
}

class RecoverySender extends RecordingEngine {
  int syncs = 0;
  RecoverySender(RecordingStore store, DesktopConnection connection)
    : super(store, connection, (_) {});
  @override
  Future<void> sync() async {
    syncs++;
  }
}
