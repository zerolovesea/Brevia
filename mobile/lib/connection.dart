import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import 'i18n.dart';

const vault = FlutterSecureStorage(
  iOptions: IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
  ),
);

class DesktopHttpException extends HttpException {
  final int status;
  DesktopHttpException(this.status, super.message);
}

class MeetingDeletedException implements Exception {
  @override
  String toString() => tr("会议已在电脑永久删除");
}

class DesktopConnection {
  String address;
  String fingerprint;
  String token;
  String name;
  final available = StreamController<bool>.broadcast();
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

  dynamic decodeResponse(int status, dynamic value) {
    if (status == 410) throw MeetingDeletedException();
    if (status != 200) {
      throw DesktopHttpException(
        status,
        value is Map ? remoteError(value['error'].toString()) : tr("连接失败"),
      );
    }
    return value;
  }

  Future<void> reconnect() async {
    if (!available.isClosed) available.add(true);
  }

  Future<void> dispose() => available.close();

  Future<T> _request<T>(
    String method,
    String route,
    Object? data,
    Future<T> Function(HttpClientResponse response) handle,
  ) async {
    final base = endpoint(address);
    final client = HttpClient(context: SecurityContext(withTrustedRoots: false))
      ..connectionTimeout = Duration(seconds: 6);
    String? peer;
    client.badCertificateCallback = (cert, host, port) {
      peer = sha256.convert(cert.der).toString();
      // 仅未认证的设备发现允许空指纹。
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
        Duration(
          seconds: route == '/pair'
              ? 120
              : route.contains('/document/')
              ? 60
              : 12,
        ),
      );
      peer ??= response.certificate == null
          ? null
          : sha256.convert(response.certificate!.der).toString();
      if (peer == null || (fingerprint.isNotEmpty && peer != fingerprint)) {
        throw HandshakeException(tr("电脑身份已改变，请重新配对"));
      }
      if (fingerprint.isEmpty) fingerprint = peer!;
      return await handle(response);
    } finally {
      client.close(force: true);
    }
  }

  Future<dynamic> call(String method, String route, [Object? data]) =>
      _request(method, route, data, (response) async {
        final bytes = <int>[];
        await for (final chunk in response.timeout(Duration(seconds: 15))) {
          bytes.addAll(chunk);
          if (bytes.length > 16 * 1024 * 1024) {
            throw FormatException(tr("电脑返回内容过大"));
          }
        }
        final value = jsonDecode(utf8.decode(bytes));
        return decodeResponse(response.statusCode, value);
      });

  /// 通过已配对的 TLS 连接将音频或导出文档直接写入临时文件。
  Future<void> downloadFile(String route, File temporary) =>
      _request('GET', route, null, (response) async {
        if (response.statusCode != 200) {
          throw DesktopHttpException(response.statusCode, tr('连接失败'));
        }
        final out = temporary.openWrite();
        try {
          await out.addStream(response.timeout(const Duration(seconds: 15)));
          await out.flush();
        } finally {
          await out.close();
        }
      });

  static final _imageName = RegExp(
    r'^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|gif)$',
    caseSensitive: false,
  );
  static bool isNoteImageFilename(String name) => _imageName.hasMatch(name);

  Future<Uint8List> noteImage(String id, String name) async {
    if (!RegExp(r'^[a-zA-Z0-9_-]+$').hasMatch(id) ||
        !isNoteImageFilename(name)) {
      throw FormatException(tr('图片格式无效'));
    }
    final result = await call('GET', '/desktop-meetings/$id/images/$name');
    return base64Decode(result['base64']);
  }

  Future<File> document(
    String id,
    String content,
    String format, {
    Directory? directory,
  }) async {
    if (!Uuid.isValidUUID(fromString: id) ||
        !['notes', 'mynotes'].contains(content) ||
        !['pdf', 'docx'].contains(format)) {
      throw ArgumentError('Unsupported document export');
    }
    final temp = directory ?? await getTemporaryDirectory();
    final file = File('${temp.path}/brevia-${Uuid().v4()}.$format');
    try {
      await downloadFile(
        '/desktop-meetings/$id/document/$content/$format',
        file,
      );
      return file;
    } catch (_) {
      if (await file.exists()) await file.delete();
      rethrow;
    }
  }

  Future<void> save() =>
      vault.write(key: 'desktop', value: jsonEncode(toJson()));
  static Future<DesktopConnection?> load() async {
    final value = await vault.read(key: 'desktop');
    return value == null ? null : DesktopConnection.fromJson(jsonDecode(value));
  }
}
