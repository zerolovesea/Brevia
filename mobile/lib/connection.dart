import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'i18n.dart';
import 'remote_transport.dart';

const vault = FlutterSecureStorage(
  iOptions: IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
  ),
);

class MeetingDeletedException implements Exception {
  @override
  String toString() => tr("会议已在电脑永久删除");
}

class DesktopConnection {
  String address;
  String fingerprint;
  String token;
  String name;
  Map<String, dynamic>? remote;
  RemoteTransport? transport;
  final available = StreamController<bool>.broadcast();
  bool checkedRemote = false;
  DateTime lanRetry = DateTime.fromMillisecondsSinceEpoch(0);
  DesktopConnection({
    required this.address,
    required this.fingerprint,
    this.token = '',
    this.name = '',
    this.remote,
  });
  Map<String, dynamic> toJson() => {
    'address': address,
    'fingerprint': fingerprint,
    'token': token,
    'name': name,
    if (remote != null) 'remote': remote,
  };
  factory DesktopConnection.fromJson(Map<String, dynamic> v) =>
      DesktopConnection(
        address: v['address'],
        fingerprint: v['fingerprint'],
        token: v['token'] ?? '',
        name: v['name'] ?? tr("电脑"),
        remote: v['remote'] == null
            ? null
            : Map<String, dynamic>.from(v['remote']),
      );
  static Uri endpoint(String address) {
    final uri = Uri.parse(
      address.contains('://') ? address : 'https://$address',
    );
    final ip = InternetAddress.tryParse(uri.host);
    final b = ip?.rawAddress;
    final local =
        b != null &&
        b.length == 4 &&
        (b[0] == 10 ||
            (b[0] == 172 && b[1] >= 16 && b[1] <= 31) ||
            (b[0] == 192 && b[1] == 168) ||
            (b[0] == 169 && b[1] == 254));
    if (uri.scheme != 'https' ||
        !local ||
        uri.userInfo.isNotEmpty ||
        (uri.path.isNotEmpty && uri.path != '/') ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw FormatException(tr("请输入电脑显示的局域网 HTTPS 地址"));
    }
    return uri;
  }

  Future<dynamic> call(String method, String route, [Object? data]) async {
    if (remote == null ||
        (!transportConnected && DateTime.now().isAfter(lanRetry))) {
      try {
        final value = await localCall(method, route, data);
        if (!checkedRemote && token.isNotEmpty) {
          checkedRemote = true;
          try {
            final setup = await localCall('GET', '/connection');
            if (setup['remote'] != null) {
              remote = Map<String, dynamic>.from(setup['remote']);
              await save();
            }
          } catch (_) {
            /* 兼容未启用跨网连接的旧版电脑。 */
          }
        }
        return value;
      } on SocketException {
        if (remote == null) rethrow;
      } on TimeoutException {
        if (remote == null) rethrow;
      }
      lanRetry = DateTime.now().add(Duration(seconds: 30));
    }
    transport ??= RemoteTransport(remote!, (connected) {
      if (!available.isClosed) available.add(connected);
    });
    final result = await transport!.call({
      'method': method,
      'route': route,
      'data': data,
      'token': token,
    });
    return decodeResponse(result['status'], result['value']);
  }

  bool get transportConnected => transport?.connected == true;
  dynamic decodeResponse(int status, dynamic value) {
    if (status == 410) throw MeetingDeletedException();
    if (status != 200) {
      throw HttpException(
        value is Map ? remoteError(value['error'].toString()) : tr("连接失败"),
      );
    }
    return value;
  }

  Future<void> reconnect() async {
    lanRetry = DateTime.fromMillisecondsSinceEpoch(0);
    if (!transportConnected) await transport?.reconnect();
    if (!available.isClosed) available.add(true);
  }

  Future<void> dispose() async {
    await transport?.dispose();
    transport = null;
  }

  Future<dynamic> localCall(String method, String route, [Object? data]) async {
    final base = endpoint(address);
    final client = HttpClient(
      context: SecurityContext(withTrustedRoots: false),
    )..connectionTimeout = Duration(milliseconds: remote == null ? 6000 : 1500);
    String? peer;
    client.badCertificateCallback = (cert, host, port) {
      peer = sha256.convert(cert.der).toString();
      // Empty pin is permitted only for unauthenticated identity discovery.
      return host == base.host &&
          (peer == fingerprint ||
              (fingerprint.isEmpty && route == '/identity'));
    };
    try {
      final request = await client
          .openUrl(method, base.replace(path: route))
          .timeout(Duration(milliseconds: remote == null ? 8000 : 2000));
      request.followRedirects = false;
      if (token.isNotEmpty) {
        request.headers.set('Authorization', 'Bearer $token');
      }
      request.headers.contentType = ContentType.json;
      if (data != null) request.write(jsonEncode(data));
      final response = await request.close().timeout(
        Duration(seconds: route == '/pair' ? 120 : 12),
      );
      peer ??= response.certificate == null
          ? null
          : sha256.convert(response.certificate!.der).toString();
      if (peer == null || (fingerprint.isNotEmpty && peer != fingerprint)) {
        throw HandshakeException(tr("电脑身份已改变，请重新配对"));
      }
      if (fingerprint.isEmpty) fingerprint = peer!;
      final bytes = <int>[];
      await for (final chunk in response.timeout(Duration(seconds: 15))) {
        bytes.addAll(chunk);
        if (bytes.length > 16 * 1024 * 1024) {
          throw FormatException(tr("电脑返回内容过大"));
        }
      }
      final value = jsonDecode(utf8.decode(bytes));
      return decodeResponse(response.statusCode, value);
    } finally {
      client.close(force: true);
    }
  }

  Future<void> save() =>
      vault.write(key: 'desktop', value: jsonEncode(toJson()));
  static Future<DesktopConnection?> load() async {
    final value = await vault.read(key: 'desktop');
    return value == null ? null : DesktopConnection.fromJson(jsonDecode(value));
  }
}
