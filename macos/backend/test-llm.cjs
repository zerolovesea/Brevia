const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { complete } = require('./llm-client.cjs');
const { splitByBudget, estimatedTokens } = require('./summary-facts.cjs');
const { createLLMHandlers } = require('./worker-llm.cjs');
const { createAiNoteHandlers, parseSuggestions, similarity } = require('./worker-ai-note.cjs');
const { TaskRegistry } = require('./tasks.cjs');

function completeMinutes(detail) {
  return [
    'Meeting Summary',
    'Key Conclusions',
    'Topic Discussion',
    'Confirmed Decisions',
    'Action Items',
    'Open Questions',
    'Key Figures',
  ]
    .map((heading, index) => '## ' + heading + '\n' + (index ? 'Not discussed.' : detail))
    .join('\n\n');
}

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

test('OpenCode Go 复用会议会话标识，连接测试也发送会话标识', async (t) => {
  const sessions = [];
  const endpoint = await server(t, (req, res) => {
    sessions.push(req.headers['x-opencode-session']);
    res.end('{"choices":[{"message":{"content":"OK"}}]}');
  });
  const options = { endpoint: endpoint + '/v1', model: 'glm-5.3-flash' };
  const go = { ...options, provider: 'opencode-go' };
  assert.equal(await complete({ ...go, meeting_id: 'meeting-1' }, 'part 1'), 'OK');
  await complete({ ...go, meeting_id: 'meeting-1' }, 'part 2');
  await complete(go, 'Reply only OK.');
  await complete(options, 'other provider');
  assert.deepEqual(sessions.slice(0, 2), ['meeting-1', 'meeting-1']);
  assert.match(sessions[2], /^[\da-f-]{36}$/);
  assert.equal(sessions[3], undefined);
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
  const chunks = splitByBudget(source, 128);
  assert.ok(
    chunks.every((chunk) => estimatedTokens(chunk) <= 128 && chunk.startsWith('S1 [00:00] ')),
  );
  assert.equal(chunks.map((chunk) => chunk.slice(11)).join(''), '内容'.repeat(100));
  const fact = '原话'.repeat(100) + ' [[cause:S1,S3]]';
  const fragments = splitByBudget(fact, 128, true);
  assert.ok(
    fragments.length > 1 &&
      fragments.every(
        (piece) => estimatedTokens(piece) <= 128 && piece.endsWith(' [[cause:S1,S3]]'),
      ),
  );
  assert.equal(fragments.map((piece) => piece.split(' [[')[0]).join(''), fact.split(' [[')[0]);
  assert.throws(() => splitByBudget(source, 4));
  assert.throws(() => splitByBudget(source, 0));
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
  assert.deepEqual(
    parseSuggestions(
      JSON.stringify({ type: 'topic', text: '普工培训创业项目\n## 普工培训创业项目' }),
    ),
    [],
  );
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
        choices: [
          {
            message: {
              content:
                calls === 1
                  ? completeMinutes('### Unanswered\n[[cause:S1]]')
                  : completeMinutes('- Confirmed action [[S1]]'),
            },
          },
        ],
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
  assert.equal(calls, 2);
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

test('带前缀 Base URL 保留路径和查询参数', async (t) => {
  const urls = [];
  const endpoint = await server(t, (req, res) => {
    urls.push(req.url);
    res.end('{"choices":[{"message":{"content":"OK"}}]}');
  });
  for (const suffix of ['/gateway/v1', '/gateway/v1/chat', '/gateway/v1/chat/completions'])
    await complete({ endpoint: endpoint + suffix + '?test=1', model: 'test' }, 'OK');
  assert.deepEqual(urls, Array(3).fill('/gateway/v1/chat/completions?test=1'));
});

test('长纪要覆盖第六段之后并拒绝空分段', async (t) => {
  let empty = false;
  let verbose = false;
  const seen = [];
  const endpoint = await server(t, (_req, res, body) => {
    const prompt = body.messages[0].content;
    seen.push(prompt);
    const labels = [...prompt.matchAll(/^S(\d+) \[/gm)].map((m) => 'S' + m[1]);
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: empty
                ? '<think>only</think>'
                : prompt.includes('Use these seven level-two headings')
                  ? completeMinutes('- Tail [[conclusion:S8]]')
                  : '# Summary\n- Tail [[conclusion:' +
                    (labels.join(',') || 'S8') +
                    ']]' +
                    (verbose && labels.length ? '\n' + 'Detail '.repeat(500) : ''),
            },
          },
        ],
      }),
    );
  });
  let saves = 0;
  const meeting = {
    id: 'long',
    title: 'Long',
    segments: Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      text: 'x'.repeat(8500),
      start_ms: i * 1000,
      end_ms: (i + 1) * 1000,
      speaker_name: 'A',
    })),
  };
  const worker = {
    tasks: new TaskRegistry(),
    settings: { llm: { timeout_seconds: 2 } },
    models: { catalog: new Map() },
    emit() {},
    store: {
      getMeeting: () => meeting,
      meetingExists: () => true,
      saveSummary() {
        saves++;
        return false;
      },
    },
  };
  const handler = createLLMHandlers(worker)['summary.generate'];
  const payload = {
    meeting_id: 'long',
    context_size: 12000,
    endpoint,
    provider: 'openai',
    model: 'test',
    consent: true,
  };
  await handler(payload);
  assert.equal(seen.filter((p) => p.includes('<transcript>')).length, 8);
  assert.match(seen.at(-1), /S8/);
  assert.equal(saves, 1);
  verbose = true;
  seen.length = 0;
  await handler(payload);
  assert.ok(seen.some((p) => p.includes('Compress these partial summaries')));
  assert.match(seen.at(-1), /S8/);
  assert.equal(saves, 2);
  empty = true;
  await assert.rejects(handler(payload), (e) => e.code === 'error.summary.empty_response');
  assert.equal(saves, 2);
});

