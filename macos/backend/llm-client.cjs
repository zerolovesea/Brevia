const { randomUUID } = require('node:crypto');

// 云端推理只接受调用方已确认分享的文本，重定向不得跨越凭据所属来源。
async function post(endpoint, body, headers, signal) {
  let url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid LLM endpoint');
  for (let redirects = 0; redirects < 6; redirects++) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('LLM redirect has no location');
      const next = new URL(location, url);
      if (next.origin !== url.origin) throw new Error('Cross-origin LLM redirects are not allowed');
      url = next;
      continue;
    }
    const limit = response.ok ? 8 * 1024 * 1024 : 16 * 1024;
    const parts = [];
    let size = 0;
    for await (const part of response.body || []) {
      size += part.length;
      if (size > limit)
        throw new Error('LLM response exceeds the size limit (HTTP ' + response.status + ')');
      parts.push(part);
    }
    const text = Buffer.concat(parts, size).toString('utf8');
    if (!response.ok) throw new Error(`LLM request failed (${response.status}): ${text}`);
    return JSON.parse(text);
  }
  throw new Error('Too many LLM redirects');
}

async function complete(payload, prompt, { signal, timeout = 120, jsonMode = false } = {}) {
  if (typeof payload.model !== 'string' || !payload.model.trim())
    throw new Error('Model is required');
  const anthropic = ['anthropic', 'claude'].includes((payload.format || 'openai').toLowerCase());
  const url = new URL(payload.endpoint);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (anthropic && !pathname.endsWith('/v1/messages')) url.pathname = pathname + '/v1/messages';
  if (!anthropic && (!pathname || /\/v1(?:\/chat)?$/.test(pathname)))
    url.pathname = pathname.endsWith('/chat')
      ? pathname + '/completions'
      : (pathname || '/v1') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Brevia/1.0' };
  // OpenCode Go 按会话标识路由，同一会议的请求复用标识。
  if (payload.provider === 'opencode-go')
    headers['x-opencode-session'] = payload.meeting_id || randomUUID();
  if (payload.api_key) {
    if (anthropic)
      Object.assign(headers, { 'anthropic-version': '2023-06-01', 'x-api-key': payload.api_key });
    else headers.Authorization = `Bearer ${payload.api_key}`;
  }
  const body = { model: payload.model, messages: [{ role: 'user', content: prompt }] };
  if (anthropic) body.max_tokens = payload.max_tokens ?? 2048;
  else {
    body.stream = false;
    if (payload.disable_thinking) body.thinking = { type: 'disabled' };
    if (payload.max_tokens) body.max_tokens = payload.max_tokens;
    if (jsonMode) body.response_format = { type: 'json_object' };
  }
  const seconds = Number(payload.timeout ?? timeout);
  const deadline = AbortSignal.timeout(
    (Number.isFinite(seconds) && seconds > 0 ? seconds : timeout) * 1000,
  );
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  async function request(body) {
    try {
      return await post(url, body, headers, combined);
    } catch (error) {
      if (
        !body.thinking ||
        !/LLM request failed \((400|422)\)/.test(error.message) ||
        !/thinking/i.test(error.message)
      )
        throw error;
      delete body.thinking;
      return post(url, body, headers, combined);
    }
  }
  let data;
  try {
    data = await request(body);
  } catch (error) {
    if (
      !anthropic &&
      body.max_tokens &&
      /LLM request failed \(400\)/.test(error.message) &&
      /max_tokens/.test(error.message) &&
      /max_completion_tokens/.test(error.message)
    ) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
      data = await request(body);
    } else {
      const missing =
        /model.{0,80}?(?:not\s+(?:found|supported|exist)|does\s+not\s+exist|unsupported|unknown)|\bmodel_not_found\b|(?:unknown|no\s+such)\s+model\b|模型.{0,20}?(?:不存在|不支持)/i;
      if (
        anthropic ||
        body.model === body.model.toLowerCase() ||
        !/LLM request failed \((400|404)\)/.test(error.message) ||
        !missing.test(error.message)
      )
        throw error;
      try {
        data = await request({ ...body, model: body.model.toLowerCase() });
      } catch {
        throw error;
      }
    }
  }
  if (
    payload.require_complete &&
    (data.stop_reason === 'max_tokens' || data.choices?.[0]?.finish_reason === 'length')
  )
    throw new Error('Model response reached the output limit');
  const message = data.message?.content != null ? data.message : data.choices?.[0]?.message || {};
  const content = message.content ?? data.content;
  const calls = [...(message.tool_calls || [])];
  if (Array.isArray(content)) {
    const text = content
      .filter((item) => !item.type || item.type === 'text')
      .map((item) => item.text || '')
      .join('');
    if (text) return text;
    calls.push(...content.filter((item) => item.type === 'tool_use'));
  } else if (typeof content === 'string' && content.trim()) return content;
  if (data.output_text) return data.output_text;
  if (calls.length)
    throw new Error(
      'LLM returned a tool call instead of text: ' +
        calls.map((call) => call.name || call.function?.name || 'unknown').join(', '),
    );
  throw new Error('LLM response does not contain text');
}

module.exports = { complete };
