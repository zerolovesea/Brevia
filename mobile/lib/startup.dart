import 'i18n.dart';
import 'dart:async';
import 'package:flutter/material.dart';

/// Play the desktop reveal once while local data initializes, then fade out.
class Startup extends StatefulWidget {
  final Future<void> Function() initialize;
  final Widget child;
  const Startup({super.key, required this.initialize, required this.child});
  @override
  State<Startup> createState() => _StartupState();
}

class _StartupState extends State<Startup> {
  bool ready = false, played = false;
  Object? error;
  Timer? timer;
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
    timer ??= Timer(Duration(milliseconds: 1500), () {
      if (mounted) setState(() => played = true);
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.disableAnimationsOf(context);
    return AnimatedSwitcher(
      duration: reduced ? Duration.zero : Duration(milliseconds: 360),
      child: ready && (played || reduced)
          ? widget.child
          : ColoredBox(
              key: ValueKey('startup'),
              color: Color(0xfffbfaf7),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (reduced)
                    Center(
                      child: Text(
                        'brevia',
                        style: TextStyle(
                          color: Color(0xff26221e),
                          fontSize: 36,
                          fontWeight: FontWeight.bold,
                          decoration: TextDecoration.none,
                        ),
                      ),
                    )
                  else
                    Image.asset(
                      'assets/brevia-logo-reveal.gif',
                      fit: BoxFit.cover,
                      frameBuilder: (_, child, frame, _) {
                        if (frame != null) firstFrame();
                        return Transform.scale(scale: .82, child: child);
                      },
                      errorBuilder: (_, _, _) {
                        firstFrame();
                        return Center(
                          child: Text(
                            'brevia',
                            style: TextStyle(
                              color: Color(0xff26221e),
                              fontSize: 36,
                              decoration: TextDecoration.none,
                            ),
                          ),
                        );
                      },
                    ),
                  if (error != null)
                    SafeArea(
                      child: Align(
                        alignment: Alignment.bottomCenter,
                        child: Material(
                          color: Color(0xfffbfaf7),
                          child: Padding(
                            padding: EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(tr("本机数据暂时无法读取，请重试。")),
                                TextButton(
                                  onPressed: load,
                                  child: Text(tr("重试")),
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
