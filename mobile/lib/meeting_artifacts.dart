import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'design_icons.dart';
import 'design_system.dart';
import 'desktop_library.dart';
import 'i18n.dart';

List<Map> _rows(dynamic value) =>
    value is List ? value.whereType<Map>().toList() : const [];

Map _summary(Map meeting) {
  final summary = meeting['summary'];
  if (summary is String) return {'markdown': summary};
  if (summary is Map) {
    return {
      ...summary,
      if (summary['data'] is Map) ...(summary['data'] as Map),
    };
  }
  return const {};
}

String meetingSummaryMarkdown(Map meeting) =>
    _summary(meeting)['markdown']?.toString() ?? '';

Map<String, List<Map>> _branches(Map meeting) {
  final groups = <String, List<Map>>{};
  for (final claim in _rows(_summary(meeting)['claims'])) {
    if (claim['kind'] != 'cause') continue;
    final section = claim['section']?.toString().trim() ?? '';
    (groups[section.isEmpty ? tr('原因分析') : section] ??= []).add(claim);
  }
  return groups;
}

String _stamp(dynamic value, {bool subtitle = false, bool vtt = false}) {
  final time = Duration(
    milliseconds: value is num ? value.toInt().clamp(0, 1 << 48) : 0,
  );
  String two(int n) => n.toString().padLeft(2, '0');
  final basic =
      '${two(time.inMinutes.remainder(60))}:${two(time.inSeconds.remainder(60))}';
  final h = subtitle || time.inHours > 0 ? '${two(time.inHours)}:' : '';
  return subtitle
      ? '$h$basic${vtt ? '.' : ','}${(time.inMilliseconds % 1000).toString().padLeft(3, '0')}'
      : '$h$basic';
}

bool _playable(Map source) =>
    source['seekable'] != false &&
    source['start_ms'] is num &&
    (!source.containsKey('current_segment_id') ||
        source['current_segment_id'] != null);

String _status(Map claim) {
  final status = switch (claim['status']) {
    'missing' => tr('缺少原文依据'),
    'changed' => tr('原文已变化'),
    'thin' => tr('依据较少'),
    _ => '',
  };
  return [
    if (claim['detached'] == true)
      tr('与当前笔记待核对')
    else if (claim['edited'] == true)
      tr('已编辑'),
    if (status.isNotEmpty) status,
  ].join(' · ');
}

/// 手机只呈现这场会议的本地附件，不让 Markdown 自动加载外部资源。
class MeetingNoteImage extends StatefulWidget {
  const MeetingNoteImage({
    super.key,
    required this.id,
    required this.uri,
    this.alt,
    required this.load,
  });
  final String id;
  final Uri uri;
  final String? alt;
  final Future<Uint8List> Function(String)? load;

  @override
  State<MeetingNoteImage> createState() => _MeetingNoteImageState();
}

class _MeetingNoteImageState extends State<MeetingNoteImage> {
  Future<Uint8List>? bytes;
  @override
  void didUpdateWidget(MeetingNoteImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.id != oldWidget.id ||
        widget.uri != oldWidget.uri ||
        (widget.load == null) != (oldWidget.load == null)) {
      bytes = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = DesktopLibrary.attachmentName(widget.id, widget.uri);
    if (name == null) return Text(widget.alt ?? tr('图片'));
    final load = widget.load;
    if (load == null) return Text('${tr("图片")} · ${tr("请先连接电脑")}');
    return FutureBuilder<Uint8List>(
      future: bytes ??= load(name),
      builder: (context, result) {
        if (result.hasData) {
          return ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.memory(
              result.data!,
              fit: BoxFit.contain,
              cacheWidth: 900,
              semanticLabel: widget.alt,
              errorBuilder: (_, _, _) => Text(tr('图片格式无效')),
            ),
          );
        }
        if (result.hasError) {
          return TextButton.icon(
            icon: const BreviaIcon(Icons.refresh),
            label: Text(tr('重新加载图片')),
            onPressed: () => setState(() => bytes = null),
          );
        }
        return const LinearProgressIndicator();
      },
    );
  }
}

String mobileSpeakerIdentity(Map segment) =>
    (segment['speaker_id'] ??
            segment['speaker'] ??
            segment['speaker_name'] ??
            '')
        .toString();

