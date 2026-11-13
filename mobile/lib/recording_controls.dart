import 'dart:async';
import 'dart:math' as math;
import 'design_icons.dart';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';

import 'design_system.dart';
import 'storage.dart';

import 'i18n.dart';

/// 按同一区域的全部状态预留高度，避免文案换行时推动计时器和正文。
class StableStatusText extends StatelessWidget {
  final String text;
  final List<String> states;
  final TextStyle? style;
  final TextAlign textAlign;
  const StableStatusText(
    this.text, {
    super.key,
    required this.states,
    this.style,
    this.textAlign = TextAlign.start,
  });

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final effectiveStyle = DefaultTextStyle.of(context).style.merge(style);
      double height = 0;
      for (final value in {
        text,
        ...states,
      }.where((value) => value.isNotEmpty)) {
        final painter = TextPainter(
          text: TextSpan(text: value, style: effectiveStyle),
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
          locale: Localizations.maybeLocaleOf(context),
        )..layout(maxWidth: constraints.maxWidth);
        if (painter.height > height) height = painter.height;
        painter.dispose();
      }
      return SizedBox(
        height: height.ceilToDouble(),
        child: text.isEmpty
            ? const SizedBox.shrink()
            : Text(text, style: style, textAlign: textAlign),
      );
    },
  );
}

/// 只展示状态和发送动作；录音、传输和错误处理仍由会议控制器负责。
class RecordingControls extends StatelessWidget {
  final bool paused, pending;
  final bool showLabels;
  final VoidCallback onPause, onEnd;
  final VoidCallback? onMark, onMinutes;
  const RecordingControls({
    super.key,
    required this.paused,
    required this.pending,
    required this.onPause,
    required this.onEnd,
    this.onMark,
    this.onMinutes,
    this.showLabels = false,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    if (onMinutes != null) {
      return Row(
        children: [
          IconButton(
            tooltip: tr('结束'),
            onPressed: pending ? null : onEnd,
            style: IconButton.styleFrom(
              shape: CircleBorder(
                side: BorderSide(color: colors.outlineVariant),
              ),
            ),
            icon: Icon(
              Icons.circle,
              size: 15,
              color: pending ? null : colors.error,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: OutlinedButton(
              onPressed: onMinutes,
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                backgroundColor: colors.surfaceContainerLow,
                side: BorderSide(color: colors.outlineVariant),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                    child: Text(tr('查看纪要'), textAlign: TextAlign.center),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.arrow_forward, size: 18),
                ],
              ),
            ),
          ),
        ],
      );
    }
    Widget control(
      String label,
      IconData icon,
      VoidCallback? action, {
      bool danger = false,
    }) => Expanded(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton.filledTonal(
            tooltip: label,
            onPressed: pending ? null : action,
            icon: BreviaStateChange(
              child: BreviaIcon(icon, key: ValueKey(icon), size: 23),
            ),
            style: IconButton.styleFrom(
              minimumSize: const Size(48, 48),
              shape: CircleBorder(
                side: BorderSide(color: colors.outlineVariant),
              ),
              backgroundColor: colors.surface,
              foregroundColor: danger ? colors.error : colors.onSurface,
            ),
          ),
          if (showLabels) ...[
            const SizedBox(height: 6),
            StableStatusText(
              label,
              states: [
                if (label == tr('暂停') || label == tr('继续')) ...[
                  tr('暂停'),
                  tr('继续'),
                ] else
                  label,
              ],
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(fontSize: 12),
            ),
          ],
        ],
      ),
    );
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        control(
          tr(paused ? '继续' : '暂停'),
          paused ? Icons.play_arrow : Icons.pause,
          onPause,
        ),
        control(tr('重点'), Icons.bookmark_border, onMark),
        control(tr('结束'), Icons.stop_rounded, onEnd, danger: true),
      ],
    );
  }
}

/// 最近的麦克风电平；仅音频输入变化时重绘波形。
class RecordingSignal extends StatefulWidget {
  const RecordingSignal({
    super.key,
    required this.level,
    required this.recording,
    required this.status,
    required this.time,
    this.waveformCollapsed = false,
  });
  final ValueListenable<double> level;
  final bool recording;
  final String status, time;
  final bool waveformCollapsed;
  @override
  State<RecordingSignal> createState() => _RecordingSignalState();
}

