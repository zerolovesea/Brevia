const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { complete } = require('./llm-client.cjs');
const { createLLMHandlers, splitTranscript } = require('./worker-llm.cjs');
const { createAiNoteHandlers, parseSuggestions, similarity } = require('./worker-ai-note.cjs');
const { TaskRegistry } = require('./tasks.cjs');

async function server(t, handler) {
  const app = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    handler(request, response, JSON.parse(Buffer.concat(chunks).toString() || '{}'));
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => {
    app.closeAllConnections();
    app.close();
  });
  return `http://127.0.0.1:${app.address().port}`;
}

test('云端补全保留 API 路径、认证、正文并仅在模型不存在时重试小写', async (t) => {
  const requests = [];
  const endpoint = await server(t, (req, res, body) => {
    requests.push({ url: req.url, key: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    if (requests.length === 1) {
      res.statusCode = 404;
      res.end('{"error":"model_not_found"}');
    } else res.end('{"choices":[{"message":{"content":"结果"}}]}');
  });
  assert.equal(
    await complete(
      { endpoint: endpoint + '/v1?key=value', model: 'GPT-4o', api_key: 'private-key' },
      'private transcript',
    ),
    '结果',
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/v1/chat/completions?key=value');
  assert.equal(requests[0].key, 'Bearer private-key');
  assert.equal(requests[1].body.model, 'gpt-4o');
  assert.deepEqual(requests[1].body.messages, [{ role: 'user', content: 'private transcript' }]);
  assert.equal('tool_choice' in requests[1].body, false);
});

test('云端重定向不能把会议或密钥发送到另一来源', async (t) => {
  let leaked = false;
  const destination = await server(t, (_req, res) => {
    leaked = true;
    res.end('{}');
  });
  const endpoint = await server(t, (_req, res) => {
    res.writeHead(307, { Location: destination });
    res.end();
  });
  await assert.rejects(
    complete({ endpoint, model: 'test', api_key: 'secret' }, 'private transcript'),
    /Cross-origin/,
  );
  assert.equal(leaked, false);
});

test('云端 Anthropic 内容块与工具调用错误保持兼容', async (t) => {
  let count = 0;
  const endpoint = await server(t, (req, res, body) => {
    assert.equal(req.url, '/v1/messages');
    assert.equal(req.headers['x-api-key'], 'secret');
    assert.equal(body.max_tokens, 2048);
    res.end(
      JSON.stringify({
        content:
          ++count === 1
            ? [{ type: 'text', text: '回答' }]
            : [{ type: 'tool_use', name: 'external_tool' }],
      }),
    );
  });
  const options = { endpoint, format: 'anthropic', model: 'claude', api_key: 'secret' };
  assert.equal(await complete(options, 'question'), '回答');
  await assert.rejects(complete(options, 'question'), /tool call.*external_tool/);
});

test('本地请求同一引擎的加载/生成不交错，翻译使用模型聊天模板', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-llm-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'model.gguf'), 'fixture');
  const requests = [],
    events = [];
  let loaded;
  const worker = {
    active: null,
    settings: { llm: { timeout_seconds: 10 } },
    tasks: new TaskRegistry(),
    models: { isReady: () => true, path: () => directory, catalog: new Map() },
    engineFactory: () => ({
      request: async (type, payload) => {
        requests.push([type, payload]);
        await new Promise((resolve) => setImmediate(resolve));
        if (type === 'llama.load') loaded = payload.path;
        return { text: loaded ? 'Hello.' : 'missing' };
      },
    }),
    emit: (type, payload) => events.push([type, payload]),
    store: {
      translationContext: () => [
        { id: 'meeting' },
        { id: 'segment', text: '你好', version: 'refined', revision: 3 },
      ],
      saveTranslation: (_mid, _sid, text, expected) => {
        assert.equal(text, 'Hello.');
        assert.deepEqual(expected.expected_version, ['refined', 3]);
        return false;
      },
    },
  };
  const handlers = createLLMHandlers(worker);
  await Promise.all([
    worker.llmComplete({ provider: 'builtin', model: 'first' }, 'one'),
    worker.llmComplete({ provider: 'builtin', model: 'second' }, 'two'),
  ]);
  assert.deepEqual(
    requests.map(([type]) => type),
    ['llama.load', 'llama.generate', 'llama.load', 'llama.generate'],
  );
  const result = await handlers['translation.generate']({
    meeting_id: 'meeting',
    segment_id: 'segment',
    target_language: 'en',
    consent: true,
  });
  assert.deepEqual(result, { cancelled: true });
  assert.equal(requests.at(-1)[1].chat, true);
  assert.equal(
    events.some(([type]) => type === 'translation.ready'),
    false,
  );
});

