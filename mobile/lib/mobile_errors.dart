import 'design_icons.dart';
import 'dart:io';

import 'package:flutter/material.dart';

import 'i18n.dart';
import 'storage.dart';
import 'translations.dart';

enum MobileErrorKind { microphone, pairingUnavailable, storageFull }

MobileErrorKind? mobileErrorKind(Object error) {
  final message = error.toString();
  bool matches(String key) =>
      message.contains(key.split('{0}').first) ||
      translations.values.any(
        (values) => message.contains((values[key] ?? key).split('{0}').first),
      );
  if (matches('需要麦克风权限，请前往系统设置')) return MobileErrorKind.microphone;
  if (matches('配对已过期或尝试过多，请在电脑重新开启配对')) {
    return MobileErrorKind.pairingUnavailable;
  }
  // 只把明确的 ENOSPC 当作空间不足，其他保存错误仍保留原原因。
  final localWrite =
      message.startsWith('FileSystemException:') ||
      matches('手机无法保存录音，请释放空间：{0}') ||
      matches('本地保存失败：{0}');
  if (error is FileSystemException && error.osError?.errorCode == 28 ||
      localWrite &&
          RegExp(r'\bENOSPC\b|\berrno\s*=\s*28\b').hasMatch(message)) {
    return MobileErrorKind.storageFull;
  }
  return null;
}

class MobileRecoveryPage extends StatelessWidget {
  final MobileErrorKind kind;
  final VoidCallback onPrimary;
  final VoidCallback? onSecondary;
  final VoidCallback? onReturn;
  final num savedSamples;
  const MobileRecoveryPage({
    super.key,
    required this.kind,
    required this.onPrimary,
    this.onSecondary,
    this.onReturn,
    this.savedSamples = 0,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (icon, title, description, primary, secondary) = switch (kind) {
      MobileErrorKind.microphone => (
        Icons.mic_none,
        '需要麦克风权限',
        '需要麦克风权限，请前往系统设置',
        '前往设置',
        '返回',
      ),
      MobileErrorKind.pairingUnavailable => (
        Icons.phonelink_erase_outlined,
        '配对已失效',
        '配对已过期或尝试过多，请在电脑重新开启配对',
        '重新扫码',
        '输入新配对码',
      ),
      MobileErrorKind.storageFull => (
        Icons.storage_outlined,
        '存储空间不足',
        '请释放存储空间后重试，已保存的录音会继续保留。',
        onSecondary == null ? '管理存储' : '导出已有录音',
        onSecondary == null ? '返回' : '管理存储',
      ),
    };
    return Scaffold(
      appBar: AppBar(
        leading: onReturn == null ? null : BackButton(onPressed: onReturn),
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: (constraints.maxHeight - 48).clamp(
                  0,
                  double.infinity,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      BreviaIcon(icon, size: 26, color: colors.error),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          tr(title),
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 32),
                  Text(
                    tr(description),
                    textAlign: TextAlign.start,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                  if (savedSamples > 0) ...[
                    SizedBox(height: 32),
                    Container(
                      decoration: BoxDecoration(
                        color: colors.surfaceContainerLowest,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: ListTile(
                        contentPadding: EdgeInsets.all(16),
                        leading: BreviaIcon(Icons.description_outlined),
                        title: Text(
                          '${tr("已保存")} ${durationText(savedSamples)}',
                        ),
                        subtitle: Text(tr('已保存部分可导出；尚未写入的音频不会包含在导出文件中。')),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              FilledButton(onPressed: onPrimary, child: Text(tr(primary))),
              SizedBox(height: 12),
              OutlinedButton(
                onPressed:
                    onSecondary ??
                    onReturn ??
                    () => Navigator.maybePop(context),
                child: Text(
                  tr(
                    onSecondary == null && onReturn != null
                        ? '返回录音'
                        : secondary,
                  ),
                ),
              ),
              if (onReturn != null && onSecondary != null) ...[
                SizedBox(height: 12),
                TextButton(onPressed: onReturn, child: Text(tr('返回录音'))),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
