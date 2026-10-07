import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'i18n.dart';

// 只负责可靠 DataChannel；录音落盘、确认位置和重传仍由 RecordingEngine 管理。
class RemoteTransport {
  final Map<String, dynamic> config;
  final void Function(bool) onState;
  RemoteTransport(this.config, this.onState);
  WebSocket? socket;
  RTCPeerConnection? peer;
  RTCDataChannel? channel;
  StreamSubscription<List<ConnectivityResult>>? network;
  Timer? retry;
  Timer? watchdog;
  Timer? renewal;
  Future<void> signals = Future.value();
  Future<void> outgoing = Future.value();
  Future<void> calls = Future.value();
  Future<void>? reconnecting;
  Completer<void>? ready;
  Completer<Map<String, dynamic>>? response;
  List<int> parts = [];
  int size = 0, failures = 0, generation = 0;
  bool disposed = false, opening = false;
  String session = '';
  final cipher = AesGcm.with256bits();
  bool get connected =>
      channel?.state == RTCDataChannelState.RTCDataChannelOpen;
  SecretKey get key => SecretKey([
    for (var i = 0; i < 64; i += 2)
      int.parse((config['key'] as String).substring(i, i + 2), radix: 16),
  ]);

  Future<Map<String, dynamic>> call(Map<String, dynamic> value) {
    final result = Completer<Map<String, dynamic>>();
    calls = calls.then((_) async {
      try {
        if (disposed) throw SocketException(tr("连接失败"));
        if (!connected) {
          ready ??= Completer<void>();
          await open();
          await ready!.future.timeout(Duration(seconds: 15));
        }
        final pending = Completer<Map<String, dynamic>>();
        response = pending;
        unawaited(pending.future.then<void>((_) {}, onError: (Object _) {}));
        // 从发送前开始计时，发送队列阻塞也必须结束本次请求。
        final deadline = DateTime.now().add(Duration(seconds: 15));
        final encoded = Uint8List.fromList(utf8.encode(jsonEncode(value)));
        if (encoded.length > 60000) {
          throw FormatException(tr("连接失败"));
        }
        for (var offset = 0; offset < encoded.length; offset += 8000) {
          while ((await channel!.getBufferedAmount()) > 64000) {
            if (!connected || DateTime.now().isAfter(deadline)) {
              throw SocketException(tr("连接失败"));
            }
            await Future<void>.delayed(Duration(milliseconds: 10));
          }
          await channel!.send(
            RTCDataChannelMessage.fromBinary(
              encoded.sublist(offset, min(offset + 8000, encoded.length)),
            ),
          );
        }
        await channel!.send(RTCDataChannelMessage(''));
        result.complete(
          await pending.future.timeout(deadline.difference(DateTime.now())),
        );
      } catch (error, stack) {
        response = null;
        try {
          await reconnect();
        } catch (_) {
          /* 本次请求仍返回原始失败。 */
        }
        if (!result.isCompleted) result.completeError(error, stack);
      } finally {
        response = null;
        parts = [];
        size = 0;
      }
    });
    return result.future;
  }

