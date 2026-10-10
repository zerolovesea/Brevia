import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:brevia_mobile/remote_transport.dart';
import 'package:brevia_mobile/connection.dart';

class SignallingSocket implements WebSocket {
  @override
  Future<void> close([int? code, String? reason]) async {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class TestChannel implements RTCDataChannel {
  final RemoteTransport transport;
  final requests = <Map<String, dynamic>>[];
  final bytes = <int>[];
  TestChannel(this.transport);
  @override
  RTCDataChannelState get state => RTCDataChannelState.RTCDataChannelOpen;
  @override
  Future<int> getBufferedAmount() async => 0;
  @override
  Future<void> close() async {}
  @override
  Future<void> send(RTCDataChannelMessage message) async {
    if (message.isBinary) {
      expect(message.binary.length, lessThanOrEqualTo(8000));
      bytes.addAll(message.binary);
    } else {
      expect(message.text, isEmpty);
      final value = Map<String, dynamic>.from(jsonDecode(utf8.decode(bytes)));
      bytes.clear();
      requests.add(value);
      final response = utf8.encode(jsonEncode({'status': 200, 'value': value}));
      // 刻意在 UTF-8 字符内部断帧，接收方必须完整重组后解码。
      for (var offset = 0; offset < response.length; offset += 127) {
        transport.receive(
          RTCDataChannelMessage.fromBinary(
            Uint8List.fromList(
              response.sublist(
                offset,
                (offset + 127).clamp(0, response.length),
              ),
            ),
          ),
        );
      }
      transport.receive(RTCDataChannelMessage(''));
    }
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class ReconnectingTransport extends RemoteTransport {
  final releasing = Completer<void>();
  int releases = 0, opens = 0;
  ReconnectingTransport() : super({}, (_) {});
  @override
  Future<void> closePeer() async {
    releases++;
    await releasing.future;
  }

  @override
  Future<void> open() async {
    opens++;
  }
}

void main() {
  test('periodic wake preserves signalling during ICE negotiation', () async {
    final transport = RemoteTransport({}, (_) {});
    final socket = SignallingSocket();
    transport.socket = socket;
    transport.session = 'negotiating';
    final connection = DesktopConnection(address: '', fingerprint: '')
      ..transport = transport;
    for (var i = 0; i < 5; i++) {
      await connection.reconnect();
    }
    expect(transport.connected, isFalse);
    expect(transport.socket, same(socket));
    expect(transport.session, 'negotiating');
    expect(transport.generation, 0);
    await connection.dispose();
  });
  test('concurrent network and peer failures share one reconnect', () async {
    final transport = ReconnectingTransport();
    final first = transport.reconnect();
    final second = transport.reconnect();
    expect(identical(first, second), isTrue);
    expect(transport.releases, 1);
    transport.releasing.complete();
    await Future.wait([first, second]);
    expect(transport.opens, 1);
    expect(transport.reconnecting, isNull);
    await transport.dispose();
  });
  test(
    'binary RPC serializes calls and reassembles fragmented UTF-8',
    () async {
      final transport = RemoteTransport({}, (_) {});
      final channel = TestChannel(transport);
      transport.channel = channel;
      final value = {'text': List.filled(2500, '会议😀').join()};
      final results = await Future.wait([
        transport.call(value),
        transport.call({'end': true}),
      ]);
      expect(results.first['value'], value);
      expect(results.last['value'], {'end': true});
      expect(channel.requests, [
        value,
        {'end': true},
      ]);
      expect(transport.parts, isEmpty);
      await transport.dispose();
    },
  );
}
