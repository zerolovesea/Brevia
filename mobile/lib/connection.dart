import 'i18n.dart';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const vault = FlutterSecureStorage(
  iOptions: IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
  ),
);

class DesktopConnection {
  String address;
  String fingerprint;
  String token;
  String name;
  DesktopConnection({
    required this.address,
    required this.fingerprint,
    this.token = '',
    this.name = '',
  });
  Map<String, dynamic> toJson() => {
    'address': address,
    'fingerprint': fingerprint,
    'token': token,
    'name': name,
  };
  factory DesktopConnection.fromJson(Map<String, dynamic> v) =>
      DesktopConnection(
        address: v['address'],
        fingerprint: v['fingerprint'],
        token: v['token'] ?? '',
        name: v['name'] ?? tr("电脑"),
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
    final base = endpoint(address);
    final client = HttpClient(context: SecurityContext(withTrustedRoots: false))
      ..connectionTimeout = Duration(seconds: 6);
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
          .timeout(Duration(seconds: 8));
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
      if (response.statusCode != 200) {
        throw HttpException(
          value is Map ? remoteError(value['error'].toString()) : tr("连接失败"),
        );
      }
      return value;
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