test('归并膨胀、拒绝压缩或成稿截断时保留每组来源并只保存一份七章纪要', async (t) => {
  const segments = Array.from({ length: 5 }, (_, index) => ({
    id: 'seg' + (index + 1),
    start_ms: index * 1000,
    end_ms: (index + 1) * 1000,
    speaker_name: 'A',
    text: 'Item ' + (index + 1) + '. ' + '内容'.repeat(1500),
  }));
  let mode, reductions, writes;
  const endpoint = await server(t, (_req, res, body) => {
    const prompt = body.messages[0].content;
    const map = [...prompt.matchAll(/^S(\d+) \[/gm)].map((m) => m[1]);
    let result,
      truncated = false;
    if (map.length) {
      result = map
        .map((id) => '- Item ' + id + '. [[conclusion:S' + id + ']]' + '\n' + '细节。'.repeat(260))
        .join('\n');
    } else if (prompt.includes('Compress these partial summaries')) {
      reductions++;
      result = mode === 'expand' ? '冗长。'.repeat(2000) : '- Item 1. [[conclusion:S1]]';
      truncated = mode === 'limit';
    } else {
      const ids = [...prompt.matchAll(/Item (\d+)\./g)].map((m) => m[1]);
      result = completeMinutes(
        ids.length
          ? ids.map((id) => '- Item ' + id + '. [[conclusion:S' + id + ']]').join('\n')
          : '—',
      ).replaceAll('Not discussed.', '—');
      // 始终要求跨组的引用，检查每组自己的证据边界。
      result = result.replace(
        '## Key Conclusions\n—',
        '## Key Conclusions\n- Unsupported [[conclusion:S99]]',
      );
      writes++;
      if (mode === 'final limit' && writes === 1) truncated = true;
    }
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: truncated ? 'length' : 'stop', message: { content: result } }],
      }),
    );
  });
  const meeting = { id: 'bounded', title: 'Meeting', segments };
  let saved;
  const worker = {
    tasks: new TaskRegistry(),
    settings: { llm: { timeout_seconds: 3 } },
    models: { catalog: new Map() },
    emit() {},
    store: {
      getMeeting: () => meeting,
      meetingExists: () => true,
      saveSummary(id, data) {
        saved = data;
        return false;
      },
    },
  };
  for (mode of ['expand', 'limit', 'final limit']) {
    saved = null;
    reductions = writes = 0;
    await createLLMHandlers(worker)['summary.generate']({
      meeting_id: meeting.id,
      context_size: 8192,
      endpoint,
      model: 'test',
      provider: 'openai',
      consent: true,
    });
    assert.ok(reductions > 0 && writes <= 1);
    assert.equal((saved.markdown.match(/^## /gm) || []).length, 7);
    for (let i = 1; i <= segments.length; i++)
      assert.ok(
        saved.claims.some(
          (c) => c.text === 'Item ' + i + '.' && c.sources.some((s) => s.segment_id === 'seg' + i),
        ),
        'lost ' + i,
      );
    assert.ok(saved.claims.filter((c) => c.text === 'Unsupported').every((c) => !c.sources.length));
  }
});

test('纪要在线最多三路并行，本地串行，乱序完成仍按原文合并', { timeout: 5000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-summary-concurrency-'));
  fs.writeFileSync(path.join(directory, 'test.gguf'), '');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const provider of ['openai', 'built-in']) {
    let active = 0,
      peak = 0;
    const completed = [],
      progress = [];
    async function answer(prompt) {
      const label = /^S(\d+) \[/m.exec(prompt)?.[1];
      if (!label) {
        const labels = [...prompt.matchAll(/part-(\d+)/g)].map((m) => Number(m[1]));
        assert.deepEqual(labels, [1, 2, 3, 4, 5, 6]);
        return completeMinutes('Complete');
      }
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, Number(label) % 3 === 1 ? 45 : 10));
      active--;
      completed.push(Number(label));
      return '# part-' + label;
    }
    const endpoint = await server(t, async (_req, res, body) => {
      res.end(
        JSON.stringify({
          choices: [{ message: { content: await answer(body.messages[0].content) } }],
        }),
      );
    });
    const meeting = {
      id: 'parallel',
      title: 'Test',
      segments: Array.from({ length: 6 }, (_, i) => ({
        id: String(i),
        text: 'x'.repeat(8500),
        speaker_name: 'A',
        start_ms: i * 1000,
        end_ms: (i + 1) * 1000,
      })),
    };
    const worker = {
      tasks: new TaskRegistry(),
      settings: { llm: { timeout_seconds: 2 } },
      models: { catalog: new Map(), isReady: () => true, path: () => directory },
      engineFactory: () => ({
        request: async (command, payload) =>
          command === 'llama.load' ? {} : { text: await answer(payload.prompt) },
      }),
      emit: (type, payload) => {
        if (type === 'summary.progress') progress.push(payload.completed);
      },
      store: { getMeeting: () => meeting, meetingExists: () => true, saveSummary: () => false },
    };
    await createLLMHandlers(worker)['summary.generate']({
      meeting_id: meeting.id,
      context_size: 12000,
      provider,
      model: 'test',
      endpoint,
      consent: true,
    });
    assert.equal(peak, provider === 'openai' ? 3 : 1);
    assert.equal(active, 0);
    if (provider === 'openai') assert.notDeepEqual(completed, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(
      progress,
      [...progress].sort((a, b) => a - b),
    );
  }
});

