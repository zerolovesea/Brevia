import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_model.dart';
import 'design_icons.dart';
import 'design_system.dart';
import 'i18n.dart';
import 'pairing_illustration.dart';

/// 首次配对沿用真实连接页面；只在用户完成或选择稍后时保存引导偏好。
class OnboardingGate extends StatefulWidget {
  final Widget child;
  final AppModel? model;
  final Widget Function(VoidCallback onConnected)? pairingBuilder;
  const OnboardingGate({
    super.key,
    required this.child,
    this.model,
    this.pairingBuilder,
  });
  @override
  State<OnboardingGate> createState() => _OnboardingGateState();
}

class _OnboardingGateState extends State<OnboardingGate> {
  bool? complete;
  int step = 0;
  bool saving = false;

  @override
  void initState() {
    super.initState();
    final paired = widget.model?.desktop != null;
    SharedPreferences.getInstance().then((prefs) {
      if (mounted) {
        setState(
          () => complete =
              paired || (prefs.getBool('onboardingComplete') ?? false),
        );
      }
    });
  }

  Future<void> finish() async {
    if (saving) return;
    setState(() => saving = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('onboardingComplete', true);
      if (mounted) setState(() => complete = true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(tr('重试'))));
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> copyDownload() async {
    try {
      await Clipboard.setData(
        ClipboardData(
          text:
              'https://brevia.work/index-${languageCode == 'zh' ? 'zh' : 'en'}.html#download',
        ),
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(tr('已复制电脑端下载地址'))));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(tr('重试'))));
      }
    }
  }

  Widget instruction(IconData icon, String title, String body) => ListTile(
    leading: BreviaIcon(icon),
    title: Text(tr(title)),
    subtitle: Text(tr(body)),
    contentPadding: EdgeInsets.zero,
  );

  Widget content() {
    if (step == 2 && widget.pairingBuilder != null) {
      return widget.pairingBuilder!(() {
        if (mounted) setState(() => step = 3);
      });
    }
    return ListView(
      key: ValueKey(step),
      padding: const EdgeInsets.all(24),
      children: [
        if (step == 0) ...[
          breviaBrand(),
          const SizedBox(height: 32),
          Text(
            tr('手机录音，电脑转写。'),
            style: Theme.of(context).textTheme.headlineLarge,
          ),
          const SizedBox(height: 12),
          Text(
            tr('先在电脑安装 Brevia，再用手机扫码配对。'),
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 32),
          const Center(child: PairingIllustration()),
          const SizedBox(height: 28),
          Text(tr('在电脑浏览器打开')),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.only(left: 16),
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).dividerColor),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                const Expanded(
                  child: SelectableText(
                    'brevia.work',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
                  ),
                ),
                IconButton(
                  tooltip: tr('复制电脑端下载地址'),
                  onPressed: copyDownload,
                  icon: const BreviaIcon(Icons.copy_outlined, size: 20),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Text('macOS  ·  Windows', textAlign: TextAlign.center),
        ] else if (step == 1 || step == 2) ...[
          Text(tr('在电脑上准备好'), style: Theme.of(context).textTheme.headlineLarge),
          const SizedBox(height: 12),
          Text(tr('安装完成后，打开 Brevia 的「设备连接」。')),
          const SizedBox(height: 24),
          const Center(child: PairingIllustration()),
          const SizedBox(height: 24),
          instruction(
            Icons.laptop_outlined,
            '安装并打开电脑端 Brevia',
            '在电脑浏览器打开 brevia.work，下载适合电脑的版本。',
          ),
          const Divider(height: 1),
          instruction(
            Icons.description_outlined,
            '完成电脑端的模型准备',
            '手机采集音频，电脑完成转写',
          ),
          const Divider(height: 1),
          instruction(
            Icons.qr_code_scanner,
            '打开「设备连接 → 连接新设备」',
            '手机与电脑需在同一局域网',
          ),
          const SizedBox(height: 24),
          Text(tr('按需授权'), style: Theme.of(context).textTheme.titleLarge),
          instruction(Icons.mic_none, '麦克风', '首次录音时申请。'),
          instruction(Icons.wifi_outlined, '本地网络', '连接电脑时申请。'),
          instruction(Icons.camera_alt_outlined, '相机', '首次扫码时申请。'),
          Text(
            tr('可以使用手动配对，不必开启相机。'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ] else ...[
          const SizedBox(height: 24),
          Center(child: breviaLogo(size: 48)),
          const SizedBox(height: 32),
          const BreviaIcon(
            Icons.check_circle_outline,
            size: 56,
            color: Color(0xff16812e),
          ),
          const SizedBox(height: 20),
          Text(
            tr('配对成功'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineLarge,
          ),
          const SizedBox(height: 12),
          Text(
            widget.model?.desktop?.name ?? tr('已配对电脑'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 32),
          const Center(child: PairingIllustration()),
          const SizedBox(height: 24),
          instruction(Icons.mic_none, '手机采集音频', '转写和笔记会回到这里。'),
          const Divider(height: 1),
          instruction(
            Icons.phone_iphone_outlined,
            '原始录音保留在本机',
            '离线录音不会因配对自动上传。',
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (complete == true) return widget.child;
    if (complete == null) {
      return Scaffold(body: Center(child: breviaLogo(size: 64)));
    }
    final pairing = step == 2 && widget.pairingBuilder != null;
    return Scaffold(
      appBar: AppBar(
        leading: step > 0 && step < 3
            ? BackButton(
                onPressed: saving ? null : () => setState(() => step--),
              )
            : null,
        title: step < 3
            ? Text('${(step + 1).toString().padLeft(2, '0')} / 03')
            : null,
        actions: [
          if (step < 3)
            TextButton(
              onPressed: saving ? null : finish,
              child: Text(tr('稍后')),
            ),
        ],
      ),
      body: SafeArea(
        child: AnimatedSwitcher(
          duration: BreviaMotion.duration(context, BreviaMotion.state),
          reverseDuration: BreviaMotion.duration(
            context,
            BreviaMotion.feedback,
          ),
          switchInCurve: BreviaMotion.out,
          switchOutCurve: BreviaMotion.into,
          layoutBuilder: breviaPageLayout,
          child: KeyedSubtree(key: ValueKey(step), child: content()),
        ),
      ),
      bottomNavigationBar: pairing
          ? null
          : SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    FilledButton(
                      onPressed: saving
                          ? null
                          : step == 0
                          ? copyDownload
                          : step == 1
                          ? () => setState(() => step = 2)
                          : finish,
                      child: Text(
                        tr(
                          step == 0
                              ? '复制电脑端下载地址'
                              : step == 1
                              ? '已打开二维码，开始扫码'
                              : step == 3
                              ? '进入会议'
                              : '我知道了',
                        ),
                      ),
                    ),
                    if (step == 0) ...[
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: saving
                            ? null
                            : () => setState(() => step = 1),
                        child: Text(tr('电脑已安装，开始配对')),
                      ),
                      TextButton(
                        onPressed: saving ? null : finish,
                        child: Text(tr('先离线录音')),
                      ),
                    ],
                    if (step == 1)
                      TextButton(
                        onPressed: () => setState(() => step = 0),
                        child: Text(tr('查看电脑端下载地址')),
                      ),
                  ],
                ),
              ),
            ),
    );
  }
}
