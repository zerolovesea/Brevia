import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'connection.dart';
import 'i18n.dart';
import 'storage.dart';

Future<Directory> recordingsRoot() async {
  final support = await getApplicationSupportDirectory();
  return Directory('${support.path}/recordings').create(recursive: true);
}

class RecordingEngine {
  final RecordingStore store;
  final DesktopConnection? connection;
  final void Function(Map<String, dynamic>) onChanged;
  AudioRecorder? _recorder;
  AudioRecorder get recorder => _recorder ??= AudioRecorder();
  Completer<void>? audioDone;
  Completer<void>? syncDone;
  Future<void> commands = Future.value();
  StreamSubscription<Uint8List>? audio;
  StreamSubscription<RecordState>? states;
  Timer? timer;
  StreamSubscription<bool>? connectionEvents;
  Future<void> disk = Future.value();
  List<int> pending = [];
  Map<String, dynamic> snapshot = {};
  bool syncing = false, closing = false, disposed = false, connected = false;
  bool registered = false;
  String? sentState;
  String? error;
  int failures = 0;
  DateTime retryAt = DateTime.fromMillisecondsSinceEpoch(0);
  RecordingEngine(this.store, this.connection, this.onChanged) {
    connectionEvents = connection?.available.stream.listen((online) {
      if (!online) {
        connected = false;
        publish();
        return;
      }
      retryAt = DateTime.fromMillisecondsSinceEpoch(0);
      unawaited(sync());
    });
  }
  Future<void> write(Future<void> Function() fn) {
    final next = disk.then((_) => fn());
    disk = next.catchError((Object e) {
      error = tr("本地保存失败：{0}", [e]);
    });
    return next;
  }

  Map<String, dynamic> get view => {
    ...store.meta,
    'snapshot': snapshot,
    'connected': connected,
    'error': error,
    'samples': store.samples,
    'count': store.count,
  };
  DateTime activityUpdated = DateTime.fromMillisecondsSinceEpoch(0);
  String? activityStatus;
  bool? activityConnected;
  Future<void> activity(String method) async {
    if (!Platform.isIOS) return;
    try {
      await MethodChannel('brevia/recording-activity').invokeMethod(method, {
        'id': store.meta['id'],
        'status': store.meta['state'],
        'seconds': store.samples ~/ 16000,
        'connected': connected,
        'uploadedSeconds': (snapshot['samples'] as num? ?? 0) ~/ 16000,
        'statusLabel': tr(
          store.meta['state'] == 'recording'
              ? '录音中'
              : store.meta['state'] == 'paused'
              ? '录音已暂停'
              : '录音已中断',
        ),
        'connectionLabel': tr(
          connection == null
              ? '仅保存在手机'
              : connected
              ? '已连接'
              : '等待电脑连接 · 录音保留在手机',
        ),
        'uploadedLabel': tr('已传到电脑 {0}', [
          durationText(snapshot['samples'] ?? 0),
        ]),
        'staleLabel': tr('状态待确认'),
        'staleHint': tr('请打开应用确认录音状态'),
        'returnHint': tr('点击返回会议'),
      });
    } on MissingPluginException {
      // iOS versions before ActivityKit remain supported.
      return;
    } on PlatformException catch (e) {
      debugPrint('Recording activity unavailable: ${e.code}');
    }
  }

  void publish() {
    if (disposed) return;
    onChanged(view);
    if (Platform.isIOS &&
        (activityStatus != store.meta['state'] ||
            activityConnected != connected ||
            DateTime.now().difference(activityUpdated).inSeconds >= 5)) {
      activityUpdated = DateTime.now();
      activityStatus = store.meta['state'];
      activityConnected = connected;
      unawaited(activity('update'));
    }
  }

  Future<void> initialize({bool capture = true}) async {
    final cached = File('${store.directory.path}/snapshot.json');
    if (await cached.exists()) {
      snapshot = jsonDecode(await cached.readAsString());
    }
    if (capture) {
      states = recorder.onStateChanged().listen((state) {
        if (!closing &&
            state == RecordState.pause &&
            store.meta['state'] == 'recording') {
          reportInterruption(tr("录音被系统中断，请回到应用继续"));
        }
        if (!closing &&
            state == RecordState.stop &&
            store.meta['state'] == 'recording') {
          reportInterruption(tr("麦克风已停止，请检查录音权限"));
        }
      });
    }
    timer = Timer.periodic(Duration(seconds: 1), (_) {
      publish();
      unawaited(sync());
    });
    if (capture) {
      await beginCapture();
      await activity('start');
    }
    publish();
    unawaited(sync());
  }

