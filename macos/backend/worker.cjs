const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { Store } = require('./store.cjs');
const { Configuration } = require('./config.cjs');
const { ModelManager } = require('./models.cjs');
const { TaskRegistry } = require('./tasks.cjs');
const { EngineClient } = require('./engine.cjs');
const { PromptPreferences } = require('./prompts.cjs');
const { createAgentHandlers } = require('./worker-agent.cjs');
const { attachRecording } = require('./worker-session.cjs');
const { createMobileHandlers } = require('./worker-mobile.cjs');
const { createLLMHandlers } = require('./worker-llm.cjs');
const { createAiNoteHandlers } = require('./worker-ai-note.cjs');
const { createExportHandlers } = require('./worker-exports.cjs');
const { createRefinementHandlers } = require('./worker-refinement.cjs');
const { createSpeakerHandlers } = require('./worker-speakers.cjs');

function sanitize(value, depth = 0) {
  if (depth > 64) throw new Error('Command payload is nested too deeply');
  if (typeof value === 'string') return value.toWellFormed();
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key.toWellFormed(), sanitize(item, depth + 1)]),
    );
  return value;
}
class Worker {
  constructor(
    root = process.env.BREVIA_DATA_DIR || path.join(os.homedir(), 'brevia'),
    { output = (value) => process.stdout.write(JSON.stringify(value) + '\n'), engineFactory } = {},
  ) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.resources = process.env.BREVIA_RESOURCES || path.resolve(__dirname, '../..');
    this.output = output;
    this.active = null;
    this.session = null;
    this.commandTimes = [];
    this.config = new Configuration(root, path.join(this.resources, 'backend/settings.json'));
    this.prompts = new PromptPreferences(root);
    this.settings = this.config.value;
    this.store = new Store(root, {
      modelsDir: process.env.BREVIA_MODELS_DIR,
      meetingsDir: process.env.BREVIA_MEETINGS_DIR,
      settings: this.settings,
    });
    this.initialization =
      process.env.BREVIA_RECOVER_INTERRUPTED !== '0'
        ? this.store.recoverInterruptedMeetings()
        : Promise.resolve();
    const engineDir = process.env.BREVIA_NATIVE_ENGINES || path.join(this.resources, 'engines');
    this.models = new ModelManager(
      process.env.BREVIA_MODELS_DIR || this.store.modelsDir,
      (type, payload) => this.emit(type, payload),
      {
        bundledRoot:
          process.env.BREVIA_BUNDLED_MODELS_DIR ||
          path.join(this.resources, 'backend/bundled-models'),
        catalogPath: path.join(this.resources, 'backend/models.json'),
        linuxBackend:
          process.platform === 'linux' && fs.existsSync(path.join(engineDir, 'mlx-backend'))
            ? fs.readFileSync(path.join(engineDir, 'mlx-backend'), 'utf8').trim()
            : 'cpu',
      },
    );
    this.tasks = new TaskRegistry();
    this.engines = new Set();
    this.channels = new Map();
    this.newEngine = (runtime, { reusable = false } = {}) => {
      const engine = engineFactory
        ? engineFactory(runtime)
        : new EngineClient(
            path.join(
              engineDir,
              (runtime === 'mlx-audio'
                ? process.platform === 'linux'
                  ? 'brevia-mlx-cpp'
                  : 'brevia-mlx'
                : 'brevia-inference') + (process.platform === 'win32' ? '.exe' : ''),
            ),
          );
      if (!reusable) {
        // 超时关闭的客户端可在下次请求重启，必须重新纳入退出清理。
        const request = engine.request.bind(engine);
        engine.request = (...args) => {
          this.engines.add(engine);
          return request(...args);
        };
        const close = engine.close.bind(engine);
        engine.close = (...args) => {
          const result = close(...args);
          this.engines.delete(engine);
          return result;
        };
      }
      this.engines.add(engine);
      return engine;
    };
    this.engineFactory = (runtime, channel = runtime) => {
      if (!this.channels.has(channel))
        this.channels.set(channel, this.newEngine(runtime, { reusable: true }));
      return this.channels.get(channel);
    };
    this.handlers = {
      'prompts.get': () => this.prompts.get(),
      'prompts.save': (p) => this.prompts.save(p),
      ...this.baseHandlers(),
      ...attachRecording(this),
      ...createMobileHandlers(this),
      ...createLLMHandlers(this),
      ...createAiNoteHandlers(this),
      ...createExportHandlers(this),
      ...createRefinementHandlers(this),
      ...createSpeakerHandlers(this),
      ...createAgentHandlers(this),
    };
  }
  emit(type, payload) {
    this.output({ type, schema_version: 1, payload });
  }
  response(id, result, error) {
    const value = { id, ok: !error };
    if (error) {
      value.error = error.message || String(error);
      if (error.code) value.error_code = error.code;
      if (error.models) value.error_models = error.models;
    } else value.result = result ?? null;
    this.output(value);
  }
  async handle(command) {
    if (!command || Array.isArray(command) || typeof command !== 'object')
      throw new Error('Commands must be objects');
    await this.initialization;
    const now = performance.now();
    this.commandTimes = this.commandTimes.filter((value) => value > now - 1000);
    if (this.commandTimes.length >= 100) throw new Error('Command rate limit exceeded');
    this.commandTimes.push(now);
    if (!command.id || !command.type) throw new Error('Commands require id and type');
    if (typeof command.type !== 'string' || !Object.hasOwn(this.handlers, command.type))
      throw new Error('Unknown command: ' + command.type);
    return this.handlers[command.type](sanitize(command.payload || {}));
  }
  async cancelMeetingTasks(id, timeout = 5000) {
    this.tasks.cancelForMeeting(id);
    const deadline = performance.now() + timeout;
    while (this.tasks.hasForMeeting(id) && performance.now() < deadline) await delay(50);
    if (this.tasks.hasForMeeting(id))
      throw Object.assign(
        new Error('Wait for background tasks to finish before deleting meeting data'),
        { code: 'error.tasks.running' },
      );
  }
  baseHandlers() {
    const store = this.store;
    const deleted = async (p, purge = false) => {
      if (this.active === p.meeting_id)
        throw Object.assign(new Error('Stop the active meeting before deleting it'), {
          code: 'error.meeting.active',
        });
      await this.cancelMeetingTasks(p.meeting_id);
      if (purge) store.permanentDelete(p.meeting_id);
      else store.softDelete(p.meeting_id);
      return { meeting_id: p.meeting_id, [purge ? 'purged' : 'deleted']: true };
    };
    const taskStatus = (p, status) => {
      if (status === 'cancelling') this.tasks.cancel(p.task, p.meeting_id);
      else this.tasks.setPaused(p.task, p.meeting_id, status === 'paused');
      const value = { task: p.task, meeting_id: p.meeting_id, status };
      this.emit('task.status', value);
      return value;
    };
    return {
      'app.initialize': () => ({
        seeded_examples: store.seedExamples(),
        meetings: store.listMeetings(),
        workspaces: store.listWorkspaces(),
        models: this.models.list(),
        speaker_profiles: store.listSpeakerProfiles(),
        device: this.models.device(),
      }),
      'app.maintain': () => {
        const purged = store.purgeExpired();
        store.deleteLegacyBuiltinProfiles();
        this.emit('app.maintenance', {
          meetings: store.listMeetings(),
          speaker_profiles: store.listSpeakerProfiles(),
          storage: store.usage(),
          recoverable: store.recoverableMeetings(),
          purged_meeting_ids: purged,
        });
        return {};
      },
      'meeting.list': (p) => store.listMeetings(p),
      'meeting.search': (p) => store.searchMeetings(p.query || ''),
      'meeting.get': (p) => store.getMeeting(p.meeting_id, true),
      'meeting.update': (p) => store.updateMeeting(p.meeting_id, p.updates, p.expected_notes),
      'meeting.delete': (p) => deleted(p),
      'meeting.purge': (p) => deleted(p, true),
      'meeting.restore': (p) => {
        store.softDelete(p.meeting_id, true);
        return store.getMeeting(p.meeting_id);
      },
      'segment.text': (p) => {
        if (!Array.isArray(p.segments) || !p.segments.length) throw new Error('Nothing to save');
        store.saveSegmentTexts(p.meeting_id, p.segments);
        const meeting = store.getMeeting(p.meeting_id, true);
        this.emit('transcript.corrected', { meeting_id: meeting.id, meeting });
        return meeting;
      },
      'segment.correction': (p) => {
        store.transcriptCorrection(p.meeting_id, p);
        const meeting = store.getMeeting(p.meeting_id, true);
        this.emit('transcript.corrected', { meeting_id: meeting.id, meeting });
        return meeting;
      },
      'models.list': () => this.models.list(),
      'models.can-relocate': () => this.models.downloads.size === 0,
      'models.download': (p) => this.models.download(p.model_id, p.source),
      'models.pause': (p) => this.models.pause(p.model_id),
      'models.cancel': (p) => this.models.cancel(p.model_id),
      'models.delete': (p) => {
        if (this.active && store.getMeeting(this.active).refined_model_id === p.model_id)
          throw new Error('Cannot delete the model used by the active meeting');
        if (this.tasks.hasAny() || this.models.downloads.has(p.model_id))
          throw new Error('Wait for background tasks to finish before deleting models');
        return this.models.delete(p.model_id);
      },
      'task.pause': (p) => taskStatus(p, 'paused'),
      'task.resume': (p) => taskStatus(p, 'running'),
      'task.cancel': (p) => taskStatus(p, 'cancelling'),
      'settings.advanced.get': () => this.config.metadata(this.models.get('silero-vad').runtime),
      'settings.advanced.save': (p) => {
        const value = this.config.save(p.settings);
        Object.assign(this.settings, value);
        return value;
      },
      'metrics.record': (p) => store.metrics(p.app_duration_ms || 0),
      'storage.clear': (p) => {
        if (this.active && ['meetings', 'models'].includes(p.partition))
          throw Object.assign(new Error('Stop the active meeting before clearing data'), {
            code: 'error.meeting.active',
          });
        if (this.tasks.hasAny() || this.models.downloads.size)
          throw Object.assign(new Error('Wait for background tasks'), {
            code: 'error.tasks.running',
          });
        return store.clearStoragePartition(p.partition);
      },
      'storage.cleanup': () => {
        if (this.active || this.tasks.hasAny() || this.models.downloads.size)
          throw Object.assign(new Error('Wait for background tasks'), {
            code: 'error.tasks.running',
          });
        const models = this.models.cleanupUnlisted(),
          meetings = store.cleanupOrphanMeetingDirs();
        return {
          items: models.removed.length + meetings.removed.length,
          freed_bytes: models.freed_bytes + meetings.freed_bytes,
        };
      },
      'workspace.terms': (p) => store.workspaceTerms(p.workspace_id),
      'workspace.term.save': (p) => store.writeWorkspaceTerm(p),
      'workspace.list': () => store.listWorkspaces(),
      'workspace.get': (p) => store.getWorkspace(p.workspace_id),
      'workspace.create': (p) => store.createWorkspace(p),
      'workspace.update': (p) => store.updateWorkspace(p.workspace_id, p.updates),
      'workspace.reorder': (p) => store.reorderWorkspaces(p.workspace_ids),
      'workspace.assign': (p) => store.assignMeetingToWorkspace(p.meeting_id, p.workspace_id),
      'workspace.delete': async (p) => {
        const meetings = store.listMeetings().filter((m) => m.workspace_id === p.workspace_id);
        if (meetings.some((m) => m.id === this.active))
          throw Object.assign(new Error('Stop the active meeting before deleting it'), {
            code: 'error.meeting.active',
          });
        for (const meeting of meetings) await this.cancelMeetingTasks(meeting.id);
        return store.deleteWorkspace(p.workspace_id);
      },
    };
  }
  async close() {
    await this.initialization;
    await this.recordingTail;
    try {
      if (this.active)
        await this.stopRecording({
          meeting_id: this.active,
          duration_ms: this.store.recordedDurationMs(this.active),
        });
    } finally {
      for (const control of this.models.downloads.values()) control.cancel();
      for (const entry of this.tasks.controls.values()) entry.control.cancel();
      for (const engine of this.engines) engine.close();
      await this.shutdownAiNote?.();
      this.store.closeAudioSessions();
      this.store.db.close();
    }
  }
}
async function main() {
  const worker = new Worker(),
    active = new Set();
  const maximumBytes = 32 * 1024 * 1024;
  function dispatch(line) {
    const text = line.toString('utf8');
    if (!text.trim()) return;
    let command;
    try {
      command = JSON.parse(text);
      if (!command || typeof command !== 'object' || Array.isArray(command))
        throw new Error('Commands must be objects');
    } catch (error) {
      worker.response(null, null, error);
      return;
    }
    const task = worker.handle(command).then(
      (value) => worker.response(command.id, value),
      (error) => worker.response(command.id, null, error),
    );
    active.add(task);
    void task.finally(() => active.delete(task));
  }
  let chunks = [],
    bytes = 0,
    discarding = false;
  try {
    for await (const chunk of process.stdin) {
      let at = 0;
      while (at < chunk.length) {
        const newline = chunk.indexOf(10, at),
          end = newline < 0 ? chunk.length : newline;
        if (!discarding) {
          if (bytes + end - at > maximumBytes) {
            worker.response(null, null, new Error('Command is too large'));
            chunks = [];
            bytes = 0;
            discarding = true;
          } else if (end > at) {
            chunks.push(chunk.subarray(at, end));
            bytes += end - at;
          }
        }
        if (newline < 0) break;
        if (bytes) dispatch(Buffer.concat(chunks, bytes));
        chunks = [];
        bytes = 0;
        discarding = false;
        at = newline + 1;
      }
    }
    if (bytes) dispatch(Buffer.concat(chunks, bytes));
  } finally {
    for (const entry of worker.tasks.controls.values()) entry.control.cancel();
    await Promise.allSettled([...active]);
    await worker.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { Worker };
