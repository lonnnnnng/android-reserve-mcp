import { randomUUID } from 'node:crypto';
import { Backend } from './backend.js';
import { withDeadline } from './deadline.js';

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
    } catch (error) {
      try { await backend.close(); this.targets.delete(id); }
      catch (cleanup) {
        entry.state = 'cleanup-unconfirmed';
        error.message += '\nNative打开失败后的清理未确认，请close targetId=' + id;
        error.diagnostic = { targetId: id, state: entry.state, error: error.message, cleanupError: cleanup.message };
      }
      throw error;
    }
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
    const pending = this.targets.get(id);
    if (pending?.state === 'cleanup-unconfirmed') {
      await pending.backend.close(); this.targets.delete(id);
      return { targetId: id, closed: true, cleanupOnly: true };
    }
    return this.use(id, async entry => {
      const result = await entry.backend.call('close_binary', {});
      entry.state = 'cleanup-unconfirmed'; await entry.backend.close(); this.targets.delete(id);
      return result;
    });
  }
  async close({ timeoutMs = 5000 } = {}) {
    const targets = [...this.targets.values()];
    const results = await Promise.allSettled(targets.map(entry => withDeadline(async signal => {
      try { await entry.tail; await entry.backend.call('close_binary', {}, signal, { timeoutMs }); }
      finally { await entry.backend.close(); }
      this.targets.delete(entry.id);
    }, { timeoutMs, label: 'Native目标退出' })));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
      // long: 串行队列不响应取消时仍关闭登记后端；不能把超时后未确认的target直接从所有权表抹掉。
      await Promise.allSettled(targets.map(entry => withDeadline(() => entry.backend.close(), { timeoutMs, label: 'Native后端退出' })));
      throw failed.reason;
    }
  }
}
