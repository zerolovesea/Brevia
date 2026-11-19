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

test('长会反复触及输出上限时继续按来源拆分，保留末段并拒绝半截回复', async (t) => {
  const quote = '本周已完成现场验收';
  const segments = Array.from({ length: 48 }, (_, i) => ({
    id: `seg${i + 1}`,
    text: `第${i + 1}项${quote}。` + '交付记录已归档。'.repeat(10),
    start_ms: i * 1000,
    speaker_name: '甲',
  }));
  const meeting = { id: 'long-output', language: 'zh', title: '交付会议', segments };
  let alwaysTruncate = false;
  const endpoint = await server(t, (_req, res, body) => {
    const prompt = body.messages[0].content;
    const ids = [...prompt.matchAll(/^S(\d+) \[/gm)].map((m) => Number(m[1]));
    const fact = (id) => `第${id}项${quote}。`;
    let content;
    if (!alwaysTruncate && prompt.includes('"edits"')) {
      const input = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).items;
      content = JSON.stringify({
        edits: input.map((r) => ({ n: r.n, text: r.text, sources: [+r.text.match(/\d+/)[0]] })),
      });
    } else if (!alwaysTruncate && ids.length && ids.length <= 2 && !prompt.includes('## ')) {
      content = prompt.includes('"notes"')
        ? JSON.stringify({
            notes: ids.map((id) => ({ kind: 'finding', text: fact(id), refs: [{ id, quote }] })),
          })
        : ids.map((id) => `- ${fact(id)} [[conclusion:S${id}]]`).join('\n');
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: content ? 'stop' : 'length',
            message: { content: content || '半截回复 [[conclusion:S1]]' },
          },
        ],
      }),
    );
  });
  const worker = {
    tasks: new TaskRegistry(),
    settings: { llm: { timeout_seconds: 3 } },
    models: { catalog: new Map() },
    emit() {},
    store: {
      getMeeting: () => meeting,
      meetingExists: () => true,
      saveSummary(_id, data) {
        meeting.summary = { data };
        return true;
      },
    },
  };
  const handler = createLLMHandlers(worker)['summary.generate'];
  for (const model of ['test', 'deepseek-v4-flash']) {
    await t.test(model, async () => {
      alwaysTruncate = false;
      const run = () =>
        handler({
          meeting_id: meeting.id,
          endpoint,
          provider: 'openai',
          model,
          language: 'zh',
          consent: true,
        });
      const result = await run();
      assert.equal(result.markdown.match(/^## /gm)?.length, 7);
      assert.doesNotMatch(result.markdown, /半截回复/);
      assert.deepEqual(
        new Set(result.claims.flatMap((c) => c.sources.map((s) => s.segment_id))),
        new Set(segments.map((s) => s.id)),
      );
      alwaysTruncate = true;
      const previous = meeting.summary;
      await assert.rejects(run(), /Model response reached the output limit/);
      assert.equal(meeting.summary, previous);
    });
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
    else await assert.rejects(pending, /500.*part 1\/7/);
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
  assert.equal(result.trim(), '');
  assert.doesNotMatch(result, /1506|decision/);
});

test('跨轮解释同时验证各条原话；错误编号只在当前块唯一匹配时修复', () => {
  const { readTopics } = require('./topic-minutes.cjs');
  const segments = ['此前只发通知', '没有录客户音', '没有录客户音'].map((text) => ({ text }));
  const part = segments.map((s, i) => 'S' + (i + 1) + ' [00:00] speaker: ' + s.text).join('\n');
  const note = {
    kind: 'cause',
    topic: '为什么没有本地语料？',
    text: '此前只发通知，没有录客户音，无法取得训练语料。',
    refs: [
      { id: 9, quote: '此前只发通知' },
      { id: 2, quote: '没有录客户音' },
    ],
  };
  const read = (n) => readTopics(JSON.stringify({ notes: [n] }), part, segments);
  assert.deepEqual(read(note)[0].ids, [1, 2]);
  assert.deepEqual(read({ ...note, refs: [...note.refs, { id: 8, quote: '没有录客户音' }] }), []);
  assert.deepEqual(read({ ...note, refs: [] }), []);
});

test('先展示可读的纪要和原因，核证后才出现原话', async () => {
  const { topicMinutes } = require('./topic-minutes.cjs');
  const evidence = require('./meeting-evidence.cjs');
  const headings = evidence.SUMMARY_HEADINGS.zh;
  const segments = [{ id: 'seg', text: '排期已满，试点只能下周启动。', start_ms: 0 }];
  const note = {
    topic: '为什么试点下周才启动？',
    kind: 'cause',
    text: '本周排期已满，因此试点要等到下周。',
    refs: [{ id: 1, quote: '排期已满' }],
  };
  let preview,
    calls = 0;
  const result = await topicMinutes({
    transcript: 'S1 [00:00] 甲: ' + segments[0].text,
    segments,
    headings,
    language: 'zh',
    template: 'weekly',
    budget: 2000,
    store: {},
    mapChunks: (xs, fn) => Promise.all(xs.map(fn)),
    wait: async () => {},
    limit: () => false,
    generate: async () => {
      if (++calls === 1) return JSON.stringify({ notes: [note] });
      assert.equal(preview[1][0].kind, 'cause');
      assert.deepEqual(preview[1][0].sources, []);
      return JSON.stringify({
        edits: [{ n: 1, text: note.text, topic: note.topic, sources: [1] }],
      });
    },
    preview: (md) => {
      preview = evidence.parseClaims(md, [], false, headings, false);
    },
  });
  assert.equal(
    evidence.parseClaims(result, segments, true, headings, false)[1][0].sources[0].text,
    segments[0].text,
  );
});

test('校对缺项或重复项会拆批重试，未支持的数字和纯问句不能成为结论', async () => {
  const { topicMinutes } = require('./topic-minutes.cjs');
  const { SUMMARY_HEADINGS } = require('./meeting-evidence.cjs');
  const segments = [
    { text: '甲项目计划下周启动。' },
    { text: '乙项目计划下周测试。' },
    { text: '预计增加到1000台。' },
    { text: '每天五十单，是吗？' },
  ];
  const notes = segments.map((s, i) => ({
    kind: 'finding',
    text: s.text,
    refs: [{ id: i + 1, quote: s.text }],
  }));
  for (const duplicate of [false, true]) {
    let reviews = 0;
    const result = await topicMinutes({
      transcript: segments.map((s, i) => `S${i + 1} [00:00] 甲: ${s.text}`).join('\n'),
      segments,
      headings: SUMMARY_HEADINGS.zh,
      language: 'zh',
      template: 'general',
      budget: 2000,
      store: {},
      local: true,
      mapChunks: (xs, fn) => Promise.all(xs.map(fn)),
      wait: async () => {},
      limit: () => false,
      generate: async (prompt) => {
        if (!prompt.includes('"edits"')) return JSON.stringify({ notes });
        const input = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).items;
        const edits = input.map((r) => ({
          n: r.n,
          text: r.text === segments[2].text ? '增加到2000台。' : r.text?.replace('，是吗？', ''),
          sources: [segments.findIndex((s) => s.text === r.text) + 1],
        }));
        reviews++;
        if (prompt.includes('只写原话明确支持的定性关系')) {
          assert.deepEqual(
            input.map(({ sources, context }) => [sources, context]),
            [[[3], []]],
          );
          return JSON.stringify({
            edits: [
              { n: 1, text: duplicate ? '预计数量会上升。' : '预计增加到2000台。', sources: [3] },
            ],
          });
        }
        if (input.length === notes.length) {
          if (duplicate) edits.push(edits[0]);
          else edits.pop();
          return JSON.stringify({ edits });
        }
        return JSON.stringify(duplicate ? [{ edits }] : edits);
      },
    });
    assert.equal(reviews, 4);
    assert.equal(result.includes('预计数量会上升'), duplicate);
    assert.match(result, /甲项目计划下周启动/);
    assert.match(result, /乙项目计划下周测试/);
    assert.doesNotMatch(result, /2000|每天五十单/);
  }
});

