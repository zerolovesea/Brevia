import 'package:flutter/material.dart';

import 'design_system.dart';
import 'i18n.dart';

/// 原生静态 Logo 首帧就绪后再播放，初始化失败保留重试入口。
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
        duration: const Duration(milliseconds: 900),
      )..addStatusListener((status) {
        if (status == AnimationStatus.completed && mounted) {
          setState(() => played = true);
        }
      });

  @override
  void initState() {
    super.initState();
    load();
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
                          -12 *
                              const Interval(
                                .55,
                                1,
                                curve: Curves.easeOutCubic,
                              ).transform(controller.value),
                        ),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Center(
                              child: Image.asset(
                                'assets/brevia-logo.png',
                                width: 64,
                                height: 64,
                                semanticLabel: 'Brevia',
                                frameBuilder: (_, child, frame, _) {
                                  if (frame != null) firstFrame();
                                  return child;
                                },
                                errorBuilder: (_, _, _) {
                                  firstFrame();
                                  return const SizedBox(width: 64, height: 64);
                                },
                              ),
                            ),
                            Center(
                              child: Padding(
                                padding: const EdgeInsets.only(top: 120),
                                child: Opacity(
                                  opacity: const Interval(
                                    .2,
                                    .6,
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
