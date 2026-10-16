import 'design_icons.dart';

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'i18n.dart';

import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:just_audio/just_audio.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:share_plus/share_plus.dart';
import 'package:uuid/uuid.dart';

import 'app_model.dart';
import 'app_update.dart';
import 'connection.dart';
import 'recorder.dart';
import 'storage.dart';
import 'startup.dart';
import 'swipe_delete.dart';
import 'design_system.dart';
import 'recording_controls.dart';
import 'onboarding.dart';
import 'pairing_illustration.dart';
import 'mobile_errors.dart';
export 'design_system.dart' show breviaTheme;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final model = AppModel();
  runApp(BreviaApp(model: model, initialize: model.initialize));
}

class BreviaApp extends StatelessWidget {
  final AppModel model;
  final Future<void> Function()? initialize;
  const BreviaApp({super.key, required this.model, this.initialize});
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (_, _) => MaterialApp(
      title: 'Brevia',
      locale: Locale(languageCode),
      supportedLocales: languageNames.keys.map(Locale.new).toList(),
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      debugShowCheckedModeBanner: false,
      theme: breviaTheme(Brightness.light),
      darkTheme: breviaTheme(Brightness.dark),
      themeAnimationDuration: Duration(milliseconds: 180),
      themeMode: model.appearance == 'light'
          ? ThemeMode.light
          : model.appearance == 'dark'
          ? ThemeMode.dark
          : ThemeMode.system,
      home: initialize == null
          ? Home(model: model)
          : Startup(
              initialize: initialize!,
              child: OnboardingGate(
                model: model,
                pairingBuilder: (onConnected) => ConnectionPage(
                  model: model,
                  onConnected: onConnected,
                  initialScan: true,
                ),
                child: Home(model: model),
              ),
            ),
    ),
  );
}

Future<void> report(
  BuildContext context,
  Future<void> Function() action, {
  AppModel? model,
}) async {
  try {
    await action();
  } catch (e) {
    if (context.mounted) {
      final kind = mobileErrorKind(e);
      if (kind == MobileErrorKind.microphone ||
          kind == MobileErrorKind.storageFull) {
        final currentModel =
            model ?? context.findAncestorWidgetOfExactType<BreviaApp>()?.model;
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (ctx) => MobileRecoveryPage(
              kind: kind!,
              savedSamples: kind == MobileErrorKind.storageFull
                  ? (currentModel?.live?['samples'] ?? 0)
                  : 0,
              onPrimary: () {
                if (kind == MobileErrorKind.microphone ||
                    currentModel == null) {
                  openAppSettings();
                } else {
                  if ((currentModel.live?['samples'] as num? ?? 0) > 0) {
                    exportSavedRecording(
                      ctx,
                      currentModel,
                      currentModel.live!['id'],
                    );
                  } else {
                    SettingsPage(model: currentModel).storagePage(ctx);
                  }
                }
              },
              onSecondary:
                  kind == MobileErrorKind.storageFull &&
                      currentModel?.live != null &&
                      (currentModel!.live!['samples'] as num? ?? 0) > 0
                  ? () => SettingsPage(model: currentModel).storagePage(ctx)
                  : null,
            ),
          ),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), duration: Duration(seconds: 6)),
      );
    }
  }
}

Future<void> exportSavedRecording(
  BuildContext context,
  AppModel model,
  String id,
) => report(context, () async {
  final m = model.meeting(id);
  if (m == null || !['ended', 'interrupted', 'paused'].contains(m['state'])) {
    throw StateError(tr('请先结束录音再导出'));
  }
  final root = await recordingsRoot();
  final store = await RecordingStore.load(Directory('${root.path}/$id'));
  final wav = await store.wav(await getTemporaryDirectory());
  if (!context.mounted) return;
  final box = context.findRenderObject() as RenderBox?;
  await SharePlus.instance.share(
    ShareParams(
      files: [XFile(wav.path)],
      sharePositionOrigin: box == null
          ? null
          : box.localToGlobal(Offset.zero) & box.size,
    ),
  );
}, model: model);

Future<bool> confirmMobileAction(
  BuildContext context,
  String title,
  String description,
  String confirm, {
  bool danger = false,
}) async =>
    await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title, style: Theme.of(ctx).textTheme.headlineSmall),
              const SizedBox(height: 16),
              Text(description),
              const SizedBox(height: 24),
              OutlinedButton(
                autofocus: true,
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(tr('取消')),
              ),
              const SizedBox(height: 12),
              FilledButton(
                style: danger
                    ? FilledButton.styleFrom(
                        backgroundColor: Theme.of(ctx).colorScheme.error,
                        foregroundColor: Theme.of(ctx).colorScheme.onError,
                      )
                    : null,
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(confirm),
              ),
            ],
          ),
        ),
      ),
    ) ==
    true;

Future<bool> deleteLocalMeeting(
  BuildContext context,
  AppModel model,
  String id,
) async {
  if (!await confirmMobileAction(
        context,
        tr('删除本机记录？'),
        '${model.meeting(id)?['title'] ?? ''}\n\n${tr('这会删除手机上的录音与本机记录，不会删除电脑上的副本。')}',
        tr('删除本机记录'),
        danger: true,
      ) ||
      !context.mounted) {
    return false;
  }
  var deleted = false;
  await report(context, () async {
    await model.deleteMeeting(id);
    deleted = true;
  });
  return deleted;
}

Future<void> uploadRecording(BuildContext context, AppModel model, String id) =>
    report(context, () async {
      if (model.desktop == null) {
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (ctx) => Scaffold(
              appBar: AppBar(title: Text(tr("连接电脑"))),
              body: SafeArea(
                child: ConnectionPage(
                  model: model,
                  onConnected: () => Navigator.pop(ctx),
                ),
              ),
            ),
          ),
        );
      }
      if (!context.mounted || model.desktop == null) return;
      final options = Map<String, dynamic>.from(
        await model.desktop!.call('GET', '/options'),
      );
      if (!context.mounted) return;
      final settings = await Navigator.push<Map<String, dynamic>>(
        context,
        MaterialPageRoute(
          builder: (_) => PrepareMeetingPage(
            options: options,
            computer: model.desktop!.name,
            initial: model.meeting(id) ?? {},
            upload: true,
          ),
        ),
      );
      if (settings == null || !context.mounted) return;
      settings.remove('offline');
      await model.upload(id, settings);
    });

class Home extends StatefulWidget {
  final AppModel model;
  const Home({super.key, required this.model});
  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  int tab = 0;
  String query = '';
  String? openedDesktopMeeting;
  AppModel get model => widget.model;
  @override
  void initState() {
    super.initState();
    model.addListener(openDesktopRecording);
    openDesktopRecording();
  }