Map<String, int> mobileSpeakerPalette(Iterable<dynamic> segments) {
  final speakers = <String, int>{};
  for (final segment in segments) {
    final identity = mobileSpeakerIdentity(segment);
    if (identity.isEmpty || speakers.containsKey(identity)) continue;
    var color =
        identity.runes.fold(
          0,
          (hash, code) => (hash * 31 + code) & 0xffffffff,
        ) %
        6;
    if (speakers.length >= 6) {
      color = speakers.length;
    } else {
      while (speakers.containsValue(color)) {
        color = (color + 1) % 6;
      }
    }
    speakers[identity] = color;
  }
  return speakers;
}

class MobileSpeakerAvatar extends StatelessWidget {
  const MobileSpeakerAvatar({super.key, required this.color});
  final int? color;

  @override
  Widget build(BuildContext context) {
    final color = this.color;
    const inks = [
      Color(0xff006a9c),
      Color(0xff883db3),
      Color(0xff087346),
      Color(0xff994d00),
      Color(0xffb03062),
      Color(0xff414cb6),
    ];
    const tints = [
      Color(0xffcceeff),
      Color(0xfff1dafa),
      Color(0xffc9f3da),
      Color(0xffffe4b8),
      Color(0xffffdae9),
      Color(0xffdfe4ff),
    ];
    final colors = Theme.of(context).colorScheme;
    final hue = color == null ? 0.0 : (color * 137.508).round() % 360.0;
    final ink = color == null
        ? colors.onSurfaceVariant
        : color < 6
        ? inks[color]
        : HSLColor.fromAHSL(1, hue, .66, .32).toColor();
    final tint = color == null
        ? colors.surfaceContainer
        : color < 6
        ? tints[color]
        : HSLColor.fromAHSL(1, hue, .77, .90).toColor();
    return ExcludeSemantics(
      child: CircleAvatar(
        radius: 12,
        backgroundColor: tint,
        foregroundColor: ink,
        child: const BreviaIcon(Icons.person_outline, size: 15),
      ),
    );
  }
}

class MeetingTaskProgress extends StatelessWidget {
  const MeetingTaskProgress({super.key, required this.task});
  final Map? task;

  @override
  Widget build(BuildContext context) {
    final raw = task?['progress'];
    final progress = raw is num && raw.isFinite
        ? raw.toDouble().clamp(0.0, 1.0)
        : null;
    final label = tr(task?['state'] == 'queued' ? '等待电脑处理' : '电脑处理中');
    return Semantics(
      liveRegion: true,
      label: label,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            progress == null ? label : '$label · ${(progress * 100).round()}%',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(
            value:
                progress ??
                (MediaQuery.disableAnimationsOf(context) ? 0 : null),
          ),
        ],
      ),
    );
  }
}

class MeetingEvidenceTree extends StatelessWidget {
  const MeetingEvidenceTree({super.key, required this.snapshot, this.onSeek});
  final Map<String, dynamic> snapshot;
  final ValueChanged<int>? onSeek;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final groups = _branches(snapshot);
    if (groups.isEmpty) {
      return Text(tr('暂无原因分析'), style: theme.textTheme.bodySmall);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final group in groups.entries)
          Padding(
            padding: const EdgeInsets.only(bottom: 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.account_tree_outlined,
                      size: 18,
                      color: colors.onSurfaceVariant,
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        group.key,
                        style: theme.textTheme.titleMedium,
                      ),
                    ),
                  ],
                ),
                for (final (i, claim) in group.value.indexed)
                  CustomPaint(
                    painter: _Fork(colors.primary, i == group.value.length - 1),
                    child: Padding(
                      padding: const EdgeInsets.only(left: 30, top: 8),
                      child: Material(
                        color: colors.surfaceContainerLowest,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                          side: BorderSide(color: colors.outlineVariant),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: Theme(
                          data: theme.copyWith(
                            dividerColor: Colors.transparent,
                          ),
                          child: ExpansionTile(
                            key: ValueKey(
                              '${snapshot['id']}/${claim['id'] ?? i}',
                            ),
                            tilePadding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 2,
                            ),
                            childrenPadding: const EdgeInsets.fromLTRB(
                              14,
                              0,
                              14,
                              12,
                            ),
                            title: Text(
                              '${claim['text'] ?? ''}',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            subtitle: _status(claim).isEmpty
                                ? null
                                : Text(
                                    _status(claim),
                                    style: theme.textTheme.labelSmall,
                                  ),
                            children: [
                              if (claim['edited'] == true &&
                                  claim['original_text'] != null)
                                Align(
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    "${tr('生成时的结论')} · ${claim['original_text']}",
                                    style: theme.textTheme.bodySmall,
                                  ),
                                ),
                              for (final src in _rows(claim['sources']))
                                Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      Wrap(
                                        crossAxisAlignment:
                                            WrapCrossAlignment.center,
                                        spacing: 6,
                                        children: [
                                          if (_playable(src))
                                            TextButton.icon(
                                              onPressed: onSeek == null
                                                  ? null
                                                  : () => onSeek!(
                                                      (src['start_ms'] as num)
                                                          .toInt(),
                                                    ),
                                              icon: const BreviaIcon(
                                                Icons.play_arrow,
                                                size: 14,
                                              ),
                                              label: Text(
                                                _stamp(src['start_ms']),
                                              ),
                                            ),
                                          Text(
                                            '${src['speaker'] ?? ''}',
                                            style: theme.textTheme.labelMedium,
                                          ),
                                        ],
                                      ),
                                      SelectableText(
                                        '${src['text'] ?? ''}',
                                        style: theme.textTheme.bodyMedium,
                                      ),
                                    ],
                                  ),
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
      ],
    );
  }
}

