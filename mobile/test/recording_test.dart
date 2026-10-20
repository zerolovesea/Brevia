import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';
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

class CountingStore extends RecordingStore {
  CountingStore(super.directory, super.meta);
  int saves = 0;
  @override
  Future<void> save() async {
    saves++;
    await super.save();
  }
}

class BlockedStore extends RecordingStore {
  final release = Completer<void>();
  BlockedStore(super.directory, super.meta);
  @override
  Future<void> append(Uint8List bytes) async {
    await release.future;
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

class OfflineConnection extends DesktopConnection {
  final requested = Completer<void>();
  final response = Completer<dynamic>();
  int calls = 0;
  OfflineConnection()
    : super(address: 'https://192.168.1.2', fingerprint: 'offline');
  @override
  Future<dynamic> call(String method, String route, [Object? data]) {
    calls++;
    if (!requested.isCompleted) requested.complete();
    return response.future;
  }
}

class CaptureConnection extends DesktopConnection {
  final requests = <String>[];
  final id = 'b46cbe75-c097-436b-9322-55c336203f38';
  int controlVersion = 0;
  String desiredState = 'recording';
  bool stopRequested = false;
  bool preview = false, requestRecording = true;
  final levels = <double?>[];
  CaptureConnection()
    : super(address: 'https://192.168.1.2', fingerprint: 'capture');
  @override
  Future<dynamic> call(String method, String route, [Object? data]) async {
    requests.add('$method $route');
    if (route == '/meetings' && method == 'GET') return [];
    if (route == '/capture') {
      levels.add((data as Map)['level'] as double?);
      return {
        'preview': preview,
        'request': requestRecording
            ? {
                'id': id,
                'title': 'Desktop meeting',
                'language': 'en',
                'refined_model_id': 'test',
              }
            : null,
      };
    }
    if (route.endsWith('/snapshot')) {
      return {
        'desktopCapture': true,
        'stopRequested': stopRequested,
        'ended': false,
        'next': 0,
        'samples': 0,
        'controlVersion': controlVersion,
        'desiredState': desiredState,
      };
    }
    return {};
  }
}

class CaptureEngine extends RecordingEngine {
  final fake = FakeRecorder();
  CaptureEngine(RecordingStore store, DesktopConnection connection)
    : super(store, connection, (_) {});
  @override
  AudioRecorder get recorder => fake;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'slow storage interrupts capture with a bounded queue and preserves accepted audio',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'brevia-slow-disk-',
      );
      final store = BlockedStore(directory, {
        'id': 'slow',
        'state': 'starting',
      });
      final engine = Engine(store);
      try {
        await engine.beginCapture();
        for (var i = 0; i < 1000; i++) {
          engine.fake.stream.add(Uint8List(3200));
        }
        await Future<void>.delayed(Duration(milliseconds: 25));
        expect(engine.audioOverloaded, true);
        expect(store.meta['state'], 'interrupted');
        expect(
          engine.queuedAudioBytes,
          lessThanOrEqualTo(RecordingEngine.maximumQueuedAudioBytes),
        );
        expect(store.samples, 0);
        store.release.complete();
        await engine.commands;
        await engine.disk;
        expect(engine.queuedAudioBytes, 0);
        final acceptedBytes = store.samples * 2;
        expect(
          acceptedBytes,
          inInclusiveRange(
            RecordingEngine.maximumQueuedAudioBytes,
            RecordingEngine.maximumQueuedAudioBytes + 32000,
          ),
        );
        await engine.command({'action': 'resume'});
        expect(engine.audioOverloaded, false);
        engine.fake.stream.add(Uint8List(32000));
        await Future<void>.delayed(Duration(milliseconds: 10));
        await engine.disk;
        expect(store.samples * 2, acceptedBytes + 32000);
      } finally {
        if (!store.release.isCompleted) store.release.complete();
        engine.closing = true;
        await engine.fake.stream.close();
        await engine.dispose();
        await engine.connection?.dispose();
        await directory.delete(recursive: true);
      }
    },
  );

  test(
    'snapshot cache retains list search and task data, loads only viewed text and notices changes',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'brevia-snapshots-',
      );
      final model = AppModel();
      final file = File('${directory.path}/snapshot.json');
      final snapshot = {
        'notes': 'searchable notes',
        'task': {'state': 'running'},
        'samples': 100,
        'segments': [
          {'text': 'long transcript'},
        ],
        'summary': {'data': 'long summary'},
      };
      try {
        await writeJson(file, snapshot);
        final index = await model.readSnapshot(directory, 'one');
        expect(index['notes'], 'searchable notes');
        expect(index['task']['state'], 'running');
        expect(index.containsKey('segments'), false);
        expect(index.containsKey('summary'), false);
        expect(
          identical(index, await model.readSnapshot(directory, 'one')),
          true,
        );
        model.viewedMeetingId = 'one';
        final detail = await model.readSnapshot(directory, 'one');
        expect(detail['segments'][0]['text'], 'long transcript');
        expect(
          identical(detail, await model.readSnapshot(directory, 'one')),
          true,
        );
        model.viewedMeetingId = null;
        expect(
          (await model.readSnapshot(directory, 'one')).containsKey('segments'),
          false,
        );
        await writeJson(file, {
          ...snapshot,
          'notes': 'changed notes and length',
        });
        expect(
          (await model.readSnapshot(directory, 'one'))['notes'],
          'changed notes and length',
        );
      } finally {
        model.dispose();
        await directory.delete(recursive: true);
      }
    },
  );
  test('PCM microphone preview uses the desktop meter scale', () {
    expect(pcmLevel(Uint8List(3200)), 0);
    expect(
      pcmLevel(Uint8List.fromList(List.generate(3200, (i) => i.isOdd ? 8 : 0))),
      0.5,
    );
    expect(pcmLevel(Uint8List.fromList([255, 127])), 1);
  });
  test(
    'meter frames update independently without replacing the recording snapshot',
    () {
      final model = AppModel();
      model.receive({'id': 'live', 'state': 'recording', 'samples': 16000});
      final snapshot = model.live;
      var changes = 0;
      model.addListener(() => changes++);
      model.receive({'id': 'live', 'inputLevel': .7});
      expect(model.inputLevel.value, .7);
      expect(model.live, same(snapshot));
      expect(model.live!['samples'], 16000);
      expect(changes, 0);
      model.receive({'id': 'old', 'inputLevel': .1});
      expect(model.inputLevel.value, .7);
      model.receive({'id': 'live', 'state': 'paused', 'samples': 16000});
      expect(model.inputLevel.value, 0);
      expect(changes, 1);
      model.dispose();
    },
  );
  test(
    'short meter buffers still commit one complete ordered recording chunk',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-meter-');
      final store = CountingStore(dir, {'id': 'test', 'state': 'ended'});
      final engine = Engine(store);
      try {
        await engine.beginCapture();
        final initialSaves = store.saves;
        engine.fake.stream.add(Uint8List(1600));
        await Future<void>.delayed(Duration.zero);
        await engine.disk;
        expect(store.saves, initialSaves);
        expect(store.samples, 0);
        for (var i = 0; i < 19; i++) {
          engine.fake.stream.add(Uint8List(1600));
        }
        await Future<void>.delayed(Duration.zero);
        await engine.disk;
        expect(store.count, 1);
        expect(store.samples, 16000);
        expect(store.saves, initialSaves + 1);
        expect(await store.chunk(0).length(), 32000);
      } finally {
        engine.closing = true;
        await engine.fake.stream.close();
        await engine.dispose();
        await dir.delete(recursive: true);
      }
    },
  );
  test(
    'phone preview sends only levels and releases the microphone in background',
    () async {
      final root = await Directory.systemTemp.createTemp('brevia-preview-');
      const channel = MethodChannel('plugins.flutter.io/path_provider');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => root.path);
      final previous = RecordPlatform.instance;
      final platform = LocalRecordPlatform();
      RecordPlatform.instance = platform;
      final connection = CaptureConnection()
        ..preview = true
        ..requestRecording = false;
      final model = AppModel()..desktop = connection;
      try {
        await model.refresh();
        expect(model.desktopMicrophoneSelected, isTrue);
        expect(model.capturePreview, isNotNull);
        expect(model.live, isNull);
        platform.bytes.add(
          Uint8List.fromList(List.generate(3200, (i) => i.isOdd ? 8 : 0)),
        );
        await Future<void>.delayed(Duration.zero);
        await model.refresh();
        expect(connection.levels.last, 0.5);
        expect(await (await recordingsRoot()).list().toList(), isEmpty);
        model.didChangeAppLifecycleState(AppLifecycleState.paused);
        await model.previewChanges;
        expect(model.desktopMicrophoneSelected, isFalse);
        expect(model.capturePreview, isNull);
        expect(model.previewLevel, isNull);
        model.foreground = true;
        await model.setCapturePreview(true);
        connection.preview = false;
        connection.requestRecording = true;
        await model.refresh();
        expect(model.capturePreview, isNull);
        expect(model.engine?.store.meta['id'], connection.id);
      } finally {
        await model.releaseEngines();
        await platform.bytes.close();
        model.dispose();
        RecordPlatform.instance = previous;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'desktop capture adopts its meeting without preparing a phone meeting',
    () async {
      final root = await Directory.systemTemp.createTemp('brevia-capture-');
      const channel = MethodChannel('plugins.flutter.io/path_provider');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => root.path);
      final previous = RecordPlatform.instance;
      final platform = LocalRecordPlatform();
      RecordPlatform.instance = platform;
      final connection = CaptureConnection();
      final model = AppModel()..desktop = connection;
      try {
        await model.refresh();
        expect(model.live?['id'], connection.id);
        expect(model.live?['desktopCapture'], true);
        expect(model.engine?.store.meta['refined_model_id'], 'test');
        expect(connection.requests, contains('POST /capture'));
        expect(connection.requests, isNot(contains('POST /prepare')));
        await model.engine?.syncDone?.future;
        final recording = model.engine!;
        model.didChangeAppLifecycleState(AppLifecycleState.paused);
        platform.bytes.add(
          Uint8List.fromList(List.generate(32000, (i) => i.isOdd ? 8 : 0)),
        );
        await Future<void>.delayed(Duration.zero);
        await recording.disk;
        expect(model.engine, same(recording));
        expect(recording.store.meta['state'], 'recording');
        expect(recording.store.samples, 16000);
        expect(recording.view['inputLevel'], .5);
        expect(recording.store.meta.containsKey('inputLevel'), isFalse);
        recording.store.meta['state'] = 'paused';
        expect(recording.view['inputLevel'], 0);
      } finally {
        await platform.bytes.close();
        await model.releaseEngines();
        model.dispose();
        RecordPlatform.instance = previous;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'desktop pause is applied once and stop takes priority over resume',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'brevia-capture-controls-',
      );
      final connection = CaptureConnection();
      final store = RecordingStore(root, {
        'id': connection.id,
        'state': 'recording',
        'desktopCapture': true,
      });
      final engine = CaptureEngine(store, connection);
      try {
        connection.controlVersion = 1;
        connection.desiredState = 'paused';
        await engine.sync();
        expect(store.meta['state'], 'paused');
        expect(store.meta['controlVersion'], 1);
        store.meta['state'] = 'recording';
        await engine.sync();
        expect(store.meta['state'], 'recording');
        connection.controlVersion = 2;
        connection.desiredState = 'recording';
        connection.stopRequested = true;
        await engine.sync();
        expect(engine.fake.stopped, true);
        expect(store.meta['state'], 'ended');
        expect(engine.fake.starts, 0);
      } finally {
        await engine.dispose();
        await connection.dispose();
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'missing committed chunks are rejected without changing audio',
    () async {
      for (final missing in [0, 1, 2]) {
        final dir = await Directory.systemTemp.createTemp('brevia-corrupt-');
        try {
          final store = RecordingStore(dir, {
            'id': 'test',
            'state': 'recording',
          });
          for (var i = 0; i < 3; i++) {
            await store.append(Uint8List.fromList([i + 1, 0]));
          }
          await store.save();
          await store.chunk(missing).delete();
          final metadata = await File(
            '${dir.path}/session.json',
          ).readAsString();
          await expectLater(RecordingStore.load(dir), throwsFormatException);
          expect(
            await File('${dir.path}/session.json').readAsString(),
            metadata,
          );
          for (var i = 0; i < 3; i++) {
            if (i != missing) {
              expect(await store.chunk(i).readAsBytes(), [i + 1, 0]);
            }
          }
          if (missing == 1) {
            // 元数据滞后也不能把缺口后的有效分片当成可覆盖空间。
            await writeJson(File('${dir.path}/session.json'), {'count': 0});
            await expectLater(RecordingStore.load(dir), throwsFormatException);
            final empty = RecordingStore(dir, {});
            await expectLater(
              empty.append(Uint8List(2)),
              throwsFormatException,
            );
            expect(await store.chunk(0).readAsBytes(), [1, 0]);
          }
        } finally {
          await dir.delete(recursive: true);
        }
      }
    },
  );
  test(
    'local startup and recording do not wait for an offline desktop',
    () async {
      final root = await Directory.systemTemp.createTemp('brevia-startup-');
      const channel = MethodChannel('plugins.flutter.io/path_provider');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => root.path);
      final previous = RecordPlatform.instance;
      final platform = LocalRecordPlatform();
      RecordPlatform.instance = platform;
      final connection = OfflineConnection();
      final model = AppModel()..desktop = connection;
      Future<void>? refresh;
      try {
        final store =
            RecordingStore(Directory('${root.path}/recordings/saved'), {
              'id': 'saved',
              'title': 'Saved',
              'created': '2026-10-09',
              'state': 'ended',
              'localOnly': true,
            });
        await store.directory.create(recursive: true);
        await writeJson(
          File('${store.directory.path}/session.json'),
          store.meta,
        );
        await model.refresh(localOnly: true);
        expect(model.meetings.single['id'], 'saved');
        expect(connection.calls, 0);
        refresh = model.refresh();
        await connection.requested.future;
        expect(model.refreshing, false);
        final id = await model
            .start('Offline', offline: true)
            .timeout(Duration(seconds: 2));
        expect(model.engine!.connection, isNull);
        expect(connection.response.isCompleted, false);
        await model.command(id, 'end');
        connection.response.completeError(SocketException('offline'));
        await refresh;
        expect(model.desktopOnline, false);
        expect(connection.calls, 1);
      } finally {
        if (!connection.response.isCompleted) {
          connection.response.completeError(SocketException('offline'));
        }
        await refresh;
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
    'reconnect wakes a pending sender without waiting for backoff',
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
      await connection.reconnect();
      await Future<void>.delayed(Duration.zero);
      expect(sender.syncs, 1);
      expect(sender.retryAt.isBefore(DateTime.now()), isTrue);
      await sender.dispose();
      await connection.reconnect();
      await Future<void>.delayed(Duration.zero);
      expect(sender.syncs, 1);
      await connection.dispose();
      await connection.reconnect();
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
        expect(
          connection.calls.where(
            (v) => v.startsWith('POST') && v != 'POST /capture',
          ),
          isEmpty,
        );
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
    'lost chunk and end acknowledgements survive reload without duplicating audio',
    () async {
      final dir = await Directory.systemTemp.createTemp('brevia-lost-ack-');
      final store = RecordingStore(dir, {'id': 'test', 'state': 'ended'});
      await store.append(Uint8List.fromList([1, 0]));
      await store.append(Uint8List.fromList([2, 0]));
      await store.save();
      final connection = SyncConnection()
        ..loseChunkAck = true
        ..loseEndAck = true;
      var engine = RecordingEngine(store, connection, (_) {});
      try {
        await engine.sync();
        expect(engine.connected, false);
        expect(connection.next, 1);
        expect(store.meta['finished'], isNot(true));
        await engine.dispose();
        final recovered = await RecordingStore.load(dir);
        engine = RecordingEngine(recovered, connection, (_) {});
        await engine.sync();
        expect(engine.connected, false);
        expect(connection.next, 2);
        expect(recovered.meta['finished'], isNot(true));
        engine.retryAt = DateTime.fromMillisecondsSinceEpoch(0);
        await engine.sync();
        expect(recovered.meta['finished'], true);
        expect(connection.samples, 2);
        expect(
          connection.calls.where((value) => value.endsWith('/chunks')),
          hasLength(2),
        );
        expect(
          connection.calls.where((value) => value.endsWith('/end')),
          hasLength(1),
        );
        final uploaded = connection.calls.indexed
            .where((entry) => entry.$2.endsWith('/chunks'))
            .map((entry) => connection.payloads[entry.$1] as Map)
            .toList();
        expect(uploaded.map((chunk) => chunk['start_sample']), [0, 1]);
        expect(uploaded.map((chunk) => base64Decode(chunk['pcm'])), [
          [1, 0],
          [2, 0],
        ]);
        expect(await recovered.chunk(0).readAsBytes(), [1, 0]);
        expect(await recovered.chunk(1).readAsBytes(), [2, 0]);
        expect((await RecordingStore.metadata(dir))['uploaded'], 2);
      } finally {
        await engine.dispose();
        await connection.dispose();
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
  bool loseChunkAck = false, loseEndAck = false;
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
      if (loseChunkAck) {
        loseChunkAck = false;
        throw SocketException('chunk acknowledgement lost');
      }
      return {'next': next, 'samples': samples};
    }
    if (route.endsWith('/end') && loseEndAck) {
      loseEndAck = false;
      throw SocketException('end acknowledgement lost');
    }
    return {};
  }
}

class LocalRecordPlatform extends RecordPlatform {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  final bytes = StreamController<Uint8List>.broadcast();
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
