import { randomUUID } from 'node:crypto';
import { Backend } from './backend.js';

export function unpack(result) {
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content || []) if (item.type === 'text') { try { return JSON.parse(item.text); } catch {} }
  throw new Error('后端未返回结构化结果');
}

export class NativeTargets {
  constructor(factory = () => new Backend({ nativeEngine: true })) { this.factory = factory; this.targets = new Map(); }
  async providers(signal) {
    const backend = this.factory();
    try { return await backend.call('binary_session', { detail: 'complete', refresh_candidates: true }, signal); }
    finally { await backend.close(); }
  }
  async open(file, provider, signal) {
    if (this.targets.size >= 2) throw new Error('最多同时打开2个Native目标，请先close已有targetId');
    const id = randomUUID(), backend = this.factory();
    const entry = { id, backend, path: file, tail: Promise.resolve(), state: 'opening' };
    this.targets.set(id, entry);
    try {
      const output = await backend.call('open_binary', { path: file, ...(provider ? { provider_id: provider } : {}) }, signal);
      if (signal?.aborted) throw new Error('任务已取消');
      entry.state = 'open'; entry.identity = unpack(output).result;
      return { targetId: id, target: entry.identity, backend: output };
    } catch (error) { await backend.close().catch(() => {}); this.targets.delete(id); throw error; }
  }
  async use(id, operation) {
    const entry = this.targets.get(id);
    if (!entry || entry.state !== 'open') throw new Error('targetId不属于本服务或目标未就绪；请先native.open');
    // long: REA每个连接只有一个活动target；每个句柄独占连接且串行操作，避免并发查询串到另一个SO。
    const task = entry.tail.then(() => {
      if (entry.state !== 'open') throw new Error('Native目标已关闭');
      return operation(entry);
    });
    entry.tail = task.catch(() => {});
    return task;
  }
  async closeTarget(id) {
    return this.use(id, async entry => {
      const result = await entry.backend.call('close_binary', {});
      entry.state = 'closed'; await entry.backend.close(); this.targets.delete(id);
      return result;
    });
  }
  async close() {
    await Promise.allSettled([...this.targets.values()].map(async entry => {
      await entry.tail;
      try { await entry.backend.call('close_binary', {}); } finally { await entry.backend.close(); }
    }));
    this.targets.clear();
  }
}