test('并行纪要失败或取消后不启动下一批、不保存部分结果', { timeout: 5000 }, async (t) => {
  for (const cancel of [false, true]) {
    let calls = 0,
      saved = false;
    const tasks = new TaskRegistry();
    const endpoint = await server(t, async (_req, res) => {
      const index = ++calls;
      if (cancel && calls === 3) tasks.cancel('summary.generate', 'failure');
      await new Promise((resolve) => setTimeout(resolve, index === 1 ? 5 : 30));
      res.statusCode = !cancel && index === 1 ? 500 : 200;
      res.end(JSON.stringify({ choices: [{ message: { content: '# Partial' } }] }));
    });
    const meeting = {
      id: 'failure',
      title: 'Test',
      segments: Array.from({ length: 7 }, (_, i) => ({
        id: String(i),
        text: 'x'.repeat(8500),
        start_ms: 0,
        end_ms: 1000,
        speaker_name: 'A',
      })),
    };
    const worker = {
      tasks,
      settings: { llm: { timeout_seconds: 2 } },
      models: { catalog: new Map() },
      emit() {},
      store: {
        getMeeting: () => meeting,
        meetingExists: () => true,
        saveSummary: () => {
          saved = true;
        },
      },
    };
    const pending = createLLMHandlers(worker)['summary.generate']({
      meeting_id: 'failure',
      provider: 'openai',
      model: 'test',
      endpoint,
      consent: true,
    });
    if (cancel) assert.deepEqual(await pending, { cancelled: true });
    else await assert.rejects(pending, /500/);
    assert.equal(calls, 3);
    assert.equal(saved, false);
  }
});

