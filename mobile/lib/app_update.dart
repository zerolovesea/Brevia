import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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

bool newerStoreVersion(String latest, String current) {
  List<int> parts(String value) {
    if (!RegExp(r'^\d+(\.\d+){0,2}$').hasMatch(value)) {
      throw const FormatException('Invalid store version');
    }
    return [...value.split('.').map(int.parse), 0, 0];
  }

  final a = parts(latest), b = parts(current);
  for (var i = 0; i < 3; i++) {
    if (a[i] != b[i]) return a[i] > b[i];
  }
  return false;
}

class AppUpdateTile extends StatefulWidget {
  const AppUpdateTile({super.key});
  @override
  State<AppUpdateTile> createState() => _AppUpdateTileState();
}

class _AppUpdateTileState extends State<AppUpdateTile>
    with WidgetsBindingObserver {
  HttpClient? client;
  Timer? timer;
  bool busy = false, polling = false;
  String? status, currentVersion, latestVersion;
  int? currentBuild, latestBuild;
  String downloadState = 'none';
  double? progress;
  bool storeUpdate = false;
  bool get ios => defaultTargetPlatform == TargetPlatform.iOS;
  bool get downloading => ['downloading', 'paused'].contains(downloadState);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    loadCurrentVersion();
    if (!ios) {
      refreshDownload();
      timer = Timer.periodic(
        const Duration(seconds: 1),
        (_) => refreshDownload(),
      );
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (ios) return;
    timer?.cancel();
    if (state == AppLifecycleState.resumed) {
      refreshDownload();
      timer = Timer.periodic(
        const Duration(seconds: 1),
        (_) => refreshDownload(),
      );
    }
  }

  Future<void> loadCurrentVersion() async {
    try {
      final version = await updateChannel.invokeMethod<String>('version');
      final build = await updateChannel.invokeMethod<int>('build');
      if (mounted) {
        setState(() {
          currentVersion = version;
          currentBuild = build;
        });
      }
    } catch (_) {
      // 获取失败仍允许用户重试检查更新。
    }
  }

  void applyDownload(Map<dynamic, dynamic> value) {
    downloadState = value['state'] as String? ?? 'none';
    if (downloadState == 'none') {
      progress = null;
      return;
    }
    latestVersion = value['version'] as String?;
    latestBuild = (value['build'] as num?)?.toInt();
    final size = (value['size'] as num?) ?? 0;
    progress = size > 0
        ? ((value['bytes'] as num? ?? 0) / size).clamp(0, 1)
        : null;
  }

  Future<void> refreshDownload() async {
    if (polling || busy || !mounted) return;
    polling = true;
    try {
      final value = await updateChannel.invokeMapMethod('downloadStatus');
      if (mounted && value != null) setState(() => applyDownload(value));
    } catch (_) {
      if (mounted) setState(() => status = '更新失败，请检查网络后重试');
    } finally {
      polling = false;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    client?.close(force: true);
    super.dispose();
  }

  Future<Map<String, dynamic>> readManifest(Uri url) async {
    client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    final request = await client!.getUrl(url);
    final response = await request.close().timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) {
      throw const HttpException('Manifest unavailable');
    }
    final bytes = <int>[];
    await for (final chunk in response.timeout(const Duration(seconds: 15))) {
      bytes.addAll(chunk);
      if (bytes.length > 262144) {
        throw const FormatException('Manifest too large');
      }
    }
    return jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
  }

  Future<void> update() async {
    if (busy || downloading) return;
    setState(() {
      busy = true;
      status = '正在检查更新…';
    });
    try {
      if (ios && storeUpdate) {
        await updateChannel.invokeMethod('openStore');
        status = null;
        return;
      }
      if (!ios && downloadState == 'ready') {
        await updateChannel.invokeMethod('install');
        status = null;
        return;
      }
      await loadCurrentVersion();
      if (!mounted) return;
      if (currentBuild == null || currentVersion == null) {
        throw StateError('Version unavailable');
      }
      if (ios) {
        final country = await updateChannel.invokeMethod<String>(
          'storeCountry',
        );
        if (!mounted) return;
        if (country == null || !RegExp(r'^[A-Z]{2}$').hasMatch(country)) {
          throw StateError('Store unavailable');
        }
        final value = await readManifest(
          Uri.https('itunes.apple.com', '/lookup', {
            'id': '6819869442',
            'country': country,
          }),
        );
        if (!mounted) return;
        final results = value['results'] as List;
        final app = results
            .cast<Map>()
            .where(
              (item) =>
                  item['trackId'] == 6819869442 &&
                  item['bundleId'] == 'com.brevia.breviaMobile',
            )
            .firstOrNull;
        if (app == null) {
          status = '当前地区暂无可用的商店版本';
          latestVersion = null;
          storeUpdate = false;
          return;
        }
        final version = app['version'] as String;
        storeUpdate = newerStoreVersion(version, currentVersion!);
        latestVersion = version;
        status = storeUpdate ? null : '已是最新版本';
        return;
      }
      final release = AndroidRelease(
        await readManifest(
          Uri.parse(
            '${releaseBase}latest.json?t=${DateTime.now().millisecondsSinceEpoch}',
          ),
        ),
      );
      if (!mounted) return;
      setState(() {
        latestVersion = release.version;
        latestBuild = release.build;
      });
      if (release.build <= currentBuild!) {
        status = '已是最新版本';
        return;
      }
      final accept = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(tr('发现新版本 {0}', [release.version])),
          content: Text(tr('后台下载更新，完成后返回此处安装。')),
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
      status = null;
      if (accept != true || !mounted) return;
      final value = await updateChannel.invokeMapMethod('download', {
        'version': release.version,
        'build': release.build,
        'size': release.size,
        'sha256': release.digest,
      });
      if (mounted && value != null) setState(() => applyDownload(value));
    } catch (_) {
      status = '更新失败，请检查网络后重试';
    } finally {
      client?.close(force: true);
      client = null;
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final message = downloadState == 'ready'
        ? '下载完成，点击安装更新'
        : downloadState == 'paused'
        ? '等待网络，恢复后继续下载'
        : downloadState == 'downloading'
        ? '正在下载更新…'
        : downloadState == 'failed'
        ? '更新失败，请检查网络后重试'
        : status;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      minTileHeight: 76,
      leading: const Icon(Icons.system_update),
      title: Text(
        tr(
          downloadState == 'ready'
              ? '安装更新'
              : storeUpdate
              ? '前往 App Store 更新'
              : '检查更新',
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            tr('当前版本：{0}', [
              currentVersion == null ? '—' : '$currentVersion ($currentBuild)',
            ]),
          ),
          Text(
            tr('最新版本：{0}', [
              latestVersion == null
                  ? tr('尚未检查')
                  : ios
                  ? latestVersion!
                  : '$latestVersion ($latestBuild)',
            ]),
          ),
          if (message != null) Text(tr(message)),
          if (status != null && message != status && !busy) Text(tr(status!)),
          if (busy || downloading)
            LinearProgressIndicator(value: downloading ? progress : null),
          if (downloading && progress != null)
            Text('${(progress! * 100).floor()}%'),
        ],
      ),
      trailing: const Icon(Icons.chevron_right),
      onTap: busy || downloading ? null : update,
    );
  }
}
