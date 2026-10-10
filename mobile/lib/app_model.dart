import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:nsd/nsd.dart' as nsd;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'connection.dart';
import 'i18n.dart';
import 'recorder.dart';
import 'storage.dart';

class AppModel extends ChangeNotifier with WidgetsBindingObserver {
  DesktopConnection? desktop;
  List<Map<String, dynamic>> meetings = [];
  Map<String, dynamic>? live;
  RecordingEngine? engine;
  Timer? timer;
  bool disposed = false;
  String? viewedMeetingId;
  final Map<String, RecordingEngine> senders = {};
  final Map<String, Completer<void>> pendingCommands = {};

  @override
  void notifyListeners() {
    if (!disposed) super.notifyListeners();
  }

  Future<void> sendCommand(Map<String, dynamic> value) async {
    final id = Uuid().v4();
    final done = Completer<void>();
    pendingCommands[id] = done;
    try {
      FlutterForegroundTask.sendDataToTask({...value, 'commandId': id});
      await done.future.timeout(
        Duration(seconds: 30),
        onTimeout: () {
          throw StateError(tr("录音操作尚未确认，请检查录音状态后重试"));
        },
      );
    } finally {
      pendingCommands.remove(id);
    }
  }

  Future<void> releaseEngines() async {
    final current = engine;
    if (current != null) {
      await current.dispose();
      engine = null;
    }
    for (final sender in senders.values) {
      await sender.dispose();
    }
    senders.clear();
    live = null;
  }

  bool serviceRunning = false, refreshing = false, busy = false;
  bool foreground = true, checkingDesktop = false;
  String? error;
  String appearance = 'system';
  bool desktopOnline = false;
  bool get connected =>
      desktop != null &&
      (live != null ? live!['connected'] == true : desktopOnline);
  nsd.Discovery? discovery;
  Timer? discoveryTimer;
  final Map<String, String> nearby = {};
  final Set<String> greeted = {};
  String? discoveryError;
  bool discovering = false;
  Future<void> discover() async {
    if (discovering || discovery != null || desktop != null) return;
    discovering = true;
    discoveryError = null;
    try {
      discovery = await nsd.startDiscovery(
        '_brevia._tcp',
        ipLookupType: nsd.IpLookupType.v4,
      );
      if (disposed || desktop != null) {
        await stopDiscovery();
        return;
      }
      void found() {
        for (final service in discovery?.services ?? <nsd.Service>[]) {
          for (final ip in service.addresses ?? <InternetAddress>[]) {
            final address = 'https://${ip.address}:${service.port}';
            try {
              DesktopConnection.endpoint(address);
            } catch (_) {
              continue;
            }
            nearby[address] = service.name ?? tr("Brevia 电脑");
            if (greeted.add(address)) {
              unawaited(
                DesktopConnection(
                  address: address,
                  fingerprint: '',
                ).call('GET', '/identity').catchError((Object _) => null),
              );
            }
          }
        }
        notifyListeners();
      }

      discovery!.addListener(found);
      found();
      discoveryTimer = Timer(
        Duration(seconds: 30),
        () => unawaited(stopDiscovery()),
      );
    } catch (_) {
      discoveryError = tr("未能自动发现电脑，请允许局域网访问，或扫码连接。");
    } finally {
      discovering = false;
      notifyListeners();
    }
  }

  Future<void> stopDiscovery() async {
    discoveryTimer?.cancel();
    final current = discovery;
    discovery = null;
    if (current != null) {
      try {
        await nsd.stopDiscovery(current);
      } catch (_) {}
    }
  }

