import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { evidenceForJob } from './evidence.js';
import { run } from './process.js';
import { withDeadline } from './deadline.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let currentEpoch;
async function processEpoch(pid) {
  const result = await run('ps', ['-p', String(pid), '-o', 'lstart='], { timeoutMs: 2000, maxBytes: 1024, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
  return result.code === 0 && !result.truncated && !result.timedOut ? result.stdout.trim() || null : null;
}

export class Jobs {
  constructor(workspace, { closeTimeoutMs = 10000 } = {}) {
    this.root = path.join(workspace, 'jobs'); this.ownerRoot = path.join(workspace, '.instances');
    this.instanceId = randomUUID(); this.running = new Map(); this.queue = []; this.records = new Map(); this.registrations = new Map();
    this.closeTimeoutMs = closeTimeoutMs; this.closing = null;
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.ownerRoot, { recursive: true, mode: 0o700 });
    currentEpoch ||= processEpoch(process.pid).catch(() => null);
    this.owner = { instanceId: this.instanceId, pid: process.pid, processEpoch: await currentEpoch, state: 'active', createdAt: new Date().toISOString() };
    this.ownerFile = path.join(this.ownerRoot, this.instanceId + '.json');
    await fs.writeFile(this.ownerFile, JSON.stringify(this.owner), { flag: 'wx', mode: 0o600 });
  }
  async save(job) {
    if (job.owner?.instanceId !== this.instanceId) throw new Error('不能改写其他实例拥有的任务');
    const file = path.join(job.dir, 'job.json'); await fs.writeFile(file + '.tmp', JSON.stringify(job, null, 2)); await fs.rename(file + '.tmp', file);
  }
  async start(label, operation, { onQueuedCancel } = {}) {
    if (this.stopping) throw new Error('服务正在退出，不再接受新任务');
    if (this.queue.length + this.registrations.size > 30) throw new Error('等待任务过多，请等待现有任务完成');
    const id = randomUUID(), ticket = { id }; this.registrations.set(id, ticket);
    ticket.promise = (async () => {
      const dir = path.join(this.root, id); await fs.mkdir(dir, { mode: 0o700 });
      const job = { id, dir, label, state: 'queued', owner: this.owner, createdAt: new Date().toISOString() };
      this.records.set(id, job); await this.save(job);
      // long: 目录登记让出事件循环时可能已经开始退出；取消这份登记并释放预留，不能留下不会再执行的queued任务。
      if (this.stopping) { job.state = 'canceled'; onQueuedCancel?.(); await this.save(job); }
      else { this.queue.push({ job, operation, onQueuedCancel }); this.pump(); }
      return this.summary(job);
    })();
    try { return await ticket.promise; } finally { this.registrations.delete(id); }
  }
  pump() {
    if (this.stopping) return;
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
  summary(job) { return { id: job.id, label: job.label, state: job.state, createdAt: job.createdAt, finishedAt: job.finishedAt, result: job.result, error: job.error, errorArtifact: job.errorArtifact, evidence: job.evidence, evidenceWarning: job.evidenceWarning, ownership: job.ownership, recordedState: job.recordedState, recovery: job.recovery, cleanupUnconfirmed: job.cleanupUnconfirmed }; }
  async get(id) {
    if (!uuid.test(id || '')) throw new Error('无效任务 ID');
    if (this.records.has(id)) return this.records.get(id);
    const job = JSON.parse(await fs.readFile(path.join(this.root, id, 'job.json'), 'utf8'));
    job.dir = path.join(this.root, id);
    if (['queued', 'running'].includes(job.state)) {
      // long: 内存中没有任务可能只是另一个客户端实例；读取者不能改写原任务，且PID复用不能冒充原拥有者。
      let owner = null;
      if (uuid.test(job.owner?.instanceId || '')) owner = await fs.readFile(path.join(this.ownerRoot, job.owner.instanceId + '.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.pid !== job.owner?.pid || !owner.processEpoch || owner.processEpoch !== job.owner?.processEpoch) {
        job.ownership = 'unconfirmed'; job.recovery = 'owner-identity-unavailable'; job.cleanupUnconfirmed = true;
      } else {
        const epoch = await processEpoch(owner.pid).catch(() => null);
        let exited = false;
        try { process.kill(owner.pid, 0); } catch (error) { exited = error.code === 'ESRCH'; }
        if (owner.state !== 'active' || exited || (epoch && epoch !== owner.processEpoch)) {
          job.recordedState = job.state; job.state = 'interrupted'; job.ownership = 'owner-inactive';
          job.recovery = 'owner-ended-device-cleanup-unconfirmed'; job.cleanupUnconfirmed = true;
        } else job.ownership = epoch ? 'external-active' : 'unconfirmed';
      }
    }
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
    if (!this.records.has(id)) {
      if (['queued', 'running'].includes(job.state)) throw new Error('任务由其他服务实例创建，只能由原实例取消');
      return this.summary(job);
    }
    this.running.get(id)?.abort();
    if (job.state === 'queued') {
      job.state = 'canceled';
      // long: 尚未开始的设备任务不会进入operation的finally，必须在这里释放它预留的观测所有权。
      this.queue.find(entry => entry.job.id === id)?.onQueuedCancel?.();
      await this.save(job);
    }
    return this.summary(job);
  }
  close() {
    if (this.closing) return this.closing;
    this.stopping = true;
    this.closing = (async () => {
      const queued = this.queue;
      this.queue = [];
      const active = [...this.running.values()]; active.forEach(c => c.abort());
      let warning;
      try { await withDeadline(async () => {
        const canceled = await Promise.allSettled(queued.map(async ({ job, onQueuedCancel }) => { job.state = 'canceled'; onQueuedCancel?.(); await this.save(job); }));
        const failure = canceled.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
        await Promise.allSettled([...active.map(c => c.completion), ...[...this.registrations.values()].map(ticket => ticket.promise)]);
      }, { timeoutMs: this.closeTimeoutMs, label: '任务退出清理' }); }
      catch (error) { warning = error.message; }
      const unfinished = [...this.running.keys()], registering = [...this.registrations.keys()], closed = !warning && !unfinished.length && !registering.length;
      this.owner = { ...this.owner, state: closed ? 'closed' : 'cleanup-unconfirmed', closedAt: new Date().toISOString() };
      if (this.ownerFile) await fs.writeFile(this.ownerFile, JSON.stringify(this.owner), { mode: 0o600 });
      return { closed, unfinished, registering, ...(warning ? { warning } : {}) };
    })();
    return this.closing;
  }
}