  @override
  void didUpdateWidget(Home oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.model != model) {
      oldWidget.model.removeListener(openDesktopRecording);
      model.addListener(openDesktopRecording);
      openedDesktopMeeting = null;
      openDesktopRecording();
    }
  }

  bool notifiedMicrophoneSelection = false;

  void openDesktopRecording() {
    if (model.desktopMicrophoneSelected && !notifiedMicrophoneSelection) {
      notifiedMicrophoneSelection = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && model.desktopMicrophoneSelected) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(tr('电脑已选择此手机为声源')),
              duration: const Duration(seconds: 6),
            ),
          );
        }
      });
    } else if (!model.desktopMicrophoneSelected) {
      notifiedMicrophoneSelection = false;
    }
    final live = model.live;
    if (!model.foreground ||
        model.busy ||
        live?['desktopCapture'] != true ||
        live?['state'] == 'ended' ||
        live?['id'] == openedDesktopMeeting) {
      return;
    }
    final id = live!['id'] as String;
    openedDesktopMeeting = id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted &&
          model.live?['id'] == id &&
          model.live?['state'] != 'ended' &&
          model.viewedMeetingId != id) {
        openMeeting(id);
      }
    });
  }

  @override
  void dispose() {
    model.removeListener(openDesktopRecording);
    super.dispose();
  }

  void openMeeting(String id) => Navigator.push(
    context,
    MaterialPageRoute(
      builder: (_) => MeetingPage(model: model, id: id),
    ),
  );
  Future<void> prepare() async {
    final active = model.live;
    if (active != null && active['state'] != 'ended') {
      openMeeting(active['id']);
      return;
    }
    await report(context, () async {
      Map<String, dynamic> options = {};
      if (model.desktop != null && model.connected) {
        try {
          options = Map<String, dynamic>.from(
            await model.desktop!.call('GET', '/options'),
          );
        } catch (_) {
          /* 电脑不可达时仍可准备本地录音。 */
        }
      }
      if (!mounted) return;
      final settings = await Navigator.push<Map<String, dynamic>>(
        context,
        MaterialPageRoute(
          builder: (_) => PrepareMeetingPage(
            options: options,
            computer: model.desktop?.name ?? '',
          ),
        ),
      );
      if (settings == null || !mounted) return;
      final id = await model.start(
        settings.remove('title'),
        offline: settings.remove('offline') == true,
        settings: settings,
      );
      if (mounted) openMeeting(id);
    });
  }

  Future<void> deleteRecord(Map<String, dynamic> m) async {
    await deleteLocalMeeting(context, model, m['id']);
  }

  Future<void> meetingMenu(Map<String, dynamic> m) async {
    final ready = m['state'] == 'ended' && m['finished'] == true;
    final online =
        ready &&
        m['desktopCapture'] != true &&
        model.connected &&
        m['computer'] == model.desktop?.fingerprint;
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          padding: EdgeInsets.fromLTRB(24, 0, 24, 16),
          shrinkWrap: true,
          children: [
            ListTile(
              title: Text(m['title']),
              subtitle: Text(
                m['snapshot']?['task']?['state'] == 'failed'
                    ? remoteError(m['snapshot']['task']['error'] ?? '')
                    : ready
                    ? tr("会议操作")
                    : tr("结束录音并同步后可操作"),
              ),
            ),
            Divider(height: 1),
            if (m['state'] == 'ended' && m['localOnly'] == true)
              ListTile(
                leading: BreviaIcon(Icons.upload_outlined),
                title: Text(tr('上传到电脑')),
                enabled: !model.busy,
                onTap: () => Navigator.pop(ctx, 'upload'),
              ),
            ListTile(
              leading: BreviaIcon(Icons.auto_fix_high_outlined),
              title: Text(tr("重新精修")),
              enabled: online,
              onTap: () => Navigator.pop(ctx, 'refine'),
            ),
            ListTile(
              leading: BreviaIcon(Icons.translate),
              title: Text(tr("翻译")),
              enabled: online,
              onTap: () => Navigator.pop(ctx, 'translate'),
            ),
            ListTile(
              leading: BreviaIcon(Icons.drive_file_move_outline),
              title: Text(tr("移动到工作区")),
              enabled: online,
              onTap: () => Navigator.pop(ctx, 'workspace'),
            ),
            if (ready && !online)
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                child: Text(tr("连接原电脑后，可精修、翻译和移动会议。")),
              ),
            Divider(height: 1),
            ListTile(
              leading: BreviaIcon(
                Icons.delete_outline,
                color: Theme.of(ctx).colorScheme.error,
              ),
              title: Text(tr("删除本机记录")),
              enabled:
                  ready ||
                  (m['state'] == 'ended' &&
                      (m['remoteDeleted'] == true || m['localOnly'] == true)),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'upload') {
      await uploadRecording(context, model, m['id']);
      return;
    }
    if (action == 'delete') {
      await deleteRecord(m);
      return;
    }
    await report(context, () async {
      String? selection;
      if (action == 'workspace' || action == 'translate') {
        Map<String, String> choices;
        if (action == 'workspace') {
          final options = await model.desktop!.call('GET', '/options');
          choices = {
            '': tr("未分区"),
            for (final w in options['workspaces'])
              w['id'] as String: w['name'] as String,
          };
        } else {
          choices = Map.from(_PrepareMeetingPageState.languages)
            ..remove('auto');
        }
        if (!mounted) return;
        selection = await showModalBottomSheet<String>(
          context: context,
          showDragHandle: true,
          isScrollControlled: true,
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * .85,
          ),
          builder: (ctx) => SafeArea(
            child: ListView(
              padding: EdgeInsets.fromLTRB(24, 0, 24, 16),
              shrinkWrap: true,
              children: [
                ListTile(
                  title: Text(
                    action == 'workspace' ? tr("移动到工作区") : tr("选择翻译语言"),
                  ),
                  subtitle: action == 'translate'
                      ? Text(tr("使用电脑上的翻译模型处理字幕"))
                      : null,
                ),
                for (final entry in choices.entries)
                  ListTile(
                    title: Text(entry.value),
                    onTap: () => Navigator.pop(ctx, entry.key),
                  ),
              ],
            ),
          ),
        );
        if (selection == null || !mounted) return;
      }
      if (action == 'refine') {
        final yes = await confirmMobileAction(
          context,
          tr('重新精修会议？'),
          tr('电脑将使用已有录音重新生成字幕，当前字幕可能被替换。'),
          tr('重新精修'),
        );
        if (!yes || !mounted) return;
      }
      await model.meetingAction(
        m['id'],
        action,
        workspace: selection == '' ? null : selection,
        target: selection,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(action == 'workspace' ? tr("已移动会议") : tr("已提交到电脑处理")),
          ),
        );
      }
    });
  }

  Widget library() {
    final values = model.meetings
        .where(
          (m) => '${m['title']} ${m['snapshot']?['notes'] ?? ''}'
              .toLowerCase()
              .contains(query.toLowerCase()),
        )
        .toList();
    final dayCounts = <DateTime, int>{};
    for (final meeting in values) {
      final date = DateTime.tryParse(meeting['created'] ?? '')?.toLocal();
      if (date != null) {
        final day = DateTime(date.year, date.month, date.day);
        dayCounts.update(day, (count) => count + 1, ifAbsent: () => 1);
      }
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(tr('会议'), style: Theme.of(context).textTheme.headlineLarge),
              const SizedBox(height: 8),
              Text(
                tr('所有对话，清晰归档。'),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: TextField(
            onChanged: (v) => setState(() => query = v),
            decoration: InputDecoration(
              hintText: tr("搜索本机会议"),
              hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              fillColor: Theme.of(context).colorScheme.surfaceContainer,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide.none,
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide.none,
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide.none,
              ),
              contentPadding: EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 12,
              ),
              constraints: BoxConstraints(minHeight: 48),
              prefixIcon: BreviaIcon(Icons.search),
              isDense: true,
            ),
          ),
        ),
        SizedBox(height: 16),
        Expanded(
          child: values.isEmpty
              ? Center(
                  child: SingleChildScrollView(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          BreviaIcon(
                            Icons.article_outlined,
                            size: 40,
                            color: Theme.of(
                              context,
                            ).colorScheme.onSurfaceVariant,
                          ),
                          SizedBox(height: 16),
                          Text(
                            query.isEmpty ? tr("还没有会议记录") : tr("没有找到会议"),
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          SizedBox(height: 12),
                          Text(
                            tr("手机录音，电脑转写。\n转写和笔记会回到这里。"),
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: model.refresh,
                  child: ListView.separated(
                    padding: EdgeInsets.symmetric(horizontal: 24),
                    itemCount: values.length,
                    separatorBuilder: (_, _) => Divider(height: 1),
                    itemBuilder: (_, i) {
                      final m = model.meeting(values[i]['id']) ?? values[i];
                      final state = m['state'];
                      final task = m['snapshot']?['task'];
                      final label = m['localOnly'] == true && state == 'ended'
                          ? tr('仅保存在手机')
                          : m['remoteDeleted'] == true
                          ? tr('会议已在电脑永久删除')
                          : task?['state'] == 'running'
                          ? tr("电脑处理中")
                          : task?['state'] == 'failed'
                          ? tr("处理失败 · 长按重试")
                          : state == 'recording'
                          ? tr("正在录音")
                          : state != 'ended'
                          ? tr("未完成 · 点此恢复")
                          : m['finished'] == true
                          ? tr("已同步")
                          : tr("等待补传或电脑处理");
                      final date = DateTime.tryParse(
                        m['created'] ?? '',
                      )?.toLocal();
                      final previous = i == 0
                          ? null
                          : DateTime.tryParse(
                              values[i - 1]['created'] ?? '',
                            )?.toLocal();
                      final today = DateTime.now();
                      String dayLabel(DateTime d) {
                        final days = DateTime(
                          today.year,
                          today.month,
                          today.day,
                        ).difference(DateTime(d.year, d.month, d.day)).inDays;
                        return days == 0
                            ? tr("今天")
                            : days == 1
                            ? tr("昨天")
                            : tr("{0}月{1}日", [d.month, d.day]);
                      }

                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (date != null &&
                              (previous == null ||
                                  dayLabel(date) != dayLabel(previous)))
                            Padding(
                              padding: EdgeInsets.only(top: 8, bottom: 12),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      dayLabel(date),
                                      style: const TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                  Text(
                                    tr('{0} 场', [
                                      dayCounts[DateTime(
                                        date.year,
                                        date.month,
                                        date.day,
                                      )]!,
                                    ]),
                                    style: Theme.of(
                                      context,
                                    ).textTheme.bodySmall,
                                  ),
                                ],
                              ),
                            ),
                          SwipeDelete(
                            key: ValueKey(m['id']),
                            enabled:
                                m['finished'] == true ||
                                (m['state'] == 'ended' &&
                                    (m['remoteDeleted'] == true ||
                                        m['localOnly'] == true)),
                            onDelete: () => deleteRecord(m),
                            child: ListTile(
                              leading: Container(
                                width: 48,
                                height: 48,
                                decoration: BoxDecoration(
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.surfaceContainer,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: BreviaIcon(
                                  Icons.description_outlined,
                                  size: 24,
                                ),
                              ),
                              contentPadding: EdgeInsets.zero,
                              minVerticalPadding: 12,
                              title: Text(
                                m['title'],
                                style: TextStyle(fontWeight: FontWeight.w600),
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const SizedBox(height: 4),
                                  Text(
                                    [
                                      if (date != null)
                                        '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}',
                                      durationText(m['samples'] ?? 0),
                                    ].join(' · '),
                                  ),
                                  const SizedBox(height: 6),
                                  Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const BreviaIcon(
                                        Icons.phone_iphone_outlined,
                                        size: 16,
                                      ),
                                      const SizedBox(width: 4),
                                      Flexible(child: Text(tr('手机录音'))),
                                      const SizedBox(width: 8),
                                      Padding(
                                        padding: const EdgeInsets.only(top: 6),
                                        child: BreviaIcon(
                                          Icons.circle,
                                          size: 6,
                                          color: m['finished'] == true
                                              ? (Theme.of(context).brightness ==
                                                        Brightness.dark
                                                    ? const Color(0xff80c99a)
                                                    : const Color(0xff16812e))
                                              : Theme.of(
                                                  context,
                                                ).colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Text(
                                          label,
                                          style: TextStyle(
                                            color: m['finished'] == true
                                                ? const Color(0xff16812e)
                                                : null,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                              trailing: const BreviaIcon(
                                Icons.chevron_right,
                                size: 20,
                              ),
                              onTap: () => openMeeting(m['id']),
                              onLongPress: () => meetingMenu(m),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(color: Theme.of(context).dividerColor, width: .5),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              minTileHeight: 48,
              minVerticalPadding: 8,
              leading: const BreviaIcon(Icons.laptop_outlined, size: 22),
              title: model.desktop == null
                  ? Text(
                      tr('连接电脑'),
                      style: Theme.of(context).textTheme.bodySmall,
                    )
                  : Row(
                      children: [
                        BreviaIcon(
                          Icons.circle,
                          size: 6,
                          color: model.connected
                              ? (Theme.of(context).brightness == Brightness.dark
                                    ? const Color(0xff80c99a)
                                    : const Color(0xff16812e))
                              : Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            model.desktop!.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          tr(model.connected ? '已连接' : '离线'),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
              trailing: const BreviaIcon(Icons.chevron_right, size: 18),
              onTap: () => setState(() => tab = 1),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
          child: SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: model.busy ? null : prepare,
              icon: const BreviaIcon(Icons.add, size: 20),
              label: Text(model.busy ? tr('正在准备…') : tr('新建录音')),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (_, _) => Scaffold(
      appBar: tab == 1 && !model.desktopMicrophoneSelected
          ? null
          : AppBar(
              centerTitle: false,
              titleSpacing: 24,
              toolbarHeight: 48,
              title: breviaBrand(),
              actions: [
                if (tab == 0)
                  IconButton.filled(
                    tooltip: tr('新建录音'),
                    onPressed: model.busy ? null : prepare,
                    style: IconButton.styleFrom(
                      foregroundColor: Theme.of(context).colorScheme.onPrimary,
                      minimumSize: const Size(32, 32),
                      fixedSize: const Size(32, 32),
                      padding: const EdgeInsets.all(6),
                      tapTargetSize: MaterialTapTargetSize.padded,
                    ),
                    icon: const BreviaIcon(Icons.add, size: 20),
                  ),
                const SizedBox(width: 16),
              ],
            ),
      body: SafeArea(
        child: AnimatedSwitcher(
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : Duration(milliseconds: 180),
          switchInCurve: Curves.easeOut,
          child: KeyedSubtree(
            key: ValueKey(tab),
            child: tab == 0
                ? library()
                : tab == 1
                ? ConnectionPage(model: model)
                : SettingsPage(model: model),
          ),
        ),
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(color: Theme.of(context).dividerColor, width: .5),
          ),
        ),
        child: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (v) => setState(() => tab = v),
          destinations: [
            NavigationDestination(
              icon: BreviaIcon(Icons.article_outlined),
              selectedIcon: BreviaIcon(Icons.article),
              label: tr("会议"),
            ),
            NavigationDestination(
              icon: BreviaIcon(Icons.link_outlined),
              label: tr("连接"),
            ),
            NavigationDestination(
              icon: BreviaIcon(Icons.settings_outlined),
              selectedIcon: BreviaIcon(Icons.settings),
              label: tr("设置"),
            ),
          ],
        ),
      ),
    ),
  );
}

class ConnectionPage extends StatefulWidget {
  final AppModel model;
  final VoidCallback? onConnected;
  final bool initialScan;
  const ConnectionPage({
    super.key,
    required this.model,
    this.onConnected,
    this.initialScan = false,
  });
  @override
  State<ConnectionPage> createState() => _ConnectionPageState();
}

class _ConnectionPageState extends State<ConnectionPage> {
  final address = TextEditingController();
  final pin = TextEditingController();
  bool loading = false, manual = false;
  String? verification, result;

  @override
  void initState() {
    super.initState();
    if (widget.initialScan) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) scan();
      });
    }
  }

  Future<void> pair({Map<String, dynamic>? qr}) async {
    setState(() {
      loading = true;
      result = null;
      verification = null;
    });
    try {
      final endpoint = DesktopConnection.endpoint(
        qr?['address'] ?? address.text.trim(),
      );
      final expected = qr?['fingerprint'] as String? ?? '';
      if (qr != null &&
          (qr['v'] != 1 || !RegExp(r'^[a-f0-9]{64}$').hasMatch(expected))) {
        throw FormatException(tr("不是有效的 Brevia 配对码"));
      }
      final previous = widget.model.desktop;
      if (previous != null) {
        try {
          await widget.model.updateAddress(endpoint.toString());
          if (mounted) {
            setState(() => result = tr("已恢复连接 {0}", [previous.name]));
            widget.onConnected?.call();
          }
          return;
        } catch (_) {
          if (widget.model.meetings.any(
            (m) =>
                m['localOnly'] != true &&
                m['finished'] != true &&
                m['remoteDeleted'] != true,
          )) {
            throw StateError(tr("请确认地址属于原电脑且连接服务已打开。未完成补传前不能更换电脑。"));
          }
        }
      }
      final candidate = DesktopConnection(
        address: endpoint.toString(),
        fingerprint: expected,
      );
      final identity = await candidate.call('GET', '/identity');
      if (identity['v'] != 1) throw FormatException(tr("电脑版协议不兼容"));
      final nonce = Uuid().v4().replaceAll('-', '');
      if (!mounted) return;
      setState(
        () => verification = sha256
            .convert(utf8.encode('${candidate.fingerprint}:$nonce'))
            .toString()
            .substring(0, 8)
            .toUpperCase(),
      );
      final response = await candidate.call('POST', '/pair', {
        'name': Platform.isIOS ? 'iPhone' : 'Android',
        'nonce': nonce,
        'code': qr?['secret'] ?? pin.text.trim(),
      });
      candidate.token = response['token'];
      candidate.name = response['name'];
      await widget.model.connect(candidate);
      if (mounted && widget.onConnected != null) {
        widget.onConnected!();
        return;
      }
      if (mounted) {
        setState(() {
          result = tr("已连接 {0}", [candidate.name]);
          verification = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          result = e.toString();
          verification = null;
          loading = false;
        });
        if (mobileErrorKind(e) == MobileErrorKind.pairingUnavailable) {
          await Navigator.push(
            context,
            MaterialPageRoute(
              builder: (ctx) => MobileRecoveryPage(
                kind: MobileErrorKind.pairingUnavailable,
                onPrimary: () {
                  Navigator.pop(ctx);
                  scan();
                },
                onSecondary: () {
                  setState(() {
                    manual = true;
                    pin.clear();
                    result = null;
                  });
                  Navigator.pop(ctx);
                },
              ),
            ),
          );
        }
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> scan() async {
    final raw = await Navigator.push<String>(
      context,
      MaterialPageRoute(builder: (_) => ScannerPage()),
    );
    if (raw == null || !mounted) return;
    if (raw == 'manual') {
      setState(() => manual = true);
      return;
    }
    await report(context, () async {
      await pair(qr: Map<String, dynamic>.from(jsonDecode(raw)));
    });
  }

  @override
  void dispose() {
    address.dispose();
    pin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.model,
    builder: (context, _) => connectionBody(context),
  );

  Widget connectionBody(BuildContext context) {
    final computer = widget.model.desktop;
    final waiting = loading && verification != null;
    if (!manual && !waiting && computer == null) {
      return LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: IntrinsicHeight(
              child: Padding(
                padding: EdgeInsets.fromLTRB(24, 24, 24, 24),
                child: Column(
                  children: [
                    breviaLogo(size: 44),
                    SizedBox(height: 16),
                    Text(
                      tr('连接电脑'),
                      style: Theme.of(context).textTheme.headlineLarge,
                    ),
                    SizedBox(height: 12),
                    Text(
                      tr("手机采集音频，电脑完成转写"),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    SizedBox(height: 56),
                    PairingIllustration(),
                    SizedBox(height: 32),
                    Text(
                      tr('让记录接着发生'),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    SizedBox(height: 12),
                    Text(
                      tr('打开电脑端 Brevia，在「设备连接」中添加手机。'),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    SizedBox(height: 32),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: loading ? null : scan,
                        icon: BreviaIcon(Icons.qr_code_scanner, size: 20),
                        label: Text(tr("扫描电脑二维码")),
                      ),
                    ),
                    SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () => setState(() => manual = true),
                        child: Text(tr("输入配对码")),
                      ),
                    ),
                    if (result != null)
                      Padding(
                        padding: EdgeInsets.only(top: 16),
                        child: Text(result!, textAlign: TextAlign.center),
                      ),
                    SizedBox(height: 28),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        BreviaIcon(
                          Icons.wifi,
                          size: 16,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                        SizedBox(width: 8),
                        Text(
                          tr("首次配对需同一 Wi-Fi"),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                    SizedBox(height: 24),
                    Spacer(),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }
    return ListView(
      padding: EdgeInsets.fromLTRB(24, 12, 24, 32),
      children: [
        if (manual && !waiting)
          Align(
            alignment: Alignment.centerLeft,
            child: IconButton(
              tooltip: tr("返回连接"),
              onPressed: loading ? null : () => setState(() => manual = false),
              icon: BreviaIcon(Icons.arrow_back_ios_new, size: 20),
            ),
          ),
        SizedBox(height: computer != null && !manual && !waiting ? 8 : 24),
        if (computer != null &&
            !manual &&
            !waiting &&
            widget.model.desktopMicrophoneSelected) ...[
          Text(
            tr('已准备作为电脑麦克风'),
            style: Theme.of(context).textTheme.headlineLarge,
          ),
          const SizedBox(height: 12),
          Text(tr('等待电脑开始录音'), style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 28),
          const Center(child: PairingIllustration()),
          const SizedBox(height: 24),
          Text(
            tr(widget.model.capturePreview != null ? '试音中，不保存录音' : '尚未开始录音'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 16),
          Center(child: MicrophoneLevel(level: widget.model.previewLevel ?? 0)),
          const SizedBox(height: 24),
          Text(tr('电脑已选择此手机为声源，开始录音后这里会显示采集状态。')),
          const SizedBox(height: 24),
        ],
        if (computer != null &&
            !manual &&
            !waiting &&
            !widget.model.desktopMicrophoneSelected) ...[
          Center(child: breviaLogo(size: 44)),
          SizedBox(height: 8),
          Text(
            tr('连接与设备'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineLarge,
          ),
          SizedBox(height: 8),
          Text(
            tr('手机采集音频，电脑完成转写'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          SizedBox(height: 12),
          SizedBox(
            height: 64,
            child: Center(child: BreviaIcon(Icons.laptop_outlined, size: 112)),
          ),
          SizedBox(height: 4),
          Text(
            computer.name,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
          ),
          SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              BreviaIcon(
                Icons.circle,
                size: 6,
                color: widget.model.connected
                    ? (Theme.of(context).brightness == Brightness.dark
                          ? const Color(0xff80c99a)
                          : const Color(0xff16812e))
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              SizedBox(width: 6),
              Flexible(
                child: Text(
                  tr(widget.model.connected ? '已连接' : '离线 · 已保留信任'),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: widget.model.connected
                        ? (Theme.of(context).brightness == Brightness.dark
                              ? const Color(0xff80c99a)
                              : const Color(0xff16812e))
                        : null,
                  ),
                ),
              ),
            ],
          ),
          if (widget.model.connected) ...[
            SizedBox(height: 4),
            Text(
              tr('同一局域网'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          SizedBox(height: 12),
        ],
        if (manual || waiting) ...[
          if (!manual || waiting) ...[
            BreviaIcon(Icons.laptop_outlined, size: 64),
            SizedBox(height: 24),
          ],
          Text(
            waiting
                ? tr("请在电脑上允许连接")
                : manual
                ? tr("手动连接")
                : computer!.name,
            textAlign: manual && !waiting ? TextAlign.start : TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          SizedBox(height: 24),
        ],
        if (waiting) ...[
          Text(tr("确认两端显示相同的校验码。"), textAlign: TextAlign.center),
          SizedBox(height: 32),
          Container(
            padding: EdgeInsets.all(32),
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).dividerColor),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                Text(tr("校验码")),
                SizedBox(height: 16),
                SelectableText(
                  verification!,
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
                SizedBox(height: 16),
                Text(tr("仅在校验码一致时允许连接"), textAlign: TextAlign.center),
              ],
            ),
          ),
          SizedBox(height: 32),
          Center(
            child: SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        ] else if (manual) ...[
          Text(
            tr(
              '在电脑 Brevia「设备连接」中显示配对码。检查同一局域网、系统权限及防火墙；访客 Wi-Fi 可能隔离设备，可尝试电脑热点。',
            ),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          SizedBox(height: 28),
          for (final entry in widget.model.nearby.entries)
            ListTile(
              leading: BreviaIcon(Icons.laptop_outlined),
              title: Text(entry.value),
              trailing: BreviaIcon(Icons.chevron_right),
              onTap: () => setState(() => address.text = entry.key),
            ),
          Text(tr('电脑的局域网地址')),
          SizedBox(height: 8),
          TextField(
            controller: address,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: InputDecoration(hintText: 'https://192.168.1.24:43187'),
          ),
          SizedBox(height: 24),
          Text(tr('6 位配对码')),
          SizedBox(height: 8),
          Semantics(
            label: tr("6 位配对码"),
            child: Stack(
              alignment: Alignment.center,
              children: [
                ExcludeSemantics(
                  child: Row(
                    children: List.generate(
                      6,
                      (i) => Expanded(
                        child: Container(
                          height: 60,
                          margin: EdgeInsets.only(right: i == 5 ? 0 : 8),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            border: Border.all(
                              color: Theme.of(context).dividerColor,
                            ),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            pin.text.length > i ? pin.text[i] : '',
                            style: TextStyle(fontSize: 26),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                TextField(
                  controller: pin,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  enableInteractiveSelection: true,
                  showCursor: false,
                  style: TextStyle(color: Colors.transparent),
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    counterText: '',
                    labelText: null,
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: 24),
          FilledButton(
            onPressed: loading || pin.text.length != 6 ? null : () => pair(),
            child: Text(loading ? tr("连接中…") : tr("连接电脑")),
          ),
          SizedBox(height: 12),
          OutlinedButton(
            onPressed: loading ? null : scan,
            child: Text(tr("改用扫码连接")),
          ),
        ] else if (computer == null) ...[
          FilledButton.icon(
            onPressed: loading ? null : scan,
            icon: BreviaIcon(Icons.qr_code_scanner, size: 20),
            label: Text(tr("扫描电脑二维码")),
          ),
          SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => setState(() => manual = true),
            child: Text(tr("输入配对码")),
          ),
          SizedBox(height: 24),
          Text(
            tr("首次配对需同一 Wi-Fi"),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ] else ...[
          if (widget.model.desktopMicrophoneSelected) ...[
            Container(
              decoration: BoxDecoration(
                border: Border.all(color: Theme.of(context).dividerColor),
                borderRadius: BorderRadius.circular(8),
              ),
              child: ListTile(
                contentPadding: EdgeInsets.symmetric(horizontal: 16),
                leading: BreviaIcon(Icons.laptop_outlined, size: 36),
                title: Text(computer.name),
                subtitle: Text(
                  widget.model.connected ? tr('● 已连接') : tr('离线 · 已保留信任'),
                ),
              ),
            ),
            SizedBox(height: 16),
          ],
          Divider(height: 1),
          ListTile(
            minTileHeight: 64,
            leading: BreviaIcon(Icons.sync),
            title: Text(tr('自动重连')),
            subtitle: Text(
              tr('录音期间断线后保留并补传'),
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(fontSize: 12),
            ),
            trailing: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 100),
              child: Text(
                tr('已开启（自动）'),
                textAlign: TextAlign.right,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(fontSize: 12),
              ),
            ),
          ),
          Divider(height: 1),
          ListTile(
            minTileHeight: 56,
            leading: BreviaIcon(Icons.qr_code_scanner),
            title: Text(tr('重新扫码连接')),
            trailing: BreviaIcon(Icons.chevron_right, size: 18),
            onTap: loading ? null : scan,
          ),
          Divider(height: 1),
          ListTile(
            minTileHeight: 56,
            leading: BreviaIcon(Icons.edit_outlined),
            title: Text(tr('更新电脑地址')),
            trailing: BreviaIcon(Icons.chevron_right, size: 18),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => UpdateComputerAddressPage(model: widget.model),
              ),
            ),
          ),
          Divider(height: 1),
          ListTile(
            minTileHeight: 56,
            leading: BreviaIcon(Icons.help_outline),
            title: Text(tr('连接帮助')),
            trailing: BreviaIcon(Icons.chevron_right, size: 18),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => ConnectionHelpPage(model: widget.model),
              ),
            ),
          ),
          Divider(height: 1),
          SizedBox(height: 8),
          Container(
            padding: EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              tr('电脑可将此手机选为录音声源；开始采集时，手机会明确提示。'),
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(fontSize: 12),
            ),
          ),
          SizedBox(height: 8),
          TextButton(
            onPressed: () async {
              final confirmed = await confirmMobileAction(
                context,
                tr('取消信任这台电脑？'),
                tr('取消后需要重新配对，手机和电脑中已保存的会议副本不会被删除。'),
                tr('取消信任此电脑'),
                danger: true,
              );
              if (confirmed && context.mounted) {
                await report(context, () => widget.model.forget());
              }
            },
            child: Text(
              tr("取消信任此电脑"),
              style: TextStyle(
                color: Theme.of(context).colorScheme.error,
                fontWeight: FontWeight.w400,
              ),
            ),
          ),
        ],
        if (result != null)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text(result!, textAlign: TextAlign.center),
          ),
        if (manual)
          ListTile(
            title: Text(tr('连接帮助')),
            trailing: BreviaIcon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => ConnectionHelpPage(model: widget.model),
              ),
            ),
          ),
      ],
    );
  }
}

class UpdateComputerAddressPage extends StatefulWidget {
  final AppModel model;
  const UpdateComputerAddressPage({super.key, required this.model});
  @override
  State<UpdateComputerAddressPage> createState() =>
      _UpdateComputerAddressPageState();
}

class _UpdateComputerAddressPageState extends State<UpdateComputerAddressPage> {
  late String address = widget.model.desktop!.address;
  bool saving = false;
  Future<void> save() async {
    if (saving) return;
    setState(() => saving = true);
    try {
      await report(context, () async {
        await widget.model.updateAddress(address.trim());
        if (mounted) Navigator.pop(context);
      }, model: widget.model);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      actions: [
        TextButton(
          onPressed: saving ? null : () => Navigator.pop(context),
          child: Text(tr('取消')),
        ),
      ],
    ),
    body: SafeArea(
      child: ListView(
        padding: EdgeInsets.all(24),
        children: [
          Text(tr('更新电脑地址'), style: Theme.of(context).textTheme.headlineSmall),
          SizedBox(height: 12),
          Text(
            tr('电脑的局域网地址变化后，可在此更新并重新连接。'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          SizedBox(height: 28),
          Container(
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerLowest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: ListTile(
              contentPadding: EdgeInsets.all(16),
              minVerticalPadding: 8,
              leading: BreviaIcon(Icons.laptop_outlined),
              title: Text(widget.model.desktop!.name),
              subtitle: Text(widget.model.desktop!.address),
            ),
          ),
          SizedBox(height: 28),
          Text(tr('新的局域网地址')),
          SizedBox(height: 8),
          TextFormField(
            initialValue: address,
            onChanged: (value) => address = value,
            keyboardType: TextInputType.url,
            autocorrect: false,
            enabled: !saving,
          ),
          SizedBox(height: 24),
          Container(
            padding: EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerLowest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                BreviaIcon(Icons.info_outline, size: 20),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    tr('更新地址不会更改已保存的会议。'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
    bottomNavigationBar: SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.all(24),
        child: FilledButton(
          onPressed: saving ? null : save,
          child: Text(tr(saving ? '连接中…' : '保存并连接')),
        ),
      ),
    ),
  );
}

class ConnectionHelpPage extends StatelessWidget {
  final AppModel model;
  const ConnectionHelpPage({super.key, required this.model});
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (_, _) => Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.all(24),
          children: [
            Text(tr('连接帮助'), style: Theme.of(context).textTheme.headlineSmall),
            SizedBox(height: 12),
            Text(
              tr('无法连接电脑时，请检查以下项目。'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            SizedBox(height: 24),
            for (final (index, item) in [
              ('手机与电脑在同一局域网', '首次配对需同一 Wi-Fi'),
              ('电脑已开启局域网权限', '在电脑系统设置中允许 Brevia 访问局域网。'),
              ('电脑 Brevia 已开启', '在电脑「设备连接」中开启手机连接服务。'),
              ('防火墙允许连接', '请允许 Brevia 在本地网络中通信。'),
            ].indexed) ...[
              ListTile(
                minVerticalPadding: 12,
                leading: CircleAvatar(
                  backgroundColor: Theme.of(
                    context,
                  ).colorScheme.surfaceContainerLowest,
                  foregroundColor: Theme.of(context).colorScheme.onSurface,
                  child: Text('${index + 1}'),
                ),
                title: Text(tr(item.$1)),
                subtitle: Text(tr(item.$2)),
              ),
              Divider(height: 1),
            ],
            SizedBox(height: 24),
            Container(
              padding: EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  BreviaIcon(Icons.info_outline, size: 20),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      tr('访客 Wi-Fi 可能隔离设备，可尝试电脑热点。'),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
            if (model.discoveryError != null) ...[
              SizedBox(height: 16),
              Text(model.discoveryError!),
            ],
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.all(24),
          child: FilledButton(
            onPressed: model.discovering
                ? null
                : () {
                    if (model.desktop != null) {
                      Navigator.pop(context);
                      return;
                    }
                    report(context, () async {
                      await model.stopDiscovery();
                      await model.discover();
                      if (context.mounted) Navigator.pop(context);
                    });
                  },
            child: Text(tr(model.desktop == null ? '重新查找电脑' : '返回连接')),
          ),
        ),
      ),
    ),
  );
}

class ScannerPage extends StatefulWidget {
  const ScannerPage({super.key});
  @override
  State<ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends State<ScannerPage> {
  bool found = false;
  final scanner = MobileScannerController();
  @override
  void dispose() {
    unawaited(scanner.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(tr('扫描电脑二维码'))),
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              tr('在电脑 Brevia 中打开「设备连接 → 连接新设备」。'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 20),
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Theme(
                  data: breviaTheme(Brightness.dark),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      MobileScanner(
                        controller: scanner,
                        errorBuilder: (_, error) => Center(
                          child: Padding(
                            padding: EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(tr("无法使用相机。可以返回并输入配对码。")),
                                TextButton(
                                  onPressed: openAppSettings,
                                  child: Text(tr("前往系统设置")),
                                ),
                              ],
                            ),
                          ),
                        ),
                        onDetect: (capture) {
                          for (final barcode in capture.barcodes) {
                            final raw = barcode.rawValue;
                            if (!found && raw != null) {
                              try {
                                final v = jsonDecode(raw);
                                if (v is Map &&
                                    v['v'] == 1 &&
                                    v['secret'] is String) {
                                  found = true;
                                  Navigator.pop(context, raw);
                                }
                              } catch (_) {}
                            }
                          }
                        },
                      ),
                      Center(
                        child: IgnorePointer(
                          child: SizedBox.square(
                            dimension: 240,
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: Colors.white,
                                  width: 2,
                                ),
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              tr('对准电脑上的二维码，将自动识别。'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 20),
            OutlinedButton(
              onPressed: () => Navigator.pop(context, 'manual'),
              child: Text(tr('改用配对码')),
            ),
          ],
        ),
      ),
    ),
  );
}

class MeetingPage extends StatefulWidget {
  final AppModel model;
  final String id;
  const MeetingPage({super.key, required this.model, required this.id});
  @override
  State<MeetingPage> createState() => _MeetingPageState();
}

class _MeetingPageState extends State<MeetingPage> {
  int tab = 0;
  String query = '';
  final scroll = ScrollController();
  bool following = true;
  bool sawDisconnected = false, showingRecovery = false;
  AudioPlayer? _player;
  AudioPlayer get player => _player ??= AudioPlayer();
  bool loadedAudio = false, loadingAudio = false;
  Map<String, dynamic> get meeting =>
      widget.model.meeting(widget.id) ?? {'title': tr("会议"), 'samples': 0};
  @override
  void initState() {
    super.initState();
    if (meeting['state'] == 'ended') tab = 1;
    widget.model.viewedMeetingId = widget.id;
    scroll.addListener(() {
      following =
          !scroll.hasClients ||
          scroll.position.maxScrollExtent - scroll.offset < 80;
    });
  }

  @override
  void dispose() {
    if (widget.model.viewedMeetingId == widget.id) {
      widget.model.viewedMeetingId = null;
    }
    scroll.dispose();
    unawaited(_player?.dispose());
    super.dispose();
  }

  bool ending = false;
  bool recordingCommandPending = false;
  Object? dismissedRecoveryError;

  Future<void> toggleRecording() async {
    if (recordingCommandPending || ending) return;
    setState(() => recordingCommandPending = true);
    try {
      await report(context, () async {
        final m = meeting;
        final active =
            widget.model.live?['id'] == widget.id &&
            (widget.model.serviceRunning || widget.model.engine != null);
        if (!active) {
          await widget.model.start(m['title'], existing: widget.id);
        } else {
          await widget.model.command(
            widget.id,
            m['state'] == 'recording' ? 'pause' : 'resume',
          );
        }
      });
    } finally {
      if (mounted) setState(() => recordingCommandPending = false);
    }
  }

  Future<void> end() async {
    if (ending) return;
    setState(() => ending = true);
    try {
      final confirmed = await showModalBottomSheet<bool>(
        context: context,
        showDragHandle: true,
        builder: (ctx) => SafeArea(
          top: false,
          child: Padding(
            padding: EdgeInsets.fromLTRB(24, 0, 24, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  tr("结束录音？"),
                  textAlign: TextAlign.center,
                  style: Theme.of(ctx).textTheme.titleLarge,
                ),
                SizedBox(height: 12),
                Text(
                  tr("录音先保存在本机，待上传内容会继续保留。"),
                  textAlign: TextAlign.center,
                  style: Theme.of(ctx).textTheme.bodySmall,
                ),
                SizedBox(height: 24),
                OutlinedButton(
                  autofocus: true,
                  onPressed: () => Navigator.pop(ctx, false),
                  child: Text(tr("继续录音")),
                ),
                SizedBox(height: 12),
                FilledButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: Text(tr("结束并保存")),
                ),
              ],
            ),
          ),
        ),
      );
      if (confirmed != true || !mounted) return;
      await report(context, () async {
        await widget.model.command(widget.id, 'end');
        if (mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (_) =>
                  SavedMeetingPage(model: widget.model, id: widget.id),
            ),
          );
        }
      });
    } finally {
      if (mounted) setState(() => ending = false);
    }
  }

  Future<void> mark() async {
    final sample =
        (widget.model.meeting(widget.id)?['samples'] as num?)?.toInt() ?? 0;
    final text = TextEditingController();
    final note = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          24,
          16,
          24,
          MediaQuery.viewInsetsOf(ctx).bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    tr("记录重点 · {0}", [durationText(sample)]),
                    style: Theme.of(ctx).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  tooltip: tr('取消'),
                  onPressed: () => Navigator.pop(ctx),
                  icon: const BreviaIcon(Icons.close, size: 20),
                ),
              ],
            ),
            SizedBox(height: 24),
            Text(tr("备注（选填）")),
            SizedBox(height: 8),
            TextField(
              controller: text,
              maxLength: 200,
              minLines: 4,
              maxLines: 6,
              decoration: InputDecoration(
                hintText: tr("记录这一刻的重要信息"),
                fillColor: Theme.of(ctx).colorScheme.surface,
              ),
            ),
            SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, text.text),
              child: Text(tr("保存重点")),
            ),
          ],
        ),
      ),
    );
    text.dispose();
    if (note != null) {
      await widget.model.command(widget.id, 'mark', note: note, sample: sample);
      HapticFeedback.selectionClick();
    }
  }

  Future<void> play({int? milliseconds}) async {
    if (loadingAudio) return;
    await report(context, () async {
      if (!loadedAudio) {
        setState(() => loadingAudio = true);
        try {
          final root = await recordingsRoot();
          final store = await RecordingStore.load(
            Directory('${root.path}/${widget.id}'),
          );
          if (store.count == 0) throw StateError(tr("本机没有音频"));
          final wav = await store.wav(await getTemporaryDirectory());
          await player.setFilePath(wav.path);
          loadedAudio = true;
        } finally {
          if (mounted) setState(() => loadingAudio = false);
        }
      }
      if (milliseconds != null) {
        await player.seek(Duration(milliseconds: milliseconds));
      }
      if (player.playing && milliseconds == null) {
        await player.pause();
      } else {
        unawaited(player.play());
      }
    });
  }

  Future<void> share() async {
    await report(context, () async {
      final m = meeting;
      final snapshot = m['snapshot'] as Map? ?? {};
      final segments = snapshot['segments'] as List? ?? [];
      final content = tab == 1
          ? (snapshot['notes'] ?? '').toString()
          : segments
                .map(
                  (s) =>
                      '${durationText((s['start_ms'] as num? ?? 0) * 16)} ${s['text']}',
                )
                .join('\n\n');
      if (content.trim().isEmpty) throw StateError(tr("暂无可分享的内容"));
      final file = File(
        '${(await getTemporaryDirectory()).path}/${widget.id}.${tab == 1 ? 'md' : 'txt'}',
      );
      await file.writeAsString(
        tr("{0}\n截至最后同步的内容\n\n{1}", [m['title'], content]),
        flush: true,
      );
      if (!mounted) return;
      final box = context.findRenderObject() as RenderBox?;
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path)],
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    });
  }

  Widget transcript(List<dynamic> segments, bool ended) {
    final list = segments
        .where((s) => (s['text'] ?? '').toString().contains(query))
        .toList();
    if (list.isEmpty) {
      return Padding(
        padding: EdgeInsets.only(top: 48),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (query.isEmpty && waitingForComputer(meeting, widget.model))
              TranscriptionActivity(meeting: meeting, model: widget.model)
            else
              Text(tr("暂无转写。电脑处理后的文字会显示在这里。")),
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ...list.map((s) {
          final name = mobileSpeakerName(s['speaker_name'] ?? s['speaker']);
          final body = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextButton(
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  alignment: Alignment.centerLeft,
                  minimumSize: Size(48, ended ? 40 : 28),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  foregroundColor: Theme.of(
                    context,
                  ).colorScheme.onSurfaceVariant,
                  disabledForegroundColor: Theme.of(
                    context,
                  ).colorScheme.onSurfaceVariant,
                ),
                onPressed: ended
                    ? () => play(
                        milliseconds: (s['start_ms'] as num? ?? 0).toInt(),
                      )
                    : null,
                child: Text(
                  ended
                      ? '$name   ${durationText((s['start_ms'] as num? ?? 0) * 16)}'
                      : durationText((s['start_ms'] as num? ?? 0) * 16),
                ),
              ),
              SelectableText(
                (s['text'] ?? '').toString(),
                style: Theme.of(
                  context,
                ).textTheme.bodyLarge?.copyWith(height: 1.5),
              ),
              if ((s['translation'] ?? '').toString().isNotEmpty)
                Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: SelectableText(
                    s['translation'],
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          );
          return Padding(
            padding: EdgeInsets.only(bottom: 16),
            child: ended
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: EdgeInsets.only(top: 4),
                        child: CircleAvatar(
                          radius: 16,
                          backgroundColor: Theme.of(
                            context,
                          ).colorScheme.surfaceContainerLowest,
                          foregroundColor: Theme.of(
                            context,
                          ).colorScheme.onSurface,
                          child: Text(name.characters.first),
                        ),
                      ),
                      SizedBox(width: 12),
                      Expanded(child: body),
                    ],
                  )
                : body,
          );
        }),
        if (query.isEmpty)
          TranscriptionActivity(meeting: meeting, model: widget.model),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.model,
    builder: (_, _) {
      final m = meeting;
      final snapshot = m['snapshot'] as Map? ?? {};
      final state = m['state'];
      final ended = state == 'ended';
      final live =
          widget.model.live?['id'] == widget.id &&
          (widget.model.serviceRunning || widget.model.engine != null);
      final recordingFocus =
          m['desktopCapture'] == true ||
          (!ended && (m['localOnly'] == true || !live));
      final darkRecording =
          !ended &&
          !recordingFocus &&
          Theme.of(context).brightness == Brightness.dark;
      final localErrorKind = mobileErrorKind(m['error'] ?? '');
      if (m['error'] == null) dismissedRecoveryError = null;
      if (!ended &&
          m['error'] != dismissedRecoveryError &&
          (localErrorKind == MobileErrorKind.storageFull ||
              localErrorKind == MobileErrorKind.microphone)) {
        return MobileRecoveryPage(
          kind: localErrorKind!,
          savedSamples: localErrorKind == MobileErrorKind.storageFull
              ? m['samples'] ?? 0
              : 0,
          onPrimary: () {
            if (localErrorKind == MobileErrorKind.microphone) {
              openAppSettings();
            } else if ((m['samples'] as num? ?? 0) > 0) {
              exportSavedRecording(context, widget.model, widget.id);
            } else {
              SettingsPage(model: widget.model).storagePage(context);
            }
          },
          onSecondary:
              localErrorKind == MobileErrorKind.storageFull &&
                  (m['samples'] as num? ?? 0) > 0
              ? () => SettingsPage(model: widget.model).storagePage(context)
              : null,
          onReturn: () => setState(() => dismissedRecoveryError = m['error']),
        );
      }
      if (!ended && m['localOnly'] != true) {
        if (m['connected'] == false) {
          sawDisconnected = true;
          showingRecovery = false;
        } else if (m['connected'] == true && sawDisconnected) {
          showingRecovery = (m['count'] as num? ?? 0) > 0;
          sawDisconnected = false;
        }
      }
      if (showingRecovery && !ended && m['localOnly'] != true) {
        return RecordingRecoveryPage(
          meeting: m,
          onReturn: () => setState(() => showingRecovery = false),
        );
      }
      final label = state == 'recording' && live
          ? tr("录音中")
          : ended
          ? tr("录音已结束")
          : state == 'starting' && live
          ? tr("正在开始")
          : tr("录音已暂停");
      if (!recordingFocus && !ended && following && tab == 0) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && scroll.hasClients) {
            scroll.jumpTo(scroll.position.maxScrollExtent);
          }
        });
      }
      return Scaffold(
        appBar: AppBar(
          centerTitle: !darkRecording,
          title: darkRecording
              ? breviaLogo()
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      m['title'] ?? tr("会议"),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (ended)
                      Text(
                        '${durationText(m["samples"] ?? 0)} · ${m["localOnly"] == true
                            ? tr("仅保存在手机")
                            : m["finished"] == true
                            ? tr("已同步")
                            : tr("待补传")}',
                        style: Theme.of(context).textTheme.bodySmall,
                      )
                    else if (!recordingFocus)
                      Text.rich(
                        TextSpan(
                          children: [
                            if (state == 'recording' && live)
                              TextSpan(
                                text: '● ',
                                style: TextStyle(color: Color(0xffff3b30)),
                              ),
                            TextSpan(
                              text:
                                  '$label · ${durationText(m['samples'] ?? 0)}',
                            ),
                          ],
                        ),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                  ],
                ),
          actions: [
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_horiz),
              tooltip: tr("会议操作"),
              onSelected: (action) async {
                if (action == 'marks') {
                  await showModalBottomSheet(
                    context: context,
                    showDragHandle: true,
                    builder: (ctx) => SafeArea(
                      child: ListView(
                        shrinkWrap: true,
                        padding: EdgeInsets.all(24),
                        children: [
                          Text(
                            tr("已记重点"),
                            style: Theme.of(ctx).textTheme.headlineSmall,
                          ),
                          SizedBox(height: 24),
                          for (final mark in (m['marks'] as List? ?? []))
                            ListTile(
                              title: Text(
                                mark['note'].toString().isEmpty
                                    ? tr("重点")
                                    : mark['note'],
                              ),
                              subtitle: Text(durationText(mark['sample'])),
                            ),
                          if ((m['marks'] as List? ?? []).isEmpty)
                            Text(tr("尚未记录重点")),
                        ],
                      ),
                    ),
                  );
                  return;
                }
                await _player?.stop();
                if (!context.mounted) return;
                final deleted = await deleteLocalMeeting(
                  context,
                  widget.model,
                  widget.id,
                );
                if (deleted && context.mounted) Navigator.pop(context);
              },
              itemBuilder: (_) => [
                if (!ended)
                  PopupMenuItem(value: 'marks', child: Text(tr("查看已记重点"))),
                PopupMenuItem(
                  value: 'delete',
                  enabled:
                      ended &&
                      (m['finished'] == true ||
                          m['remoteDeleted'] == true ||
                          m['localOnly'] == true),
                  child: Text(
                    ended &&
                            (m['finished'] == true ||
                                m['remoteDeleted'] == true ||
                                m['localOnly'] == true)
                        ? tr("删除本机记录")
                        : tr("同步完成后可删除"),
                  ),
                ),
              ],
            ),
            if (ended)
              IconButton(
                onPressed: share,
                tooltip: tr("分享已同步内容"),
                icon: BreviaIcon(Icons.ios_share),
              ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(24, 8, 24, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (darkRecording)
                      Padding(
                        padding: EdgeInsets.only(bottom: 12),
                        child: Text(
                          m['title'] ?? tr("会议"),
                          style: Theme.of(context).textTheme.headlineLarge,
                        ),
                      ),
                    if (darkRecording)
                      Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: '● ',
                              style: TextStyle(color: Color(0xffff3b30)),
                            ),
                            TextSpan(
                              text:
                                  '$label · ${durationText(m['samples'] ?? 0)}',
                            ),
                          ],
                        ),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    if (ended && m['localOnly'] == true)
                      Padding(
                        padding: EdgeInsets.only(top: 16),
                        child: FilledButton.icon(
                          onPressed: widget.model.busy
                              ? null
                              : () => uploadRecording(
                                  context,
                                  widget.model,
                                  widget.id,
                                ),
                          icon: BreviaIcon(Icons.upload_outlined),
                          label: Text(tr('上传到电脑')),
                        ),
                      ),
                    if (!recordingFocus &&
                        m['localOnly'] != true &&
                        m['finished'] != true &&
                        m['remoteDeleted'] != true &&
                        m['connected'] == false)
                      const ConnectionRecoveryNotice(),
                    if (!ended &&
                        !recordingFocus &&
                        m['connected'] == true &&
                        (m['count'] as num? ?? 0) >
                            (m['uploaded'] as num? ?? 0))
                      Container(
                        margin: EdgeInsets.only(top: 16),
                        padding: EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Theme.of(
                            context,
                          ).colorScheme.surfaceContainerLowest,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(tr('● 已连接')),
                            SizedBox(height: 12),
                            LinearProgressIndicator(
                              value:
                                  ((m['uploaded'] as num? ?? 0) /
                                          (m['count'] as num))
                                      .clamp(0, 1)
                                      .toDouble(),
                              semanticsLabel: tr('已传到电脑  {0}', [
                                durationText(snapshot['samples'] ?? 0),
                              ]),
                            ),
                            SizedBox(height: 8),
                            Text(
                              tr('已传到电脑  {0}', [
                                durationText(snapshot['samples'] ?? 0),
                              ]),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    if (m['remoteDeleted'] == true ||
                        m['error'] != null ||
                        snapshot['error'] != null)
                      Padding(
                        padding: EdgeInsets.only(top: 16),
                        child: Text(
                          m['remoteDeleted'] == true
                              ? tr('会议已在电脑永久删除')
                              : m['error']?.toString() ??
                                    remoteError(snapshot['error'].toString()),
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    if ((m['gaps'] as List? ?? []).isNotEmpty)
                      Text(tr("本次录音包含中断缺口"), style: TextStyle(fontSize: 13)),
                  ],
                ),
              ),
              if (!recordingFocus)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border(
                        bottom: BorderSide(
                          color: Theme.of(context).dividerColor,
                        ),
                      ),
                    ),
                    child: Row(
                      children: [
                        for (final (i, text)
                            in (ended
                                ? [(1, tr('笔记')), (0, tr('转写')), (2, tr('重点'))]
                                : [
                                    (0, tr('转写')),
                                    (1, tr('笔记')),
                                    (2, tr('重点')),
                                  ]))
                          Expanded(
                            child: AnimatedContainer(
                              duration: MediaQuery.disableAnimationsOf(context)
                                  ? Duration.zero
                                  : const Duration(milliseconds: 180),
                              decoration: BoxDecoration(
                                border: Border(
                                  bottom: BorderSide(
                                    color: tab == i
                                        ? Theme.of(
                                            context,
                                          ).colorScheme.onSurface
                                        : Colors.transparent,
                                    width: 2,
                                  ),
                                ),
                              ),
                              child: TextButton(
                                onPressed: () => setState(() {
                                  tab = i;
                                  following = false;
                                }),
                                child: Text(
                                  text,
                                  style: TextStyle(
                                    fontWeight: tab == i
                                        ? FontWeight.w600
                                        : FontWeight.w400,
                                    color: tab == i
                                        ? Theme.of(
                                            context,
                                          ).colorScheme.onSurface
                                        : Theme.of(
                                            context,
                                          ).colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              if (ended && tab == 0)
                Padding(
                  padding: EdgeInsets.fromLTRB(24, 8, 24, 8),
                  child: TextField(
                    onChanged: (v) => setState(() => query = v),
                    decoration: InputDecoration(
                      hintText: tr("搜索转写"),
                      prefixIcon: BreviaIcon(Icons.search),
                      isDense: true,
                    ),
                  ),
                ),
              Expanded(
                child: AnimatedSwitcher(
                  duration: MediaQuery.disableAnimationsOf(context)
                      ? Duration.zero
                      : const Duration(milliseconds: 160),
                  layoutBuilder: (current, previous) =>
                      current ?? const SizedBox(),
                  child: ListView(
                    key: ValueKey(tab),
                    controller: scroll,
                    padding: EdgeInsets.all(24),
                    children: [
                      if (recordingFocus) ...[
                        if (m['desktopCapture'] == true) ...[
                          Text(
                            tr(
                              ended
                                  ? '录音已结束'
                                  : !live
                                  ? '录音已中断'
                                  : state != 'recording'
                                  ? '录音已暂停'
                                  : m['connected'] == false
                                  ? '正在录音，等待电脑连接'
                                  : '电脑正在使用\n手机麦克风',
                            ),
                            style: Theme.of(context).textTheme.headlineLarge,
                          ),
                          const SizedBox(height: 20),
                          if (!ended && widget.model.desktop != null)
                            ListTile(
                              leading: const BreviaIcon(Icons.laptop_outlined),
                              title: Text(widget.model.desktop!.name),
                              subtitle: Text(tr('由电脑发起')),
                            ),
                          const SizedBox(height: 24),
                        ] else
                          const SizedBox(height: 48),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            BreviaIcon(
                              live && state == 'recording'
                                  ? Icons.circle
                                  : Icons.pause,
                              size: 12,
                              color: live && state == 'recording'
                                  ? const Color(0xffff3b30)
                                  : Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 8),
                            Flexible(
                              child: Text(
                                tr(
                                  ended
                                      ? '录音已结束'
                                      : !live
                                      ? '录音已中断'
                                      : state != 'recording'
                                      ? '录音已暂停'
                                      : m['connected'] == false &&
                                            m['localOnly'] != true
                                      ? '仍在本机录音'
                                      : '录音中',
                                ),
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Text(
                          durationText(m['samples'] ?? 0),
                          textAlign: TextAlign.center,
                          style: Theme.of(
                            context,
                          ).textTheme.headlineLarge?.copyWith(fontSize: 48),
                        ),
                        const SizedBox(height: 20),
                        const Center(
                          child: BreviaIcon(Icons.mic_none, size: 32),
                        ),
                        const SizedBox(height: 16),
                        Center(
                          child: MicrophoneLevel(
                            level: live && state == 'recording'
                                ? (m['inputLevel'] as num? ?? 0).toDouble()
                                : 0,
                          ),
                        ),
                        if (state == 'paused') ...[
                          const SizedBox(height: 12),
                          Text(
                            tr('暂停期间不采集音频'),
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                        if (live &&
                            m['desktopCapture'] == true &&
                            m['connected'] == false) ...[
                          const SizedBox(height: 16),
                          Text(
                            tr('音频保留在手机，恢复连接后自动补传。'),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                        const SizedBox(height: 28),
                        Container(
                          padding: EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Theme.of(
                              context,
                            ).colorScheme.surfaceContainerLowest,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Row(
                            children: [
                              BreviaIcon(Icons.phone_iphone_outlined),
                              SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      tr(
                                        m['desktopCapture'] == true
                                            ? '电脑会议的手机录音'
                                            : '仅保存在手机',
                                      ),
                                    ),
                                    SizedBox(height: 6),
                                    Text(
                                      tr(
                                        m['desktopCapture'] == true
                                            ? '这场会议由电脑发起，逐字稿和笔记保存在电脑。录音保留在手机，断线后可补传。'
                                            : !live
                                            ? '上次录音已中断。已录内容保留，中断期间没有录音。'
                                            : '无需连接电脑。录音保存在本机，连接后由你主动上传。',
                                      ),
                                      style: Theme.of(
                                        context,
                                      ).textTheme.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                      if (!recordingFocus && tab == 0)
                        transcript(snapshot['segments'] as List? ?? [], ended),
                      if (!recordingFocus &&
                          tab == 1 &&
                          ((snapshot['notes'] as String? ?? '').isNotEmpty ||
                              !waitingForComputer(m, widget.model)))
                        Container(
                          padding: ended
                              ? EdgeInsets.zero
                              : const EdgeInsets.all(16),
                          decoration: ended
                              ? null
                              : BoxDecoration(
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.surfaceContainerLowest,
                                  border: Border.all(
                                    color: Theme.of(context).dividerColor,
                                  ),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                          child: SelectionArea(
                            child: MarkdownBody(
                              data: (snapshot['notes'] as String? ?? '').isEmpty
                                  ? tr("电脑生成或保存笔记后会显示在这里。")
                                  : snapshot['notes'],
                              sizedImageBuilder: (_) => Text(tr("图片请在电脑查看")),
                              styleSheet: MarkdownStyleSheet(
                                p: Theme.of(context).textTheme.bodyLarge,
                                h2: Theme.of(context).textTheme.titleLarge,
                                h2Padding: EdgeInsets.only(top: 16, bottom: 8),
                                blockSpacing: 12,
                              ),
                            ),
                          ),
                        ),
                      if (!recordingFocus && tab == 1)
                        TranscriptionActivity(meeting: m, model: widget.model),
                      if (!recordingFocus && tab == 2) ...[
                        for (final mark in (m['marks'] as List? ?? []))
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              mark['note'].toString().isEmpty
                                  ? tr("重点")
                                  : mark['note'],
                            ),
                            subtitle: Text(durationText(mark['sample'])),
                            onTap: ended
                                ? () => play(
                                    milliseconds: ((mark['sample'] as num) / 16)
                                        .round(),
                                  )
                                : null,
                          ),
                        if ((m['marks'] as List? ?? []).isEmpty)
                          Text(tr("点击“重点”记录值得回看的时刻。")),
                      ],
                    ],
                  ),
                ),
              ),
              if (!ended && !recordingFocus && tab == 0 && !following)
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () {
                      setState(() => following = true);
                    },
                    child: Text(tr("回到最新")),
                  ),
                ),
              Container(
                margin: EdgeInsets.fromLTRB(24, 8, 24, 16),
                padding: EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  border: Border(
                    top: BorderSide(color: Theme.of(context).dividerColor),
                  ),
                ),
                child: ended
                    ? Column(
                        children: [
                          Row(
                            children: [
                              StreamBuilder<PlayerState>(
                                stream: _player?.playerStateStream,
                                builder: (_, value) => IconButton.filledTonal(
                                  style: IconButton.styleFrom(
                                    backgroundColor: Theme.of(
                                      context,
                                    ).colorScheme.surfaceContainerLowest,
                                  ),
                                  tooltip: value.data?.playing == true
                                      ? tr("暂停回听")
                                      : tr("回听本机录音"),
                                  onPressed: loadingAudio ? null : play,
                                  icon: BreviaIcon(
                                    value.data?.playing == true
                                        ? Icons.pause
                                        : Icons.play_arrow,
                                    size: 24,
                                  ),
                                ),
                              ),
                              Expanded(
                                child: StreamBuilder<Duration>(
                                  stream: _player?.positionStream,
                                  builder: (_, pos) => LayoutBuilder(
                                    builder: (context, constraints) {
                                      final time = Text(
                                        '${durationText((pos.data?.inMilliseconds ?? 0) * 16)} / ${durationText(m['samples'] ?? 0)}',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(fontSize: 12),
                                      );
                                      final track = SizedBox(
                                        height: 32,
                                        child: Slider(
                                          value:
                                              (pos.data?.inMilliseconds
                                                          .toDouble() ??
                                                      0)
                                                  .clamp(
                                                    0,
                                                    (_player
                                                                ?.duration
                                                                ?.inMilliseconds
                                                                .toDouble() ??
                                                            1)
                                                        .clamp(
                                                          1,
                                                          double.infinity,
                                                        ),
                                                  ),
                                          max:
                                              (_player?.duration?.inMilliseconds
                                                          .toDouble() ??
                                                      1)
                                                  .clamp(1, double.infinity),
                                          onChanged: loadedAudio
                                              ? (v) => player.seek(
                                                  Duration(
                                                    milliseconds: v.toInt(),
                                                  ),
                                                )
                                              : null,
                                        ),
                                      );
                                      // 小屏/系统大字保留完整时间，将播放轨道放到下一行。
                                      if (constraints.maxWidth < 200 ||
                                          MediaQuery.textScalerOf(
                                                context,
                                              ).scale(12) >
                                              15) {
                                        return Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.stretch,
                                          children: [time, track],
                                        );
                                      }
                                      return Row(
                                        children: [
                                          time,
                                          const SizedBox(width: 8),
                                          Expanded(child: track),
                                        ],
                                      );
                                    },
                                  ),
                                ),
                              ),
                              TextButton(
                                onPressed: () => setState(() {
                                  player.setSpeed(
                                    player.speed == 1
                                        ? 1.5
                                        : player.speed == 1.5
                                        ? 2
                                        : 1,
                                  );
                                }),
                                child: Text('${_player?.speed ?? 1.0}×'),
                              ),
                            ],
                          ),
                          TranscriptionActivity(
                            meeting: m,
                            model: widget.model,
                          ),
                          Text(
                            m['finished'] == true
                                ? tr("电脑已完成处理")
                                : m['localOnly'] == true
                                ? tr("仅保存在手机")
                                : tr("待补传或等待电脑处理，音频保留在手机"),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      )
                    : Column(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Theme.of(
                                context,
                              ).colorScheme.surfaceContainerLowest,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                for (final (icon, title, time) in [
                                  (
                                    Icons.phone_iphone_outlined,
                                    tr(
                                      m['localOnly'] == true
                                          ? '仅保存在手机'
                                          : '已存本机',
                                    ),
                                    durationText(m['samples'] ?? 0),
                                  ),
                                  if (m['localOnly'] != true)
                                    (
                                      Icons.laptop_outlined,
                                      tr('已传电脑'),
                                      durationText(snapshot['samples'] ?? 0),
                                    ),
                                ])
                                  Expanded(
                                    child: Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        BreviaIcon(icon, size: 20),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                title,
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .bodySmall
                                                    ?.copyWith(
                                                      fontWeight:
                                                          FontWeight.w600,
                                                      color: Theme.of(
                                                        context,
                                                      ).colorScheme.onSurface,
                                                    ),
                                              ),
                                              if (time.isNotEmpty) ...[
                                                const SizedBox(height: 4),
                                                Text(
                                                  time,
                                                  style: Theme.of(
                                                    context,
                                                  ).textTheme.bodySmall,
                                                ),
                                              ],
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          SizedBox(height: 12),
                          if (recordingFocus && !live) ...[
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                onPressed: recordingCommandPending || ending
                                    ? null
                                    : toggleRecording,
                                child: Text(tr('继续录音')),
                              ),
                            ),
                            SizedBox(height: 12),
                            SizedBox(
                              width: double.infinity,
                              child: OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: Theme.of(
                                    context,
                                  ).colorScheme.error,
                                  side: BorderSide(
                                    color: Theme.of(context).colorScheme.error,
                                  ),
                                ),
                                onPressed: recordingCommandPending || ending
                                    ? null
                                    : end,
                                child: Text(tr('结束并保存')),
                              ),
                            ),
                          ] else
                            RecordingControls(
                              paused: state != 'recording' || !live,
                              pending: recordingCommandPending || ending,
                              onPause: toggleRecording,
                              onMark: live ? () => report(context, mark) : null,
                              onEnd: end,
                              localOnly: m['localOnly'] == true,
                            ),
                        ],
                      ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class SettingsPage extends StatelessWidget {
  final AppModel model;
  const SettingsPage({super.key, required this.model});
  Widget preferenceValue(BuildContext context, String value) => SizedBox(
    width: MediaQuery.sizeOf(context).width * .36,
    child: Row(
      children: [
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        const SizedBox(width: 8),
        const BreviaIcon(Icons.chevron_right, size: 18),
      ],
    ),
  );
  void info(BuildContext context, String title, Widget content) =>
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => Scaffold(
            appBar: AppBar(title: Text(title)),
            body: SafeArea(
              child: ListView(padding: EdgeInsets.all(24), children: [content]),
            ),
          ),
        ),
      );
  Widget updateEntry(BuildContext context) => ListTile(
    leading: const BreviaIcon(Icons.system_update),
    title: Text(tr('检查更新')),
    trailing: const BreviaIcon(Icons.chevron_right),
    onTap: () => info(
      context,
      tr('检查更新'),
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 24),
          Center(child: breviaLogo(size: 64)),
          const SizedBox(height: 16),
          const Text(
            'Brevia',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 28, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 32),
          const AppUpdateTile(),
          if (Platform.isIOS) ...[
            const SizedBox(height: 24),
            Text(
              tr('更新通过 App Store 提供。'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
      ),
    ),
  );

  void storagePage(BuildContext context) =>
      info(context, tr("本地存储"), storageContent(context));
  Widget storageContent(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: double.infinity,
        padding: EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Theme.of(context).dividerColor),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(tr("本地存储"), style: Theme.of(context).textTheme.titleMedium),
            SizedBox(height: 12),
            Text(
              '${(model.meetings.fold<num>(0, (total, m) => total + (m['samples'] ?? 0)) * 2 / 1000000).toStringAsFixed(1)} MB',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            SizedBox(height: 12),
            Text(
              tr("原始录音保留在本机；未补传的录音不会自动删除。卸载应用会删除本机数据。"),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
      SizedBox(height: 24),
      Text(tr("会议录音"), style: Theme.of(context).textTheme.titleMedium),
      SizedBox(height: 8),
      for (final m in model.meetings)
        ListTile(
          contentPadding: EdgeInsets.symmetric(horizontal: 16),
          shape: Border(
            bottom: BorderSide(color: Theme.of(context).dividerColor),
          ),
          title: Text(m['title']),
          subtitle: Text(
            m['finished'] == true ? tr("已同步 · 可导出本地音频") : tr("待同步 · 受保护"),
          ),
          trailing: IconButton(
            tooltip: tr("导出音频"),
            icon: BreviaIcon(Icons.ios_share),
            onPressed: () => exportSavedRecording(context, model, m['id']),
          ),
        ),
    ],
  );
  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.fromLTRB(24, 20, 24, 16),
    children: [
      Text(tr('设置'), style: Theme.of(context).textTheme.headlineLarge),
      const SizedBox(height: 8),
      Text(
        tr('让 Brevia 按你的习惯工作。'),
        style: Theme.of(context).textTheme.bodySmall,
      ),
      const SizedBox(height: 24),
      Text(tr('偏好设置'), style: Theme.of(context).textTheme.bodySmall),
      const SizedBox(height: 8),
      SizedBox(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Divider(height: 1),
            ListTile(
              contentPadding: EdgeInsets.zero,
              minTileHeight: 56,
              leading: BreviaIcon(Icons.language),
              title: Text(tr("界面语言")),
              trailing: preferenceValue(
                context,
                uiLanguage == 'system'
                    ? tr('跟随系统')
                    : languageNames[uiLanguage]!,
              ),
              onTap: () => info(
                context,
                tr("界面语言"),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final entry in {
                      'system': tr("跟随系统"),
                      ...languageNames,
                    }.entries) ...[
                      ListTile(
                        title: Text(entry.value),
                        leading: entry.key == 'system'
                            ? BreviaIcon(Icons.language)
                            : null,
                        selected: uiLanguage == entry.key,
                        selectedColor: Theme.of(context).colorScheme.onSurface,
                        selectedTileColor: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerLowest,
                        trailing: uiLanguage == entry.key
                            ? BreviaIcon(Icons.check)
                            : null,
                        onTap: () {
                          model.setLanguage(entry.key);
                          Navigator.pop(context);
                        },
                      ),
                      Divider(height: 1),
                    ],
                  ],
                ),
              ),
            ),
            Divider(height: 1),
            ListTile(
              contentPadding: EdgeInsets.zero,
              minVerticalPadding: 8,
              minTileHeight: 56,
              leading: BreviaIcon(Icons.brightness_6_outlined),
              title: Text(tr("外观")),
              trailing: preferenceValue(
                context,
                {
                  'system': tr('跟随系统'),
                  'light': tr('浅色'),
                  'dark': tr('深色'),
                }[model.appearance]!,
              ),
              onTap: () => info(
                context,
                tr("外观"),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        for (final brightness in Brightness.values)
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.all(6),
                              child: Theme(
                                data: breviaTheme(brightness),
                                child: Builder(
                                  builder: (ctx) => Container(
                                    padding: const EdgeInsets.all(12),
                                    decoration: BoxDecoration(
                                      color: Theme.of(
                                        ctx,
                                      ).scaffoldBackgroundColor,
                                      border: Border.all(
                                        color: Theme.of(ctx).dividerColor,
                                      ),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        breviaLogo(size: 24),
                                        const SizedBox(height: 12),
                                        Text(
                                          tr('会议'),
                                          style: Theme.of(
                                            ctx,
                                          ).textTheme.titleMedium,
                                        ),
                                        const Divider(),
                                        Text(
                                          tr(
                                            brightness == Brightness.light
                                                ? '浅色'
                                                : '深色',
                                          ),
                                          style: Theme.of(
                                            ctx,
                                          ).textTheme.bodyMedium,
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    for (final entry in {
                      'system': tr("跟随系统"),
                      'light': tr("浅色"),
                      'dark': tr("深色"),
                    }.entries) ...[
                      ListTile(
                        title: Text(entry.value),
                        leading: BreviaIcon(
                          {
                            'system': Icons.devices_outlined,
                            'light': Icons.light_mode_outlined,
                            'dark': Icons.dark_mode_outlined,
                          }[entry.key],
                        ),
                        selected: model.appearance == entry.key,
                        selectedColor: Theme.of(context).colorScheme.onSurface,
                        selectedTileColor: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerLowest,
                        trailing: model.appearance == entry.key
                            ? BreviaIcon(Icons.check)
                            : null,
                        onTap: () {
                          model.setAppearance(entry.key);
                          Navigator.pop(context);
                        },
                      ),
                      Divider(height: 1),
                    ],
                  ],
                ),
              ),
            ),
            Divider(height: 1),
            const SizedBox(height: 24),
            Text(tr('录音与数据'), style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 8),
            Divider(height: 1),
            ListTile(
              contentPadding: EdgeInsets.zero,
              minVerticalPadding: 8,
              minTileHeight: 56,
              leading: BreviaIcon(Icons.mic_none),
              title: Text(tr("录音与后台")),
              trailing: BreviaIcon(Icons.chevron_right),
              onTap: () => info(
                context,
                tr("录音与后台"),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ListTile(
                      leading: BreviaIcon(Icons.mic_none),
                      title: Text(tr("麦克风")),
                      trailing: Text(
                        tr("手机内置"),
                        style: TextStyle(fontSize: 14),
                      ),
                    ),
                    Divider(height: 1),
                    ListTile(
                      leading: BreviaIcon(Icons.shield_outlined),
                      title: Text(tr("麦克风权限")),
                      trailing: BreviaIcon(Icons.chevron_right),
                      onTap: openAppSettings,
                    ),
                    Divider(height: 1),
                    ListTile(
                      leading: BreviaIcon(Icons.description_outlined),
                      title: Text(tr("后台录音说明")),
                      trailing: BreviaIcon(Icons.chevron_right),
                      onTap: () => info(
                        context,
                        tr("后台录音说明"),
                        Text(
                          tr(
                            "锁屏后可继续录音。来电、强制停止或系统限制仍可能中断录音，返回后请检查状态。\n\nAndroid 使用麦克风前台服务。请允许录音通知；如厂商省电策略终止应用，可在系统设置中调整。暂停后请回到应用继续。",
                          ),
                        ),
                      ),
                    ),
                    Divider(height: 1),
                    SizedBox(height: 24),
                    Text(
                      tr("锁屏后可继续录音。来电或系统限制可能中断录音，恢复后会标记缺口。"),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
            Divider(height: 1),
            ListTile(
              contentPadding: EdgeInsets.zero,
              minVerticalPadding: 8,
              minTileHeight: 56,
              leading: BreviaIcon(Icons.laptop_outlined),
              title: Text(tr("连接与设备")),
              trailing: BreviaIcon(Icons.chevron_right),
              onTap: () => info(
                context,
                tr("连接与设备"),
                SizedBox(
                  height: MediaQuery.sizeOf(context).height * .8,
                  child: ConnectionPage(model: model),
                ),
              ),
            ),
            Divider(height: 1),
            ListTile(
              contentPadding: EdgeInsets.zero,
              minVerticalPadding: 8,
              minTileHeight: 56,
              leading: BreviaIcon(Icons.storage_outlined),
              title: Text(tr("本地存储")),
              trailing: BreviaIcon(Icons.chevron_right),
              onTap: () => storagePage(context),
            ),
            Divider(height: 1),
            ListTile(
              contentPadding: EdgeInsets.zero,
              minVerticalPadding: 8,
              minTileHeight: 56,
              leading: BreviaIcon(Icons.privacy_tip_outlined),
              title: Text(tr("隐私与关于")),
              trailing: BreviaIcon(Icons.chevron_right),
              onTap: () => info(
                context,
                tr("隐私与关于"),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ListTile(
                      leading: BreviaIcon(Icons.description_outlined),
                      title: Text(tr('仅保存在手机')),
                      subtitle: Text(tr('原始录音保留在本机；未补传的录音不会自动删除。卸载应用会删除本机数据。')),
                    ),
                    Divider(height: 1),
                    ListTile(
                      leading: BreviaIcon(Icons.cloud_upload_outlined),
                      title: Text(tr('上传到电脑')),
                      subtitle: Text(tr('选择实时转写时，音频传到已配对电脑；离线录音只在你确认上传后同步。')),
                    ),
                    Divider(height: 1),
                    ListTile(
                      leading: BreviaIcon(Icons.shield_outlined),
                      title: Text(tr('在线 AI')),
                      subtitle: Text(tr('电脑启用在线 AI 时，相关文字按电脑设置发送给所选服务商。')),
                    ),
                    Divider(height: 1),
                    SizedBox(height: 24),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: breviaLogo(size: 48),
                    ),
                    SizedBox(height: 16),
                    if (Platform.isAndroid || Platform.isIOS)
                      updateEntry(context),
                    Divider(height: 1),
                    SizedBox(height: 24),
                    ListTile(
                      title: Text(tr('完整隐私政策')),
                      trailing: const BreviaIcon(Icons.chevron_right),
                      onTap: () => info(
                        context,
                        tr('完整隐私政策'),
                        SelectableText(
                          tr(
                            "Brevia 隐私政策\n更新日期：2026-10-16\n\n提供者与范围\nBrevia 由 YANG ZHOU 提供。手机录音和本地回看无需账号。应用不含广告或行为分析 SDK，不会自动向开发者上传会议。Brevia 不提供在线 AI 代理或统一 AI 账号；在线 AI 地址与账号均由用户自行配置。\n\n录音、转写与同步\n录音、笔记、逐字稿和会议设置保存在你的设备上。离线录音只有在你选择电脑并确认上传后才同步；选择实时转写或将手机用作电脑麦克风时，音频及必要的会议资料会发送到已配对电脑，语音识别在电脑执行。配对和同步需要手机与电脑处于同一局域网；首次配对还需电脑确认，配对本身不会上传已有离线录音。\n\n可选在线 AI\n本地 AI 在电脑运行。选择在线 AI 后，电脑可能发送会议标题、逐字稿（含说话人和时间点）、笔记及 AI 上下文，用于生成纪要和实时 AI 笔记；这些 AI 请求不发送原始录音。请在电脑配置中核对服务商、地址和模型；启用在线 AI 或生成在线纪要后，相关文字会按该配置发送。不启用在线 AI 仍可使用录音、本地转写和本地 AI。关闭实时 AI 可停止后续自动请求，已发出的请求无法撤回。服务商可能按其政策保留请求、日志及生成结果；请在配置和使用前核对其隐私政策，并直接向所选服务管理或删除数据。自备 API Key 不代表服务商不会保留数据。\n\n连接安全\n手机与电脑仅通过局域网 HTTPS 通信，并校验已配对电脑的证书指纹。\n\n权限与更新检查\n麦克风用于录音和试音，相机仅用于扫码配对，局域网权限用于发现和连接电脑。手动配对可替代扫码。权限可在系统设置撤销；来电、强制停止或系统限制可能中断录音。在 iOS 主动检查更新时，应用向 Apple 查询公开 App ID 与商店地区，不发送会议内容；Apple 可接触请求的网络信息。\n\n保存、删除与导出\n手机配对凭据存入系统安全存储；iOS 录音目录使用系统文件保护并排除应用配置的系统备份。会议保留至你删除或卸载应用。删除手机副本不会删除电脑副本，取消配对不会删除已保存的会议，也不会删除第三方已收到的数据。卸载前请先导出或同步尚未上传的录音。自行创建的备份、导出文件及在线 AI 服务上的数据需分别管理。\n\n支持与政策变更\n支持和隐私咨询：https://github.com/zerolovesea/Brevia/issues 。反馈由你主动提供；公开反馈中不要包含录音、凭据或个人信息。请在录音前取得参与者同意。功能或数据处理方式变化时，我们会更新本政策及日期。政策网页：https://brevia.work/privacy.html",
                          ),
                        ),
                      ),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      title: Text(tr('反馈与支持')),
                      trailing: const BreviaIcon(Icons.chevron_right),
                      onTap: () => info(
                        context,
                        tr('反馈与支持'),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const SelectableText(
                              'https://github.com/zerolovesea/Brevia/issues',
                            ),
                            const SizedBox(height: 24),
                            FilledButton(
                              onPressed: () => report(context, () async {
                                await Clipboard.setData(
                                  const ClipboardData(
                                    text:
                                        'https://github.com/zerolovesea/Brevia/issues',
                                  ),
                                );
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text(tr('已复制反馈地址'))),
                                  );
                                }
                              }),
                              child: Text(tr('复制反馈地址')),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Divider(height: 1),
            const SizedBox(height: 16),
            if (Platform.isAndroid || Platform.isIOS) ...[
              updateEntry(context),
              Divider(height: 1),
            ],
            const SizedBox(height: 16),
            Text(
              tr('录音保留在本机，上传由你确认。'),
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(fontSize: 12),
            ),
            const SizedBox(height: 6),
            Text(
              'Brevia',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    ],
  );
}

class PrepareMeetingPage extends StatefulWidget {
  final Map<String, dynamic> options;
  final String computer;
  final Map<String, dynamic> initial;
  final bool upload;
  const PrepareMeetingPage({
    super.key,
    required this.options,
    required this.computer,
    this.initial = const {},
    this.upload = false,
  });
  @override
  State<PrepareMeetingPage> createState() => _PrepareMeetingPageState();
}

class _PrepareMeetingPageState extends State<PrepareMeetingPage> {
  final title = TextEditingController(text: defaultMeetingTitle());
  String language = 'zh', translation = '', workspace = '', modelId = '';
  late final bool offline;
  final participants = TextEditingController();
  static Map<String, String> get languages => {
    'zh': tr("中文"),
    'en': tr("英语"),
    'es': tr("西班牙语"),
    'ja': tr("日语"),
    'ko': tr("韩语"),
    'fr': tr("法语"),
    'de': tr("德语"),
    'ru': tr("俄语"),
    'auto': tr("多语言混说"),
  };
  List<Map<String, dynamic>> get models =>
      (widget.options['models'] as List? ?? [])
          .map((m) => Map<String, dynamic>.from(m))
          .where((m) => (m['languages'] as List).contains(language))
          .toList();
  void selectDefault() {
    final candidates = models;
    modelId =
        candidates
            .where(
              (m) =>
                  m['status'] == 'ready' &&
                  (m['default_for_languages'] as List? ?? []).contains(
                    language,
                  ),
            )
            .firstOrNull?['id'] ??
        candidates.where((m) => m['status'] == 'ready').firstOrNull?['id'] ??
        candidates.firstOrNull?['id'] ??
        '';
  }

  @override
  void initState() {
    super.initState();
    offline = !widget.upload && widget.options.isEmpty;
    title.text = widget.initial['title'] ?? defaultMeetingTitle();
    language = widget.initial['language'] ?? 'zh';
    final count = widget.initial['num_speakers'] as int? ?? -1;
    participants.text = count > 0 ? '$count' : '';
    selectDefault();
  }

  @override
  void dispose() {
    title.dispose();
    participants.dispose();
    super.dispose();
  }

  Widget select(
    String label,
    String value,
    Map<String, String> choices,
    void Function(String) changed,
  ) => Padding(
    padding: EdgeInsets.only(bottom: 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(label),
        SizedBox(height: 8),
        OutlinedButton(
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          ),
          onPressed: () async {
            final selected = await Navigator.push<String>(
              context,
              MaterialPageRoute(
                builder: (ctx) => Scaffold(
                  appBar: AppBar(title: Text(label)),
                  body: SafeArea(
                    child: ListView(
                      padding: const EdgeInsets.all(24),
                      children: [
                        if (label == tr('识别模型')) ...[
                          Text(
                            tr('手机采集音频，电脑完成转写'),
                            style: Theme.of(ctx).textTheme.bodySmall,
                          ),
                          const SizedBox(height: 16),
                        ],
                        for (final entry in choices.entries) ...[
                          ListTile(
                            title: Text(entry.value),
                            enabled:
                                label != tr('识别模型') ||
                                models.any(
                                  (m) =>
                                      m['id'] == entry.key &&
                                      m['status'] == 'ready',
                                ),
                            selected: entry.key == value,
                            selectedTileColor: Theme.of(
                              ctx,
                            ).colorScheme.surfaceContainer,
                            trailing: entry.key == value
                                ? const BreviaIcon(Icons.check)
                                : null,
                            onTap: () => Navigator.pop(ctx, entry.key),
                          ),
                          const Divider(height: 1),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            );
            if (selected != null && mounted) setState(() => changed(selected));
          },
          child: Row(
            children: [
              Expanded(
                child: Text(
                  choices[value] ?? '',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
              const SizedBox(width: 8),
              const BreviaIcon(Icons.chevron_right, size: 20),
            ],
          ),
        ),
      ],
    ),
  );
  @override
  Widget build(BuildContext context) {
    final ready =
        offline ||
        models.any((m) => m['id'] == modelId && m['status'] == 'ready');
    return Scaffold(
      appBar: AppBar(title: Text(tr(widget.upload ? "上传录音" : "新建录音"))),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.fromLTRB(24, 12, 24, 20),
          child: FilledButton(
            onPressed:
                ready &&
                    (participants.text.isEmpty ||
                        (int.tryParse(participants.text) ?? 0) >= 1)
                ? () => Navigator.pop(context, <String, dynamic>{
                    'title': title.text.trim().isEmpty
                        ? defaultMeetingTitle()
                        : title.text.trim(),
                    'language': language,
                    'num_speakers': int.tryParse(participants.text) ?? -1,
                    'offline': offline,
                    if (!offline) ...{
                      'workspace_id': workspace.isEmpty ? null : workspace,
                      'target_language': translation.isEmpty
                          ? null
                          : translation,
                      'refined_model_id': modelId,
                    },
                  })
                : null,
            child: Text(tr(widget.upload ? "上传到这台电脑" : "开始录音")),
          ),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.all(24),
          children: [
            Text(tr("会议标题")),
            SizedBox(height: 8),
            TextField(
              controller: title,
              style: Theme.of(context).textTheme.bodyMedium,
              maxLength: 120,
              decoration: InputDecoration(
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                counterText: '',
                suffixIcon: IconButton(
                  tooltip: tr("清空标题"),
                  onPressed: title.clear,
                  icon: BreviaIcon(Icons.close, size: 18),
                ),
              ),
            ),
            SizedBox(height: 12),
            select(tr("会议语言"), language, languages, (v) {
              language = v;
              selectDefault();
            }),
            Text(tr("参会人数")),
            SizedBox(height: 8),
            TextField(
              controller: participants,
              style: Theme.of(context).textTheme.bodyMedium,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(3),
              ],
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                hintText: tr("自动识别"),
                helperText: tr("用于会后整理，实时转写不标注说话人。"),
                helperMaxLines: 3,
              ),
            ),
            SizedBox(height: 12),
            if (!offline) ...[
              select(tr("工作区"), workspace, {
                '': tr("不指定工作区"),
                for (final w in widget.options['workspaces'])
                  w['id']: w['name'],
              }, (v) => workspace = v),
              select(tr("翻译为"), translation, {
                '': tr("不翻译"),
                for (final e in languages.entries.where((e) => e.key != 'auto'))
                  e.key: e.value,
              }, (v) => translation = v),
              select(
                tr("识别模型"),
                modelId,
                models.isEmpty
                    ? {'': tr("电脑暂无支持此语言的模型")}
                    : {
                        for (final m in models)
                          m['id']:
                              '${m['name']}${m['status'] == 'ready' ? '' : tr(" · 未安装")}',
                      },
                (v) => modelId = v,
              ),
            ],
            SizedBox(height: 8),
            Container(
              padding: EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  BreviaIcon(
                    offline
                        ? Icons.phone_iphone_outlined
                        : Icons.laptop_outlined,
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(offline ? tr("仅保存在手机") : widget.computer),
                        SizedBox(height: 4),
                        Text(
                          tr(
                            offline
                                ? "无需连接电脑。录音保存在本机，连接后由你主动上传。"
                                : "手机采集音频，电脑完成转写",
                          ),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  SizedBox(width: 12),
                  if (!offline)
                    BreviaIcon(
                      Icons.check_circle,
                      color: Color(0xff16803c),
                      size: 20,
                    ),
                ],
              ),
            ),

            if (!widget.upload && offline) ...[
              SizedBox(height: 16),
              Center(
                child: Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerLowest,
                    shape: BoxShape.circle,
                  ),
                  child: BreviaIcon(Icons.mic_none, size: 40),
                ),
              ),
              SizedBox(height: 12),
              Text(
                tr("点击下方按钮开始录音"),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            SizedBox(height: 16),
            if (!ready)
              Padding(
                padding: EdgeInsets.only(bottom: 16),
                child: Text(tr("请先在电脑的模型库安装所选识别模型，然后返回重新准备会议。")),
              ),

            SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

/// The same simple phone → transcript diagram as the connection reference.
bool waitingForComputer(Map<String, dynamic> meeting, AppModel? model) {
  final snapshot = meeting['snapshot'] as Map? ?? {};
  final task = snapshot['task'] as Map? ?? {};
  final connected = model != null && meeting['computer'] != null
      ? model.connected && meeting['computer'] == model.desktop?.fingerprint
      : meeting['connected'] == true;
  if (!connected ||
      meeting['localOnly'] == true ||
      meeting['remoteDeleted'] == true ||
      meeting['error'] != null ||
      snapshot['error'] != null ||
      task['state'] == 'failed') {
    return false;
  }
  return task['state'] == 'running' ||
      task['state'] == 'queued' ||
      (meeting['finished'] != true &&
          (['starting', 'recording', 'ended'].contains(meeting['state']) ||
              (snapshot['processed'] as num? ?? 0) <
                  (snapshot['next'] as num? ?? 0)));
}

String mobileSpeakerName(dynamic name) {
  final value = name?.toString() ?? '';
  if ([
    'local-user',
    'local user',
    'local_user',
  ].contains(value.toLowerCase())) {
    return tr('发言人');
  }
  return value.isEmpty ? tr('发言人') : value;
}

class TranscriptionActivity extends StatelessWidget {
  final Map<String, dynamic> meeting;
  final AppModel? model;
  const TranscriptionActivity({super.key, required this.meeting, this.model});

  @override
  Widget build(BuildContext context) {
    if (!waitingForComputer(meeting, model)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: const _TranscriptionDots(),
    );
  }
}

class _TranscriptionDots extends StatefulWidget {
  const _TranscriptionDots();

  @override
  State<_TranscriptionDots> createState() => _TranscriptionDotsState();
}

class _TranscriptionDotsState extends State<_TranscriptionDots>
    with SingleTickerProviderStateMixin {
  late final controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      controller.stop();
    } else if (!controller.isAnimating) {
      controller.repeat();
    }
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.disableAnimationsOf(context);
    return AnimatedBuilder(
      animation: controller,
      builder: (_, _) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < 3; i++)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 6),
              child: Opacity(
                opacity: reduced
                    ? 0.6
                    : 0.25 +
                          0.75 *
                              Curves.easeInOut.transform(
                                1 -
                                    (2 * ((controller.value - i * 0.18) % 1) -
                                            1)
                                        .abs(),
                              ),
                child: Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class RecordingRecoveryPage extends StatelessWidget {
  final Map<String, dynamic> meeting;
  final VoidCallback onReturn;
  const RecordingRecoveryPage({
    super.key,
    required this.meeting,
    required this.onReturn,
  });
  @override
  Widget build(BuildContext context) {
    final count = meeting['count'] as num? ?? 0;
    final uploaded = meeting['uploaded'] as num? ?? 0;
    final progress = count > 0
        ? (uploaded / count).clamp(0, 1).toDouble()
        : 0.0;
    final samples = meeting['samples'] as num? ?? 0;
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: breviaLogo(), centerTitle: false),
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.all(24),
          children: [
            SizedBox(height: 48),
            Center(
              child: Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  color: Color(0xff16803c).withValues(alpha: .08),
                  shape: BoxShape.circle,
                ),
                child: BreviaIcon(
                  Icons.check,
                  size: 48,
                  color: colors.onSurface,
                ),
              ),
            ),
            SizedBox(height: 24),
            Text(
              tr('已恢复连接'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            SizedBox(height: 12),
            Text(
              tr(
                progress < 1
                    ? meeting['state'] == 'recording'
                          ? '录音继续，正在补传'
                          : '录音已暂停'
                    : '音频已传输',
              ),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            SizedBox(height: 32),
            Container(
              padding: EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: colors.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(tr('补传进度'))),
                      Text('${(progress * 100).round()}%'),
                    ],
                  ),
                  SizedBox(height: 12),
                  LinearProgressIndicator(
                    value: progress,
                    semanticsLabel: tr('补传进度'),
                    semanticsValue: '${(progress * 100).round()}%',
                  ),
                ],
              ),
            ),
            SizedBox(height: 24),
            Container(
              decoration: BoxDecoration(
                color: colors.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: ListTile(
                contentPadding: EdgeInsets.all(16),
                minVerticalPadding: 8,
                leading: BreviaIcon(Icons.description_outlined),
                title: Text(tr('已保存的录音')),
                subtitle: Text(
                  '${durationText(samples)} · ${(samples * 2 / 1000000).toStringAsFixed(1)} MB',
                ),
                trailing: BreviaIcon(Icons.check_circle, size: 20),
              ),
            ),
            SizedBox(height: 48),
            FilledButton(onPressed: onReturn, child: Text(tr('返回录音'))),
          ],
        ),
      ),
    );
  }
}

class ConnectionRecoveryNotice extends StatelessWidget {
  const ConnectionRecoveryNotice({super.key});
  @override
  Widget build(BuildContext context) => Container(
    margin: EdgeInsets.only(top: 20),
    padding: EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(8),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LinearProgressIndicator(semanticsLabel: tr('正在重新连接')),
        SizedBox(height: 12),
        Text(tr('电脑已休眠或断开，等待开盖或恢复连接')),
        SizedBox(height: 8),
        Text(tr('录音保留在手机，恢复连接后自动补传。')),
      ],
    ),
  );
}

class SavedMeetingPage extends StatelessWidget {
  final AppModel model;
  final String id;
  const SavedMeetingPage({super.key, required this.model, required this.id});
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (_, _) {
      final m = model.meeting(id) ?? <String, dynamic>{};
      final snapshot = m['snapshot'] as Map? ?? {};
      final pending =
          ((m['samples'] as num? ?? 0) - (snapshot['samples'] as num? ?? 0))
              .clamp(0, double.infinity);
      return Scaffold(
        appBar: AppBar(title: Text(m['title'] ?? tr("会议"))),
        body: SafeArea(
          child: ListView(
            padding: EdgeInsets.all(24),
            children: [
              SizedBox(height: 24),
              Center(
                child: BreviaIcon(
                  Icons.check_circle,
                  size: 64,
                  color: Color(0xff16803c),
                ),
              ),
              SizedBox(height: 20),
              Text(
                tr("录音已结束"),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              SizedBox(height: 16),
              Text(
                durationText(m['samples'] ?? 0),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              SizedBox(height: 40),
              Divider(height: 1),
              ListTile(
                leading: BreviaIcon(Icons.phone_iphone_outlined),
                title: Text(tr("手机录音")),
                subtitle: Text(tr("已保存")),
                trailing: BreviaIcon(
                  Icons.check_circle,
                  color: Color(0xff16803c),
                ),
              ),
              Divider(height: 1),
              ListTile(
                leading: BreviaIcon(Icons.laptop_outlined),
                title: Text(tr("传到电脑")),
                subtitle: Text(
                  m['localOnly'] == true
                      ? tr("尚未上传")
                      : pending > 0
                      ? tr("待补传 {0}", [durationText(pending)])
                      : tr("音频已传输"),
                ),
                trailing: BreviaIcon(
                  pending > 0 ? Icons.schedule : Icons.check_circle,
                  color: pending > 0 ? Color(0xffa05a00) : Color(0xff16803c),
                ),
              ),
              Divider(height: 1),
              ListTile(
                leading: BreviaIcon(Icons.description_outlined),
                title: Text(tr("会议笔记")),
                subtitle: Text(
                  m['desktopCapture'] == true
                      ? tr('这场会议由电脑发起，逐字稿和笔记保存在电脑。录音保留在手机，断线后可补传。')
                      : (snapshot['notes'] ?? '').toString().isEmpty
                      ? tr("等待电脑整理")
                      : tr("已收到电脑笔记"),
                ),
                trailing: m['desktopCapture'] == true
                    ? null
                    : TranscriptionActivity(meeting: m, model: model),
              ),
              Divider(height: 1),
              if (m['localOnly'] != true &&
                  m['finished'] != true &&
                  m['remoteDeleted'] != true &&
                  m['connected'] == false)
                const ConnectionRecoveryNotice(),
              if (m['remoteDeleted'] == true ||
                  m['error'] != null ||
                  snapshot['error'] != null)
                Padding(
                  padding: EdgeInsets.only(top: 16),
                  child: Text(
                    m['remoteDeleted'] == true
                        ? tr('会议已在电脑永久删除')
                        : m['error']?.toString() ??
                              remoteError(snapshot['error'].toString()),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              SizedBox(height: 40),
              if (m['localOnly'] == true) ...[
                FilledButton.icon(
                  onPressed: model.busy
                      ? null
                      : () => uploadRecording(context, model, id),
                  icon: BreviaIcon(Icons.upload_outlined),
                  label: Text(tr("上传到电脑")),
                ),
                SizedBox(height: 12),
              ],
              if (m['localOnly'] == true)
                OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(tr("返回会议列表")),
                )
              else
                FilledButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(tr("返回会议列表")),
                ),
              SizedBox(height: 12),
              TextButton(
                onPressed: () => Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => MeetingPage(model: model, id: id),
                  ),
                ),
                child: Text(
                  tr(m['desktopCapture'] == true ? '手机录音' : "查看转写与笔记"),
                ),
              ),
              SizedBox(height: 32),
              Text(
                tr("关闭页面不会删除待传录音。"),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      );
    },
  );
}