  Future<void> initialize() async {
    WidgetsBinding.instance.addObserver(this);
    desktop = await DesktopConnection.load();
    uiLanguage =
        (await SharedPreferences.getInstance()).getString('uiLanguage') ??
        'system';
    appearance =
        (await SharedPreferences.getInstance()).getString('appearance') ??
        'system';
    FlutterForegroundTask.initCommunicationPort();
    FlutterForegroundTask.addTaskDataCallback(receive);
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'brevia_recording',
        channelName: tr("会议录音"),
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: IOSNotificationOptions(
        showNotification: false,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.repeat(5000),
        autoRunOnBoot: false,
        autoRunOnMyPackageReplaced: false,
        allowWakeLock: true,
        allowWifiLock: true,
      ),
    );
    await refresh(localOnly: true);
    if (disposed) return;
    unawaited(refresh());
    if (desktop == null) unawaited(discover());
    timer = Timer.periodic(Duration(seconds: 2), (_) {
      if (foreground) {
        if (serviceRunning) {
          unawaited(
            sendCommand({'action': 'reconnect'}).catchError((Object _) {}),
          );
        } else {
          unawaited(desktop?.reconnect() ?? Future.value());
        }
        for (final sender in senders.values) {
          sender.retryAt = DateTime.fromMillisecondsSinceEpoch(0);
        }
        unawaited(refresh());
      }
    });
  }

  void receive(Object data) {
    if (data is! Map) return;
    final value = Map<String, dynamic>.from(data);
    if (value.containsKey('commandId')) {
      final done = pendingCommands[value['commandId']];
      if (done != null && !done.isCompleted) {
        if (value['commandError'] != null) {
          done.completeError(StateError(value['commandError']));
        } else {
          done.complete();
        }
      }
      return;
    }
    if (value['fatal'] != null) {
      error = value['fatal'];
      live = null;
    } else {
      live = value;
    }
    notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    if (foreground) unawaited(refresh());
  }

  Future<void> refresh({bool localOnly = false}) async {
    if (refreshing || checkingDesktop || busy || disposed) return;
    // 连通性探测不持有本地录音锁；离线启动和开始录音不等待网络超时。
    if (!localOnly && desktop != null && !serviceRunning && engine == null) {
      final connection = desktop!;
      checkingDesktop = true;
      try {
        await connection.call('GET', '/meetings');
        if (desktop == connection) desktopOnline = true;
      } catch (_) {
        if (desktop == connection) desktopOnline = false;
      } finally {
        checkingDesktop = false;
      }
      if (disposed || busy || desktop != connection) return;
    }
    refreshing = true;
    try {
      serviceRunning =
          Platform.isAndroid && await FlutterForegroundTask.isRunningService;
      if (engine?.store.meta['finished'] == true ||
          engine?.store.meta['remoteDeleted'] == true ||
          (engine?.store.meta['localOnly'] == true &&
              engine?.store.meta['state'] == 'ended')) {
        await engine!.dispose();
        engine = null;
        live = null;
      }
      final root = await recordingsRoot();
      final records = <Map<String, dynamic>>[];
      for (final dir in await root.list().toList()) {
        if (dir is! Directory ||
            !await File('${dir.path}/session.json').exists()) {
          continue;
        }
        final meta = await RecordingStore.metadata(dir);
        final cached = File('${dir.path}/snapshot.json');
        records.add({
          ...meta,
          'snapshot': await cached.exists()
              ? jsonDecode(await cached.readAsString())
              : <String, dynamic>{},
        });
      }
      records.sort(
        (a, b) => (b['created'] as String).compareTo(a['created'] as String),
      );
      if (disposed) return;
      if (!localOnly && desktopOnline && desktop != null && !serviceRunning) {
        for (final record in records.where(
          (m) =>
              m['computer'] == desktop!.fingerprint &&
              m['remoteDeleted'] != true &&
              (m['snapshot']?['task']?['state'] == 'running' ||
                  (m['id'] == viewedMeetingId && m['finished'] == true)) &&
              m['id'] != engine?.store.meta['id'],
        )) {
          try {
            final snapshot = await desktop!.call(
              'GET',
              '/meetings/${record['id']}/snapshot',
            );
            record['snapshot'] = snapshot;
            await writeJson(
              File('${root.path}/${record['id']}/snapshot.json'),
              snapshot,
            );
          } on MeetingDeletedException {
            record['remoteDeleted'] = true;
            await writeJson(
              File('${root.path}/${record['id']}/session.json'),
              {...record}..remove('snapshot'),
            );
          } catch (_) {
            /* Keep cached task status until the original computer reconnects. */
          }
        }
      }
      meetings = records;
      if (!serviceRunning && engine == null) live = null;
      // 仅为待补传会议保留发送器，复用恢复清单与重试退避；不遍历历史 PCM。
      if (!localOnly && desktopOnline && !serviceRunning && desktop != null) {
        final pending = meetings
            .where(
              (m) =>
                  m['state'] == 'ended' &&
                  m['finished'] != true &&
                  m['remoteDeleted'] != true &&
                  m['computer'] == desktop!.fingerprint &&
                  m['id'] != engine?.store.meta['id'],
            )
            .toList()
            .reversed;
        for (final record in pending) {
          if (disposed) return;
          final id = record['id'] as String;
          var sender = senders[id];
          if (sender == null) {
            final store = await RecordingStore.load(
              Directory('${root.path}/$id'),
            );
            sender = RecordingEngine(store, desktop!, (_) {});
            senders[id] = sender;
          }
          await sender.sync();
          record.addAll(sender.view);
          desktopOnline = sender.connected;
          if (record['finished'] == true || record['remoteDeleted'] == true) {
            await sender.dispose();
            senders.remove(id);
          }
          if (!sender.connected) break;
        }
      }
    } catch (e) {
      error = e.toString();
    } finally {
      refreshing = false;
      notifyListeners();
    }
  }

  Map<String, dynamic>? meeting(String id) {
    if (live?['id'] == id) return live;
    for (final value in meetings) {
      if (value['id'] == id) return value;
    }
    return null;
  }

  @override
  void didChangeLocales(List<Locale>? locales) {
    if (uiLanguage == 'system') updateRecordingLanguage();
    notifyListeners();
  }

  void updateRecordingLanguage() {
    if (serviceRunning) {
      unawaited(
        sendCommand({
          'action': 'ui-language',
          'language': languageCode,
        }).catchError((Object e) {
          error = e.toString();
          notifyListeners();
        }),
      );
    }
  }

  Future<void> setLanguage(String value) async {
    uiLanguage = value;
    await (await SharedPreferences.getInstance()).setString(
      'uiLanguage',
      value,
    );
    updateRecordingLanguage();
    notifyListeners();
  }

  Future<void> setAppearance(String value) async {
    appearance = value;
    await (await SharedPreferences.getInstance()).setString(
      'appearance',
      value,
    );
    notifyListeners();
  }

  Future<String> start(
    String title, {
    String? existing,
    bool offline = false,
    Map<String, dynamic> settings = const {},
  }) async {
    if (busy ||
        serviceRunning ||
        (engine != null && engine!.store.meta['state'] != 'ended')) {
      throw StateError(tr("已有正在进行的录音"));
    }
    if (meetings.any((m) => m['state'] != 'ended' && m['id'] != existing)) {
      throw StateError(tr("请先处理未完成的录音"));
    }
    busy = true;
    notifyListeners();
    try {
      while (refreshing) {
        await Future<void>.delayed(Duration(milliseconds: 50));
      }
      final permissionRecorder = AudioRecorder();
      final allowed = await permissionRecorder.hasPermission();
      await permissionRecorder.dispose();
      if (!allowed) throw StateError(tr("需要麦克风权限，请前往系统设置"));
      if (Platform.isAndroid) {
        await FlutterForegroundTask.requestNotificationPermission();
      }
      await engine?.dispose();
      engine = null;
      final root = await recordingsRoot();
      final id = existing ?? Uuid().v4();
      final directory = await Directory(
        '${root.path}/$id',
      ).create(recursive: true);
      RecordingStore store;
      if (existing != null) {
        store = await RecordingStore.load(directory);
        offline = store.meta['localOnly'] == true;
        if (!offline &&
            (desktop == null ||
                store.meta['computer'] != desktop!.fingerprint)) {
          throw StateError(tr("请连接这场会议原来的电脑"));
        }
        if (store.meta['state'] == 'ended') throw StateError(tr("这场录音已经结束"));
      } else {
        if (!offline && desktop == null) throw StateError(tr("请先连接电脑"));
        store = RecordingStore(directory, {
          'id': id,
          'title': title.trim().isEmpty ? defaultMeetingTitle() : title.trim(),
          'created': DateTime.now().toIso8601String(),
          'computer': offline ? null : desktop!.fingerprint,
          'localOnly': offline,
          'state': 'starting',
          ...settings,
          'language': settings['language'] ?? 'zh',
          'marks': [],
          'uploaded': 0,
        });
        final request = <String, dynamic>{
          'id': id,
          'title': store.meta['title'],
          ...settings,
          'language': settings['language'] ?? 'zh',
        };
        if (!offline) await desktop!.call('POST', '/prepare', request);
        await store.save();
        if (!offline) await desktop!.call('POST', '/meetings', request);
      }
      if (existing != null) {
        final gaps = List<dynamic>.from(store.meta['gaps'] ?? []);
        gaps.add({
          'sample': store.samples,
          'resumedAt': DateTime.now().toIso8601String(),
        });
        store.meta['gaps'] = gaps;
        await store.save();
      }
      live = {...store.meta, 'samples': store.samples};
      if (Platform.isAndroid) {
        await desktop?.dispose();
        await FlutterForegroundTask.saveData(key: 'sessionId', value: id);
        final result = await FlutterForegroundTask.startService(
          serviceId: 43187,
          serviceTypes: [ForegroundServiceTypes.microphone],
          notificationTitle: tr("Brevia · 正在开始录音"),
          notificationIcon: NotificationIcon(
            metaDataName: 'com.brevia.recordingIcon',
          ),
          notificationText: tr("点击返回会议"),
          notificationButtons: [
            NotificationButton(id: 'pause', text: tr("暂停")),
            NotificationButton(id: 'return', text: tr("返回会议")),
          ],
          callback: recordingTask,
        );
        if (result is ServiceRequestFailure) {
          throw StateError(result.error.toString());
        }
        serviceRunning = true;
      } else {
        engine = RecordingEngine(store, offline ? null : desktop!, receive);
        await engine!.initialize();
      }
      return id;
    } catch (e) {
      error = e.toString();
      rethrow;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> command(
    String id,
    String action, {
    String note = '',
    int? sample,
  }) async {
    if (live?['id'] == id && (serviceRunning || engine != null)) {
      final data = {'action': action, 'note': note, 'sample': sample};
      if (serviceRunning) {
        await sendCommand(data);
      } else {
        await engine!.command(data);
      }
    } else if (action == 'end') {
      final root = await recordingsRoot();
      final store = await RecordingStore.load(Directory('${root.path}/$id'));
      store.meta['state'] = 'ended';
      await store.save();
      await refresh();
    }
  }

  Future<void> updateAddress(String address) async {
    final current = desktop!;
    final candidate = DesktopConnection.fromJson(current.toJson())
      ..address = address;
    // 用户修改局域网地址时必须验证该地址，不能由远程回退掩盖错误。
    await candidate.localCall('GET', '/meetings');
    current.address = address;
    await current.save();
    if (serviceRunning) {
      await sendCommand({'action': 'address', 'address': address});
    } else if (engine != null) {
      await engine!.command({'action': 'address', 'address': address});
    }
    await refresh();
  }

  Future<void> upload(String id, Map<String, dynamic> settings) async {
    if (busy ||
        serviceRunning ||
        (engine != null && engine!.store.meta['state'] != 'ended')) {
      throw StateError(tr("请先结束录音"));
    }
    final connection = desktop;
    if (connection == null) throw StateError(tr("请先连接电脑"));
    busy = true;
    notifyListeners();
    try {
      while (refreshing) {
        await Future<void>.delayed(Duration(milliseconds: 50));
      }
      if (!RegExp(r'^[a-f0-9-]{36}$').hasMatch(id)) {
        throw FormatException(tr("无效会议"));
      }
      final root = await recordingsRoot();
      final store = await RecordingStore.load(Directory('${root.path}/$id'));
      if (store.meta['localOnly'] != true || store.meta['state'] != 'ended') {
        throw StateError(tr("请先结束录音"));
      }
      final request = {
        'id': id,
        'title': store.meta['title'],
        ...settings,
        'num_speakers':
            settings['num_speakers'] ?? store.meta['num_speakers'] ?? -1,
      };
      await connection.call('POST', '/prepare', request);
      if (engine?.store.meta['id'] == id) {
        await engine!.dispose();
        engine = null;
        live = null;
      }
      // 用户确认目标电脑后再持久化绑定；后续失败由原有分片补传恢复。
      store.meta.addAll({
        ...settings,
        'localOnly': false,
        'computer': connection.fingerprint,
      });
      await store.save();
    } finally {
      busy = false;
      notifyListeners();
    }
    await refresh();
  }

  Future<void> meetingAction(
    String id,
    String action, {
    String? workspace,
    String? target,
  }) async {
    final record = meeting(id);
    if (record == null || record['finished'] != true) {
      throw StateError(tr("请先结束录音并完成同步"));
    }
    if (desktop == null || record['computer'] != desktop!.fingerprint) {
      throw StateError(tr("请连接这场会议原来的电脑"));
    }
    await desktop!.call('POST', '/meetings/$id/action', {
      'action': action,
      if (action == 'workspace') 'workspace_id': workspace,
      if (action != 'workspace') 'request_id': Uuid().v4(),
      if (action == 'translate') ...{
        'target_language': target,
        'consent': true,
      },
    });
    final snapshot = Map<String, dynamic>.from(
      await desktop!.call('GET', '/meetings/$id/snapshot'),
    );
    final root = await recordingsRoot();
    await writeJson(File('${root.path}/$id/snapshot.json'), snapshot);
    if (live?['id'] == id) live = {...live!, 'snapshot': snapshot};
    if (engine?.store.meta['id'] == id) engine!.snapshot = snapshot;
    await refresh();
  }

  Future<void> deleteMeeting(String id) async {
    if (busy ||
        serviceRunning ||
        (live?['id'] == id && live?['state'] != 'ended')) {
      throw StateError(tr("请先结束录音并完成同步"));
    }
    busy = true;
    try {
      while (refreshing) {
        await Future<void>.delayed(Duration(milliseconds: 50));
      }
      if (engine?.store.meta['id'] == id) {
        await engine!.dispose();
        engine = null;
        live = null;
      }
      if (!RegExp(r'^[a-f0-9-]{36}$').hasMatch(id)) {
        throw FormatException(tr("无效会议"));
      }
      final root = await recordingsRoot();
      final store = await RecordingStore.load(Directory('${root.path}/$id'));
      await senders.remove(id)?.dispose();
      await store.deleteLocal();
      final temporary = await getTemporaryDirectory();
      for (final extension in ['wav', 'md', 'txt']) {
        final file = File('${temporary.path}/$id.$extension');
        if (await file.exists()) await file.delete();
      }
      meetings.removeWhere((m) => m['id'] == id);
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> connect(DesktopConnection connection) async {
    if (busy ||
        serviceRunning ||
        (engine != null &&
            (engine!.store.meta['state'] != 'ended' ||
                (engine!.store.meta['localOnly'] != true &&
                    engine!.store.meta['finished'] != true &&
                    engine!.store.meta['remoteDeleted'] != true))) ||
        meetings.any(
          (m) =>
              desktop != null &&
              m['computer'] == desktop!.fingerprint &&
              m['finished'] != true &&
              m['remoteDeleted'] != true,
        )) {
      throw StateError(tr("请先完成当前电脑的录音与补传，未传音频会继续保留"));
    }
    busy = true;
    try {
      while (refreshing) {
        await Future<void>.delayed(Duration(milliseconds: 50));
      }
      await releaseEngines();
      await desktop?.dispose();
      await connection.save();
      await stopDiscovery();
      desktop = connection;
      desktopOnline = true;
    } finally {
      busy = false;
      notifyListeners();
    }
    await refresh();
  }

  Future<void> forget() async {
    if (busy ||
        serviceRunning ||
        (engine != null &&
            (engine!.store.meta['state'] != 'ended' ||
                (engine!.store.meta['localOnly'] != true &&
                    engine!.store.meta['finished'] != true &&
                    engine!.store.meta['remoteDeleted'] != true))) ||
        meetings.any(
          (m) =>
              desktop != null &&
              m['computer'] == desktop!.fingerprint &&
              m['finished'] != true &&
              m['remoteDeleted'] != true,
        )) {
      throw StateError(tr("请先完成当前电脑的录音与补传，未传音频会继续保留"));
    }
    busy = true;
    try {
      while (refreshing) {
        await Future<void>.delayed(Duration(milliseconds: 50));
      }
      await releaseEngines();
      await desktop?.dispose();
      await vault.delete(key: 'desktop');
      desktop = null;
      desktopOnline = false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    disposed = true;
    timer?.cancel();
    for (final done in pendingCommands.values) {
      if (!done.isCompleted) {
        done.completeError(StateError(tr("录音操作尚未确认，请检查录音状态后重试")));
      }
    }
    pendingCommands.clear();
    unawaited(
      () async {
        while (refreshing) {
          await Future<void>.delayed(Duration(milliseconds: 50));
        }
        await releaseEngines();
        await desktop?.dispose();
      }().catchError((Object e) => debugPrint('Recording cleanup failed: $e')),
    );
    unawaited(stopDiscovery());
    WidgetsBinding.instance.removeObserver(this);
    FlutterForegroundTask.removeTaskDataCallback(receive);
    super.dispose();
  }
}
