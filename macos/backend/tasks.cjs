const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

class TaskCancelled extends Error {
  constructor() {
    super('Task cancelled');
    this.name = 'TaskCancelled';
  }
}
class TaskControl {
  constructor() {
    this.paused = false;
    this.controller = new AbortController();
  }
  get signal() {
    return this.controller.signal;
  }
  get cancelled() {
    return this.signal.aborted;
  }
  cancel() {
    this.paused = false;
    this.controller.abort(new TaskCancelled());
  }
  async wait() {
    while (this.paused && !this.cancelled) await delay(50);
    if (this.cancelled) throw new TaskCancelled();
  }
}
class TaskRegistry {
  constructor() {
    this.controls = new Map();
  }
  key(task, meetingId) {
    return JSON.stringify([task, meetingId ?? null]);
  }
  begin(task, meetingId) {
    const key = this.key(task, meetingId);
    if (
      this.controls.has(key) ||
      (task === 'summary.generate' &&
        [...this.controls.values()].some((value) => value.task === task))
    )
      throw Object.assign(new Error('Task is already running'), { code: 'error.tasks.running' });
    const control = new TaskControl();
    this.controls.set(key, { task, meetingId, control });
    return control;
  }
  finish(task, meetingId, control) {
    const key = this.key(task, meetingId);
    if (!control || this.controls.get(key)?.control === control) this.controls.delete(key);
  }
  async running(task, meetingId, fn, { concurrent = false } = {}) {
    const key = concurrent ? task + ':' + randomUUID() : task;
    const control = this.begin(key, meetingId);
    try {
      return await fn(control);
    } finally {
      this.finish(key, meetingId, control);
    }
  }
  get(task, meetingId) {
    const control = this.controls.get(this.key(task, meetingId))?.control;
    if (!control) throw new Error('Task is not running');
    return control;
  }
  setPaused(task, meetingId, paused) {
    this.get(task, meetingId).paused = paused;
  }
  cancel(task, meetingId) {
    this.get(task, meetingId).cancel();
  }
  cancelForMeeting(meetingId) {
    for (const entry of this.controls.values())
      if (entry.meetingId === meetingId) entry.control.cancel();
  }
  hasForMeeting(meetingId) {
    return [...this.controls.values()].some((entry) => entry.meetingId === meetingId);
  }
  hasAny() {
    return this.controls.size > 0;
  }
}
module.exports = { TaskRegistry, TaskControl, TaskCancelled };