test('本地小数被冠以另一指标时单独核对，仍失配只引用原发言', async () => {
  const { topicMinutes } = require('./topic-minutes.cjs');
  const source = '这次得到0.79，指标名称听不清。意向点击率是2.58。';
  const wrong = '过审率为0.79。';
  let reviews = 0;
  const result = await topicMinutes({
    transcript: 'S1 [00:00] 甲: ' + source,
    segments: [{ text: source }],
    language: 'zh',
    local: true,
    budget: 2000,
    store: {},
    headings: require('./meeting-evidence.cjs').SUMMARY_HEADINGS.zh,
    wait: async () => {},
    limit: () => false,
    mapChunks: (xs, fn) => Promise.all(xs.map(fn)),
    generate: async (prompt) => {
      if (!prompt.includes('"edits"'))
        return JSON.stringify({
          notes: [wrong, '意向点击率是2.58。'].map((text) => ({
            kind: 'finding',
            text,
            refs: [{ id: 1, quote: '意向点击率' }],
          })),
        });
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
      if (++reviews === 2) {
        assert.equal(items.length, 1);
        assert.ok(!Object.hasOwn(items[0], 'text'));
        assert.deepEqual(items[0].sources, [1]);
      }
      return JSON.stringify({
        edits: items.map(({ n, text }) => ({ n, text: text || wrong, sources: [1] })),
      });
    },
  });
  assert.equal(reviews, 2);
  assert.ok(result.includes('原话：“' + source + '” [[conclusion:S1]]'));
  assert.ok(result.includes('意向点击率是2.58。 [[conclusion:S1]]'));
  assert.ok(!result.includes(wrong));
});

