import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:just_audio/just_audio.dart';
import 'package:uuid/uuid.dart';

import 'app_model.dart';
import 'connection.dart';
import 'design_icons.dart';
import 'design_system.dart';
import 'desktop_library.dart';
import 'i18n.dart';
import 'meeting_artifacts.dart';
import 'storage.dart';

String _time(num ms) => durationText(ms * 16);

class DesktopMeetingPage extends StatefulWidget {
  const DesktopMeetingPage({super.key, required this.model, required this.id});
  final AppModel model;
  final String id;

  @override
  State<DesktopMeetingPage> createState() => _DesktopMeetingPageState();
}

enum _Section { transcript, notes, summary, evidence }

class _DesktopMeetingPageState extends State<DesktopMeetingPage> {
  late final library = widget.model.desktopLibrary!;
  SharedNoteDraft draft = SharedNoteDraft();
  MeetingData snapshot = {};
  final editor = TextEditingController();
  final transcriptScroll = ScrollController();
  final requestIds = <String, String>{};
  Timer? poll, autosave;
  Future<void> saving = Future.value();
  bool loading = true,
      fetching = false,
      editing = false,
      busy = false,
      unavailable = false;
  String? error;
  bool online = false;
  _Section section = _Section.transcript;
  ModalRoute<dynamic>? meetingDialog;
  AudioPlayer? player;
  bool audioReady = false;
  bool get current =>
      mounted && identical(library, widget.model.desktopLibrary);
  String get id => widget.id;
  bool get ended => snapshot['state'] == 'ended';
  bool get remoteChanged =>
      draft.revision != null && draft.revision != snapshot['revision'];
  bool get pending => snapshot['proposal']?['state'] == 'pending';
  bool get processing =>
      ['queued', 'running'].contains(snapshot['task']?['state']);
  List get segments => snapshot['segments'] as List? ?? const [];

  @override
  void initState() {
    super.initState();
    widget.model.addListener(_libraryChanged);
    _open();
  }

  void _libraryChanged() {
    if (!mounted || unavailable) return;
    if (!widget.model.foreground && autosave?.isActive == true) _save();
    if (!current || (library.authoritative && !library.visible(id))) {
      _hideMeeting();
    }
  }

  void _hideMeeting() {
    autosave?.cancel();
    poll?.cancel();
    unawaited(player?.stop());
    // 撤销共享时只移除本页弹出的面板，保留其他页面的路由。
    final route = meetingDialog;
    if (route != null && route.isActive) route.navigator?.removeRoute(route);
    meetingDialog = null;
    setState(() {
      unavailable = true;
      snapshot = {};
      draft = SharedNoteDraft();
      editor.clear();
    });
  }

  Future<void> _open() async {
    try {
      final cached = await library.cached(id);
      final saved = await library.draft(id);
      if (!current || unavailable) return;
      draft = SharedNoteDraft.restore(saved);
      editor.text = draft.text;
      if (cached.isNotEmpty) _receive(cached);
      await _refresh();
    } catch (e) {
      if (current) setState(() => error = e.toString());
    } finally {
      if (current && !unavailable) {
        setState(() => loading = false);
        poll = Timer.periodic(const Duration(seconds: 2), (_) {
          if (widget.model.foreground) {
            unawaited(_refresh());
          }
        });
      }
    }
  }

  Future<void> _refresh() async {
    if (fetching || !current || unavailable) return;
    fetching = true;
    try {
      final data = await library.snapshot(id);
      if (current && !unavailable) {
        online = true;
        _receive(data);
      }
    } on DesktopHttpException catch (e) {
      online = false;
      if (!current) return;
      if ([401, 403, 404].contains(e.status)) {
        _hideMeeting();
        await widget.model.refreshLibrary();
      } else {
        setState(() => error = e.message);
      }
    } catch (_) {
      online = false;
      if (current) setState(() => error = tr('等待电脑连接'));
    } finally {
      fetching = false;
    }
  }

