import schema from './schema.cjs';
const { uploadSchema, MAX_BYTES } = schema;
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const json = (value, status = 200) => Response.json(value, { status, headers });
async function readBody(request, limit) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw Object.assign(new Error(), { status: 415 });
  if (Number(request.headers.get('content-length')) > limit)
    throw Object.assign(new Error(), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error(), { status: 400 });
  let size = 0,
    body = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Object.assign(new Error(), { status: 413 });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return body;
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
      key,
      256,
    ),
  );
}
async function upload(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (
    !(await env.UPLOAD_LIMIT.limit({ key: ip })).success ||
    !(await env.TOTAL_LIMIT.limit({ key: 'uploads' })).success
  )
    return json({ error: 'Too many uploads. Try again later.' }, 429);
  const body = await readBody(request, MAX_BYTES);
  let payload;
  try {
    payload = uploadSchema.parse(JSON.parse(body));
  } catch {
    return json({ error: 'Invalid document or expiry' }, 400);
  }
  const id = crypto.randomUUID().replaceAll('-', '');
  const expiresAt = Math.floor(Date.now() / 1000) + payload.days * 86400;
  const salt = payload.password ? crypto.randomUUID() : undefined;
  const password = salt
    ? { salt, hash: [...(await passwordHash(payload.password, salt))] }
    : undefined;
  await env.SHARES.put(id, JSON.stringify({ ...payload.snapshot, expiresAt, password }), {
    expiration: expiresAt,
  });
  return json({ url: `${new URL(request.url).origin}/s/${id}`, expiresAt }, 201);
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/shares' && request.method === 'POST')
        return await upload(request, env);
      const match = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32})$/);
      if (match && ['GET', 'POST'].includes(request.method)) {
        const document = await env.SHARES.get(match[1], 'json');
        if (!document || document.expiresAt <= Math.floor(Date.now() / 1000))
          return json({ error: 'Share unavailable or expired' }, 404);
        if (document.password) {
          if (request.method !== 'POST') return json({ passwordRequired: true }, 401);
          if (
            !(
              await env.PASSWORD_LIMIT.limit({
                key: request.headers.get('CF-Connecting-IP') || 'local',
              })
            ).success
          )
            return json({ error: 'Too many attempts' }, 429);
          let password;
          try {
            password = JSON.parse(await readBody(request, 2048)).password;
          } catch {
            return json({ error: 'Invalid password' }, 400);
          }
          if (typeof password !== 'string' || !password.length || password.length > 128)
            return json({ error: 'Invalid password' }, 400);
          const hash = await passwordHash(password, document.password.salt);
          let difference = 0;
          for (let index = 0; index < hash.length; index++)
            difference |= hash[index] ^ document.password.hash[index];
          if (difference) return json({ passwordRequired: true }, 401);
        }
        const { password, ...snapshot } = document;
        const views = await env.VIEWS.getByName(match[1]).increment(document.expiresAt);
        return json({ ...snapshot, views });
      }
      if (!['GET', 'HEAD'].includes(request.method))
        return json({ error: 'Method not allowed' }, 405);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      if (/^\/s\/[a-f0-9]{32}$/.test(url.pathname)) url.pathname = '/';
      const asset = await env.ASSETS.fetch(new Request(url, request));
      const response = new Response(asset.body, asset);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    } catch (error) {
      if ([400, 413, 415].includes(error.status))
        return json({ error: 'Invalid request or body too large' }, error.status);
      return json({ error: 'Share service unavailable. Try again later.' }, 503);
    }
  },
};
