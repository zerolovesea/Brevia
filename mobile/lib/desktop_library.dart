import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import 'connection.dart';
import 'i18n.dart';
import 'storage.dart';

typedef MeetingData = Map<String, dynamic>;

/// 每次配对隔离一份电脑缓存；手机录音目录的恢复与补传只处理手机创建的录音。
class DesktopLibrary {
  DesktopLibrary(this.connection, {this.directory});
  final DesktopConnection connection;
  final Directory? directory;
  List<MeetingData> meetings = [];
  final Map<String, String> _jobs = {};
  late final Future<Directory> _root = _open();
  Future<void>? _refresh;
  Future<void> _writes = Future.value();
  final Map<String, Digest> _cachedDigests = {};
  final Map<String, Future<MeetingData>> _requests = {};
  bool _authoritative = false;
  bool _forgotten = false;
  bool visible(String id) => !_forgotten && meetings.any((m) => m['id'] == id);
  bool get authoritative => _authoritative;

  Future<Directory> _open() async {
    final support = directory ?? await getApplicationSupportDirectory();
    final key = sha256.convert(
      utf8.encode('${connection.fingerprint}:${connection.token}'),
    );
    final root = await Directory(
      '${support.path}/desktop-library/$key',
    ).create(recursive: true);
    final index = await _read(File('${root.path}/index.json'));
    meetings = _rows(index['meetings']);
    if (index['jobs'] is Map) {
      for (final entry in (index['jobs'] as Map).entries) {
        if (entry.key is String && entry.value is String) {
          _jobs[entry.key] = entry.value;
        }
      }
    }
    return root;
  }

  static List<MeetingData> _rows(dynamic list) => [
    if (list is List)
      for (final value in list.whereType<Map>())
        if (value['id'] is String) Map<String, dynamic>.from(value),
  ];

  static Future<MeetingData> _read(File file) async {
    if (!await file.exists()) return {};
    try {
      final value = jsonDecode(await file.readAsString());
      return value is Map<String, dynamic> ? value : {};
    } on FormatException {
      // 缓存损坏时允许重新从电脑读取，不妨碍打开本机录音。
      return {};
    }
  }

  Future<File> _file(String id, String name) async {
    final key = sha256.convert(utf8.encode(id));
    return File('${(await _root).path}/$key.$name');
  }

  Future<void> load() async {
    await _root;
  }

  Future<T> _serialize<T>(Future<T> Function() operation) {
    final next = _writes.then((_) => operation());
    _writes = next.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return next;
  }

  Future<void> _saveIndex() => _serialize(() async {
    if (_forgotten) return;
    await writeJson(File('${(await _root).path}/index.json'), {
      'meetings': meetings,
      'jobs': _jobs,
    });
  });

  Future<void> refresh() => _refresh ??= _refreshList().whenComplete(() {
    _refresh = null;
  });

  Future<void> _refreshList() async {
    await _root;
    List<MeetingData> current;
    try {
      final list = await connection.call('GET', '/desktop-meetings');
      if (list is! List) return;
      current = _rows(list);
    } on DesktopHttpException catch (e) {
      if (![401, 403, 404].contains(e.status)) rethrow;
      current = [];
    }
    if (_forgotten) return;
    _authoritative = true;
    final previous = meetings;
    meetings = current;
    final removed = previous.where((m) => !visible(m['id'])).toList();
    for (final m in removed) {
      await _serialize(() => _removeFiles(m['id']));
    }
    // 进行中的时长随时可重建，只有列表结构和已结束会议发生变化时才落盘。
    String indexKey(List<MeetingData> rows) => jsonEncode([
      for (final m in rows) {...m, if (m['state'] != 'ended') 'duration_ms': 0},
    ]);
    if (indexKey(previous) != indexKey(current)) await _saveIndex();
    for (final id in _jobs.keys.toList()) {
      if (visible(id)) await snapshot(id);
    }
  }

  Future<File> _audioFile(String id) async {
    final temp = directory ?? await getTemporaryDirectory();
    final key = sha256.convert(
      utf8.encode('${connection.fingerprint}:${connection.token}:$id'),
    );
    return File('${temp.path}/brevia-$key.wav');
  }

  Future<Directory> _imagesDirectory(String id) async =>
      Directory((await _file(id, 'images')).path);