class _RecordingSignalState extends State<RecordingSignal> {
  static const count = 29;
  final samples = List<double>.filled(count, 0);
  int next = 0;
  Timer? timer;
  double get level => widget.recording ? widget.level.value.clamp(0.0, 1.0) : 0;
  void startSampling() {
    timer?.cancel();
    samples.fillRange(0, count, 0);
    next = 0;
    if (!widget.recording) return;
    samples[next++] = level;
    timer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      final value = level;
      if (samples.every((sample) => sample == value)) return;
      setState(() {
        samples[next] = value;
        next = (next + 1) % count;
      });
    });
  }

  @override
  void initState() {
    super.initState();
    startSampling();
  }

  @override
  void didUpdateWidget(RecordingSignal oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.recording != widget.recording ||
        oldWidget.level != widget.level) {
      startSampling();
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, box) {
            final clock = FittedBox(
              fit: BoxFit.scaleDown,
              alignment: AlignmentDirectional.centerEnd,
              child: Text(
                widget.time,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            );
            final status = Row(
              children: [
                Icon(
                  widget.recording ? Icons.circle : Icons.pause,
                  size: 9,
                  color: widget.recording
                      ? const Color(0xffdb3039)
                      : theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: StableStatusText(
                    widget.status,
                    states: [
                      for (final text in [
                        '录音中',
                        '仍在本机录音',
                        '录音已暂停',
                        '录音已中断',
                        '正在开始',
                      ])
                        tr(text),
                    ],
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            );
            if (MediaQuery.textScalerOf(context).scale(14) > 21 ||
                box.maxWidth < 245) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [status, clock],
              );
            }
            return Row(
              children: [
                Expanded(child: status),
                const SizedBox(width: 8),
                Flexible(
                  child: Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: clock,
                  ),
                ),
              ],
            );
          },
        ),
        if (!widget.waveformCollapsed) const SizedBox(height: 12),
        if (!widget.waveformCollapsed)
          Semantics(
            label: tr('输入音量'),
            value: '${(level * 100).round()}%',
            child: CustomPaint(
              size: Size(
                double.infinity,
                MediaQuery.sizeOf(context).height < 650 ||
                        MediaQuery.textScalerOf(context).scale(14) > 20
                    ? 32
                    : 64,
              ),
              painter: _Waveform([
                ...samples.skip(next),
                ...samples.take(next),
              ], theme.colorScheme.onSurface),
            ),
          ),
      ],
    );
  }
}

class _Waveform extends CustomPainter {
  const _Waveform(this.samples, this.color);
  final List<double> samples;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final step = size.width / samples.length;
    final paint = Paint()
      ..color = color
      ..strokeCap = StrokeCap.round
      ..strokeWidth = (step * .48).clamp(1, 5);
    for (var i = 0; i < samples.length; i++) {
      final half = 3 + math.sqrt(samples[i]) * (size.height / 2 - 6);
      final x = (i + .5) * step;
      canvas.drawLine(
        Offset(x, size.height / 2 - half),
        Offset(x, size.height / 2 + half),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_Waveform old) =>
      color != old.color || !listEquals(samples, old.samples);
}

class MicrophoneLevel extends StatefulWidget {
  final double level;
  final Size size;
  const MicrophoneLevel({
    super.key,
    required this.level,
    this.size = const Size(160, 12),
  });
  @override
  State<MicrophoneLevel> createState() => _MicrophoneLevelState();
}

class _MicrophoneLevelState extends State<MicrophoneLevel>
    with SingleTickerProviderStateMixin {
  late final AnimationController animation = AnimationController.unbounded(
    vsync: this,
    value: widget.level.clamp(0, 1),
  );
  @override
  void didUpdateWidget(MicrophoneLevel oldWidget) {
    super.didUpdateWidget(oldWidget);
    final target = widget.level.clamp(0.0, 1.0);
    if (MediaQuery.disableAnimationsOf(context)) {
      animation.value = target;
    } else {
      animation.animateTo(
        target,
        duration: Duration(milliseconds: target > animation.value ? 65 : 240),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  void dispose() {
    animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: tr('输入音量'),
    value: '${(widget.level.clamp(0, 1) * 100).round()}%',
    child: AnimatedBuilder(
      animation: animation,
      builder: (_, _) => CustomPaint(
        size: widget.size,
        painter: _LevelPainter(
          animation.value.clamp(0, 1),
          Theme.of(context).brightness == Brightness.dark
              ? const Color(0xff80c99a)
              : const Color(0xff27b97b),
          Theme.of(context).colorScheme.outlineVariant,
        ),
      ),
    ),
  );
}

class _LevelPainter extends CustomPainter {
  final double level;
  final Color active, inactive;
  _LevelPainter(this.level, this.active, this.inactive);
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    for (var i = 0; i < 20; i++) {
      final rect = Rect.fromLTWH(
        i * size.width / 20 + 2,
        0,
        size.width / 20 - 4,
        size.height,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect, const Radius.circular(2)),
        paint..color = inactive,
      );
      final fraction = (level * 20 - i).clamp(0.0, 1.0);
      if (fraction > 0) {
        canvas.save();
        canvas.clipRect(
          Rect.fromLTWH(rect.left, 0, rect.width * fraction, size.height),
        );
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, const Radius.circular(2)),
          paint..color = active,
        );
        canvas.restore();
      }
    }
  }