  Future<void> open() async {
    if (disposed || opening || socket != null) return;
    opening = true;
    final current = ++generation;
    final client = HttpClient()..connectionTimeout = Duration(seconds: 8);
    try {
      final url = Uri.parse(config['url']);
      if (url.scheme != 'wss' ||
          url.userInfo.isNotEmpty ||
          url.hasQuery ||
          url.hasFragment ||
          !RegExp(r'^[a-f0-9]{64}$').hasMatch(config['key'] ?? '') ||
          !RegExp(r'^[a-f0-9]{64}$').hasMatch(config['ticket'] ?? '') ||
          !RegExp(r'^[a-f0-9]{32}$').hasMatch(config['room'] ?? '')) {
        throw FormatException(tr("电脑版协议不兼容"));
      }
      network ??= Connectivity().onConnectivityChanged.listen(
        (_) => unawaited(reconnect()),
      );
      final ws = await WebSocket.connect(
        url.toString(),
        customClient: client,
      ).timeout(Duration(seconds: 8));
      if (disposed || current != generation) {
        await ws.close();
        return;
      }
      socket = ws;
      ws.pingInterval = Duration(seconds: 10);
      ws.add(
        jsonEncode({
          'room': config['room'],
          'role': 'phone',
          'ticket': config['ticket'],
        }),
      );
      ws.listen(
        (raw) {
          signals = signals
              .then((_) async {
                if (socket != ws || raw is! String || raw.length > 96000) {
                  return;
                }
                final value = jsonDecode(raw);
                if (value['type'] == 'joined' || value['type'] == 'ready') {
                  iceServers = value['iceServers'];
                  failures = 0;
                }
                if (value['type'] == 'ready' && !connected) await offer();
                if (value['type'] != 'signal') return;
                final bytes = base64Decode(value['box']);
                final plain = await cipher.decrypt(
                  SecretBox(
                    bytes.sublist(12, bytes.length - 16),
                    nonce: bytes.sublist(0, 12),
                    mac: Mac(bytes.sublist(bytes.length - 16)),
                  ),
                  secretKey: key,
                  aad: utf8.encode('brevia-v1:host'),
                );
                final signal = jsonDecode(utf8.decode(plain));
                if (signal['session'] != session || peer == null) return;
                if (signal['type'] == 'answer') {
                  await peer!.setRemoteDescription(
                    RTCSessionDescription(signal['sdp'], 'answer'),
                  );
                }
                if (signal['type'] == 'candidate') {
                  final c = signal['candidate'];
                  await peer!.addCandidate(
                    RTCIceCandidate(
                      c['candidate'],
                      c['sdpMid'],
                      c['sdpMLineIndex'],
                    ),
                  );
                }
              })
              .catchError((Object _) {
                if (socket == ws) unawaited(reconnect());
              });
        },
        onError: (Object _) {
          if (socket == ws) unawaited(disconnected(ws));
        },
        onDone: () {
          if (socket == ws) unawaited(disconnected(ws));
        },
      );
    } catch (_) {
      // 统一在 finally 安排一次重试，避免同次失败重复递增退避。
    } finally {
      client.close(force: true);
      opening = false;
      if (!disposed && socket == null) schedule();
    }
  }

  List<dynamic> iceServers = [];
  void schedule() {
    retry?.cancel();
    if (!disposed) {
      retry = Timer(
        Duration(
          milliseconds:
              min(10000, 500 * (1 << min(failures++, 5))) +
              Random().nextInt(300),
        ),
        () => unawaited(open()),
      );
    }
  }

  Future<void> disconnected(WebSocket ws) async {
    if (socket != ws) return;
    socket = null;
    unawaited(ws.close());
    // 信令中断不破坏仍然可用的点对点连接。
    schedule();
  }

  void signal(Map<String, dynamic> value) {
    final ws = socket;
    outgoing = outgoing
        .then((_) async {
          if (ws == null || socket != ws || disposed) return;
          final box = await cipher.encrypt(
            utf8.encode(jsonEncode(value)),
            secretKey: key,
            aad: utf8.encode('brevia-v1:phone'),
          );
          if (socket != ws || disposed) return;
          ws.add(
            jsonEncode({
              'type': 'signal',
              'box': base64Encode([
                ...box.nonce,
                ...box.cipherText,
                ...box.mac.bytes,
              ]),
            }),
          );
        })
        .catchError((Object _) {
          if (socket == ws) unawaited(reconnect());
        });
  }