  Future<void> _removeFiles(String id) async {
    _jobs.remove(id);
    _cachedDigests.remove(id);
    final images = await _imagesDirectory(id);
    if (await images.exists()) await images.delete(recursive: true);
    for (final file in [
      await _file(id, 'snapshot.json'),
      await _file(id, 'draft.json'),
      await _audioFile(id),
    ]) {
      if (await file.exists()) await file.delete();
    }
  }

  Future<void> forget() async {
    _forgotten = true;
    final root = await _root;
    await _serialize(() async {
      for (final row in meetings) {
        await _removeFiles(row['id']);
      }
      meetings = [];
      if (await root.exists()) await root.delete(recursive: true);
    });
  }

  Future<MeetingData> cached(String id) async {
    await _root;
    return visible(id) ? _read(await _file(id, 'snapshot.json')) : {};
  }

  Future<MeetingData> draft(String id) async {
    await _root;
    return visible(id) ? _read(await _file(id, 'draft.json')) : {};
  }

  Future<bool> hasUnsyncedDrafts() async {
    await _root;
    return _serialize(() async {
      for (final meeting in meetings) {
        final saved = SharedNoteDraft.restore(await draft(meeting['id']));
        if (saved.dirty || saved.proposalId != null) return true;
      }
      return false;
    });
  }

  Future<void> saveDraft(String id, MeetingData value) => _serialize(() async {
    if (visible(id)) await writeJson(await _file(id, 'draft.json'), value);
  });

  Future<MeetingData> snapshot(String id) =>
      _requests[id] ??= _snapshot(id).whenComplete(() {
        _requests.remove(id);
      });

  Future<MeetingData> _snapshot(String id) async {
    final watchedJob = _jobs[id];
    final result = Map<String, dynamic>.from(
      await connection.call(
        'GET',
        '/desktop-meetings/${Uri.encodeComponent(id)}/snapshot',
      ),
    );
    if (!visible(id) || result['id'] != id) throw StateError(tr('这场会议已停止共享'));
    // 只缓存回看结果；会中字幕持续刷新，避免每两秒重复写入全文。
    if (result['state'] == 'ended') {
      final file = await _file(id, 'snapshot.json');
      final digest = sha256.convert(utf8.encode(jsonEncode(result)));
      if (_cachedDigests[id] != digest) {
        await _serialize(() async {
          if (!visible(id)) return;
          await writeJson(file, result);
          _cachedDigests[id] = digest;
        });
      }
    }
    final task = result['task'];
    // 桌面只保存最新任务。另一端已开始下一项任务时，旧任务也已结束。
    if (watchedJob != null &&
        watchedJob == _jobs[id] &&
        task is Map &&
        (task['id'] != watchedJob ||
            ['failed', 'done'].contains(task['state']))) {
      _jobs.remove(id);
      await _saveIndex();
    }
    return result;
  }

  Future<void> process(String id, String action, String requestId) async {
    await connection
        .call('POST', '/desktop-meetings/${Uri.encodeComponent(id)}/action', {
          'action': action,
          'request_id': requestId,
          if (action == 'summary') 'consent': true,
        });
    if (!visible(id)) throw StateError(tr('这场会议已停止共享'));
    _jobs[id] = requestId;
    await _saveIndex();
  }

  Future<MeetingData> propose(
    String id,
    String requestId,
    String revision,
    String notes,
  ) async => Map<String, dynamic>.from(
    await connection.call(
      'POST',
      '/desktop-meetings/${Uri.encodeComponent(id)}/proposals',
      {'id': requestId, 'base_revision': revision, 'notes': notes},
    ),
  );

  Future<File> audio(String id) async {
    if (!visible(id)) throw StateError(tr('这场会议已停止共享'));
    final file = await _audioFile(id);
    if (await file.exists()) return file;
    final part = File('${file.path}.${Uuid().v4()}.tmp');
    try {
      await connection.downloadFile(
        '/desktop-meetings/${Uri.encodeComponent(id)}/audio',
        part,
      );
      return await _serialize(() {
        if (!visible(id)) throw StateError(tr('这场会议已停止共享'));
        return part.rename(file.path);
      });
    } finally {
      if (await part.exists()) await part.delete();
    }
  }

  Future<File> document(String id, String content, String format) async {
    if (!visible(id)) throw StateError(tr('这场会议已停止共享'));
    final file = await connection.document(
      id,
      content,
      format,
      directory: directory,
    );
    if (visible(id)) return file;
    await file.delete();
    throw StateError(tr('这场会议已停止共享'));
  }