test('长段落分块保留来源且小预算不会死循环', () => {
  const source = 'S1 [00:00] ' + '内容'.repeat(100);
  const chunks = splitTranscript(source, 30);
  assert.ok(chunks.every((chunk) => chunk.length <= 30 && chunk.startsWith('S1 [00:00] ')));
  assert.equal(chunks.map((chunk) => chunk.slice(11)).join(''), '内容'.repeat(100));
  assert.equal(splitTranscript(source, 4).join(''), source);
  assert.throws(() => splitTranscript(source, 0));
});

test(
  'queued local cancellation returns promptly without interrupting or overtaking the active request',
  { timeout: 2000 },
  async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-llm-cancel-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'model.gguf'), 'fixture');
    let release, entered;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    t.after(() => release());
    const requests = [];
    const worker = {
      models: { isReady: () => true, path: () => directory },
      engineFactory: () => ({
        request: async (type, payload) => {
          if (type === 'llama.load') return {};
          requests.push(payload.prompt);
          if (payload.prompt === 'first') {
            entered();
            await gate;
          }
          return { text: payload.prompt };
        },
      }),
    };
    createLLMHandlers(worker);
    const options = { provider: 'builtin', model: 'local' };
    const first = worker.llmComplete(options, 'first');
    await started;
    const controller = new AbortController();
    const cancelled = worker.llmComplete(options, 'cancelled', { signal: controller.signal });
    controller.abort(new Error('cancelled while queued'));
    await assert.rejects(cancelled, /cancelled while queued/);
    const third = worker.llmComplete(options, 'third');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(requests, ['first']);
    release();
    assert.deepEqual(await Promise.all([first, third]), ['first', 'third']);
    assert.deepEqual(requests, ['first', 'third']);
  },
);

test('AI 建议解析兼容噪声、转义括号、旧格式且一次仅返回一条', () => {
  assert.deepEqual(
    parseSuggestions(
      'noise ```json\n{"suggestions":[{"type":"待办","text":"提交预算[含税]\\\"复核\\\""},{"type":"date","text":"2026-11-06"}]}\n```',
    ).map(({ type, text }) => ({ type, text })),
    [{ type: 'action', text: '提交预算[含税]"复核"' }],
  );
  assert.deepEqual(parseSuggestions('invalid [{oops} then {"type":"none"}'), []);
  assert.equal(similarity('abxcd', 'abcd'), 8 / 9);
});

test('重启同一会议的 AI 会话后，旧请求收尾不能清除新分析状态', async (t) => {
  const events = [],
    pending = [];
  const worker = {
    emit: (type, payload) => events.push({ type, payload }),
    store: { getMeeting: () => ({ id: 'meeting', meeting_date: '2026-11-06' }) },
    llmComplete: () => new Promise((resolve) => pending.push(resolve)),
  };
  const handlers = createAiNoteHandlers(worker);
  t.after(() => worker.shutdownAiNote());
  const start = () => {
    handlers['ai-note.start']({ meeting_id: 'meeting', proactivity: 'quiet' });
    handlers['ai-note.request']({ meeting_id: 'meeting' });
  };
  start();
  start();
  assert.equal(pending.length, 2);
  assert.equal(events.at(-1).payload.active, true);
  const count = events.length;
  pending[0]('[]');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, count);
  pending[1]('[]');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.at(-1).payload.active, false);
});