// 每个分支按内容自然增高，长引文展开时树干也随之延伸。
class _Fork extends CustomPainter {
  const _Fork(this.ink, this.last);
  final Color ink;
  final bool last;
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = ink.withValues(alpha: .66)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.25;
    if (!last) canvas.drawLine(const Offset(9, 0), Offset(9, size.height), p);
    canvas.drawPath(
      Path()
        ..moveTo(9, 0)
        ..lineTo(9, 20)
        ..quadraticBezierTo(9, 34, 24, 34)
        ..lineTo(30, 34),
      p,
    );
  }

  @override
  bool shouldRepaint(_Fork old) => ink != old.ink || last != old.last;
}

String _mermaidLabel(String value) => value
    .replaceAll(RegExp(r'[\r\n]+'), ' ')
    .replaceAllMapped(RegExp(r'["`#&<>%]'), (m) => '#${m[0]!.codeUnitAt(0)};');

String causeMarkdown(Map meeting, {bool plain = false}) {
  final groups = _branches(meeting);
  if (groups.isEmpty) return '';
  final graph = plain
      ? [tr('原因分析')]
      : ['## ${tr('原因分析')}', '', '```mermaid', 'flowchart TD'];
  final evidence = <String>[];
  var number = 0;
  for (final (i, group) in groups.entries.indexed) {
    graph.add(plain ? group.key : '  p$i["${_mermaidLabel(group.key)}"]');
    for (final claim in group.value) {
      number++;
      final status = _status(claim);
      final text = '${claim['text']}${status.isEmpty ? '' : ' · $status'}';
      graph.add(
        plain
            ? '  • $text'
            : '  p$i --- c$number["$number. ${_mermaidLabel(text)}"]',
      );
      for (final src in _rows(claim['sources'])) {
        final stamp = _playable(src) ? '${_stamp(src['start_ms'])} · ' : '';
        final quote = "${src['speaker'] ?? ''} · ${src['text'] ?? ''}"
            .replaceAll(RegExp(r'[\r\n]+'), ' ');
        if (plain) {
          graph.add('    $stamp$quote');
        } else {
          final escaped = quote.replaceAllMapped(
            RegExp(r'[\\`*_{}\[\]<>~&]'),
            (m) => '\\${m[0]}',
          );
          evidence.add('> **$number** · $stamp$escaped');
        }
      }
    }
  }
  if (plain) return graph.join('\n');
  return [graph.join('\n'), '```', ...evidence.map((q) => '\n$q')].join('\n');
}