test('分块缓存跨重启和模板复用，单段变更与截断重试独立，覆盖同段多项事实', async (t) => {
  const { Store } = require('./store.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-chunk-cache-'));
  let store = new Store(dir);
  t.after(() => {
    store.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const meeting = store.createMeeting({
    title: 'Review',
    language: 'en',
    refined_model_id: 'test',
  });
  for (let i = 1; i <= 4; i++)
    store.saveSegment({
      meeting_id: meeting.id,
      segment_id: 'seg' + i,
      start_ms: i * 1000,
      end_ms: i * 1000 + 800,
      text: 'Review budget. Send report. 15 people. ' + 'x'.repeat(8500),
    });
  let calls = [],
    fail = true,
    truncate = false;
  const endpoint = await server(t, (_req, res, body) => {
    const prompt = body.messages[0].content;
    const id = /^S(\d+) \[/m.exec(prompt)?.[1];
    calls.push(id || 'final');
    if (id === '4' && fail) {
      res.statusCode = 503;
      return res.end('{}');
    }
    const limited = truncate && id === '4';
    if (limited) truncate = false;
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: limited ? 'length' : 'stop',
            message: {
              content: id
                ? '- Review budget. [[action:S' +
                  id +
                  ']]\n- Send report. [[action:S' +
                  id +
                  ']]\n- 5 people. [[conclusion:S' +
                  id +
                  ']]'
                : completeMinutes('Summary'),
            },
          },
        ],
      }),
    );
  });
  const run = (template = 'general') =>
    createLLMHandlers({
      tasks: new TaskRegistry(),
      store,
      models: { catalog: new Map() },
      settings: { llm: {} },
      emit() {},
    })['summary.generate']({
      meeting_id: meeting.id,
      provider: 'openai',
      model: 'test',
      endpoint,
      consent: true,
      context_size: 12000,
      template,
    });
  await assert.rejects(run(), /503/);
  store.db.close();
  store = new Store(dir);
  calls = [];
  fail = false;
  truncate = true;
  const result = await run();
  assert.equal(calls.at(-1), 'final');
  assert.ok(calls.length >= 4 && calls.slice(0, -1).every((id) => id === '4'));
  assert.match(result.markdown, /Review budget/);
  assert.match(result.markdown, /Send report/);
  assert.doesNotMatch(result.markdown, /5 people/);
  calls = [];
  await run('review');
  assert.deepEqual(calls, ['final']);
  store.saveSegment({
    meeting_id: meeting.id,
    segment_id: 'seg2',
    start_ms: 2000,
    end_ms: 2800,
    text: 'Review budget. Send report. ' + 'z'.repeat(8500),
  });
  calls = [];
  await run();
  assert.deepEqual(calls, ['2', 'final']);
});

test('纯数字事实不变为原因，有原话解释的数字原因保留', () => {
  const { verifyFactSources } = require('./summary-facts.cjs');
  const rows = [
    { text: '试点中有20家客户，失败率是8%。' },
    { text: '失败率升高，因为客户端超时只有三秒。' },
  ];
  assert.equal(
    verifyFactSources('- 试点中有20家客户 [[cause:S1,S2]]', rows),
    '- 试点中有20家客户 [[conclusion:S1]]',
  );
  assert.equal(
    verifyFactSources('- 客户端超时只有3秒 [[cause:S2]]', rows),
    '- 客户端超时只有3秒 [[cause:S2]]',
  );
});

test('只在兼容端点明确要求时换用 max_completion_tokens，截断结果不作为纪要', async (t) => {
  const requests = [];
  const endpoint = await server(t, (_req, res, body) => {
    requests.push(body);
    if (body.max_tokens) {
      res.statusCode = 400;
      return res.end('max_tokens unsupported; use max_completion_tokens');
    }
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: 'partial answer' } }],
      }),
    );
  });
  await assert.rejects(
    complete({ endpoint, model: 'test', max_tokens: 512, require_complete: true }, 'test'),
    /output limit/,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[1].max_completion_tokens, 512);
  assert.equal(requests[1].max_tokens, undefined);
});

