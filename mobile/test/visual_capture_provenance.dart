import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

// 防止失败复拍或并行源码修改后，将旧图误标为当前证据。
Map<String, String> captureSources() {
  final files = [
    ...Directory('lib').listSync(recursive: true).whereType<File>(),
    ...Directory('assets').listSync(recursive: true).whereType<File>(),
    File('pubspec.yaml'),
    File('pubspec.lock'),
    File('test/design_capture_test.dart'),
    File('test/visual_capture_provenance.dart'),
    File('integration_test/visual_alignment_test.dart'),
    File('test/meeting_stability_test.dart'),
    File('integration_test/meeting_stability_test.dart'),
    File('test_driver/visual_alignment_driver.dart'),
  ];
  return {
    for (final file in files)
      'mobile/${file.path}': sha256.convert(file.readAsBytesSync()).toString(),
  };
}

void writeCaptureRun(
  Directory output,
  Map<String, String> sources,
  List<String> screenshots,
  Map<String, Object?> details,
) {
  if (jsonEncode(sources) != jsonEncode(captureSources())) {
    throw StateError('截图期间源码发生变化，请重新运行');
  }
  File('${output.path}/capture-run.json').writeAsStringSync(
    '${const JsonEncoder.withIndent('  ').convert({'capturedAt': DateTime.now().toUtc().toIso8601String(), 'checksPassed': true, 'sources': sources, 'screenshots': screenshots, ...details})}\n',
  );
}