String transcriptExport(Map meeting, String format) {
  final rows = _rows(meeting['segments']);
  if (format == 'json') return const JsonEncoder.withIndent('  ').convert(rows);
  final captions = format == 'srt' || format == 'vtt';
  final out = <String>[if (format == 'vtt') 'WEBVTT'];
  for (final (i, row) in rows.indexed) {
    final speaker = row['speaker_name'] ?? row['speaker'];
    final line = [
      if (speaker != null && '$speaker'.isNotEmpty) '$speaker: ',
      row['text'] ?? '',
    ].join();
    final translated = row['translation'];
    final body = [
      line,
      if (translated is String && translated.isNotEmpty) translated,
    ].join('\n');
    if (captions) {
      String cue(dynamic ms) =>
          _stamp(ms, subtitle: true, vtt: format == 'vtt');
      out.add(
        "${i + 1}\n${cue(row['start_ms'])} --> ${cue(row['end_ms'])}\n$body",
      );
    } else {
      out.add("[${_stamp(row['start_ms'])}] $body");
    }
  }
  if (format == 'md') {
    return "# ${meeting['title'] ?? ''}\n\n${out.join('\n\n')}";
  }
  return out.join(captions ? '\n\n' : '\n');
}

class MeetingExportButton extends StatefulWidget {
  const MeetingExportButton({
    super.key,
    required this.snapshot,
    this.audioFile,
    this.imageBytes,
    this.documentFile,
    this.documentNotesCurrent = true,
  });
  final Map<String, dynamic> snapshot;
  final Future<File> Function()? audioFile;
  final Future<File> Function(String content, String format)? documentFile;
  final bool documentNotesCurrent;
  final Future<Uint8List> Function(String)? imageBytes;
  @override
  State<MeetingExportButton> createState() => _MeetingExportButtonState();
}

class _MeetingExportButtonState extends State<MeetingExportButton> {
  bool busy = false;
  ModalRoute<bool>? _sheet;