test('补写只保留逐字成立的整句，不把否定改成决定，替换空章占位', () => {
  const { coverFacts } = require('./summary-facts.cjs');
  const { SUMMARY_HEADINGS } = require('./meeting-evidence.cjs');
  const md = completeMinutes('Meeting').replaceAll(
    'Not discussed.',
    'No action items were mentioned.',
  );
  const corrected = coverFacts(
    md,
    ['- 批准上线。 [[decision:S1]]\n- 提交预算。 [[action:S2]]'],
    SUMMARY_HEADINGS.en,
    [{ text: '并未批准上线。' }, { text: '提交预算。' }],
  );
  assert.doesNotMatch(corrected, /批准上线/);
  assert.match(corrected, /## Action Items\n- 提交预算。 \[\[action:S2\]\]/);
});

test('oversized chunked provider error bodies are bounded before logging or parsing', async (t) => {
  const endpoint = await server(t, (_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.write('x'.repeat(12000));
    res.end('y'.repeat(12000));
  });
  await assert.rejects(
    complete({ endpoint, model: 'test' }, 'fixed sample'),
    /size limit \(HTTP 500\)/,
  );
});

test('只在兼容端点明确要求时换用 max_completion_tokens，截断结果不作为纪要', async (t) => {
  const requests = [];
  const endpoint = await server(t, (_req, res, body) => {
    requests.push(body);
    if (body.max_tokens) {
      res.statusCode = 400;
      return res.end('max_tokens unsupported; use max_completion_tokens');
    }
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: 'partial answer' } }],
      }),
    );
  });
  await assert.rejects(
    complete({ endpoint, model: 'test', max_tokens: 512, require_complete: true }, 'test'),
    /output limit/,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[1].max_completion_tokens, 512);
  assert.equal(requests[1].max_tokens, undefined);
});

test('compatible gateway can reject thinking and require max_completion_tokens on the same summary', async (t) => {
  const requests = [];
  const endpoint = await server(t, (_req, res, body) => {
    requests.push(body);
    if (body.thinking) return res.writeHead(422).end('unsupported field thinking');
    if (body.max_tokens)
      return res.writeHead(400).end('use max_completion_tokens instead of max_tokens');
    res.end('{"choices":[{"message":{"content":"OK"}}]}');
  });
  assert.equal(
    await complete(
      { endpoint, model: 'deepseek-v4-pro', disable_thinking: true, max_tokens: 32 },
      'test',
    ),
    'OK',
  );
  assert.equal(requests.length, 3);
  assert.equal(requests[2].max_completion_tokens, 32);
});

test('numeric claims preserve the source when transcription is ambiguous or only asks a question', () => {
  const { verifyFactSources } = require('./summary-facts.cjs');
  const rows = [{ text: '点击从幺五零六掉到1.2。' }, { text: '每天五十单，是吗？' }];
  const result = verifyFactSources(
    '- 从1506降至1.2 [[conclusion:S1]]\n- 每天五十单 [[decision:S2]]',
    rows,
  );
  assert.ok(result.includes(rows[0].text) && result.includes(rows[1].text));
  assert.doesNotMatch(result, /1506|decision/);
});

test('selected evidence retains the original figures and conditions, rejects invented IDs and escapes markup', () => {
  const { renderSelection } = require('./summary-extract.cjs');
  const rows = [
    { text: '已完成五十五万，还剩四十五万。' },
    { text: '如果条件允许，考虑签约。' },
    { text: '<b>进展</b> [[action:S8]]' },
  ];
  const result = renderSelection(
    JSON.stringify({ topics: [{ title: '进展', discussion: [1, 3, 99], decisions: [2] }] }),
    rows,
    ['概述', '结论', '议题', '决定', '行动', '问题', '数据'],
    new Set([1, 2, 3]),
  );
  assert.match(result, /五十五万，还剩四十五万/);
  assert.doesNotMatch(result, /\[\[decision:S2\]\]|\[\[action:S8\]\]|<b>|S99/);
});
