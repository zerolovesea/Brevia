const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

class EngineClient {
  constructor(binary) {
    this.binary = binary;
    this.sequence = 0;
    this.pending = new Map();
  }
  start() {
    if (this.child) return;
    const child = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child = child;
    const fail = (error) => {
      if (this.child !== child) return;
      this.child = null;
      for (const entry of this.pending.values()) {
        entry.cleanup();
        entry.reject(error);
      }
      this.pending.clear();
      child.kill();
    };
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('exit', (code) => fail(new Error('Inference engine exited (' + code + ')')));
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        fail(new Error('Invalid inference response'));
        return;
      }
      const entry = this.pending.get(value.id ?? value.payload?.id);
      if (!entry) return;
      if (value.type) {
        entry.onEvent?.(value);
        return;
      }
      this.pending.delete(value.id);
      entry.cleanup();
      if (value.ok) entry.resolve(value.result);
      else entry.reject(new Error(value.error || 'Inference failed'));
    });
  }
  request(type, payload, { signal, onEvent, timeout = 300000 } = {}) {
    signal?.throwIfAborted();
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const cancel = () => this.close(signal?.reason || new Error('Inference cancelled'));
      const timer = setTimeout(() => this.close(new Error('Inference timed out')), timeout);
      signal?.addEventListener('abort', cancel, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      };
      this.pending.set(id, { resolve, reject, cleanup, onEvent });
      this.child.stdin.write(JSON.stringify({ id, type, payload }) + '\n');
    });
  }
  close(error = new Error('Inference engine closed')) {
    for (const entry of this.pending.values()) {
      entry.cleanup();
      entry.reject(error);
    }
    this.pending.clear();
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }
}
module.exports = { EngineClient };