  @override
  void dispose() {
    final route = _sheet;
    if (route != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (route.isActive) route.navigator?.removeRoute(route);
      });
    }
    super.dispose();
  }

  Future<void> _export() async {
    final item = widget;
    final m = item.snapshot;
    final tree = causeMarkdown(m);
    final summary = meetingSummaryMarkdown(m);
    final notes = m['notes'] as String? ?? '';
    final outputs = <String, List<String>>{
      if (summary.trim().isNotEmpty)
        '会议纪要': [
          'md',
          'txt',
          if (item.documentFile != null) ...['pdf', 'docx'],
        ],
      if (notes.trim().isNotEmpty)
        '我的笔记': [
          'md',
          'txt',
          if (item.documentFile != null && item.documentNotesCurrent) ...[
            'pdf',
            'docx',
          ],
        ],
      if (tree.isNotEmpty) '原因分析': ['md', 'txt'],
      if (_rows(m['segments']).isNotEmpty)
        '逐字稿': ['srt', 'vtt', 'md', 'txt', 'json'],
      if (widget.audioFile != null) '会议录音': ['wav'],
    };
    if (outputs.isEmpty) return;
    final selected = <String>{
      outputs.keys.first,
      if (outputs.containsKey('会议纪要') && tree.isNotEmpty) '原因分析',
    };
    final formats = outputs.map((k, v) => MapEntry(k, v.first));
    final origin = context.findRenderObject() as RenderBox;
    final rect = origin.localToGlobal(Offset.zero) & origin.size;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      sheetAnimationStyle: BreviaMotion.sheet(context),
      builder: (sheet) {
        _sheet = ModalRoute.of<bool>(sheet);
        return StatefulBuilder(
          builder: (ctx, update) => SafeArea(
            top: false,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(tr('导出'), style: Theme.of(ctx).textTheme.headlineSmall),
                  const SizedBox(height: 12),
                  for (final entry in outputs.entries)
                    Row(
                      children: [
                        Expanded(
                          child: CheckboxListTile(
                            controlAffinity: ListTileControlAffinity.leading,
                            contentPadding: EdgeInsets.zero,
                            title: Text(tr(entry.key)),
                            value: selected.contains(entry.key),
                            onChanged: (v) => update(() {
                              if (v == true) {
                                selected.add(entry.key);
                              } else {
                                selected.remove(entry.key);
                              }
                            }),
                          ),
                        ),
                        if (entry.value.length == 1)
                          Text(
                            entry.value.first.toUpperCase(),
                            style: Theme.of(ctx).textTheme.labelMedium,
                          )
                        else
                          DropdownButton<String>(
                            value: formats[entry.key],
                            underline: const SizedBox(),
                            items: entry.value
                                .map(
                                  (f) => DropdownMenuItem(
                                    value: f,
                                    child: Text(f.toUpperCase()),
                                  ),
                                )
                                .toList(),
                            onChanged: (v) => update(() {
                              if (v != null) formats[entry.key] = v;
                            }),
                          ),
                      ],
                    ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: selected.isEmpty
                        ? null
                        : () => Navigator.pop(ctx, true),
                    child: Text(tr('导出')),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
    _sheet = null;
    if (ok != true || !mounted || widget.snapshot['id'] != m['id']) return;
    setState(() => busy = true);
    Directory? shareDirectory;
    try {
      final dir = await (await getTemporaryDirectory()).createTemp(
        'brevia-share-',
      );
      shareDirectory = dir;
      final name = String.fromCharCodes(
        ('${m['title'] ?? 'Brevia'}')
            .replaceAll(RegExp(r'[\x00-\x1f<>:"/\\|?*]'), '-')
            .runes
            .take(44),
      );
      final files = <XFile>[];
      final attachments = <String>{};
      for (final key in selected) {
        final format = formats[key]!;
        if (format == 'docx' || format == 'pdf') {
          final doc = await item.documentFile!(
            key == '会议纪要' ? 'notes' : 'mynotes',
            format,
          );
          try {
            final named = await doc.rename(
              '${dir.path}/$name - ${tr(key)}.$format',
            );
            files.add(XFile(named.path));
          } finally {
            if (await doc.exists()) await doc.delete();
          }
          continue;
        }
        if (key == '会议录音') {
          final wav = await item.audioFile!();
          files.add(XFile(wav.path, mimeType: 'audio/wav'));
          continue;
        }
        var content = switch (key) {
          '会议纪要' => summary,
          '我的笔记' => notes,
          '原因分析' => format == 'md' ? tree : causeMarkdown(m, plain: true),
          _ => transcriptExport(m, format),
        };
        if (format == 'md') {
          content = content.replaceAllMapped(
            RegExp(r'!\[([^\]\n]*)\]\((brevia-note://[^\s)]+)\)'),
            (match) {
              final uri = Uri.tryParse(match[2]!);
              final filename = uri == null
                  ? null
                  : DesktopLibrary.attachmentName('${m['id']}', uri);
              if (filename == null) return match[0]!;
              if (item.imageBytes == null) throw StateError(tr('请先连接电脑'));
              attachments.add(filename);
              return '![${match[1]}]($filename)';
            },
          );
        }
        final file = await File(
          '${dir.path}/$name - ${tr(key)}.$format',
        ).writeAsString(content);
        files.add(XFile(file.path));
      }
      for (final attachment in attachments) {
        final bytes = await item.imageBytes!(attachment);
        final file = await File('${dir.path}/$attachment').writeAsBytes(bytes);
        files.add(XFile(file.path));
      }
      if (mounted) {
        await SharePlus.instance.share(
          ShareParams(files: files, sharePositionOrigin: rect),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text("${tr('导出失败')} · $e")));
      }
    } finally {
      try {
        if (shareDirectory != null && await shareDirectory.exists()) {
          await shareDirectory.delete(recursive: true);
        }
      } finally {
        if (mounted) setState(() => busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.snapshot;
    final available =
        widget.audioFile != null ||
        _rows(m['segments']).isNotEmpty ||
        _branches(m).isNotEmpty ||
        (m['notes'] ?? '').toString().isNotEmpty ||
        meetingSummaryMarkdown(m).isNotEmpty;
    return IconButton(
      tooltip: tr('导出'),
      onPressed: busy || !available ? null : _export,
      icon: busy
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const BreviaIcon(Icons.ios_share_outlined),
    );
  }
}

/// 纪要正文常驻少量操作；重生成和精修在同一菜单中保留完整名称。
class MeetingArtifactActions extends StatelessWidget {
  const MeetingArtifactActions({
    super.key,
    required this.hasSummary,
    required this.busy,
    required this.onGenerate,
    this.onRefine,
  });
  final bool hasSummary, busy;
  final VoidCallback onGenerate;
  final VoidCallback? onRefine;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(tr('会议纪要'), style: Theme.of(context).textTheme.titleMedium),
      ),
      if (busy)
        Padding(
          padding: const EdgeInsets.all(14),
          child: Semantics(
            label: tr('电脑处理中'),
            liveRegion: true,
            child: const SizedBox.square(
              dimension: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        ),
      if (!hasSummary && !busy)
        IconButton.filledTonal(
          tooltip: tr('生成会议纪要'),
          onPressed: onGenerate,
          icon: const BreviaIcon(Icons.auto_awesome, size: 21),
        ),
      if (hasSummary || onRefine != null)
        PopupMenuButton<String>(
          tooltip: tr('更多'),
          elevation: 0,
          color: Theme.of(context).colorScheme.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
          enabled: !busy,
          icon: const BreviaIcon(Icons.more_horiz),
          onSelected: (value) =>
              value == 'summary' ? onGenerate() : onRefine?.call(),
          itemBuilder: (_) => [
            if (hasSummary)
              PopupMenuItem(
                value: 'summary',
                child: Row(
                  children: [
                    const BreviaIcon(Icons.refresh, size: 20),
                    const SizedBox(width: 12),
                    Expanded(child: Text(tr('重新生成纪要'))),
                  ],
                ),
              ),
            if (onRefine != null)
              PopupMenuItem(
                value: 'refine',
                child: Row(
                  children: [
                    const BreviaIcon(Icons.tune, size: 20),
                    const SizedBox(width: 12),
                    Expanded(child: Text(tr('重新精修'))),
                  ],
                ),
              ),
          ],
        ),
    ],
  );
}

/// 保持 Markdown 文本格式和原有草稿保存流程，只修改当前选择。
void insertNoteFormat(
  TextEditingController editor,
  String before, [
  String after = '',
]) {
  final selection = editor.selection;
  final start = selection.isValid ? selection.start : editor.text.length;
  final end = selection.isValid ? selection.end : start;
  final selected = editor.text.substring(start, end);
  editor.value = TextEditingValue(
    text: editor.text.replaceRange(start, end, '$before$selected$after'),
    selection: TextSelection.collapsed(
      offset: start + before.length + selected.length,
    ),
  );
}

class MinutesDocument extends StatelessWidget {
  const MinutesDocument({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Align(
        alignment: AlignmentDirectional.centerEnd,
        child: TextButton.icon(
          icon: const BreviaIcon(Icons.open_in_full, size: 16),
          label: Text(tr('全屏阅读')),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              fullscreenDialog: true,
              builder: (_) => Scaffold(
                appBar: AppBar(title: Text(tr('会议纪要'))),
                body: SafeArea(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
                    child: child,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      const SizedBox(height: 10),
      const Divider(height: 1),
      Padding(padding: const EdgeInsets.symmetric(vertical: 18), child: child),
    ],
  );
}

class NoteComposer extends StatelessWidget {
  const NoteComposer({
    super.key,
    required this.editor,
    required this.onChanged,
    this.expanded = false,
  });
  final TextEditingController editor;
  final ValueChanged<String> onChanged;
  final bool expanded;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final field = TextField(
      controller: editor,
      onChanged: onChanged,
      expands: expanded,
      minLines: expanded ? null : 7,
      maxLines: expanded ? null : 14,
      keyboardType: TextInputType.multiline,
      textAlignVertical: TextAlignVertical.top,
      style: theme.textTheme.bodyLarge?.copyWith(height: 1.7),
      decoration: InputDecoration(
        hintText: tr('写笔记…'),
        filled: false,
        contentPadding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
      ),
    );
    return Material(
      type: MaterialType.transparency,
      child: Column(
        mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          NoteFormatBar(editor: editor, onChanged: onChanged),
          if (expanded) Expanded(child: field) else field,
        ],
      ),
    );
  }
}

class NoteFormatBar extends StatelessWidget {
  const NoteFormatBar({
    super.key,
    required this.editor,
    required this.onChanged,
  });
  final TextEditingController editor;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => Align(
    alignment: AlignmentDirectional.centerStart,
    child: Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final item in [
            (Icons.format_bold, '加粗', '**', '**'),
            (Icons.format_list_bulleted, '列表', '\n- ', ''),
            (Icons.check_box_outlined, '待办', '\n- [ ] ', ''),
          ])
            IconButton(
              tooltip: tr(item.$2),
              icon: BreviaIcon(item.$1, size: 20),
              onPressed: () {
                insertNoteFormat(editor, item.$3, item.$4);
                onChanged(editor.text);
              },
            ),
        ],
      ),
    ),
  );
}