  void reportInterruption(String reason) {
    unawaited(
      command({
        'action': 'interrupt',
        'reason': reason,
      }).catchError((Object _) {}),
    );
  }

  Future<void> beginCapture() async {
    store.meta['state'] = 'starting';
    await write(store.save);
    publish();
    try {
      final stream = await recorder.startStream(
        RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: 16000,
          numChannels: 1,
          streamBufferSize: 32000,
          audioInterruption: AudioInterruptionMode.pause,
          androidConfig: AndroidRecordConfig(manageBluetooth: false),
        ),
      );
      store.meta['state'] = 'recording';
      error = null;
      await write(store.save);
      final done = Completer<void>();
      audioDone = done;
      audio = stream.listen(
        (bytes) {
          // One ordered disk queue; transport never owns the microphone stream.
          unawaited(
            write(() async {
              pending.addAll(bytes);
              while (pending.length >= 32000) {
                await store.append(
                  Uint8List.fromList(pending.sublist(0, 32000)),
                );
                pending = pending.sublist(32000);
              }
              await store.save();
              publish();
            }).catchError((Object e) {
              reportInterruption(tr("手机无法保存录音，请释放空间：{0}", [e]));
            }),
          );
        },
        onDone: () {
          if (!done.isCompleted) done.complete();
          if (!closing && store.meta['state'] == 'recording') {
            reportInterruption(tr("麦克风已停止，请检查录音权限"));
          }
        },
        onError: (Object e) {
          reportInterruption(tr("麦克风中断：{0}", [e]));
        },
      );
    } catch (e) {
      await interrupted(tr("无法开始录音：{0}", [e]));
      rethrow;
    }
  }

  Future<void> flush() => write(() async {
    if (pending.isNotEmpty) {
      // PCM16 buffers must end on a whole sample.
      if (pending.length.isOdd) throw FormatException(tr("麦克风返回了不完整的音频样本"));
      while (pending.isNotEmpty) {
        final length = pending.length.clamp(0, 32000);
        await store.append(Uint8List.fromList(pending.sublist(0, length)));
        pending = pending.sublist(length);
      }
      await store.save();
    }
  });
  Future<void> interrupted(String reason) async {
    error = reason;
    closing = true;
    try {
      await recorder.pause();
      await disk;
      await flush();
    } catch (_) {
      /* Preserve disk and in-memory tail on write failure. */
    }
    store.meta['state'] = 'interrupted';
    store.meta['interruptedAt'] = DateTime.now().toIso8601String();
    try {
      await write(store.save);
    } catch (_) {}
    closing = false;
    publish();
  }

  Future<void> command(Map<String, dynamic> value) {
    final next = commands.then((_) => applyCommand(value));
    // 对调用方保留失败，同时让下一次重试仍能进入控制队列。
    commands = next.catchError((Object _) {});
    return next;
  }

  Future<void> applyCommand(Map<String, dynamic> value) async {
    try {
      switch (value['action']) {
        case 'interrupt':
          if (store.meta['state'] == 'ended') return;
          await interrupted(value['reason']);
        case 'ui-language':
          uiLanguage = value['language'];
          activityStatus = null;
        case 'reconnect':
          retryAt = DateTime.fromMillisecondsSinceEpoch(0);
          await connection?.reconnect();
          break;
        case 'address':
          DesktopConnection.endpoint(value['address']);
          connection?.address = value['address'];
          retryAt = DateTime.fromMillisecondsSinceEpoch(0);
        case 'pause':
          closing = true;
          await recorder.pause();
          await disk;
          await flush();
          store.meta['state'] = 'paused';
          await write(store.save);
          closing = false;
        case 'resume':
          if (store.meta['state'] == 'ended') return;
          closing = true;
          await disk;
          await flush();
          if (await recorder.isPaused()) {
            await recorder.resume();
          } else if (!await recorder.isRecording()) {
            await audio?.cancel();
            audio = null;
            await beginCapture();
          }
          if (!await recorder.isRecording() || await recorder.isPaused()) {
            throw StateError(tr("麦克风不可用，请重新打开录音"));
          }
          store.meta['state'] = 'recording';
          error = null;
          await write(store.save);
          closing = false;
        case 'end':
          closing = true;
          await recorder.stop();
          await audioDone?.future.timeout(Duration(seconds: 5));
          await audio?.cancel();
          await disk;
          await flush();
          store.meta['state'] = 'ended';
          await write(store.save);
          if (connection == null) timer?.cancel();
          closing = false;
        case 'mark':
          final marks = List<dynamic>.from(store.meta['marks'] ?? []);
          marks.add({
            'id': Uuid().v4(),
            'sample': value['sample'] ?? store.samples,
            'note': (value['note'] ?? '').toString(),
          });
          store.meta['marks'] = marks;
          await write(store.save);
        case 'retry':
          retryAt = DateTime.fromMillisecondsSinceEpoch(0);
      }
      publish();
      unawaited(sync());
    } catch (e) {
      if (['pause', 'resume', 'end'].contains(value['action'])) {
        await interrupted(e.toString());
      }
      closing = false;
      error = e.toString();
      publish();
      rethrow;
    }
  }

  Future<void> sync() async {
    if (syncing ||
        disposed ||
        connection == null ||
        store.meta['remoteDeleted'] == true ||
        DateTime.now().isBefore(retryAt)) {
      return;
    }
    syncing = true;
    syncDone = Completer<void>();
    try {
      final id = store.meta['id'];
      if (!registered) {
        await connection!.call('POST', '/meetings', {
          'id': id,
          'title': store.meta['title'],
          for (final key in [
            'language',
            'num_speakers',
            'target_language',
            'workspace_id',
            'refined_model_id',
            'speaker_segmentation_model_id',
            'vad_model_id',
          ])
            if (store.meta[key] != null) key: store.meta[key],
        });
        registered = true;
      }
      final state = store.meta['state'] as String;
      if (sentState != state) {
        await connection!.call('POST', '/meetings/$id/state', {'state': state});
        sentState = state;
      }
      snapshot = Map<String, dynamic>.from(
        await connection!.call('GET', '/meetings/$id/snapshot'),
      );
      if (snapshot['stopRequested'] == true && store.meta['state'] != 'ended') {
        await command({'action': 'end'});
      }
      int next = snapshot['next'];
      if (next > store.count || (snapshot['samples'] as int) > store.samples) {
        throw StateError(tr("手机与电脑的录音清单不一致，请保留本地文件"));
      }
      // Small bounded batch allows controls and snapshots to stay responsive.
      for (var sent = 0; next < store.count && sent < 8; sent++) {
        final data = await store.chunk(next).readAsBytes();
        final ack = await connection!.call('PUT', '/meetings/$id/chunks', {
          'seq': next,
          'start_sample': store.offsets[next],
          'pcm': base64Encode(data),
        });
        next = ack['next'];
        snapshot['next'] = next;
        snapshot['samples'] = ack['samples'];
        snapshot['ended'] = false;
        snapshot['finished'] = false;
      }
      final marks = List<dynamic>.from(store.meta['marks'] ?? []);
      for (final mark in marks.where((m) => m['synced'] != true)) {
        await connection!.call('POST', '/meetings/$id/marks', {
          'id': mark['id'],
          'sample': mark['sample'],
          'note': mark['note'],
        });
        mark['synced'] = true;
      }
      if (store.meta['state'] == 'ended' &&
          next == store.count &&
          snapshot['ended'] != true) {
        await connection!.call('POST', '/meetings/$id/end', {
          'count': store.count,
          'samples': store.samples,
        });
        snapshot['ended'] = true;
      }
      await write(() async {
        store.meta['uploaded'] = next;
        store.meta['finished'] =
            store.meta['state'] == 'ended' &&
            next == store.count &&
            snapshot['ended'] == true &&
            snapshot['finished'] == true;
        await store.save();
        await writeJson(
          File('${store.directory.path}/snapshot.json'),
          snapshot,
        );
      });
      connected = true;
      failures = 0;
      if (store.meta['finished'] == true) timer?.cancel();
      if (store.meta['state'] != 'interrupted') {
        error = snapshot['error'] == null
            ? null
            : remoteError(snapshot['error'].toString());
      }
    } on MeetingDeletedException catch (e) {
      // 电脑已明确删除：停止重传但保留本机音频，交由用户导出或删除。
      connected = true;
      error = e.toString();
      try {
        if (store.meta['state'] != 'ended') await command({'action': 'end'});
        store.meta['remoteDeleted'] = true;
        await write(store.save);
        timer?.cancel();
      } catch (localError) {
        error = localError.toString();
      }
    } catch (e) {
      connected = false;
      failures++;
      final delay = (1 << failures.clamp(0, 4)).clamp(1, 15);
      retryAt = DateTime.now().add(Duration(seconds: delay));
      if (store.meta['state'] != 'interrupted') {
        error = e is SocketException || e is TimeoutException
            ? null
            : tr("电脑连接中断，已有录音保留在手机。{0}", [e]);
      }
    } finally {
      syncing = false;
      syncDone?.complete();
      publish();
    }
  }

  Future<void> dispose() async {
    if (disposed) return;
    timer?.cancel();
    await connectionEvents?.cancel();
    disposed = true;
    try {
      await commands;
      await syncDone?.future;
      closing = true;
      if (_recorder != null) await recorder.stop();
      await audioDone?.future.timeout(Duration(seconds: 5));
      await audio?.cancel();
      await disk;
      await flush();
    } finally {
      await audio?.cancel();
      await states?.cancel();
      await _recorder?.dispose();
      await activity('end');
    }
  }
}

