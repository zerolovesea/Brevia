import 'package:flutter/material.dart';

import 'design_system.dart';
import 'i18n.dart';

/// 首帧后播放矢量 Logo，初始化失败保留重试入口。
class Startup extends StatefulWidget {
  final Future<void> Function() initialize;
  final Widget child;
  const Startup({super.key, required this.initialize, required this.child});
  @override
  State<Startup> createState() => _StartupState();
}

class _StartupState extends State<Startup> with SingleTickerProviderStateMixin {
  bool ready = false, played = false, started = false;
  Object? error;
  late final controller =
      AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 1500),
      )..addStatusListener((status) {
        if (status == AnimationStatus.completed && mounted) {
          setState(() => played = true);
        }
      });

  @override
  void initState() {
    super.initState();
    load();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) firstFrame();
    });
  }

  Future<void> load() async {
    setState(() => error = null);
    try {
      await widget.initialize();
      if (mounted) setState(() => ready = true);
    } catch (e) {
      if (mounted) setState(() => error = e);
    }
  }

  void firstFrame() {
    if (started) return;
    started = true;
    controller.forward();
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.disableAnimationsOf(context);
    final canvas = Theme.of(context).scaffoldBackgroundColor;
    return AnimatedSwitcher(
      duration: reduced ? Duration.zero : const Duration(milliseconds: 220),
      child: ready && (played || reduced)
          ? widget.child
          : ColoredBox(
              key: const ValueKey('startup'),
              color: canvas,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (reduced)
                    Center(child: breviaLogo(size: 64))
                  else
                    AnimatedBuilder(
                      animation: controller,
                      builder: (context, _) => Transform.translate(
                        offset: Offset(
                          0,
                          -4 *
                              const Interval(
                                .7,
                                1,
                                curve: Curves.easeOutCubic,
                              ).transform(controller.value),
                        ),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Center(
                              child: Semantics(
                                label: 'Brevia',
                                child: CustomPaint(
                                  size: const Size(64, 64),
                                  painter: _StartupMarkPainter(
                                    controller.value,
                                  ),
                                ),
                              ),
                            ),
                            Center(
                              child: Padding(
                                padding: const EdgeInsets.only(top: 120),
                                child: Opacity(
                                  opacity: const Interval(
                                    .32,
                                    .88,
                                    curve: Curves.easeOut,
                                  ).transform(controller.value),
                                  child: Image.asset(
                                    'assets/brevia-wordmark.png',
                                    height: 24,
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.onSurface,
                                    excludeFromSemantics: true,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  if (error != null)
                    SafeArea(
                      child: Align(
                        alignment: Alignment.bottomCenter,
                        child: Material(
                          color: canvas,
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(tr('本机数据暂时无法读取，请重试。')),
                                TextButton(
                                  onPressed: load,
                                  child: Text(tr('重试')),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

/// 直接绘制品牌源 SVG 的方形及字形，避免开屏放大时出现位图锯齿。
class _StartupMarkPainter extends CustomPainter {
  final double progress;
  _StartupMarkPainter(this.progress);

  @override
  void paint(Canvas canvas, Size size) {
    final reveal = const Interval(
      .24,
      .72,
      curve: Curves.easeInOutCubic,
    ).transform(progress);
    canvas.scale(size.width / 160, size.height / 160);
    canvas.drawRect(
      const Rect.fromLTWH(0, 0, 160, 160),
      Paint()..color = const Color(0xff26221e),
    );
    canvas.save();
    canvas.clipRect(Rect.fromLTWH(0, 0, 160, 160 * reveal));
    final ink = Path()
      ..fillType = PathFillType.evenOdd
      ..moveTo(44, 54)
      ..lineTo(76, 54)
      ..lineTo(72, 47)
      ..lineTo(82, 44)
      ..lineTo(86, 54)
      ..lineTo(116, 54)
      ..lineTo(116, 62)
      ..lineTo(44, 62)
      ..close()
      ..addRect(const Rect.fromLTWH(54, 67, 52, 8))
      ..addRect(const Rect.fromLTWH(54, 80, 52, 7))
      ..moveTo(52, 92)
      ..lineTo(108, 92)
      ..lineTo(108, 120)
      ..lineTo(100, 120)
      ..lineTo(100, 117)
      ..lineTo(60, 117)
      ..lineTo(60, 120)
      ..lineTo(52, 120)
      ..close()
      ..addRect(const Rect.fromLTWH(60, 100, 40, 9));
    canvas.drawPath(ink, Paint()..color = const Color(0xfffbfaf7));
    canvas.restore();
  }

  @override
  bool shouldRepaint(_StartupMarkPainter oldDelegate) =>
      oldDelegate.progress != progress;
}
