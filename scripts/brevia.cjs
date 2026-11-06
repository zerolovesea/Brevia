#!/usr/bin/env node
const { z } = require('zod');
const { call, credentials } = require('../electron/agent-client.cjs');
const { schemas, scopeFor } = require('../electron/agent-contract.cjs');
const { errorResult } = require('../electron/agent-service.cjs');
const path = require('node:path');
const os = require('node:os');

async function mcp(request = call, input = process.stdin, output = process.stdout) {
  const send = (value) => output.write(JSON.stringify(value) + '\n');
  let initialized = false;
  const tools = Object.entries(schemas).map(([name, schema]) => ({
    name: name.replaceAll('.', '_'),
    description: `Brevia ${name} (${scopeFor(name)} permission). Long inference returns task_id; poll task_get. Recording requires explicit user intent and a stable request_id.`,
    inputSchema: z.toJSONSchema(schema, { unrepresentable: 'any' }),
    annotations: {
      readOnlyHint: scopeFor(name) === 'read',
      destructiveHint: false,
      openWorldHint: false,
    },
  }));
  async function handle(message) {
    const { id, method, params = {} } = message || {};
    if (id === undefined) return;
    if (message.jsonrpc !== '2.0' || typeof method !== 'string')
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32600, message: 'Invalid request' },
      };
    let result;
    try {
      if (method === 'initialize') {
        initialized = true;
        result = {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'brevia', version: '1.0.0' },
        };
      } else if (method === 'ping') result = {};
      else if (!initialized) throw new Error('Initialize the MCP connection first');
      else if (method === 'tools/list') result = { tools };
      else if (method === 'tools/call') {
        const tool = tools.find((t) => t.name === params.name);
        if (!tool) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
        const name = Object.keys(schemas).find((name) => name.replaceAll('.', '_') === tool.name);
        try {
          const value = await request(name, schemas[name].parse(params.arguments || {}));
          result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false };
        } catch (error) {
          result = {
            content: [{ type: 'text', text: JSON.stringify({ error: errorResult(error) }) }],
            isError: true,
          };
        }
      } else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: error.message } };
    }
  }
  // 有界行缓冲，避免对端无限发送不换行的输入占满内存。
  let buffer = '';
  input.setEncoding('utf8');
  for await (const chunk of input) {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
      return;
    }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (Array.isArray(message)) {
          const results = (await Promise.all(message.map(handle))).filter(Boolean);
          if (results.length) send(results);
        } else {
          const result = await handle(message);
          if (result) send(result);
        }
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
    }
  }
}
async function main(args = process.argv.slice(2)) {
  if (args[0] === 'mcp')
    return mcp((method, params) => call(method, params, { noStart: args.includes('--no-start') }));
  if (args[0] === 'help' || !args.length) {
    console.log(
      JSON.stringify({
        usage: 'brevia METHOD [JSON] [--no-start] | brevia mcp | brevia token read|infer|record',
        methods: Object.keys(schemas),
      }),
    );
    return;
  }
  if (args[0] === 'token') {
    if (!['read', 'infer', 'record'].includes(args[1]))
      throw new Error('Choose read, infer or record');
    console.log(
      JSON.stringify(
        credentials(process.env.BREVIA_DATA_DIR || path.join(os.homedir(), 'brevia'), args[1]),
      ),
    );
    return;
  }
  const method = args[0] === 'status' ? 'app.status' : args[0];
  if (!schemas[method]) throw new Error('Unknown method: ' + method);
  const payload = args.slice(1).find((arg) => arg !== '--no-start');
  const result = await call(method, schemas[method].parse(payload ? JSON.parse(payload) : {}), {
    noStart: args.includes('--no-start'),
  });
  console.log(JSON.stringify({ ok: true, result }));
}
if (require.main === module)
  main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: errorResult(error) }));
    process.exitCode = 1;
  });
module.exports = { main, mcp };
