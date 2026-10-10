import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import 'i18n.dart';

const releaseBase =
    'https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/';
const updateChannel = MethodChannel('com.brevia/app_update');

class AndroidRelease {
  final int build, size;
  final String version, digest;
  AndroidRelease(Map<String, dynamic> value)
    : build = value['build'] as int,
      size = value['size'] as int,
      version = value['version'] as String,
      digest = value['sha256'] as String {
    if (build <= 0 ||
        build > 2100000000 ||
        size <= 0 ||
        size > 500000000 ||
        !RegExp(r'^\d+\.\d+\.\d+$').hasMatch(version) ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(digest)) {
      throw FormatException('Invalid Android release');
    }
  }
  String get filename => 'Brevia-$version-$build.apk';
  Uri get url => Uri.parse('$releaseBase$filename');
}

class AppUpdateTile extends StatefulWidget {
  const AppUpdateTile({super.key});
  @override
  State<AppUpdateTile> createState() => _AppUpdateTileState();
}

class _AppUpdateTileState extends State<AppUpdateTile> {
  HttpClient? client;
  bool busy = false;
  double? progress;
  String? status;
  File? apk;

  @override
  void dispose() {
    client?.close(force: true);
    super.dispose();
  }

  Future<void> update() async {
    if (busy) return;
    setState(() {
      busy = true;
      status = tr('正在检查更新…');
    });
    try {
      if (apk != null) {
        await updateChannel.invokeMethod('install', apk!.path);
        return;
      }
      final current = await updateChannel.invokeMethod<int>('build');
      client = HttpClient()..connectionTimeout = Duration(seconds: 15);
      final request = await client!.getUrl(
        Uri.parse(
          '${releaseBase}latest.json?t=${DateTime.now().millisecondsSinceEpoch}',
        ),
      );
      final response = await request.close().timeout(Duration(seconds: 15));
      if (response.statusCode != 200) {
        throw HttpException('Manifest unavailable');
      }
      final bytes = <int>[];
      await for (final chunk in response.timeout(Duration(seconds: 15))) {
        bytes.addAll(chunk);
        if (bytes.length > 16384) throw FormatException('Manifest too large');
      }
      final release = AndroidRelease(
        jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (release.build <= current!) {
        setState(() => status = tr('已是最新版本'));
        return;
      }
      final accept = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(tr('发现新版本 {0}', [release.version])),
          content: Text(tr('从 ModelScope 下载，完成后由系统确认安装。')),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(tr('取消')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(tr('下载更新')),
            ),
          ],
        ),
      );
      if (accept != true || !mounted) {
        status = null;
        return;
      }
      final directory = Directory(
        '${(await getTemporaryDirectory()).path}/updates',
      );
      if (await directory.exists()) await directory.delete(recursive: true);
      await directory.create(recursive: true);
      final partial = File('${directory.path}/${release.filename}.part');
      final downloadRequest = await client!.getUrl(release.url);
      final downloadResponse = await downloadRequest.close().timeout(
        Duration(seconds: 15),
      );
      if (downloadResponse.statusCode != 200) {
        throw HttpException('APK unavailable');
      }
      final sink = partial.openWrite();
      var received = 0;
      try {
        await for (final chunk in downloadResponse.timeout(
          Duration(seconds: 30),
        )) {
          received += chunk.length;
          if (received > release.size) throw FormatException('APK too large');
          sink.add(chunk);
          await sink.flush();
          if (mounted) {
            setState(() {
              progress = received / release.size;
              status = tr('正在下载更新…');
            });
          }
        }
      } finally {
        await sink.close();
      }
      if (received != release.size ||
          (await sha256.bind(partial.openRead()).first).toString() !=
              release.digest) {
        await partial.delete();
        throw FormatException('APK checksum mismatch');
      }
      apk = await partial.rename('${directory.path}/${release.filename}');
      if (mounted) await updateChannel.invokeMethod('install', apk!.path);
    } catch (_) {
      apk = null;
      if (mounted) setState(() => status = tr('更新失败，请检查网络后重试'));
    } finally {
      client?.close(force: true);
      client = null;
      if (mounted) {
        setState(() {
          busy = false;
          progress = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: EdgeInsets.zero,
    minTileHeight: 76,
    leading: Icon(Icons.system_update),
    title: Text(tr(apk == null ? '检查更新' : '安装更新')),
    subtitle: busy
        ? Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(status ?? ''),
              LinearProgressIndicator(value: progress),
            ],
          )
        : Text(apk != null ? tr('如需授权，请允许安装后返回重试') : status ?? 'ModelScope'),
    trailing: Icon(Icons.chevron_right),
    onTap: busy ? null : update,
  );
}