  void _receive(MeetingData data) {
    final submittedId = draft.proposalId;
    final changed = draft.reconcile(data);
    if (submittedId != null &&
        data['proposal']?['id'] == submittedId &&
        data['proposal']?['state'] == 'declined' &&
        changed) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(tr('电脑未采纳修改，手机草稿已保留'))));
    }
    setState(() {
      if (snapshot.isEmpty && data['state'] == 'ended') {
        section = _Section.summary;
      }
      snapshot = data;
      if (editor.text != draft.text) editor.text = draft.text;
      error = null;
    });
    if (changed) _save();
  }

  Future<void> _save() {
    autosave?.cancel();
    final value = draft.toJson();
    final target = library;
    final meetingId = id;
    saving = saving.then((_) => target.saveDraft(meetingId, value)).catchError((
      Object e,
    ) {
      if (current) setState(() => error = e.toString());
    });
    return saving;
  }

  void _change(String text) {
    setState(() => draft.text = text);
    autosave?.cancel();
    autosave = Timer(const Duration(milliseconds: 300), _save);
  }

  void _insert(String value, {bool append = false}) {
    final selection = editor.selection;
    final start = !append && selection.isValid
        ? selection.start
        : editor.text.length;
    final end = !append && selection.isValid ? selection.end : start;
    final before = editor.text.substring(0, start);
    final gap = before.isEmpty || before.endsWith('\n\n') ? '' : '\n\n';
    final inserted = '$gap$value\n\n';
    editor.value = TextEditingValue(
      text: editor.text.replaceRange(start, end, inserted),
      selection: TextSelection.collapsed(offset: start + inserted.length),
    );
    _change(editor.text);
    section = _Section.notes;
  }

  Future<void> _action(Future<void> Function() callback) async {
    if (busy || unavailable || !current) return;
    setState(() => busy = true);
    try {
      await callback();
    } catch (e) {
      if (mounted && current && !unavailable) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (current) setState(() => busy = false);
    }
  }

  Future<void> _send() async {
    if (remoteChanged) {
      await _compare();
      return;
    }
    final requestId = draft.prepare();
    final revision = draft.revision!;
    final notes = draft.submitted!;
    await _save();
    if (!current || unavailable) return;
    try {
      final reply = await library.propose(id, requestId, revision, notes);
      if (current && !unavailable) {
        setState(() => snapshot = {...snapshot, 'proposal': reply});
      }
    } on DesktopHttpException catch (e) {
      if (current && !unavailable && [400, 409, 413].contains(e.status)) {
        draft.proposalId = draft.submitted = null;
        await _save();
      }
      rethrow;
    } finally {
      await _refresh();
    }
  }

  Future<void> _pickImage() async {
    const images = XTypeGroup(
      label: 'Images',
      extensions: ['jpg', 'jpeg', 'png', 'webp'],
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      uniformTypeIdentifiers: [
        'public.jpeg',
        'public.png',
        'org.webmproject.webp',
      ],
    );
    final file = await openFile(acceptedTypeGroups: const [images]);
    if (file == null || !current || unavailable) return;
    if (await file.length() > 4 * 1024 * 1024) {
      throw FormatException(tr('图片最大为 4 MB'));
    }
    final bytes = await file.readAsBytes();
    final url = await library.upload(id, bytes);
    if (!current || unavailable) return;
    _insert('![${tr('图片')}]($url)');
  }

  Future<void> _compare() async {
    final shown = Map<String, dynamic>.from(snapshot);
    final take = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) {
        meetingDialog = ModalRoute.of(ctx);
        return SafeArea(
          child: FractionallySizedBox(
            heightFactor: .78,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(tr('同步笔记'), style: Theme.of(ctx).textTheme.titleLarge),
                  const SizedBox(height: 14),
                  Expanded(
                    child: ListView(
                      children: [
                        for (final pair in [
                          (tr('电脑版本'), shown['notes']?.toString() ?? ''),
                          (tr('手机草稿'), draft.text),
                        ]) ...[
                          Text(
                            pair.$1,
                            style: Theme.of(ctx).textTheme.labelMedium,
                          ),
                          Padding(
                            padding: const EdgeInsets.only(top: 8, bottom: 20),
                            child: SelectableText(
                              pair.$2.isEmpty ? '—' : pair.$2,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => Navigator.pop(ctx, false),
                          child: Text(tr('保留手机草稿')),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: FilledButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: Text(tr('使用电脑版本')),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
    meetingDialog = null;
    if (take == null || !current || unavailable) return;
    setState(() {
      draft.resolve(shown, keepLocal: !take);
      editor.text = draft.text;
    });
    await _save();
  }

  Future<void> _process(String action) async {
    final summary = action == 'summary';
    final approved = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        meetingDialog = ModalRoute.of(ctx);
        return AlertDialog(
          title: Text(tr(summary ? '生成会议纪要' : '会后精修')),
          content: Text(
            tr(
              summary
                  ? '电脑将使用已配置的模型整理会议。使用在线模型时，相关文字会发送给所选服务商。'
                  : '电脑将重新处理这场会议的录音，完成后会同步逐字稿。',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text(tr('取消')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(tr('开始处理')),
            ),
          ],
        );
      },
    );
    meetingDialog = null;
    if (approved != true || !current || unavailable) return;
    // 如果服务器已接单但响应丢失，下一次点击仍携带同一请求 id。
    final requestId = requestIds.putIfAbsent(action, () => Uuid().v4());
    await library.process(id, action, requestId);
    requestIds.remove(action);
    await _refresh();
  }

  Future<void> _seek(int ms) async {
    if (!current || unavailable) return;
    if (snapshot['has_audio'] != true) {
      final match = segments.where((s) => s['start_ms'] == ms).firstOrNull;
      if (match != null) {
        setState(() {
          section = _Section.transcript;
          _selectedMs = ms;
        });
      }
      return;
    }
    await _action(() async {
      final audio = player ??= AudioPlayer();
      if (!audioReady) {
        final file = await library.audio(id);
        if (!current || unavailable) return;
        await audio.setFilePath(file.path);
        audioReady = true;
      }
      if (!current || unavailable) return;
      await audio.seek(Duration(milliseconds: ms));
      unawaited(
        audio.play().catchError((Object e) {
          if (mounted && current && !unavailable) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(SnackBar(content: Text(e.toString())));
          }
        }),
      );
    });
  }

  int? _selectedMs;
  @override
  void dispose() {
    widget.model.removeListener(_libraryChanged);
    poll?.cancel();
    autosave?.cancel();
    if (!unavailable && draft.revision != null) unawaited(_save());
    unawaited(player?.dispose());
    editor.dispose();
    transcriptScroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    if (unavailable) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(child: Text(tr('这场会议已停止共享'))),
      );
    }
    final header = library.meetings.where((m) => m['id'] == id).firstOrNull;
    final shown = ended
        ? [
            _Section.summary,
            _Section.evidence,
            _Section.notes,
            _Section.transcript,
          ]
        : [_Section.transcript, _Section.notes];
    return Scaffold(
      appBar: AppBar(
        title: Text(tr('电脑上的会议')),
        actions: [
          if (ended)
            MeetingExportButton(
              snapshot: {...snapshot, 'notes': draft.text},
              imageBytes: (name) => library.image(id, name),
              documentFile: online
                  ? (content, format) => library.document(id, content, format)
                  : null,
              documentNotesCurrent: draft.text == snapshot['notes'],
              audioFile: snapshot['has_audio'] == true
                  ? () => library.audio(id)
                  : null,
            ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (MediaQuery.viewInsetsOf(context).bottom == 0)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      snapshot['title'] ?? header?['title'] ?? tr('会议'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        BreviaIcon(
                          Icons.computer,
                          size: 15,
                          color: c.onSurfaceVariant,
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            library.connection.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        if (snapshot.isNotEmpty) ...[
                          const SizedBox(width: 10),
                          Icon(
                            Icons.circle,
                            size: 7,
                            color: !ended && snapshot['state'] == 'recording'
                                ? c.error
                                : c.outline,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            tr(
                              ended
                                  ? '已结束'
                                  : snapshot['state'] == 'paused'
                                  ? '已暂停'
                                  : '正在录制',
                            ),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            if (snapshot.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: BreviaTabs(
                  entries: [
                    for (final s in shown)
                      (
                        s.index,
                        tr(
                          s == _Section.transcript
                              ? '逐字稿'
                              : s == _Section.notes
                              ? '笔记'
                              : s == _Section.evidence
                              ? '鱼骨图'
                              : '会议纪要',
                        ),
                      ),
                  ],
                  selected: section.index,
                  onSelect: (i) => setState(() {
                    section = _Section.values[i];
                    _selectedMs = null;
                  }),
                ),
              ),
            if (error != null)
              ListTile(
                dense: true,
                leading: const BreviaIcon(Icons.wifi_off, size: 18),
                title: Text(error!),
                trailing: TextButton(
                  onPressed: _refresh,
                  child: Text(tr('重试')),
                ),
              ),
            if (processing || snapshot['task']?['state'] == 'failed')
              ListTile(
                dense: true,
                leading: processing
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const BreviaIcon(Icons.error_outline, size: 18),
                title: Text(
                  processing
                      ? tr('电脑正在处理')
                      : remoteError(
                          snapshot['task']?['error']?.toString() ?? '',
                        ),
                ),
              ),
            if (remoteChanged)
              ListTile(
                dense: true,
                leading: const BreviaIcon(Icons.sync, size: 18),
                title: Text(tr('电脑笔记已更新')),
                trailing: TextButton(
                  onPressed: _compare,
                  child: Text(tr('查看更新')),
                ),
              ),
            Expanded(
              child: snapshot.isEmpty
                  ? Center(
                      child: loading
                          ? const CircularProgressIndicator()
                          : const SizedBox.shrink(),
                    )
                  : switch (section) {
                      _Section.notes => _notes(context),
                      _Section.transcript => _transcript(context),
                      _Section.summary => _summary(context),
                      _Section.evidence => ListView(
                        padding: const EdgeInsets.all(20),
                        children: [
                          MeetingEvidenceTree(
                            snapshot: snapshot,
                            onSeek: _seek,
                          ),
                        ],
                      ),
                    },
            ),
            if (ended && snapshot['has_audio'] == true)
              StreamBuilder<PlayerState>(
                stream: player?.playerStateStream,
                builder: (context, s) {
                  final playing =
                      s.data?.playing == true &&
                      s.data?.processingState != ProcessingState.completed;
                  return ListTile(
                    dense: true,
                    leading: const BreviaIcon(Icons.graphic_eq),
                    title: Text(tr('会议录音')),
                    trailing: IconButton(
                      tooltip: tr(playing ? '暂停' : '播放'),
                      icon: BreviaIcon(
                        playing ? Icons.pause : Icons.play_arrow,
                      ),
                      onPressed: busy
                          ? null
                          : () {
                              if (playing) {
                                player?.pause();
                              } else {
                                _seek(
                                  s.data?.processingState ==
                                          ProcessingState.completed
                                      ? 0
                                      : player?.position.inMilliseconds ?? 0,
                                );
                              }
                            },
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }

  Widget _markdown(String content) => MarkdownBody(
    data: content,
    selectable: true,
    onTapLink: (text, href, title) {
      final link = RegExp(
        r'^#brevia-highlight-([0-9]+)$',
      ).firstMatch(href ?? '');
      if (link != null) _seek(int.parse(link[1]!));
    },
    sizedImageBuilder: (image) => MeetingNoteImage(
      key: ValueKey(image.uri),
      id: id,
      uri: image.uri,
      alt: image.alt,
      load: (name) => library.image(id, name),
    ),
  );

  Widget _notes(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: Row(
          children: [
            IconButton(
              tooltip: tr(editing ? '预览' : '编辑'),
              onPressed: () => setState(() => editing = !editing),
              icon: BreviaIcon(
                editing ? Icons.visibility_outlined : Icons.edit_outlined,
                size: 20,
              ),
            ),
            IconButton(
              tooltip: tr('插入图片'),
              onPressed: busy || !online ? null : () => _action(_pickImage),
              icon: const BreviaIcon(Icons.image_outlined, size: 20),
            ),
            const Spacer(),
            if (pending)
              Text(tr('等待电脑确认'), style: Theme.of(context).textTheme.labelMedium)
            else if (draft.dirty || draft.proposalId != null)
              FilledButton(
                onPressed: busy || !online ? null : () => _action(_send),
                child: Text(tr('发送至电脑')),
              ),
          ],
        ),
      ),
      Expanded(
        child: editing
            ? Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: TextField(
                  controller: editor,
                  onChanged: _change,
                  expands: true,
                  minLines: null,
                  maxLines: null,
                  textAlignVertical: TextAlignVertical.top,
                  keyboardType: TextInputType.multiline,
                  decoration: InputDecoration(
                    border: InputBorder.none,
                    hintText: tr('写笔记…'),
                  ),
                ),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
                children: [
                  if (draft.text.isEmpty)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: () => setState(() => editing = true),
                        icon: const BreviaIcon(Icons.edit_outlined, size: 16),
                        label: Text(tr('写笔记…')),
                      ),
                    )
                  else
                    _markdown(draft.text),
                ],
              ),
      ),
    ],
  );

  Widget _transcript(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final shown = _selectedMs == null
        ? segments
        : segments.where((s) => s['start_ms'] == _selectedMs).toList();
    return Column(
      children: [
        if (ended)
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: TextButton.icon(
                icon: const BreviaIcon(Icons.tune, size: 17),
                label: Text(tr('会后精修')),
                onPressed: processing || busy || !online
                    ? null
                    : () => _action(() => _process('refine')),
              ),
            ),
          ),
        if (_selectedMs != null)
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(left: 20, top: 8),
              child: InputChip(
                label: Text(_time(_selectedMs!)),
                onDeleted: () => setState(() => _selectedMs = null),
              ),
            ),
          ),
        Expanded(
          child: shown.isEmpty
              ? Center(child: Text(tr('暂无字幕')))
              : ListView.builder(
                  controller: transcriptScroll,
                  reverse: !ended,
                  padding: const EdgeInsets.fromLTRB(20, 10, 12, 12),
                  itemCount: shown.length,
                  itemBuilder: (ctx, i) {
                    final segment =
                        shown[ended ? i : shown.length - 1 - i] as Map;
                    final ms = (segment['start_ms'] as num? ?? 0).toInt();
                    final content = segment['text']?.toString() ?? '';
                    final speaker =
                        segment['speaker_name'] ?? segment['speaker'];
                    final mark =
                        '> [${_time(ms)}](#brevia-highlight-$ms) ${content.replaceAll(RegExp(r'[\r\n]+'), ' ').trim()}';
                    return Container(
                      color: _selectedMs == ms
                          ? c.surfaceContainerHighest
                          : null,
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  [
                                    _time(ms),
                                    if (speaker != null &&
                                        speaker.toString().isNotEmpty)
                                      speaker,
                                  ].join('  ·  '),
                                  style: Theme.of(ctx).textTheme.labelSmall
                                      ?.copyWith(color: c.onSurfaceVariant),
                                ),
                                const SizedBox(height: 4),
                                SelectableText(
                                  content,
                                  style: Theme.of(ctx).textTheme.bodyLarge,
                                ),
                                if (segment['translation'] is String &&
                                    segment['translation'].isNotEmpty)
                                  Text(
                                    segment['translation'],
                                    style: TextStyle(color: c.onSurfaceVariant),
                                  ),
                              ],
                            ),
                          ),
                          IconButton(
                            tooltip: tr('标记到笔记'),
                            onPressed:
                                content.isEmpty || draft.text.contains(mark)
                                ? null
                                : () => _insert(mark, append: true),
                            icon: BreviaIcon(
                              draft.text.contains(mark)
                                  ? Icons.bookmark
                                  : Icons.bookmark_border,
                              size: 18,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _summary(BuildContext context) {
    final summary = meetingSummaryMarkdown(snapshot);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            icon: const BreviaIcon(Icons.auto_awesome, size: 17),
            label: Text(tr(summary.isEmpty ? '生成会议纪要' : '重新生成纪要')),
            onPressed: busy || processing || !online
                ? null
                : () => _action(() => _process('summary')),
          ),
        ),
        if (summary.isNotEmpty) _markdown(summary),
      ],
    );
  }
}