  Future<void> offer() async {
    await closePeer();
    if (disposed || socket == null) return;
    session = List.generate(
      16,
      (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    final currentSession = session;
    final pc = await createPeerConnection({'iceServers': iceServers});
    if (disposed || currentSession != session) {
      await pc.dispose();
      return;
    }
    peer = pc;
    final candidates = <Map<String, dynamic>>[];
    var sent = false;
    pc.onIceCandidate = (candidate) {
      if (peer != pc ||
          candidate.candidate == null ||
          candidate.candidate!.isEmpty) {
        return;
      }
      final value = {
        'type': 'candidate',
        'session': currentSession,
        'candidate': candidate.toMap(),
      };
      if (sent) {
        signal(value);
      } else {
        candidates.add(value);
      }
    };
    pc.onConnectionState = (state) {
      if (peer != pc) return;
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        onState(false);
        watchdog?.cancel();
        watchdog = Timer(Duration(seconds: 3), () => unawaited(reconnect()));
      } else if (state ==
          RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        watchdog?.cancel();
        if (connected) onState(true);
      }
      if (peer == pc &&
          state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        unawaited(reconnect());
      }
    };
    final dc = await pc.createDataChannel(
      'brevia-v1',
      RTCDataChannelInit()..ordered = true,
    );
    if (disposed || peer != pc || currentSession != session) {
      await dc.close();
      return;
    }
    channel = dc;
    dc.onDataChannelState = (state) {
      if (channel != dc) return;
      if (state == RTCDataChannelState.RTCDataChannelOpen) {
        watchdog?.cancel();
        renewal?.cancel();
        renewal = Timer(Duration(minutes: 45), () => unawaited(reconnect()));
        if (ready?.isCompleted == false) ready!.complete();
        onState(true);
      } else if (state == RTCDataChannelState.RTCDataChannelClosed) {
        // 关闭后立即协商，不能等待录音同步的指数退避。
        unawaited(reconnect());
      }
    };
    dc.onMessage = (message) {
      if (channel == dc) receive(message);
    };
    final description = await pc.createOffer();
    if (peer != pc || disposed) return;
    await pc.setLocalDescription(description);
    if (peer != pc || disposed) return;
    signal({
      'type': 'offer',
      'session': currentSession,
      'sdp': description.sdp,
    });
    sent = true;
    for (final candidate in candidates) {
      signal(candidate);
    }
    watchdog?.cancel();
    watchdog = Timer(Duration(seconds: 15), () {
      if (!connected) unawaited(reconnect());
    });
  }

  void receive(RTCDataChannelMessage message) {
    if (response == null) return;
    if ((!message.isBinary && message.text.isNotEmpty) ||
        (message.isBinary && message.binary.length > 16000)) {
      unawaited(reconnect());
      return;
    }
    if (message.isBinary) {
      size += message.binary.length;
      if (size > 16 * 1024 * 1024) {
        unawaited(reconnect());
        return;
      }
      parts.addAll(message.binary);
      return;
    }
    try {
      final value = Map<String, dynamic>.from(jsonDecode(utf8.decode(parts)));
      if (!response!.isCompleted) response!.complete(value);
    } catch (error) {
      if (!response!.isCompleted) response!.completeError(error);
    }
    parts = [];
    size = 0;
  }

  Future<void> closePeer() async {
    watchdog?.cancel();
    renewal?.cancel();
    final dc = channel;
    final pc = peer;
    if (connected) onState(false);
    channel = null;
    peer = null;
    session = '';
    try {
      await dc?.close();
    } catch (_) {
      /* 原生连接可能已被系统关闭。 */
    }
    try {
      await pc?.dispose();
    } catch (_) {
      /* 保证旧连接释放失败不阻止新连接。 */
    }
    if (ready?.isCompleted == true) ready = null;
  }

  Future<void> reconnect() {
    if (disposed) return Future.value();
    return reconnecting ??= resetConnection().whenComplete(
      () => reconnecting = null,
    );
  }

  Future<void> resetConnection() async {
    retry?.cancel();
    generation++;
    final ws = socket;
    socket = null;
    unawaited(ws?.close() ?? Future.value());
    // 先结束旧请求，再释放原生对象，避免异步释放期间误伤新请求。
    if (response?.isCompleted == false) {
      response!.completeError(SocketException(tr("连接失败")));
    }
    await closePeer();
    if (!opening) await open();
  }

  Future<void> dispose() async {
    disposed = true;
    generation++;
    retry?.cancel();
    watchdog?.cancel();
    renewal?.cancel();
    await network?.cancel();
    final ws = socket;
    socket = null;
    unawaited(ws?.close() ?? Future.value());
    await closePeer();
  }
}
