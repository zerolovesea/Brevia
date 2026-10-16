import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/meeting_stability_test.dart' show verifyMeetingStability;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'recording layouts stay stable through connection and upload changes',
    (tester) async {
      for (final (brightness, scale, language) in [
        (Brightness.light, 1.0, 'zh'),
        (Brightness.dark, 1.0, 'zh'),
        (Brightness.dark, 2.0, 'zh'),
        (Brightness.light, 2.0, 'de'),
      ]) {
        var frame = 0;
        await verifyMeetingStability(
          tester,
          brightness: brightness,
          scale: scale,
          language: language,
          capture: (name) async {
            await tester.runAsync(
              () => Future<void>.delayed(const Duration(milliseconds: 100)),
            );
            await binding.takeScreenshot(
              '${brightness.name}-$scale-$language-${frame++}-$name',
            );
          },
        );
      }
    },
  );
}