  @override
  bool shouldRepaint(_LevelPainter old) =>
      level != old.level || active != old.active || inactive != old.inactive;
}

class RecordingReturnBar extends StatelessWidget {
  final Map<String, dynamic> meeting;
  final VoidCallback onTap;
  const RecordingReturnBar({
    super.key,
    required this.meeting,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) => FilledButton(
    key: const ValueKey('recording-return'),
    onPressed: onTap,
    style: FilledButton.styleFrom(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    ),
    child: Row(
      children: [
        BreviaIcon(
          Icons.circle,
          size: 8,
          color: meeting['state'] == 'recording'
              ? const Color(0xffff3b30)
              : null,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${tr(meeting['state'] == 'recording' ? '录音中' : '录音已暂停')} · ${durationText(meeting['samples'] ?? 0)}',
              ),
              Text(
                meeting['title'] ?? tr('会议'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        const BreviaIcon(Icons.chevron_right, size: 20),
      ],
    ),
  );
}

class RecordingFocus extends StatelessWidget {
  final Map<String, dynamic> meeting;
  final String? desktopName;
  final bool live, pending;
  final ValueListenable<double> level;
  final VoidCallback onPause, onEnd;
  final VoidCallback? onMark;
  const RecordingFocus({
    super.key,
    required this.meeting,
    this.desktopName,
    required this.live,
    required this.pending,
    required this.level,
    required this.onPause,
    required this.onEnd,
    this.onMark,
  });
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final compact = constraints.maxHeight < 600;
      final dense = constraints.maxHeight < 560;
      final desktop = meeting['desktopCapture'] == true;
      final local = meeting['localOnly'] == true;
      final recording = live && meeting['state'] == 'recording';
      final info = tr(
        desktop
            ? '这场会议由电脑发起，逐字稿和笔记保存在电脑。录音保留在手机，断线后可补传。'
            : '无需连接电脑。录音保存在本机，连接后由你主动上传。',
      );
      final status = tr(
        !live
            ? '录音已中断'
            : recording
            ? (!local && meeting['connected'] == false ? '仍在本机录音' : '录音中')
            : meeting['state'] == 'starting'
            ? '正在开始'
            : '录音已暂停',
      );
      final colors = Theme.of(context).colorScheme;
      Widget transfer(IconData icon, String label, String time) => Expanded(
        child: compact
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(fontSize: 12),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      BreviaIcon(icon, size: 18),
                      const SizedBox(width: 6),
                      Expanded(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            time,
                            style: Theme.of(
                              context,
                            ).textTheme.bodySmall?.copyWith(fontSize: 12),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              )
            : Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  BreviaIcon(icon, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          label,
                          style: Theme.of(
                            context,
                          ).textTheme.bodySmall?.copyWith(fontSize: 12),
                        ),
                        Text(
                          time,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: colors.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
      );
      return Padding(
        padding: EdgeInsets.fromLTRB(16, compact ? 8 : 0, 16, dense ? 8 : 16),
        child: Column(
          children: [
            Expanded(
              child: LayoutBuilder(
                builder: (context, body) => SingleChildScrollView(
                  key: const ValueKey('recording-focus-scroll'),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(minHeight: body.maxHeight),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.fromLTRB(12, 0, 0, 0),
                          decoration: BoxDecoration(
                            color: colors.surface,
                            border: Border.all(color: colors.outlineVariant),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Row(
                            children: [
                              BreviaIcon(
                                local
                                    ? Icons.phone_iphone_outlined
                                    : Icons.laptop_outlined,
                                size: 24,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      local
                                          ? tr('仅保存在手机')
                                          : desktopName ?? tr('连接电脑'),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(
                                        context,
                                      ).textTheme.bodySmall,
                                    ),
                                    if (!local)
                                      StableStatusText(
                                        tr(
                                          meeting['connected'] == false
                                              ? '离线'
                                              : '已连接',
                                        ),
                                        states: [tr('已连接'), tr('离线')],
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(fontSize: 12),
                                      ),
                                  ],
                                ),
                              ),
                              IconButton(
                                tooltip: tr('录音说明'),
                                onPressed: () => showModalBottomSheet<void>(
                                  requestFocus: false,
                                  context: context,
                                  sheetAnimationStyle: BreviaMotion.sheet(
                                    context,
                                  ),
                                  showDragHandle: true,
                                  isScrollControlled: true,
                                  builder: (_) => SafeArea(
                                    child: SingleChildScrollView(
                                      child: Padding(
                                        padding: const EdgeInsets.all(24),
                                        child: Column(
                                          mainAxisSize: MainAxisSize.min,
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            if (!local && desktopName != null)
                                              Text(
                                                desktopName!,
                                                style: Theme.of(
                                                  context,
                                                ).textTheme.titleMedium,
                                              ),
                                            const SizedBox(height: 12),
                                            if (!recording && live)
                                              Text(tr('暂停期间不采集音频')),
                                            Text(info),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                                icon: const BreviaIcon(
                                  Icons.info_outline,
                                  size: 20,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Padding(
                          padding: EdgeInsets.symmetric(
                            vertical: dense
                                ? 0
                                : compact
                                ? 4
                                : 24,
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              RecordingSignal(
                                level: level,
                                recording: recording,
                                status: status,
                                time: durationText(meeting['samples'] ?? 0),
                              ),
                              if (!dense) ...[
                                const SizedBox(height: 12),
                                StableStatusText(
                                  !recording && live ? tr('暂停期间不采集音频') : '',
                                  states: [tr('暂停期间不采集音频')],
                                  textAlign: TextAlign.center,
                                  style: Theme.of(
                                    context,
                                  ).textTheme.bodySmall?.copyWith(fontSize: 12),
                                ),
                              ],
                              if (meeting['error'] != null) ...[
                                const SizedBox(height: 8),
                                Text(
                                  meeting['error'].toString(),
                                  textAlign: TextAlign.center,
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(color: colors.error),
                                ),
                              ],
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          decoration: BoxDecoration(
                            border: Border(
                              top: BorderSide(color: colors.outline),
                            ),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              transfer(
                                Icons.phone_iphone_outlined,
                                tr('已存本机'),
                                durationText(meeting['samples'] ?? 0),
                              ),
                              if (!local) ...[
                                const SizedBox(width: 12),
                                transfer(
                                  Icons.laptop_outlined,
                                  tr('已传电脑'),
                                  durationText(
                                    meeting['snapshot']?['samples'] ?? 0,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(height: 16),
                if (!live) ...[
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: pending ? null : onPause,
                      child: Text(tr('继续录音')),
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: pending ? null : onEnd,
                      child: Text(tr('结束并保存')),
                    ),
                  ),
                ] else
                  RecordingControls(
                    paused: !recording,
                    pending: pending,
                    onPause: onPause,
                    onMark: onMark,
                    onEnd: onEnd,
                    showLabels: true,
                  ),
              ],
            ),
          ],
        ),
      );
    },
  );
}
