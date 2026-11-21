import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { ApiError } from './types.js';
type Task = { id: number; mode: string; payload: unknown; resolve: (v: any) => void; reject: (e: Error) => void };
type Slot = { worker: Worker; task?: Task; timer?: NodeJS.Timeout };
export class VerificationPool {
  private slots: Slot[] = [];
  private queue: Task[] = [];
  private counter = 0;
  private closed = false;
  constructor(private size = Math.max(1, Math.min(4, availableParallelism() - 1)), private timeout = 30000) {
    if (!Number.isInteger(size) || size < 1 || size > 16) throw new Error('VERIFICATION_WORKERS 需要是 1–16 的整数');
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }
  private spawn(): Slot {
    const slot: Slot = { worker: new Worker(new URL('./verify-worker.mjs', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 128 } }) };
    slot.worker.on('message', message => {
      const task = slot.task;
      if (!task || task.id !== message.id) return;
      clearTimeout(slot.timer); slot.task = undefined;
      if (message.error) task.reject(new ApiError(400, message.error)); else task.resolve(message.result);
      this.dispatch();
    });
    const replace = (error: Error) => {
      if (!this.slots.includes(slot)) return;
      clearTimeout(slot.timer); slot.task?.reject(error);
      const index = this.slots.indexOf(slot); this.slots.splice(index, 1);
      void slot.worker.terminate();
      if (!this.closed) { this.slots.splice(index, 0, this.spawn()); this.dispatch(); }
    };
    slot.worker.on('error', () => replace(new ApiError(503, '解法校验暂时不可用，请稍后重试')));
    slot.worker.on('exit', code => { if (code && !this.closed) replace(new ApiError(503, '解法校验中断，请稍后重试')); });
    (slot as Slot & { fail: (e: Error) => void }).fail = replace;
    return slot;
  }
  run<T = any>(mode: string, payload: unknown): Promise<T> {
    if (this.closed || this.queue.length >= 128) return Promise.reject(new ApiError(503, '校验繁忙，请稍后重试'));
    return new Promise((resolve, reject) => { this.queue.push({ id: ++this.counter, mode, payload, resolve, reject }); this.dispatch(); });
  }
  private dispatch() {
    for (const slot of this.slots) {
      if (slot.task || !this.queue.length) continue;
      slot.task = this.queue.shift()!;
      slot.timer = setTimeout(() => (slot as Slot & { fail: (e: Error) => void }).fail(new ApiError(503, '这份解法校验耗时较长，请稍后重试')), this.timeout);
      slot.worker.postMessage({ id: slot.task.id, mode: slot.task.mode, payload: slot.task.payload });
    }
  }
  async close() {
    this.closed = true;
    for (const task of this.queue.splice(0)) task.reject(new ApiError(503, '服务正在关闭'));
    await Promise.all(this.slots.map(slot => { clearTimeout(slot.timer); slot.task?.reject(new ApiError(503, '服务正在关闭')); return slot.worker.terminate(); }));
    this.slots = [];
  }
}