@pragma('vm:entry-point')
void recordingTask() => FlutterForegroundTask.setTaskHandler(RecordingTask());

class RecordingTask extends TaskHandler {
  RecordingEngine? engine;
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    // Never restart a microphone because Android restarted a process.
    if (starter != TaskStarter.developer) {
      await FlutterForegroundTask.stopService();
      return;
    }
    try {
      uiLanguage =
          (await SharedPreferences.getInstance()).getString('uiLanguage') ??
          'system';
      final id = await FlutterForegroundTask.getData<String>(key: 'sessionId');
      final root = await recordingsRoot();
      final store = await RecordingStore.load(Directory('${root.path}/$id'));
      final connection = store.meta['localOnly'] == true
          ? null
          : await DesktopConnection.load();
      if (store.meta['localOnly'] != true &&
          (connection == null ||
              connection.fingerprint != store.meta['computer'])) {
        throw StateError(tr("请连接原电脑"));
      }
      engine = RecordingEngine(store, connection, (value) {
        FlutterForegroundTask.sendDataToMain(value);
      });
      await engine!.initialize();
    } catch (e) {
      FlutterForegroundTask.sendDataToMain({'fatal': e.toString()});
      await FlutterForegroundTask.stopService();
    }
  }

  @override
  void onRepeatEvent(DateTime timestamp) {
    final e = engine;
    if (e == null) return;
    FlutterForegroundTask.updateService(
      notificationTitle:
          'Brevia · ${e.store.meta['state'] == 'recording'
              ? tr("录音中")
              : e.store.meta['state'] == 'paused'
              ? tr("录音已暂停")
              : tr("录音已中断")}',
      notificationText:
          '${durationText(e.store.samples)} · ${e.connection == null
              ? tr("仅保存在手机")
              : e.connected
              ? tr("已传到电脑 {0}", [durationText(e.snapshot['samples'] ?? 0)])
              : tr("等待电脑连接 · 录音保留在手机")}',
      notificationButtons: [
        if (e.store.meta['state'] == 'recording')
          NotificationButton(id: 'pause', text: tr("暂停")),
        NotificationButton(id: 'return', text: tr("返回会议")),
      ],
    );
    if (e.store.meta['state'] == 'ended') {
      unawaited(FlutterForegroundTask.stopService());
    }
  }

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {
    await engine?.dispose();
    await engine?.connection?.dispose();
  }

  @override
  void onReceiveData(Object data) {
    if (data is Map) {
      final value = Map<String, dynamic>.from(data);
      unawaited(() async {
        try {
          if (engine == null) throw StateError(tr("麦克风不可用，请重新打开录音"));
          await engine!.command(value);
          FlutterForegroundTask.sendDataToMain({
            'commandId': value['commandId'],
          });
        } catch (e) {
          FlutterForegroundTask.sendDataToMain({
            'commandId': value['commandId'],
            'commandError': e.toString(),
          });
        }
      }());
    }
  }

  @override
  void onNotificationButtonPressed(String id) {
    if (id == 'pause') {
      unawaited(
        engine
            ?.command({'action': 'pause'})
            .then((_) => onRepeatEvent(DateTime.now()))
            .catchError((Object _) {}),
      );
    } else if (id == 'return') {
      FlutterForegroundTask.launchApp();
    }
  }

  @override
  void onNotificationPressed() {
    FlutterForegroundTask.launchApp();
  }
}
