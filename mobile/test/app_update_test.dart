import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
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
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    clients++;
    return ManifestClient();
  }
}

class ManifestClient extends Fake implements HttpClient {
  @override
  Duration? connectionTimeout;
  @override
  Future<HttpClientRequest> getUrl(Uri url) async => ManifestRequest();
  @override
  void close({bool force = false}) {}
}

class ManifestRequest extends Fake implements HttpClientRequest {
  @override
  Future<HttpClientResponse> close() async => ManifestResponse();
}

class ManifestResponse extends Fake implements HttpClientResponse {
  @override
  int get statusCode => 200;
  @override
  Stream<List<int>> timeout(
    Duration timeLimit, {
    void Function(EventSink<List<int>>)? onTimeout,
  }) => Stream.value(
    utf8.encode(
      jsonEncode({
        'version': '1.0.1',
        'build': 7,
        'size': 100,
        'sha256': 'a' * 64,
      }),
    ),
  );
}
