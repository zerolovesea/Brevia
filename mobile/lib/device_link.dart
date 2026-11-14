import 'package:flutter/material.dart';

import 'design_system.dart';
import 'recording_controls.dart';

enum DeviceLinkPhase {
  pair(Icons.qr_code_scanner, Color(0xff315f96), Color(0xffa4cbff)),
  verify(Icons.shield_outlined, Color(0xff655399), Color(0xffd5c4ff)),
  online(Icons.link, Color(0xff17634e), Color(0xff94e2c6)),
  offline(Icons.link_off, Color(0xff80521b), Color(0xfff3ca8a)),
  reconnect(Icons.sync, Color(0xff80521b), Color(0xfff3ca8a));

  const DeviceLinkPhase(this.icon, this.light, this.dark);
  final IconData icon;
  final Color light, dark;
  Color ink(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? dark : light;
}

class DeviceLinkHeader extends StatelessWidget {
  const DeviceLinkHeader({
    super.key,
    required this.phase,
    required this.title,
    required this.status,
    this.states = const [],
  });
  final DeviceLinkPhase phase;
  final String title, status;
  final List<String> states;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ink = phase.ink(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: theme.colorScheme.inverseSurface,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: BreviaStateChange(
                  child: Icon(
                    phase.icon,
                    key: ValueKey(phase),
                    size: 28,
                    color: theme.colorScheme.onInverseSurface,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: theme.textTheme.titleLarge),
                    const SizedBox(height: 4),
                    Semantics(
                      liveRegion: true,
                      child: StableStatusText(
                        status,
                        states: states,
                        style: theme.textTheme.bodyMedium?.copyWith(color: ink),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          const Divider(height: 1),
        ],
      ),
    );
  }
}