test('主题纪要逐块核证并落盘，重开后只重试未完成或原话已变的块', async (t) => {
  const { Store } = require('./store.cjs');
  const { topicMinutes } = require('./topic-minutes.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-topic-resume-'));
  let store = new Store(directory);
  t.after(() => {
    store.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const meetingId = store.createMeeting({
    title: 'Review',
    language: 'zh',
    refined_model_id: 'test',
  }).id;
  const segments = [1, 2, 3, 4].map((id) => ({
    text: '议题' + id + '已验收。' + '等待门店确认。'.repeat(23),
  }));
  const calls = [];
  let fail = true;
  const run = () =>
    topicMinutes({
      transcript: segments.map((s, i) => `S${i + 1} [00:00] 甲: ${s.text}`).join('\n'),
      segments,
      store,
      meetingId,
      language: 'zh',
      local: true,
      budget: 250,
      headings: require('./meeting-evidence.cjs').SUMMARY_HEADINGS.zh,
      wait: async () => {},
      limit: () => false,
      mapChunks: async (chunks, fn) => {
        const output = [];
        for (const [i, chunk] of chunks.entries()) output.push(await fn(chunk, i));
        return output;
      },
      generate: async (prompt) => {
        if (prompt.includes('"edits"')) {
          const { items } = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
          return JSON.stringify({
            edits: items.map(({ n, text, sources }) => ({ n, text, sources })),
          });
        }
        const id = +prompt.match(/^S(\d+) /m)[1];
        calls.push(id);
        if (id === 3 && fail) throw new Error('service unavailable');
        if (id === 2) return '{"notes":[]}';
        const text = segments[id - 1].text.split('。')[0];
        return JSON.stringify({ notes: [{ kind: 'finding', text, refs: [{ id, quote: text }] }] });
      },
    });
  await assert.rejects(run(), /service unavailable/);
  assert.deepEqual(calls, [1, 2, 3]);
  store.db.close();
  store = new Store(directory);
  calls.length = 0;
  fail = false;
  assert.match(await run(), /议题4已验收/);
  assert.deepEqual(calls, [3, 4]);
  calls.length = 0;
  segments[0].text = segments[0].text.replace('已验收', '待验收');
  assert.match(await run(), /议题1待验收/);
  assert.ok(calls.includes(1));
  assert.ok(!calls.includes(4));
});

test('共用原话仍逐项限制引文，暂定日期可改类，综述带上最后决定', async () => {
  const { topicMinutes } = require('./topic-minutes.cjs');
  const segments = [
    '范围仅限北桥。',
    '提出周五上线。',
    '清点设备库存。',
    '确定周一上线。',
    '交付计划待审。',
    '是否需要备机？',
  ].map((text) => ({ text }));
  const notes = segments.map(({ text }, i) => ({
    kind: ['overview', 'decision', 'overview', 'decision', 'finding', 'decision'][i],
    text,
    refs: [{ id: i + 1, quote: text }],
  }));
  const run = (overview) =>
    topicMinutes({
      transcript: segments.map((s, i) => `S${i + 1} [00:00] 甲: ${s.text}`).join('\n'),
      segments,
      language: 'zh',
      headings: require('./meeting-evidence.cjs').SUMMARY_HEADINGS.zh,
      budget: 4000,
      store: {},
      wait: async () => {},
      limit: () => false,
      mapChunks: (xs, fn) => Promise.all(xs.map(fn)),
      generate: async (prompt) => {
        if (prompt.includes('"edits"')) {
          const { speech, items } = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
          assert.deepEqual(
            Object.values(speech),
            segments.map((s) => s.text),
          );
          assert.equal(items[4].context.includes(1), false);
          return JSON.stringify({
            edits: items.map(({ n, text, sources }) => ({
              n,
              text,
              kind: n === 2 ? 'open' : undefined,
              sources: n === 5 ? [1] : sources,
            })),
          });
        }
        if (prompt.startsWith('Compose')) {
          assert.match(prompt, /3\. \[decision\] 确定周一上线/);
          assert.doesNotMatch(prompt, /\[decision\] 提出周五/);
          return overview;
        }
        return JSON.stringify({ notes });
      },
    });
  for (const overview of [
    '{"overview":[{"text":"确定周一上线。","notes":[3]}]}',
    '{"overview":[{"text":"范围仅限北桥。","notes":[1]}]}',
    'null',
  ]) {
    const result = await run(overview);
    assert.match(result, /## 会议摘要\n- 确定周一上线。 \[\[conclusion:S4/);
    assert.match(result, /## 待确认事项\n- 提出周五上线/);
    assert.doesNotMatch(result, /交付计划待审/);
    assert.match(result, /## 待确认事项[^#]*是否需要备机？/);
  }
});

test('跨块摘要合并不能引入原话中没有的数字', async () => {
  const { topicMinutes } = require('./topic-minutes.cjs');
  const { SUMMARY_HEADINGS } = require('./meeting-evidence.cjs');
  const segments = [1, 2].map(() => ({
    text: '本期预算1000元。' + '项目正在按计划推进。'.repeat(30),
  }));
  let merged = false;
  const result = await topicMinutes({
    transcript: segments.map((s, i) => `S${i + 1} [00:00] 甲: ${s.text}`).join('\n'),
    segments,
    headings: SUMMARY_HEADINGS.zh,
    language: 'zh',
    template: 'general',
    budget: 500,
    store: {},
    mapChunks: (xs, fn) => Promise.all(xs.map(fn)),
    wait: async () => {},
    limit: () => false,
    generate: async (prompt) => {
      if (prompt.startsWith('Compose')) {
        merged = true;
        return '{"overview":[{"text":"预算2000元。","notes":[1]}]}';
      }
      if (prompt.includes('"edits"')) {
        const input = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).items;
        return JSON.stringify({
          edits: input.map((r) => ({ n: r.n, text: r.text, sources: [r.sources[0]] })),
        });
      }
      return JSON.stringify({
        notes: [
          {
            kind: 'overview',
            text: '预算1000元。',
            refs: [{ id: Number(prompt.match(/^S(\d+) /m)[1]), quote: '本期预算1000元' }],
          },
        ],
      });
    },
  });
  assert.equal(merged, true);
  assert.match(result, /1000/);
  assert.doesNotMatch(result, /2000/);
});

test('内置长会议的逐项核证遵循实际16K窗口而不是整场32K预算', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-topic-context-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'model.gguf'), 'fixture');
  const meeting = {
    id: 'long-local',
    title: 'Long meeting',
    language: 'zh',
    segments: [1, 2, 3].map((id) => ({
      id: String(id),
      text: '项目按计划推进。'.repeat(700),
      start_ms: id * 1000,
      speaker_name: '甲',
    })),
  };
  let reviews = 0,
    saves = 0;
  const worker = {
    tasks: new TaskRegistry(),
    settings: { llm: {} },
    models: {
      catalog: new Map([['local', { context_size: 32768 }]]),
      isReady: () => true,
      path: () => directory,
    },
    emit() {},
    engineFactory: () => ({
      async request(type, payload) {
        if (type === 'llama.load') return {};
        if (estimatedTokens(payload.prompt) + payload.max_tokens > payload.context_size)
          throw new Error('maximum context length exceeded');
        if (payload.prompt.includes('"edits"')) {
          reviews++;
          const input = JSON.parse(payload.prompt.slice(payload.prompt.indexOf('\n') + 1)).items;
          return {
            text: JSON.stringify({
              edits: input.map((r) => ({ n: r.n, text: r.text, sources: [r.sources[0]] })),
            }),
          };
        }
        const id = Number(payload.prompt.match(/^S(\d+) /m)[1]);
        return {
          text: JSON.stringify({
            notes: [
              {
                kind: 'finding',
                text: '项目按计划推进。',
                refs: [{ id, quote: '项目按计划推进' }],
              },
            ],
          }),
        };
      },
    }),
    store: {
      getMeeting: () => meeting,
      meetingExists: () => true,
      saveSummary() {
        saves++;
        return false;
      },
    },
  };
  await createLLMHandlers(worker)['summary.generate']({
    meeting_id: meeting.id,
    provider: 'built-in',
    model: 'local',
    language: 'zh',
    consent: true,
  });
  assert.ok(reviews > 0);
  assert.equal(saves, 1);
});

