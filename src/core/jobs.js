import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { evidenceForJob } from './evidence.js';

export class Jobs {
  constructor(workspace) { this.root = path.join(workspace, 'jobs'); this.running = new Map(); this.queue = []; this.records = new Map(); }
  async init() { await fs.mkdir(this.root, { recursive: true, mode: 0o700 }); }
  async save(job) { const file = path.join(job.dir, 'job.json'); await fs.writeFile(file + '.tmp', JSON.stringify(job, null, 2)); await fs.rename(file + '.tmp', file); }
  async start(label, operation, { onQueuedCancel } = {}) {
    if (this.queue.length > 30) throw new Error('等待任务过多，请等待现有任务完成');
    const id = randomUUID(), dir = path.join(this.root, id);
    await fs.mkdir(dir, { mode: 0o700 });
    const job = { id, dir, label, state: 'queued', createdAt: new Date().toISOString() };
    this.records.set(id, job); await this.save(job);
    this.queue.push({ job, operation, onQueuedCancel }); this.pump();
    return this.summary(job);
  }
  pump() {
    // long: JADX 和 apktool 都可能占用大量内存，默认最多并行两个任务，避免拖垮正在使用的开发环境。
    while (this.running.size < 2 && this.queue.length) {
      const next = this.queue.shift();
      if (next.job.state === 'canceled') continue;
      const controller = new AbortController(); this.running.set(next.job.id, controller);
      const task = this.execute(next, controller);
      controller.completion = task;
    }
  }
  async execute({ job, operation }, controller) {
    try {
      job.state = 'running'; await this.save(job);
      const result = await operation(controller.signal, job.dir);
      await fs.writeFile(path.join(job.dir, 'result.json'), JSON.stringify(result, null, 2));
      try { job.evidence=await evidenceForJob(job,result); } catch(error) { job.evidenceWarning=String(error.message).slice(0,300); }
      job.state = controller.signal.aborted ? 'canceled' : result?.partial ? 'partial' : 'succeeded';
      job.result = 'result.json';
    } catch (error) {
      job.state = controller.signal.aborted ? 'canceled' : 'failed'; job.error = String(error.message || error).slice(0, 1600);
      // long: 对外保留可读修复提示，完整后端诊断留在任务内，避免双重JSON转义挤掉关键原因。
      if (error.diagnostic) { await fs.writeFile(path.join(job.dir, 'error.json'), JSON.stringify(error.diagnostic, null, 2)); job.errorArtifact = 'error.json'; }
    }
    finally { job.finishedAt = new Date().toISOString(); await this.save(job); this.running.delete(job.id); this.pump(); }
  }
  summary(job) { return { id: job.id, label: job.label, state: job.state, createdAt: job.createdAt, finishedAt: job.finishedAt, result: job.result, error: job.error, errorArtifact: job.errorArtifact, evidence: job.evidence, evidenceWarning: job.evidenceWarning }; }
  async get(id) {
    if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('无效任务 ID');
    if (this.records.has(id)) return this.records.get(id);
    const job = JSON.parse(await fs.readFile(path.join(this.root, id, 'job.json'), 'utf8'));
    job.dir = path.join(this.root, id);
    // long: 重启后旧进程已不存在，不能把遗留 running 状态继续当作正在执行。
    if (['queued', 'running'].includes(job.state)) { job.state = 'interrupted'; await this.save(job); }
    return job;
  }
  async list() {
    const ids = (await fs.readdir(this.root)).filter(id => /^[0-9a-f-]{36}$/.test(id));
    const jobs = [];
    for (const id of ids) { try { jobs.push(this.summary(await this.get(id))); } catch {} }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  }
  async cancel(id) {
    const job = await this.get(id);
    this.running.get(id)?.abort();
    if (job.state === 'queued') {
      job.state = 'canceled';
      // long: 尚未开始的设备任务不会进入operation的finally，必须在这里释放它预留的观测所有权。
      this.queue.find(entry => entry.job.id === id)?.onQueuedCancel?.();
      await this.save(job);
    }
    return this.summary(job);
  }
  async close() {
    for (const { job, onQueuedCancel } of this.queue) { job.state = 'canceled'; onQueuedCancel?.(); await this.save(job); }
    this.queue = [];
    const active = [...this.running.values()]; active.forEach(c => c.abort());
    await Promise.allSettled(active.map(c => c.completion));
  }
}
