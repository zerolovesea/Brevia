import 'dart:math' as math;
import 'package:flutter/material.dart';

/// A miniature of the two real workspaces, including the caption feed.
class PairingIllustration extends StatelessWidget {
  final bool active;
  const PairingIllustration({super.key, this.active = false});
  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return ExcludeSemantics(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 320),
          child: AspectRatio(
            aspectRatio: 2.6,
            child: TweenAnimationBuilder<double>(
              tween: Tween<double>(begin: 0, end: active ? 1 : 0),
              duration: MediaQuery.disableAnimationsOf(context)
                  ? Duration.zero
                  : const Duration(milliseconds: 850),
              builder: (context, progress, _) =>
                  CustomPaint(painter: _PairingPainter(dark, progress)),
            ),
          ),
        ),
      ),
    );
  }
}

class _PairingPainter extends CustomPainter {
  const _PairingPainter(this.dark, this.progress);
  final double progress;
  final bool dark;
  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 312, size.height / 120);
    final frame = dark ? const Color(0xffbbbcbf) : const Color(0xff35363a);
    const glass = Color(0xff242528);
    const pane = Color(0xff33353a);
    const type = Color(0xffc8cbd0);
    void panel(double x, double y, double w, double h, double r, Color color) =>
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromLTWH(x, y, w, h),
            Radius.circular(r),
          ),
          Paint()..color = color,
        );
    final dots = Paint()..color = frame.withValues(alpha: .12);
    for (var y = 4.0; y < 120; y += 7) {
      for (var x = 2.0; x < 312; x += 7) {
        canvas.drawCircle(Offset(x, y), .75, dots);
      }
    }
    panel(28, 19, 151, 89, 6, frame);
    panel(31, 22, 145, 82, 4, glass);
    panel(38, 35, 32, 63, 2, pane);
    panel(76, 35, 94, 63, 3, pane);
    for (var i = 0; i < 3; i++) {
      canvas.drawCircle(Offset(37.0 + i * 5, 28), 1.25, Paint()..color = type);
      panel(
        43,
        43.0 + i * 6,
        i.isEven ? 18 : 13,
        1.5,
        1,
        type.withValues(alpha: .55),
      );
    }
    panel(83, 45, 39, 3, 1, type);
    for (var i = 0; i < 5; i++) {
      panel(
        83,
        57.0 + i * 5,
        [68.0, 59.0, 71.0, 40.0, 54.0][i],
        1.5,
        1,
        type.withValues(alpha: .55),
      );
    }
    panel(18, 108, 171, 3.5, 2, frame);
    final link = Paint()..color = frame.withValues(alpha: .42);
    for (var x = 185.0; x < 225; x += 5) {
      canvas.drawCircle(Offset(x, 66), 1, link);
    }
    if (progress > 0) {
      canvas.drawCircle(
        Offset(185 + progress * 35, 66),
        2.3,
        Paint()..color = const Color(0xff278260),
      );
    }
    panel(226, 7, 48, 105, 9, frame);
    panel(229, 10, 42, 99, 7, const Color(0xfff6f5f3));
    panel(244, 13, 13, 2.5, 1.25, glass);
    for (var i = 0; i < 12; i++) {
      final height = 3 + math.sin(i * 1.53 + progress * 6).abs() * 14;
      panel(234 + i * 2.8, 48 - height / 2, 1.6, height, 1, glass);
    }
    panel(235, 67, 24, 2, 1, glass);
    panel(235, 74, 29, 1.5, 1, const Color(0xffa4a5a6));
    panel(235, 79, 21, 1.5, 1, const Color(0xffa4a5a6));
    panel(243, 103, 15, 1.7, 1, glass);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_PairingPainter old) =>
      old.dark != dark || old.progress != progress;
}
