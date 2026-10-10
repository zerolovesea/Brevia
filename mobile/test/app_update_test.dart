import 'package:flutter_test/flutter_test.dart';
import 'package:brevia_mobile/app_update.dart';

void main() {
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