test('新字幕不污染在飞建议的来源，停止后迟到响应不能落盘', async () => {
  const events = [],
    claims = [],
    pending = [];
  const worker = {
    store: {
      getMeeting: () => ({ id: 'meeting', meeting_date: '2026-11-06' }),
      recordAiClaim: (_id, claim) => claims.push(claim),
    },
    emit: (type, payload) => events.push([type, payload]),
    llmComplete: (_payload, _prompt, options) =>
      new Promise((resolve) => pending.push({ resolve, options })),
  };
  const handlers = createAiNoteHandlers(worker);
  try {
    handlers['ai-note.start']({
      meeting_id: 'meeting',
      provider: 'builtin',
      model: 'test',
      proactivity: 'quiet',
    });
    worker.aiNoteOnSegment({
      meeting_id: 'meeting',
      segment_id: 'first',
      text: '服务器预计使用容量',
      start_ms: 1000,
      end_ms: 2000,
    });
    handlers['ai-note.request']({ meeting_id: 'meeting' });
    assert.equal(pending.length, 1);
    worker.aiNoteOnSegment({
      meeting_id: 'meeting',
      segment_id: 'later',
      text: '新增的另一条内容',
      start_ms: 3000,
      end_ms: 4000,
    });
    pending[0].resolve(
      '{"type":"risk","text":"服务器容量可能超过计划预算","evidence":["00:01","00:03"]}',
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(claims.length, 1);
    assert.deepEqual(
      claims[0].sources.map((source) => source.segment_id),
      ['first'],
    );
    assert.equal(claims[0].section, '');
    assert.equal(claims[0].id, events.find(([type]) => type === 'ai-note.suggestion')[1].id);
    handlers['ai-note.request']({ meeting_id: 'meeting' });
    handlers['ai-note.stop']({ meeting_id: 'meeting' });
    assert.equal(pending[1].options.signal.aborted, true);
    pending[1].resolve('{"type":"risk","text":"迟到结果不得修改会议内容"}');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(claims.length, 1);
  } finally {
    worker.shutdownAiNote();
  }
});

test('缺失本地模型仍返回前端识别的结构化错误', async () => {
  const worker = { models: { isReady: () => false }, settings: { llm: {} } };
  createLLMHandlers(worker);
  await assert.rejects(
    worker.llmComplete({ provider: 'builtin', model: 'uninstalled' }, 'prompt'),
    (error) => error.code === 'model_not_installed' && error.models[0] === 'uninstalled',
  );
});

test('纪要生成保留并发文稿保护，拒绝分享时不启动推理', async (t) => {
  let calls = 0,
    saved = false;
  const endpoint = await server(t, (_req, res) => {
    calls++;
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '# Meeting\n- Confirmed action [[action:S1]]' } }],
      }),
    );
  });
  const events = [];
  const meeting = {
    id: 'meeting',
    title: 'Meeting',
    meeting_date: '2026-11-06',
    summary: { data: { markdown: 'user notes' } },
    correction: { revision: 7 },
    segments: [
      {
        id: 'one',
        text: 'We will submit the budget tomorrow.',
        start_ms: 1000,
        end_ms: 2000,
        speaker_name: 'Alice',
      },
    ],
  };
  const worker = {
    active: null,
    tasks: new TaskRegistry(),
    settings: { llm: { timeout_seconds: 2 } },
    models: { catalog: new Map() },
    emit: (type, payload) => events.push([type, payload]),
    store: {
      getMeeting: () => meeting,
      meetingExists: () => true,
      saveSummary: (_id, data, _raw, expected) => {
        saved = true;
        assert.deepEqual(expected, {
          expected_revision: 7,
          expected_document: ['2026-11-06', 'user notes'],
        });
        assert.equal(data.claims[0].sources[0].segment_id, 'one');
        return false;
      },
    },
  };
  const handlers = createLLMHandlers(worker),
    payload = {
      meeting_id: 'meeting',
      endpoint,
      provider: 'openai',
      model: 'test',
      consent: false,
    };
  await assert.rejects(
    handlers['summary.generate'](payload),
    (error) => error.code === 'error.sharing_not_confirmed',
  );
  assert.equal(calls, 0);
  assert.deepEqual(await handlers['summary.generate']({ ...payload, consent: true }), {
    cancelled: true,
  });
  assert.equal(saved, true);
  assert.equal(
    events.some(([type]) => type === 'summary.ready'),
    false,
  );
});

test('complete file translation reserves output and reports token exhaustion instead of exporting a fragment', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-complete-translation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'model.gguf'), 'fixture');
  const worker = {
    models: { isReady: () => true, path: () => directory },
    engineFactory: () => ({
      request: async (type, p) => {
        if (type === 'llama.load') return {};
        if (!p.require_complete) {
          assert.equal(p.max_tokens, 512);
          return { text: 'UI translation' };
        }
        assert.equal(p.max_tokens, 2048);
        throw new Error('Translation exceeded output token limit; no complete result was produced');
      },
    }),
  };
  createLLMHandlers(worker);
  assert.equal(await worker.translateText('你好', 'en'), 'UI translation');
  await assert.rejects(worker.translateText('你好', 'en', undefined, { complete: true }), {
    code: 'translation_truncated',
  });
});
