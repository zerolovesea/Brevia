import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'i18n.dart';

Future<void> writeJson(File file, Object value) async {
  final tmp = File('${file.path}.tmp');
  await tmp.writeAsString(jsonEncode(value), flush: true);
  await tmp.rename(file.path);
}

class RecordingStore {
  final Directory directory;
  Map<String, dynamic> meta;
  final List<int> offsets = [];
  int samples = 0;
  RecordingStore(this.directory, this.meta);
  int get count => offsets.length;
  File chunk(int seq) => File('${directory.path}/$seq.pcm');
  Future<void> recover() async {
    final sequences = <int>[];
    await for (final entry in directory.list()) {
      final match = RegExp(
        r'^(0|[1-9][0-9]*)\.pcm$',
      ).firstMatch(entry.uri.pathSegments.last);
      if (match != null) sequences.add(int.parse(match[1]!));
    }
    sequences.sort();
    if (sequences.length < (meta['count'] as int? ?? 0) ||
        sequences.indexed.any((entry) => entry.$1 != entry.$2)) {
      throw FormatException(tr("本地录音分片损坏，请保留文件并联系支持"));
    }
    offsets.clear();
    samples = 0;
    for (final seq in sequences) {
      final length = await chunk(seq).length();
      if (length == 0 || length > 32000 || length.isOdd) {
        throw FormatException(tr("本地录音分片损坏，请保留文件并联系支持"));
      }
      offsets.add(samples);
      samples += length ~/ 2;
    }
    meta['samples'] = samples;
    meta['count'] = count;
  }

  Future<void> append(Uint8List bytes) async {
    if (bytes.isEmpty || bytes.length > 32000 || bytes.length.isOdd) {
      throw ArgumentError('Invalid PCM16 chunk');
    }
    if (await chunk(count).exists()) {
      throw FormatException(tr("本地录音分片损坏，请保留文件并联系支持"));
    }
    final tmp = File('${chunk(count).path}.tmp');
    await tmp.writeAsBytes(bytes, flush: true);
    await tmp.rename(chunk(count).path);
    offsets.add(samples);
    samples += bytes.length ~/ 2;
    // Recovery derives committed samples from PCM files even if metadata lags.
  }

  Future<void> save() async {
    meta['samples'] = samples;
    meta['count'] = count;
    await writeJson(File('${directory.path}/session.json'), meta);
  }

  static Future<Map<String, dynamic>> metadata(Directory dir) async =>
      jsonDecode(await File('${dir.path}/session.json').readAsString())
          as Map<String, dynamic>;

  static Future<RecordingStore> load(Directory dir) async {
    final meta = await metadata(dir);
    final store = RecordingStore(dir, meta);
    await store.recover();
    return store;
  }

  Future<void> deleteLocal() async {
    if (meta['state'] != 'ended' ||
        (meta['finished'] != true &&
            meta['remoteDeleted'] != true &&
            meta['localOnly'] != true)) {
      throw StateError(tr("请先结束录音并完成同步，以免丢失尚未传到电脑的音频"));
    }
    await directory.delete(recursive: true);
  }

  Future<File> wav(Directory output) async {
    final file = File('${output.path}/${meta['id']}.wav');
    final h = ByteData(44);
    for (final pair in {0: 'RIFF', 8: 'WAVE', 12: 'fmt ', 36: 'data'}.entries) {
      for (var i = 0; i < pair.value.length; i++) {
        h.setUint8(pair.key + i, pair.value.codeUnitAt(i));
      }
    }
    h.setUint32(4, 36 + samples * 2, Endian.little);
    h.setUint32(16, 16, Endian.little);
    h.setUint16(20, 1, Endian.little);
    h.setUint16(22, 1, Endian.little);
    h.setUint32(24, 16000, Endian.little);
    h.setUint32(28, 32000, Endian.little);
    h.setUint16(32, 2, Endian.little);
    h.setUint16(34, 16, Endian.little);
    h.setUint32(40, samples * 2, Endian.little);
    final out = await file.open(mode: FileMode.write);
    try {
      await out.writeFrom(h.buffer.asUint8List());
      for (var i = 0; i < count; i++) {
        await out.writeFrom(await chunk(i).readAsBytes());
      }
      await out.flush();
    } finally {
      await out.close();
    }
    return file;
  }
}

String durationText(num samples) {
  final total = samples ~/ 16000;
  final h = total ~/ 3600;
  return '${h > 0 ? '${h.toString().padLeft(2, '0')}:' : ''}${(total ~/ 60 % 60).toString().padLeft(2, '0')}:${(total % 60).toString().padLeft(2, '0')}';
}
