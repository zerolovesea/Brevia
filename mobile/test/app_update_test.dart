import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:brevia_mobile/i18n.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:brevia_mobile/app_update.dart';

void main() {
  testWidgets('leaving settings during version lookup starts no request', (
    tester,
  ) async {
    uiLanguage = 'zh';
    final pendingVersion = Completer<String>();
    var versionCalls = 0;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      updateChannel,
      (call) async {
        if (call.method == 'downloadStatus') return {'state': 'none'};
        if (call.method == 'version') {
          return ++versionCalls == 1 ? '1.0.0' : pendingVersion.future;
        }
        return 6;
      },
    );
    final original = HttpOverrides.current;
    final network = ManifestHttpOverrides();
    HttpOverrides.global = network;
    addTearDown(() {
      HttpOverrides.global = original;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        updateChannel,
        null,
      );
    });
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AppUpdateTile())));
    await tester.pumpAndSettle();
    await tester.tap(find.text('检查更新'));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    pendingVersion.complete('1.0.0');
    await tester.pumpAndSettle();
    expect(network.clients, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'update tile shows installed and checked versions even after cancellation',
    (tester) async {
      uiLanguage = 'zh';
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        updateChannel,
        (call) async {
          if (call.method == 'downloadStatus') return {'state': 'none'};
          if (call.method == 'version') return '1.0.0';
          if (call.method == 'build') return 6;
          throw StateError('Unexpected method');
        },
      );
      final original = HttpOverrides.current;
      HttpOverrides.global = ManifestHttpOverrides();
      addTearDown(() {
        HttpOverrides.global = original;
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          updateChannel,
          null,
        );
      });
      await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: AppUpdateTile())),
      );
      await tester.pumpAndSettle();
      expect(find.text('当前版本：1.0.0 (6)'), findsOneWidget);
      expect(find.text('最新版本：尚未检查'), findsOneWidget);
      expect(find.text('ModelScope'), findsNothing);
      await tester.tap(find.text('检查更新'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('最新版本：1.0.1 (7)'), findsOneWidget);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(find.text('最新版本：1.0.1 (7)'), findsOneWidget);
      expect(find.text('当前版本：1.0.0 (6)'), findsOneWidget);
    },
  );

  test(
    'store versions compare numerically and ignore TestFlight build numbers',
    () {
      expect(newerStoreVersion('1.10.0', '1.9.9'), true);
      expect(newerStoreVersion('1.0', '1.0.0'), false);
      expect(newerStoreVersion('1.0.0', '1.1.0'), false);
      expect(
        () => newerStoreVersion('invalid', '1.0.0'),
        throwsFormatException,
      );
    },
  );

  testWidgets('background download restores progress on page and app return', (
    tester,
  ) async {
    uiLanguage = 'zh';
    var state = 'none', bytes = 0, starts = 0, installs = 0;
    final calls = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      updateChannel,
      (call) async {
        calls.add(call.method);
        if (call.method == 'version') return '1.0.0';
        if (call.method == 'build') return 6;
        if (call.method == 'download') {
          starts++;
          expect((call.arguments as Map)['sha256'], 'a' * 64);
          state = 'downloading';
          bytes = 25;
        }
        if (call.method == 'install') {
          installs++;
          return null;
        }
        return {
          'state': state,
          'bytes': bytes,
          'size': 100,
          'version': '1.0.1',
          'build': 7,
        };
      },
    );
    final original = HttpOverrides.current;
    HttpOverrides.global = ManifestHttpOverrides();
    addTearDown(() {
      HttpOverrides.global = original;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        updateChannel,
        null,
      );
    });
    Future<void> show() async {
      await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: AppUpdateTile())),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
    }

    await show();
    await tester.tap(find.text('检查更新'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('下载更新'));
    await tester.pump();
    expect(find.text('25%'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    bytes = 60;
    await show();
    expect(find.text('60%'), findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    bytes = 90;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(find.text('90%'), findsOneWidget);
    state = 'paused';
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('等待网络，恢复后继续下载'), findsOneWidget);
    state = 'ready';
    bytes = 100;
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('安装更新'), findsOneWidget);
    await tester.tap(find.text('安装更新'));
    await tester.pump();
    expect(installs, 1);
    expect(starts, 1);
    expect(calls, isNot(contains('cancel')));
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('iOS only offers newer public versions and opens App Store', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    uiLanguage = 'zh';
    var opened = 0;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      updateChannel,
      (call) async {
        if (call.method == 'version') return '1.0.0';
        if (call.method == 'build') return 999;
        if (call.method == 'storeCountry') return 'CN';
        if (call.method == 'openStore') {
          opened++;
          return null;
        }
        throw StateError('Unexpected method: ${call.method}');
      },
    );
    final original = HttpOverrides.current;
    final network = ManifestHttpOverrides(
      payload: {
        'results': [
          {
            'trackId': 6819869442,
            'bundleId': 'com.brevia.breviaMobile',
            'version': '1.1.0',
          },
        ],
      },
    );
    HttpOverrides.global = network;
    addTearDown(() {
      debugDefaultTargetPlatformOverride = null;
      HttpOverrides.global = original;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        updateChannel,
        null,
      );
    });
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AppUpdateTile())));
    await tester.pumpAndSettle();
    await tester.tap(find.text('检查更新'));
    await tester.pumpAndSettle();
    expect(find.text('最新版本：1.1.0'), findsOneWidget);
    expect(opened, 0);
    await tester.tap(find.text('前往 App Store 更新'));
    await tester.pumpAndSettle();
    expect(opened, 1);
    await tester.pumpWidget(const SizedBox());
    network.payload = {'results': []};
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AppUpdateTile())));
    await tester.pumpAndSettle();
    await tester.tap(find.text('检查更新'));
    await tester.pumpAndSettle();
    expect(find.text('当前地区暂无可用的商店版本'), findsOneWidget);
    expect(find.text('前往 App Store 更新'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = null;
  });

  test('release uses monotonic build and a fixed ModelScope APK path', () {
    final manifest = {
      'version': '0.1.5',
      'build': 24184403,
      'size': 100,
      'sha256': 'a' * 64,
      'url': 'https://untrusted.example/app.apk',
    };
    final release = AndroidRelease(manifest);
    expect(release.build, 24184403);
    expect(release.url.toString(), '${releaseBase}Brevia-0.1.5-24184403.apk');
    for (final invalid in [
      {'build': 0},
      {'size': -1},
      {'size': 500000001},
      {'version': '../app'},
      {'sha256': 'bad'},
    ]) {
      expect(
        () => AndroidRelease({...manifest, ...invalid}),
        throwsFormatException,
      );
    }
  });
}

