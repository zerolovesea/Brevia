import 'package:flutter/material.dart';

import 'i18n.dart';

class SwipeDelete extends StatefulWidget {
  final bool enabled;
  final Future<void> Function() onDelete;
  final Widget child;
  const SwipeDelete({
    super.key,
    required this.enabled,
    required this.onDelete,
    required this.child,
  });

  @override
  State<SwipeDelete> createState() => _SwipeDeleteState();
}

class _SwipeDeleteState extends State<SwipeDelete> {
  double offset = 0;
  bool deleting = false;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ClipRect(
      child: Stack(
        children: [
          if (widget.enabled && offset > 0)
            Positioned.fill(
              right: null,
              child: SizedBox(
                width: 80,
                child: TextButton(
                  style: TextButton.styleFrom(
                    backgroundColor: colors.error,
                    foregroundColor: colors.onError,
                    shape: const RoundedRectangleBorder(),
                  ),
                  onPressed: deleting
                      ? null
                      : () async {
                          setState(() => deleting = true);
                          try {
                            await widget.onDelete();
                          } finally {
                            if (mounted) setState(() => deleting = false);
                          }
                        },
                  child: Text(tr('删除')),
                ),
              ),
            ),
          GestureDetector(
            onHorizontalDragUpdate: widget.enabled && !deleting
                ? (details) => setState(() {
                    offset = (offset + details.delta.dx).clamp(0.0, 80.0);
                  })
                : null,
            onHorizontalDragEnd: widget.enabled
                ? (details) => setState(() {
                    final velocity = details.primaryVelocity ?? 0;
                    offset =
                        velocity > 300 || (velocity >= -300 && offset >= 40)
                        ? 80
                        : 0;
                  })
                : null,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              transform: Matrix4.translationValues(
                widget.enabled ? offset : 0,
                0,
                0,
              ),
              child: Material(
                color: Theme.of(context).scaffoldBackgroundColor,
                child: widget.child,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
