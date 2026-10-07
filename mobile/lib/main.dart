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
import 'connection.dart';
import 'recorder.dart';
import 'storage.dart';
import 'startup.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final model = AppModel();
  runApp(BreviaApp(model: model, initialize: model.initialize));
}

ThemeData breviaTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final ink = dark ? Color(0xfff1eee8) : Color(0xff26221e);
  final canvas = dark ? Color(0xff262626) : Color(0xfffbfaf7);
  final muted = dark ? Color(0xffa6a19a) : Color(0xff6b655f);
  final line = dark ? Color(0xff454545) : Color(0xffe6e2d8);
  final sheet = dark ? Color(0xff2e2e2e) : Colors.white;
  final scheme = ColorScheme.fromSeed(seedColor: ink, brightness: brightness)
      .copyWith(
        primary: ink,
        onPrimary: canvas,
        surface: canvas,
        onSurface: ink,
        onSurfaceVariant: muted,
        outline: line,
        outlineVariant: line,
        surfaceTint: Colors.transparent,
        error: dark ? Color(0xffc48686) : Color(0xffa65b5b),
      );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: canvas,
  );
  return base.copyWith(
    splashFactory: NoSplash.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: canvas,
      foregroundColor: ink,
      centerTitle: true,
      titleTextStyle: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: ink,
      ),
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    textTheme: base.textTheme.copyWith(
      headlineLarge: TextStyle(
        fontSize: 32,
        height: 1.25,
        fontWeight: FontWeight.w600,
        color: ink,
      ),
      headlineSmall: TextStyle(
        fontSize: 24,
        height: 1.4,
        fontWeight: FontWeight.w600,
        color: ink,
      ),
      titleLarge: TextStyle(
        fontSize: 20,
        height: 1.4,
        fontWeight: FontWeight.w600,
        color: ink,
      ),
      bodySmall: TextStyle(fontSize: 13, height: 1.5, color: muted),
      bodyLarge: TextStyle(fontSize: 17, height: 1.7, color: ink),
      bodyMedium: TextStyle(fontSize: 16, height: 1.55, color: ink),
    ),
    dividerTheme: DividerThemeData(
      color: dark ? Color(0xff454545) : Color(0xffe6e2d8),
      thickness: 1,
      space: 32,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: false,
      contentPadding: EdgeInsets.all(16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: ink),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: Size(48, 54),
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        textStyle: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: Size(48, 54),
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        textStyle: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: sheet,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: ink,
      contentPadding: EdgeInsets.zero,
      minVerticalPadding: 20,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: canvas,
      height: 72,
      elevation: 0,
      indicatorColor: Colors.transparent,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 12,
          color: states.contains(WidgetState.selected) ? ink : muted,
        ),
      ),
    ),
  );
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
              child: Home(model: model),
            ),
    ),
  );
}