  Future<String> upload(String id, Uint8List bytes) async {
    final type = imageType(bytes);
    final value = await connection.call(
      'POST',
      '/desktop-meetings/${Uri.encodeComponent(id)}/images',
      {'mime_type': type, 'base64': base64Encode(bytes)},
    );
    final url = value['url'] as String;
    final name = attachmentName(id, Uri.parse(url));
    if (name == null) throw FormatException(tr('图片格式无效'));
    await _saveImage(id, name, bytes);
    return url;
  }

  static String? attachmentName(String id, Uri uri) {
    final parts = uri.pathSegments;
    if (uri.scheme != 'brevia-note' ||
        uri.host != id.toLowerCase() ||
        parts.length != 1 ||
        !DesktopConnection.isNoteImageFilename(parts.single)) {
      return null;
    }
    return parts.single;
  }

  Future<void> _saveImage(String id, String name, Uint8List bytes) =>
      _serialize(() async {
        if (!visible(id)) throw StateError(tr('这场会议已停止共享'));
        final dir = await (await _imagesDirectory(id)).create(recursive: true);
        final staging = File('${dir.path}/$name.tmp');
        await staging.writeAsBytes(bytes);
        await staging.rename('${dir.path}/$name');
      });

  Future<Uint8List> image(String id, String name) async {
    if (!visible(id)) throw StateError(tr('这场会议已停止共享'));
    if (!DesktopConnection.isNoteImageFilename(name)) {
      throw FormatException(tr('图片格式无效'));
    }
    final file = File('${(await _imagesDirectory(id)).path}/$name');
    if (await file.exists()) return file.readAsBytes();
    final bytes = await connection.noteImage(id, name);
    await _saveImage(id, name, bytes);
    return bytes;
  }

  static String imageType(Uint8List b) {
    if (b.length > 4 * 1024 * 1024) throw FormatException(tr('图片最大为 4 MB'));
    if (b.length >= 8 &&
        b[0] == 0x89 &&
        b[1] == 0x50 &&
        b[2] == 0x4e &&
        b[3] == 0x47 &&
        b[4] == 0x0d &&
        b[5] == 0x0a &&
        b[6] == 0x1a &&
        b[7] == 0x0a) {
      return 'image/png';
    }
    if (b.length >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff) {
      return 'image/jpeg';
    }
    if (b.length >= 12 &&
        ascii.decode(b.sublist(0, 4), allowInvalid: true) == 'RIFF' &&
        ascii.decode(b.sublist(8, 12), allowInvalid: true) == 'WEBP') {
      return 'image/webp';
    }
    throw FormatException(tr('请选择 JPEG、PNG 或 WebP 图片'));
  }
}

/// 笔记的基线只在用户采纳电脑版本，或电脑确认采纳本机提议时前移。
class SharedNoteDraft {
  String? revision;
  String base = '', text = '';
  String? proposalId, submitted;
  bool get dirty => base != text;
  SharedNoteDraft();
  SharedNoteDraft.restore(MeetingData json) {
    revision = json['revision'];
    base = json['base'] ?? '';
    text = json['text'] ?? base;
    proposalId = json['proposalId'];
    submitted = json['submitted'];
  }
  MeetingData toJson() => {
    'revision': revision,
    'base': base,
    'text': text,
    'proposalId': proposalId,
    'submitted': submitted,
  };

  bool reconcile(MeetingData data) {
    final current = data['notes'] as String? ?? '';
    final rev = data['revision'] as String?;
    if (revision == null) {
      base = current;
      text = current;
      revision = rev;
      return true;
    }
    final proposal = data['proposal'];
    if (proposalId == null || proposal?['id'] != proposalId) return false;
    if (proposal['state'] == 'accepted') {
      if (current == submitted) {
        base = current;
        revision = rev;
      }
      proposalId = submitted = null;
      return true;
    } else if ([
      'declined',
      'rejected',
      'stale',
      'conflict',
    ].contains(proposal['state'])) {
      proposalId = submitted = null;
      return true;
    }
    return false;
  }

  void resolve(MeetingData remote, {required bool keepLocal}) {
    base = remote['notes'] ?? '';
    revision = remote['revision'];
    if (!keepLocal) text = base;
    proposalId = submitted = null;
  }

  String prepare() {
    if (proposalId == null) {
      proposalId = Uuid().v4();
      submitted = text;
    }
    return proposalId!;
  }
}