class ManifestHttpOverrides extends HttpOverrides {
  int clients = 0;
  Map<String, dynamic>? payload;
  ManifestHttpOverrides({this.payload});
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    clients++;
    return ManifestClient(payload);
  }
}

class ManifestClient extends Fake implements HttpClient {
  final Map<String, dynamic>? payload;
  ManifestClient(this.payload);
  @override
  Duration? connectionTimeout;
  @override
  Future<HttpClientRequest> getUrl(Uri url) async => ManifestRequest(payload);
  @override
  void close({bool force = false}) {}
}

class ManifestRequest extends Fake implements HttpClientRequest {
  final Map<String, dynamic>? payload;
  ManifestRequest(this.payload);
  @override
  Future<HttpClientResponse> close() async => ManifestResponse(payload);
}

class ManifestResponse extends Fake implements HttpClientResponse {
  final Map<String, dynamic>? payload;
  ManifestResponse(this.payload);
  @override
  int get statusCode => 200;
  @override
  Stream<List<int>> timeout(
    Duration timeLimit, {
    void Function(EventSink<List<int>>)? onTimeout,
  }) => Stream.value(
    utf8.encode(
      jsonEncode(
        payload ??
            {'version': '1.0.1', 'build': 7, 'size': 100, 'sha256': 'a' * 64},
      ),
    ),
  );
}