Future<void> report(
  BuildContext context,
  Future<void> Function() action,
) async {
  try {
    await action();
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), duration: Duration(seconds: 6)),
      );
    }
  }
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
  bool searching = false;
  AppModel get model => widget.model;
  @override
  void initState() {
    super.initState();
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
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr("删除本机记录？")),
        content: Text(
          tr(
            m['localOnly'] == true
                ? "此录音仅保存在手机。请先导出需要保留的录音，删除后无法恢复。"
                : m['remoteDeleted'] == true
                ? "电脑上的会议已删除。本机可能是唯一副本，请先导出需要保留的录音。删除后无法恢复。"
                : "删除手机上的录音、字幕与笔记缓存。电脑上的会议仍会保留。",
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(tr("取消")),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(tr("删除")),
          ),
        ],
      ),
    );
    if (yes == true && mounted) {
      await report(context, () => model.deleteMeeting(m['id']));
    }
  }

  Future<void> meetingMenu(Map<String, dynamic> m) async {
    final ready = m['state'] == 'ended' && m['finished'] == true;
    final online =
        ready && model.connected && m['computer'] == model.desktop?.fingerprint;
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
            ListTile(
              leading: Icon(Icons.auto_fix_high_outlined),
              title: Text(tr("重新精修")),
              enabled: online,
              onTap: () => Navigator.pop(ctx, 'refine'),
            ),
            ListTile(
              leading: Icon(Icons.translate),
              title: Text(tr("翻译")),
              enabled: online,
              onTap: () => Navigator.pop(ctx, 'translate'),
            ),
            ListTile(
              leading: Icon(Icons.drive_file_move_outline),
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
              leading: Icon(
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
        final yes = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text(tr("重新精修会议？")),
            content: Text(tr("电脑将使用已有录音重新生成字幕，当前字幕可能被替换。")),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(tr("取消")),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(tr("重新精修")),
              ),
            ],
          ),
        );
        if (yes != true || !mounted) return;
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
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(24, 8, 24, 20),
          child: Ink(
            decoration: BoxDecoration(
              color: Theme.of(
                context,
              ).colorScheme.onSurface.withValues(alpha: .035),
              borderRadius: BorderRadius.circular(8),
            ),
            child: ListTile(
              contentPadding: EdgeInsets.symmetric(horizontal: 16),
              minVerticalPadding: 8,
              leading: Icon(Icons.laptop_outlined, size: 22),
              title: Text(
                model.desktop == null
                    ? tr("连接电脑")
                    : '${model.desktop!.name} · ${model.connected ? tr("已连接") : tr("离线")}',
                style: TextStyle(fontSize: 14),
              ),
              trailing: Icon(Icons.chevron_right, size: 20),
              onTap: () => setState(() => tab = 1),
            ),
          ),
        ),
        if (searching)
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 24),
            child: TextField(
              autofocus: true,
              onChanged: (v) => setState(() => query = v),
              decoration: InputDecoration(
                hintText: tr("搜索本机会议"),
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
            ),
          ),
        SizedBox(height: 24),
        Expanded(
          child: values.isEmpty
              ? Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.article_outlined, size: 42),
                        SizedBox(height: 24),
                        Text(
                          query.isEmpty ? tr("还没有会议记录") : tr("没有找到会议"),
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        SizedBox(height: 12),
                        Text(
                          tr("手机录音，电脑转写。\n转写和笔记会回到这里。"),
                          textAlign: TextAlign.center,
                        ),
                      ],
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
                              padding: EdgeInsets.only(top: 16, bottom: 12),
                              child: Text(
                                dayLabel(date),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ),
                          Dismissible(
                            key: ValueKey(m['id']),
                            direction:
                                m['finished'] == true ||
                                    m['remoteDeleted'] == true
                                ? DismissDirection.startToEnd
                                : DismissDirection.none,
                            background: Container(
                              alignment: Alignment.centerLeft,
                              padding: EdgeInsets.all(20),
                              color: Theme.of(
                                context,
                              ).colorScheme.errorContainer,
                              child: Icon(
                                Icons.delete_outline,
                                color: Theme.of(
                                  context,
                                ).colorScheme.onErrorContainer,
                              ),
                            ),
                            confirmDismiss: (_) async {
                              await deleteRecord(m);
                              return false;
                            },
                            child: ListTile(
                              contentPadding: EdgeInsets.zero,
                              minVerticalPadding: 16,
                              title: Text(
                                m['title'],
                                style: TextStyle(fontWeight: FontWeight.w600),
                              ),
                              subtitle: Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text:
                                          '${durationText(m['samples'] ?? 0)} · ',
                                    ),
                                    TextSpan(
                                      text: label,
                                      style: TextStyle(
                                        color: m['finished'] == true
                                            ? Color(0xff16803c)
                                            : null,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  if (date != null)
                                    Text(
                                      '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}',
                                      style: Theme.of(
                                        context,
                                      ).textTheme.bodySmall,
                                    ),
                                  SizedBox(width: 8),
                                  Icon(Icons.chevron_right, size: 20),
                                ],
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
        Padding(
          padding: EdgeInsets.all(24),
          child: SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: model.busy ? null : prepare,
              icon: Icon(Icons.mic_none),
              label: Text(model.busy ? tr("正在准备…") : tr("新建录音")),
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
      appBar: tab == 1 && model.desktop == null
          ? null
          : AppBar(
              centerTitle: false,
              titleSpacing: 24,
              toolbarHeight: 88,
              actions: [
                if (tab == 0)
                  IconButton(
                    tooltip: tr("搜索会议"),
                    onPressed: () => setState(() {
                      searching = !searching;
                      if (!searching) query = '';
                    }),
                    icon: Icon(searching ? Icons.close : Icons.search),
                  ),
                SizedBox(width: 12),
              ],
              title: Text(
                [tr("会议"), tr("连接"), tr("设置")][tab],
                style: TextStyle(fontSize: 32, fontWeight: FontWeight.w600),
              ),
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
            top: BorderSide(color: Theme.of(context).dividerColor),
          ),
        ),
        child: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (v) => setState(() => tab = v),
          destinations: [
            NavigationDestination(
              icon: Icon(Icons.article_outlined),
              label: tr("会议"),
            ),
            NavigationDestination(
              icon: Icon(Icons.laptop_outlined),
              label: tr("连接"),
            ),
            NavigationDestination(
              icon: Icon(Icons.settings_outlined),
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
  const ConnectionPage({super.key, required this.model, this.onConnected});
  @override
  State<ConnectionPage> createState() => _ConnectionPageState();
}

class _ConnectionPageState extends State<ConnectionPage> {
  final address = TextEditingController();
  final pin = TextEditingController();
  bool loading = false, manual = false;
  String? verification, result;
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
      candidate.remote = response['remote'] == null
          ? null
          : Map<String, dynamic>.from(response['remote']);
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
        });
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
  Widget build(BuildContext context) {
    final computer = widget.model.desktop;
    final waiting = loading && verification != null;
    if (!manual && !waiting && computer == null) {
      return LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: IntrinsicHeight(
              child: Padding(
                padding: EdgeInsets.fromLTRB(24, 48, 24, 24),
                child: Column(
                  children: [
                    Spacer(),
                    Text(
                      'Brevia',
                      style: TextStyle(
                        fontSize: 48,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -1.5,
                      ),
                    ),
                    SizedBox(height: 8),
                    Text(
                      tr("手机录音，电脑转写"),
                      style: Theme.of(context).textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                    SizedBox(height: 48),
                    PairingIllustration(),
                    SizedBox(height: 32),
                    Text(
                      tr("在同一网络连接电脑，\n转写和笔记实时回到手机。"),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    Spacer(),
                    SizedBox(height: 40),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: loading ? null : scan,
                        icon: Icon(Icons.qr_code_scanner, size: 20),
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
                        Icon(
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
              icon: Icon(Icons.arrow_back_ios_new, size: 20),
            ),
          ),
        SizedBox(height: 24),
        ...[
          Icon(Icons.laptop_outlined, size: 64),
          SizedBox(height: 24),
          Text(
            waiting
                ? tr("请在电脑上允许连接")
                : manual
                ? tr("输入电脑上的配对码")
                : computer!.name,
            textAlign: TextAlign.center,
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
          for (final entry in widget.model.nearby.entries)
            ListTile(
              leading: Icon(Icons.laptop_outlined),
              title: Text(entry.value),
              trailing: Icon(Icons.chevron_right),
              onTap: () => setState(() => address.text = entry.key),
            ),
          TextField(
            controller: address,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: tr("电脑的局域网地址"),
              hintText: 'https://192.168.1.24:43187',
            ),
          ),
          SizedBox(height: 24),
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
          TextButton(
            onPressed: loading ? null : scan,
            child: Text(tr("改用扫码连接")),
          ),
        ] else if (computer == null) ...[
          FilledButton.icon(
            onPressed: loading ? null : scan,
            icon: Icon(Icons.qr_code_scanner, size: 20),
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
          Text(
            widget.model.connected ? tr("● 已连接") : tr("离线 · 已保留信任"),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          SizedBox(height: 24),
          Divider(),
          ListTile(
            leading: Icon(Icons.sync),
            title: Text(tr("自动重连")),
            subtitle: Text(tr("录音期间保持连接，断线后保留并补传")),
          ),
          Divider(),
          ListTile(
            leading: Icon(Icons.qr_code_scanner),
            title: Text(tr("重新扫码连接")),
            trailing: Icon(Icons.chevron_right),
            onTap: loading ? null : scan,
          ),
          Divider(),
          ListTile(
            leading: Icon(Icons.edit_outlined),
            title: Text(tr("更新电脑地址")),
            trailing: Icon(Icons.chevron_right),
            onTap: () async {
              final text = TextEditingController(text: computer.address);
              final value = await showDialog<String>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: Text(tr("更新电脑地址")),
                  content: TextField(
                    controller: text,
                    keyboardType: TextInputType.url,
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: Text(tr("取消")),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, text.text),
                      child: Text(tr("连接")),
                    ),
                  ],
                ),
              );
              text.dispose();
              if (value != null && context.mounted) {
                await report(context, () => widget.model.updateAddress(value));
              }
            },
          ),
          Divider(),
          TextButton(
            onPressed: () => report(context, () => widget.model.forget()),
            child: Text(
              tr("取消信任此电脑"),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
          SizedBox(height: 24),
          Text(
            tr(
              computer.remote == null
                  ? '跨网连接需要先在电脑配置服务。'
                  : '已配置跨网连接，直连失败时通过加密中继连接。',
            ),
            textAlign: TextAlign.center,
          ),
        ],
        if (result != null)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text(result!, textAlign: TextAlign.center),
          ),
        if (manual || computer != null)
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(tr("连接帮助")),
            children: [
              Text(
                widget.model.discoveryError ??
                    tr(
                      "在电脑 Brevia「设备连接」中显示配对码。检查同一局域网、系统权限及防火墙；访客 Wi-Fi 可能隔离设备，可尝试电脑热点。",
                    ),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              TextButton(
                onPressed: () => widget.model.discover(),
                child: Text(tr("重新查找电脑")),
              ),
            ],
          ),
      ],
    );
  }
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
    backgroundColor: Colors.black,
    appBar: AppBar(
      backgroundColor: Colors.black,
      foregroundColor: Colors.white,
      title: Text(tr("扫描二维码"), style: TextStyle(color: Colors.white)),
    ),
    body: Stack(
      children: [
        Positioned.fill(
          child: MobileScanner(
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
                    if (v is Map && v['v'] == 1 && v['secret'] is String) {
                      found = true;
                      Navigator.pop(context, raw);
                    }
                  } catch (_) {}
                }
              }
            },
          ),
        ),
        Positioned(
          top: 24,
          left: 24,
          right: 24,
          child: IgnorePointer(
            child: Text(
              tr("在电脑 Brevia 中打开「设备连接」"),
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white, fontSize: 14),
            ),
          ),
        ),
        Center(
          child: IgnorePointer(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 2),
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
        ),
        Positioned(
          bottom: 32,
          left: 24,
          right: 24,
          child: SafeArea(
            child: TextButton.icon(
              onPressed: () => Navigator.pop(context, 'manual'),
              icon: Icon(Icons.dialpad, color: Colors.white),
              label: Text(tr("输入配对码"), style: TextStyle(color: Colors.white)),
            ),
          ),
        ),
      ],
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

  Future<void> end() async {
    final yes = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SingleChildScrollView(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(tr("结束本次录音？"), style: Theme.of(ctx).textTheme.headlineSmall),
            SizedBox(height: 24),
            Text(
              tr(
                meeting['localOnly'] == true
                    ? "结束后由你选择电脑并上传，录音期间不传输音频。"
                    : "尚未传到电脑的音频会保留在手机，连接后继续补传。",
              ),
            ),
            SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(tr("结束并保存")),
            ),
            SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text(tr("继续录音")),
            ),
          ],
        ),
      ),
    );
    if (yes == true && mounted) {
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
            Text(
              tr("记录重点 · {0}", [durationText(meeting['samples'] ?? 0)]),
              style: Theme.of(ctx).textTheme.titleLarge,
            ),
            SizedBox(height: 24),
            TextField(
              controller: text,
              maxLength: 200,
              decoration: InputDecoration(labelText: tr("备注（选填）")),
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
        child: Text(tr("暂无转写。电脑处理后的文字会显示在这里。")),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: list
          .map(
            (s) => Padding(
              padding: EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextButton(
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      alignment: Alignment.centerLeft,
                      minimumSize: Size(48, ended ? 48 : 28),
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
                      '${durationText((s['start_ms'] as num? ?? 0) * 16)}   ${s['speaker_name'] ?? s['speaker'] ?? tr("发言人")}',
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
              ),
            ),
          )
          .toList(),
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
      final label = state == 'recording' && live
          ? tr("录音中")
          : ended
          ? tr("录音已结束")
          : state == 'starting' && live
          ? tr("正在开始")
          : tr("录音已暂停");
      if (!ended && following && tab == 0) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && scroll.hasClients) {
            scroll.jumpTo(scroll.position.maxScrollExtent);
          }
        });
      }
      return Scaffold(
        appBar: AppBar(
          title: Text(m['title'] ?? tr("会议")),
          actions: [
            PopupMenuButton<String>(
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
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: Text(tr("删除手机上的会议？")),
                    content: Text(
                      tr(
                        m['localOnly'] == true
                            ? "此录音仅保存在手机。请先导出需要保留的录音，删除后无法恢复。"
                            : m['remoteDeleted'] == true
                            ? "电脑上的会议已删除。本机可能是唯一副本，请先导出需要保留的录音。删除后无法恢复。"
                            : "将删除本机录音、转写与笔记缓存。电脑上的会议仍会保留。此操作无法撤销。",
                      ),
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: Text(tr("取消")),
                      ),
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        child: Text(tr("删除本机记录")),
                      ),
                    ],
                  ),
                );
                if (confirmed == true && context.mounted) {
                  await report(context, () async {
                    await _player?.stop();
                    await widget.model.deleteMeeting(widget.id);
                    if (context.mounted) Navigator.pop(context);
                  });
                }
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
                icon: Icon(Icons.ios_share),
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
                    if (ended)
                      Padding(
                        padding: EdgeInsets.only(bottom: 12),
                        child: Text(
                          m['title'] ?? tr("会议"),
                          style: Theme.of(context).textTheme.headlineLarge,
                        ),
                      ),
                    Row(
                      children: [
                        if (!ended) ...[
                          Icon(
                            state == 'recording' && live
                                ? Icons.circle
                                : Icons.pause_circle_filled,
                            size: 12,
                            color: state == 'recording' && live
                                ? Color(0xffff3b30)
                                : Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                          ),
                          SizedBox(width: 10),
                        ],
                        Flexible(
                          child: Text(
                            ended
                                ? '${durationText(m['samples'] ?? 0)} · ${m['localOnly'] == true
                                      ? tr("仅保存在手机")
                                      : m['finished'] == true
                                      ? tr("已同步")
                                      : tr("待补传")}'
                                : label,
                            style: TextStyle(
                              color: state == 'recording' && live
                                  ? Color(0xffff3b30)
                                  : null,
                            ),
                          ),
                        ),
                        if (!ended) ...[
                          SizedBox(width: 16),
                          Text(durationText(m['samples'] ?? 0)),
                        ],
                      ],
                    ),
                    if (!ended) ...[
                      SizedBox(height: 12),
                      Row(
                        children: [
                          Icon(Icons.laptop_outlined, size: 19),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              tr("已传到电脑  {0}", [
                                durationText(snapshot['samples'] ?? 0),
                              ]),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                        ],
                      ),
                    ],
                    if (m['localOnly'] == true)
                      Padding(
                        padding: EdgeInsets.only(top: 16),
                        child: Text(tr('仅保存在手机')),
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
                          icon: Icon(Icons.upload_outlined),
                          label: Text(tr('上传到电脑')),
                        ),
                      ),
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
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    if (!live && !ended)
                      Padding(
                        padding: EdgeInsets.only(top: 16),
                        child: Text(tr("上次录音已中断。已录内容保留，中断期间没有录音。")),
                      ),
                    if ((m['gaps'] as List? ?? []).isNotEmpty)
                      Text(tr("本次录音包含中断缺口"), style: TextStyle(fontSize: 13)),
                  ],
                ),
              ),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 24),
                child: Row(
                  children: [
                    for (final (i, text)
                        in (ended
                            ? [(1, tr("笔记")), (0, tr("转写")), (2, tr("重点"))]
                            : [(0, tr("转写")), (1, tr("笔记"))]))
                      Expanded(
                        child: AnimatedContainer(
                          duration: MediaQuery.disableAnimationsOf(context)
                              ? Duration.zero
                              : Duration(milliseconds: 180),
                          decoration: BoxDecoration(
                            border: Border(
                              bottom: BorderSide(
                                color: tab == i
                                    ? Theme.of(context).colorScheme.primary
                                    : Theme.of(context).dividerColor,
                                width: tab == i ? 2 : 1,
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
                                color: tab == i
                                    ? Theme.of(context).colorScheme.primary
                                    : Theme.of(
                                        context,
                                      ).colorScheme.onSurfaceVariant,
                                fontWeight: tab == i
                                    ? FontWeight.w600
                                    : FontWeight.normal,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (ended && tab == 0)
                Padding(
                  padding: EdgeInsets.fromLTRB(24, 8, 24, 8),
                  child: TextField(
                    onChanged: (v) => setState(() => query = v),
                    decoration: InputDecoration(
                      hintText: tr("搜索转写"),
                      prefixIcon: Icon(Icons.search),
                      isDense: true,
                    ),
                  ),
                ),
              Expanded(
                child: ListView(
                  controller: scroll,
                  padding: EdgeInsets.all(24),
                  children: [
                    if (tab == 0)
                      transcript(snapshot['segments'] as List? ?? [], ended),
                    if (tab == 1)
                      SelectionArea(
                        child: MarkdownBody(
                          data: (snapshot['notes'] as String? ?? '').isEmpty
                              ? tr("电脑生成或保存笔记后会显示在这里。")
                              : snapshot['notes'],
                          sizedImageBuilder: (_) => Text(tr("图片请在电脑查看")),
                          styleSheet: MarkdownStyleSheet(
                            p: Theme.of(context).textTheme.bodyLarge,
                            h2: Theme.of(context).textTheme.headlineSmall,
                            h2Padding: EdgeInsets.only(top: 24, bottom: 16),
                            blockSpacing: 20,
                          ),
                        ),
                      ),
                    if (tab == 2) ...[
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
              if (!ended && tab == 0 && !following)
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
                margin: EdgeInsets.fromLTRB(12, 8, 12, 12),
                padding: EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? Color(0xff2e2e2e)
                      : Colors.white,
                  border: Border.all(color: Theme.of(context).dividerColor),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: ended
                    ? Column(
                        children: [
                          Row(
                            children: [
                              StreamBuilder<PlayerState>(
                                stream: player.playerStateStream,
                                builder: (_, value) => IconButton(
                                  tooltip: value.data?.playing == true
                                      ? tr("暂停回听")
                                      : tr("回听本机录音"),
                                  onPressed: loadingAudio ? null : play,
                                  icon: Icon(
                                    value.data?.playing == true
                                        ? Icons.pause
                                        : Icons.play_arrow,
                                    size: 30,
                                  ),
                                ),
                              ),
                              Expanded(
                                child: StreamBuilder<Duration>(
                                  stream: player.positionStream,
                                  builder: (_, pos) => Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${durationText((pos.data?.inMilliseconds ?? 0) * 16)} / ${durationText(m['samples'] ?? 0)}',
                                        style: Theme.of(
                                          context,
                                        ).textTheme.bodySmall,
                                      ),
                                      SizedBox(
                                        height: 28,
                                        child: Slider(
                                          value:
                                              (pos.data?.inMilliseconds
                                                          .toDouble() ??
                                                      0)
                                                  .clamp(
                                                    0,
                                                    (player
                                                                .duration
                                                                ?.inMilliseconds
                                                                .toDouble() ??
                                                            1)
                                                        .clamp(
                                                          1,
                                                          double.infinity,
                                                        ),
                                                  ),
                                          max:
                                              (player.duration?.inMilliseconds
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
                                      ),
                                    ],
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
                                child: Text('${player.speed}×'),
                              ),
                            ],
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
                    : Row(
                        children: [
                          Expanded(
                            child: FilledButton.icon(
                              icon: Icon(
                                state == 'recording' && live
                                    ? Icons.pause
                                    : Icons.play_arrow,
                                size: 18,
                              ),
                              onPressed: () => report(context, () async {
                                if (!live) {
                                  await widget.model.start(
                                    m['title'],
                                    existing: widget.id,
                                  );
                                } else {
                                  await widget.model.command(
                                    widget.id,
                                    state == 'recording' ? 'pause' : 'resume',
                                  );
                                }
                              }),
                              label: Text(
                                state == 'recording' && live
                                    ? tr("暂停")
                                    : tr("继续"),
                              ),
                            ),
                          ),
                          SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton.icon(
                              icon: Icon(Icons.bookmark_border, size: 18),
                              onPressed: live ? mark : null,
                              label: Text(tr("重点")),
                            ),
                          ),
                          SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton.icon(
                              icon: Icon(Icons.stop, size: 18),
                              onPressed: end,
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Theme.of(
                                  context,
                                ).colorScheme.error,
                                side: BorderSide(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                              label: Text(tr("结束")),
                            ),
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
  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.all(24),
    children: [
      ListTile(
        contentPadding: EdgeInsets.zero,
        minTileHeight: 76,
        leading: Icon(Icons.language),
        title: Text(tr("界面语言")),
        subtitle: Text(
          uiLanguage == 'system' ? tr("跟随系统") : languageNames[uiLanguage]!,
        ),
        trailing: Icon(Icons.chevron_right),
        onTap: () => showModalBottomSheet(
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
                for (final entry in {
                  'system': tr("跟随系统"),
                  ...languageNames,
                }.entries)
                  ListTile(
                    title: Text(entry.value),
                    trailing: uiLanguage == entry.key
                        ? Icon(Icons.check)
                        : null,
                    onTap: () {
                      model.setLanguage(entry.key);
                      Navigator.pop(ctx);
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
      Divider(height: 1),
      ListTile(
        contentPadding: EdgeInsets.zero,
        minVerticalPadding: 20,
        minTileHeight: 76,
        leading: Icon(Icons.mic_none),
        title: Text(tr("录音与后台")),
        trailing: Icon(Icons.chevron_right),
        onTap: () => info(
          context,
          tr("录音与后台"),
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(
                leading: Icon(Icons.mic_none),
                title: Text(tr("麦克风")),
                trailing: Text(tr("手机内置"), style: TextStyle(fontSize: 14)),
              ),
              Divider(height: 1),
              ListTile(
                leading: Icon(Icons.shield_outlined),
                title: Text(tr("麦克风权限")),
                trailing: Icon(Icons.chevron_right),
                onTap: openAppSettings,
              ),
              Divider(height: 1),
              ListTile(
                leading: Icon(Icons.description_outlined),
                title: Text(tr("后台录音说明")),
                trailing: Icon(Icons.chevron_right),
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
        minVerticalPadding: 20,
        minTileHeight: 76,
        leading: Icon(Icons.laptop_outlined),
        title: Text(tr("连接与设备")),
        trailing: Icon(Icons.chevron_right),
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
        minVerticalPadding: 20,
        minTileHeight: 76,
        leading: Icon(Icons.storage_outlined),
        title: Text(tr("本地存储")),
        trailing: Icon(Icons.chevron_right),
        onTap: () => info(
          context,
          tr("本地存储"),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${(model.meetings.fold<num>(0, (total, m) => total + (m['samples'] ?? 0)) * 2 / 1000000).toStringAsFixed(1)} MB',
                style: Theme.of(context).textTheme.headlineLarge,
              ),
              SizedBox(height: 24),
              Text(tr("原始录音保留在本机；未补传的录音不会自动删除。卸载应用会删除本机数据。")),
              SizedBox(height: 24),
              for (final m in model.meetings)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(m['title']),
                  subtitle: Text(
                    m['finished'] == true
                        ? tr("已同步 · 可导出本地音频")
                        : tr("待同步 · 受保护"),
                  ),
                  trailing: IconButton(
                    tooltip: tr("导出音频"),
                    icon: Icon(Icons.ios_share),
                    onPressed: () => report(context, () async {
                      if (m['state'] != 'ended') {
                        throw StateError(tr("请先结束录音再导出"));
                      }
                      final root = await recordingsRoot();
                      final store = await RecordingStore.load(
                        Directory('${root.path}/${m['id']}'),
                      );
                      final wav = await store.wav(
                        await getTemporaryDirectory(),
                      );
                      await SharePlus.instance.share(
                        ShareParams(files: [XFile(wav.path)]),
                      );
                    }),
                  ),
                ),
            ],
          ),
        ),
      ),
      Divider(height: 1),
      ListTile(
        contentPadding: EdgeInsets.zero,
        minVerticalPadding: 20,
        minTileHeight: 76,
        leading: Icon(Icons.brightness_6_outlined),
        title: Text(tr("外观")),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              {
                'system': tr("跟随系统"),
                'light': tr("浅色"),
                'dark': tr("深色"),
              }[model.appearance]!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            SizedBox(width: 12),
            Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => showModalBottomSheet(
          context: context,
          showDragHandle: true,
          builder: (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final e in {
                  'system': tr("跟随系统"),
                  'light': tr("浅色"),
                  'dark': tr("深色"),
                }.entries)
                  ListTile(
                    title: Text(e.value),
                    onTap: () {
                      model.setAppearance(e.key);
                      Navigator.pop(ctx);
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
      Divider(height: 1),
      ListTile(
        contentPadding: EdgeInsets.zero,
        minVerticalPadding: 20,
        minTileHeight: 76,
        leading: Icon(Icons.privacy_tip_outlined),
        title: Text(tr("隐私与关于")),
        trailing: Icon(Icons.chevron_right),
        onTap: () => info(
          context,
          tr("隐私与关于"),
          Text(
            tr(
              "Brevia Mobile 0.1\n\n音频仅在手机与已配对电脑之间传输，语音识别在电脑执行。电脑如启用了在线 AI，相关文字按电脑设置发送。\n\n手机不运行转写模型。录音与本地回看不需要注册账号。\n\n测试版：真机后台运行、功耗和中断恢复仍需按项目验收清单验证。",
            ),
          ),
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
  late bool offline;
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
    padding: EdgeInsets.only(bottom: 24),
    child: DropdownButtonFormField<String>(
      key: ValueKey('$label:$value'),
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: choices.entries
          .map(
            (e) => DropdownMenuItem(
              value: e.key,
              child: Text(e.value, overflow: TextOverflow.ellipsis),
            ),
          )
          .toList(),
      onChanged: (v) {
        if (v != null) setState(() => changed(v));
      },
    ),
  );
  @override
  Widget build(BuildContext context) {
    final ready =
        offline ||
        models.any((m) => m['id'] == modelId && m['status'] == 'ready');
    return Scaffold(
      appBar: AppBar(
        centerTitle: false,
        toolbarHeight: 88,
        title: Text(
          tr(widget.upload ? "上传录音" : "准备录音"),
          style: Theme.of(context).textTheme.headlineLarge,
        ),
      ),
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
            Container(
              padding: EdgeInsets.all(16),
              decoration: BoxDecoration(
                border: Border.all(color: Theme.of(context).dividerColor),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(
                    offline
                        ? Icons.phone_iphone_outlined
                        : Icons.laptop_outlined,
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(offline ? tr("仅保存在手机") : widget.computer),
                  ),
                  SizedBox(width: 12),
                  if (!offline)
                    Icon(
                      Icons.check_circle,
                      color: Color(0xff16803c),
                      size: 20,
                    ),
                ],
              ),
            ),
            if (!widget.upload && widget.options.isNotEmpty)
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: Text(tr("仅保存在手机")),
                subtitle: Text(tr("结束后由你选择电脑并上传，录音期间不传输音频。")),
                value: offline,
                onChanged: (value) => setState(() => offline = value),
              ),
            if (offline)
              Padding(
                padding: EdgeInsets.only(top: 16),
                child: Text(tr("无需连接电脑。录音保存在本机，连接后由你主动上传。")),
              ),
            SizedBox(height: 32),
            TextField(
              controller: title,
              maxLength: 120,
              decoration: InputDecoration(
                labelText: tr("会议标题"),
                floatingLabelBehavior: FloatingLabelBehavior.always,
                counterText: '',
                suffixIcon: IconButton(
                  tooltip: tr("清空标题"),
                  onPressed: title.clear,
                  icon: Icon(Icons.close, size: 18),
                ),
              ),
            ),
            SizedBox(height: 24),
            select(tr("会议语言"), language, languages, (v) {
              language = v;
              selectDefault();
            }),
            TextField(
              controller: participants,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(3),
              ],
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: tr("参会人数"),
                hintText: tr("自动识别"),
                helperText: tr("可留空；已知人数用于电脑端说话人区分。"),
                helperMaxLines: 3,
              ),
            ),
            SizedBox(height: 24),
            if (!widget.upload)
              ListTile(
                leading: Icon(Icons.mic_none),
                title: Text(tr("手机内置麦克风")),
                subtitle: Text(tr(offline ? "仅保存在手机" : "手机采集音频，电脑完成转写")),
              ),
            Divider(),
            if (!offline)
              ListTile(
                leading: Icon(Icons.laptop_outlined),
                title: Text(ready ? tr("电脑已就绪") : tr("电脑尚未就绪")),
                trailing: Icon(
                  ready ? Icons.check_circle : Icons.info_outline,
                  color: ready
                      ? Color(0xff16803c)
                      : Theme.of(context).colorScheme.error,
                ),
              ),
            if (!offline) Divider(),
            if (!offline)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                leading: Icon(Icons.tune),
                title: Text(tr("录音选项")),
                subtitle: Text(
                  '${languages[language]} · ${translation.isEmpty ? tr("不翻译") : languages[translation]}',
                ),
                children: [
                  SizedBox(height: 24),
                  select(tr("工作区"), workspace, {
                    '': tr("不指定工作区"),
                    for (final w in widget.options['workspaces'])
                      w['id']: w['name'],
                  }, (v) => workspace = v),
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
                  select(tr("翻译为"), translation, {
                    '': tr("不翻译"),
                    for (final e in languages.entries.where(
                      (e) => e.key != 'auto',
                    ))
                      e.key: e.value,
                  }, (v) => translation = v),
                ],
              ),
            SizedBox(height: 24),
            if (!ready)
              Padding(
                padding: EdgeInsets.only(bottom: 24),
                child: Text(tr("请先在电脑的模型库安装所选识别模型，然后返回重新准备会议。")),
              ),

            Text(
              tr("录音前请告知参与者。"),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

/// The same simple phone → transcript diagram as the connection reference.
class PairingIllustration extends StatelessWidget {
  const PairingIllustration({super.key});
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: CustomPaint(
      size: Size(280, 140),
      painter: _PairingPainter(
        Theme.of(context).colorScheme.onSurface,
        Theme.of(context).dividerColor,
      ),
    ),
  );
}

class _PairingPainter extends CustomPainter {
  final Color ink, line;
  const _PairingPainter(this.ink, this.line);
  @override
  void paint(Canvas canvas, Size size) {
    final stroke = Paint()
      ..color = ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(8, 20, 52, 102),
        Radius.circular(8),
      ),
      stroke,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(154, 18, 118, 92),
        Radius.circular(3),
      ),
      stroke,
    );
    canvas.drawPath(
      Path()
        ..moveTo(140, 112)
        ..lineTo(280, 112)
        ..lineTo(274, 119)
        ..lineTo(146, 119)
        ..close(),
      stroke,
    );
    final red = Paint()
      ..color = Color(0xffff3b30)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromLTWH(30, 55, 9, 21), Radius.circular(5)),
      Paint()..color = red.color,
    );
    canvas.drawArc(Rect.fromLTWH(25, 61, 19, 23), 0, 3.14159, false, red);
    canvas.drawLine(Offset(34.5, 84), Offset(34.5, 91), red);
    canvas.drawLine(Offset(29, 92), Offset(40, 92), red);
    final muted = Paint()
      ..color = ink.withValues(alpha: .25)
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;
    for (var i = 0; i < 3; i++) {
      canvas.drawCircle(
        Offset(85 + i * 16, 72),
        2.5,
        Paint()..color = muted.color,
      );
      canvas.drawLine(
        Offset(180, 48 + i * 15),
        Offset(i == 2 ? 232 : 249, 48 + i * 15),
        muted,
      );
    }
  }

  @override
  bool shouldRepaint(_PairingPainter old) => old.ink != ink || old.line != line;
}

class ConnectionRecoveryNotice extends StatelessWidget {
  const ConnectionRecoveryNotice({super.key});
  @override
  Widget build(BuildContext context) => Container(
    margin: EdgeInsets.only(top: 20),
    padding: EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Theme.of(context).brightness == Brightness.dark
          ? Color(0xff40351f)
          : Color(0xfffff4df),
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
              SizedBox(height: 32),
              Text(
                tr("录音已结束"),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              SizedBox(height: 16),
              Text(
                durationText(m['samples'] ?? 0),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 48, fontWeight: FontWeight.w600),
              ),
              SizedBox(height: 40),
              Divider(height: 1),
              ListTile(
                leading: Icon(Icons.phone_iphone_outlined),
                title: Text(tr("手机录音")),
                subtitle: Text(tr("已保存")),
                trailing: Icon(Icons.check_circle, color: Color(0xff16803c)),
              ),
              Divider(height: 1),
              ListTile(
                leading: Icon(Icons.laptop_outlined),
                title: Text(tr("传到电脑")),
                subtitle: Text(
                  m['localOnly'] == true
                      ? tr("尚未上传")
                      : pending > 0
                      ? tr("待补传 {0}", [durationText(pending)])
                      : tr("音频已传输"),
                ),
                trailing: Icon(
                  pending > 0 ? Icons.schedule : Icons.check_circle,
                  color: pending > 0 ? Color(0xffa05a00) : Color(0xff16803c),
                ),
              ),
              Divider(height: 1),
              ListTile(
                leading: Icon(Icons.description_outlined),
                title: Text(tr("会议笔记")),
                subtitle: Text(
                  (snapshot['notes'] ?? '').toString().isEmpty
                      ? tr("等待电脑整理")
                      : tr("已收到电脑笔记"),
                ),
                trailing: Icon(Icons.more_horiz),
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
                  icon: Icon(Icons.upload_outlined),
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
                child: Text(tr("查看转写与笔记")),
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