test('在线术语请求让位纪要，排队取消不占用请求槽', async (t) => {
  const held = [];
  const endpoint = await server(t, (_req, res, body) =>
    held.push({ res, text: body.messages.at(-1).content }),
  );
  const worker = { settings: { llm: { timeout_seconds: 30 } } };
  createLLMHandlers(worker);
  const options = { provider: 'openai', model: 'test', endpoint, format: 'openai' };
  const waitFor = async (count) => {
    for (let i = 0; i < 100 && held.length < count; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(held.length, count);
  };
  const first = [0, 1, 2].map((i) => worker.llmComplete(options, 'main' + i));
  await waitFor(3);
  const abort = new AbortController();
  const cancelled = worker.llmComplete(options, 'cancelled', {
    background: true,
    signal: abort.signal,
  });
  abort.abort(new Error('cancelled'));
  await assert.rejects(cancelled, /cancelled/);
  const background = worker.llmComplete(options, 'terms', { background: true });
  const foreground = worker.llmComplete(options, 'main3');
  const reply = (index) =>
    held[index].res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  reply(0);
  await waitFor(4);
  assert.equal(held[3].text, 'main3');
  reply(1);
  reply(2);
  await waitFor(5);
  assert.equal(held[4].text, 'terms');
  reply(3);
  reply(4);
  assert.deepEqual(await Promise.all([...first, foreground, background]), [
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
  ]);
});

test('重新生成等待旧术语扫描取消后启动本轮扫描，不误报失败', async (t) => {
  let scans = 0;
  const endpoint = await server(t, (_req, res, body) => {
    const terms = body.messages
      .at(-1)
      .content.includes('Identify terminology that needs human clarification');
    if (terms) scans++;
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: terms
                ? '{"terms":[]}'
                : completeMinutes('- Submit the budget tomorrow [[conclusion:S1]]'),
            },
          },
        ],
      }),
    );
  });
  const tasks = new TaskRegistry(),
    events = [];
  const old = tasks.running(
    'glossary.analyze',
    'meeting',
    async (control) =>
      new Promise((resolve) => {
        control.signal.addEventListener('abort', () => setTimeout(resolve, 40), { once: true });
      }),
  );
  const meeting = {
    id: 'meeting',
    title: 'Meeting',
    meeting_date: '2026-11-06',
    summary: { data: { markdown: '' } },
    segments: [
      {
        id: 's1',
        text: 'We will submit the budget tomorrow.',
        start_ms: 0,
        end_ms: 1000,
        speaker_name: 'Alice',
      },
    ],
  };
  const worker = {
    tasks,
    settings: { llm: { timeout_seconds: 2 } },
    models: { catalog: new Map() },
    emit: (type) => events.push(type),
    store: {
      getMeeting: () => meeting,
      query: () => [],
      one: () => undefined,
      run: () => ({ changes: 0 }),
      meetingExists: () => true,
      saveSummary: () => false,
    },
  };
  await createLLMHandlers(worker)['summary.generate']({
    meeting_id: 'meeting',
    endpoint,
    provider: 'openai',
    model: 'test',
    consent: true,
    analyze_terms: true,
  });
  await old;
  for (let i = 0; i < 100 && (scans === 0 || tasks.hasAny()); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(scans, 1);
  assert.ok(!events.includes('glossary.failed'));
  assert.equal(tasks.hasAny(), false);
});
