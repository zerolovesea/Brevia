const fs = require('node:fs'),
  path = require('node:path');
const { safeChild, atomicWrite } = require('./store-base.cjs');
const { latestSegments } = require('./meeting-evidence.cjs');
function size(root) {
  let total = 0;
  try {
    for (const item of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, item.name);
      if (item.isDirectory()) total += size(file);
      else if (item.isFile()) total += fs.statSync(file).size;
    }
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
  }
  return total;
}
function children(root) {
  try {
    return fs.readdirSync(root);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
function managedDirectories(root) {
  return children(root).filter((name) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return false;
    try {
      return fs.lstatSync(path.join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });
}
module.exports = {
  purgeMobileRecording(mid) {
    const directory = safeChild(path.join(this.root, 'mobile'), mid, 'meeting id');
    if (!fs.existsSync(directory)) return;
    const manifest = path.join(directory, 'session.json');
    let session = {};
    try {
      session = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    atomicWrite(
      manifest,
      JSON.stringify({ id: mid, owner: session.owner ?? null, deleted: true, finished: true }),
    );
    for (const name of children(directory))
      if (name !== 'session.json')
        fs.rmSync(path.join(directory, name), { recursive: true, force: true });
  },
  usage() {
    return {
      meetings: size(this.meetingsDir) + size(path.join(this.root, 'mobile')),
      models: size(this.modelsDir),
      exports: children(this.meetingsDir).reduce(
        (n, name) => n + size(path.join(this.meetingsDir, name, 'exports')),
        0,
      ),
      root: this.root,
      models_root: this.modelsDir,
    };
  },
  metrics(duration = 0) {
    return this.transaction(() => {
      const row = this.one("SELECT value FROM app_meta WHERE key='metrics'"),
        value = row ? JSON.parse(row.value) : { app_duration_ms: 0 };
      if (duration > 0) {
        value.app_duration_ms += Math.trunc(duration);
        this.run(
          "INSERT OR REPLACE INTO app_meta(key,value) VALUES('metrics',?)",
          JSON.stringify(value),
        );
      }
      Object.assign(
        value,
        this.one(
          'SELECT COUNT(*) meeting_count,COALESCE(SUM(duration_ms),0) meeting_duration_ms FROM meetings WHERE deleted_at IS NULL AND is_example=0',
        ),
      );
      value.subtitle_count = value.subtitle_lines = value.subtitle_characters = 0;
      for (const meeting of this.query(
        'SELECT id FROM meetings WHERE deleted_at IS NULL AND is_example=0',
      )) {
        const current = latestSegments(
          this.query(
            'SELECT id,version,revision,start_ms,text FROM segments WHERE meeting_id=?',
            meeting.id,
          ),
        );
        value.subtitle_count += current.length;
        value.subtitle_characters += current.reduce((n, s) => n + [...s.text].length, 0);
        value.subtitle_lines += current.reduce((n, s) => n + s.text.split('\n').length, 0);
      }
      Object.assign(
        value,
        this.one(
          "SELECT COUNT(*) summary_count,COALESCE(SUM(length(json_extract(s.data,'$.markdown'))),0) summary_characters FROM summaries s JOIN meetings m ON m.id=s.meeting_id WHERE s.data IS NOT NULL AND m.deleted_at IS NULL AND m.is_example=0",
        ),
      );
      return value;
    });
  },
  clearStoragePartition(partition) {
    if (partition === 'meetings') {
      for (const id of managedDirectories(path.join(this.root, 'mobile')))
        if (fs.existsSync(path.join(this.root, 'mobile', id, 'session.json')))
          this.purgeMobileRecording(id);
      fs.rmSync(this.meetingsDir, { recursive: true, force: true });
      fs.mkdirSync(this.meetingsDir, { recursive: true });
      this.run('DELETE FROM meetings');
    } else if (partition === 'models') {
      fs.rmSync(this.modelsDir, { recursive: true, force: true });
      fs.mkdirSync(this.modelsDir, { recursive: true });
    } else if (partition === 'exports') {
      for (const id of managedDirectories(this.meetingsDir))
        fs.rmSync(path.join(this.meetingDir(id), 'exports'), { recursive: true, force: true });
    } else throw new Error('Unknown storage partition');
    return this.usage();
  },
  cleanupOrphanMeetingDirs() {
    const ids = new Set(this.query('SELECT id FROM meetings').map((r) => r.id)),
      removed = [];
    let freed = 0;
    for (const id of managedDirectories(path.join(this.root, 'mobile'))) {
      if (ids.has(id)) continue;
      const folder = safeChild(path.join(this.root, 'mobile'), id);
      let session;
      try {
        session = JSON.parse(fs.readFileSync(path.join(folder, 'session.json'), 'utf8'));
      } catch {
        continue;
      }
      if (session.finished && !session.deleted) {
        const before = size(folder);
        this.purgeMobileRecording(id);
        freed += Math.max(0, before - size(folder));
        removed.push(id);
      }
    }
    for (const id of managedDirectories(this.meetingsDir)) {
      if (ids.has(id)) continue;
      const folder = this.meetingDir(id);
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
      } catch {
        continue;
      }
      if (manifest.meeting_id !== id) continue;
      freed += size(folder);
      fs.rmSync(folder, { recursive: true, force: true });
      removed.push(id);
    }
    return { removed, freed_bytes: freed };
  },
};
