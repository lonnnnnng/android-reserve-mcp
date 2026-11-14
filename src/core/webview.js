import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { run, tool, checked } from './process.js';

const validSerial = value => { if (!/^[A-Za-z0-9._:-]+$/.test(value || '') || value.startsWith('-')) throw new Error('必须提供有效serial'); };
const validPackage = value => { if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value || '')) throw new Error('必须提供精确Android包名'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identityError = message => Object.assign(new Error(message), { identityMismatch: true });

export function pageSocket(target, port) {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(target.id || '')) throw new Error('页面targetId无效');
  const url = new URL(target.webSocketDebuggerUrl);
  // long: 页面内容可控制URL字段；只允许本地CDP路径，绝不把响应中的外部主机当成新连接目标。
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/devtools/page/' + target.id) throw new Error('拒绝非本地或不匹配的CDP WebSocket地址');
  return `ws://127.0.0.1:${port}${url.pathname}`;
}

function headers(values = {}) {
  return Object.fromEntries(Object.entries(values).slice(0, 100).map(([key, value]) => [key.slice(0, 200), /authorization|cookie|api[-_]?key|token|secret/i.test(key) ? '<redacted>' : String(value).slice(0, 2048)]));
}

export class Cdp {
  constructor(url) {
    this.pending = new Map(); this.next = 0; this.scripts = new Map(); this.requests = new Map(); this.partial = false; this.bytes = 0; this.closed = false;
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('CDP连接超时')); this.close(); }, 7000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP连接失败')); this.close(); }, { once: true });
      this.socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('CDP连接关闭')); this.close(); });
    });
    this.socket.addEventListener('message', event => {
      try {
        if (typeof event.data !== 'string') throw new Error('CDP仅接受JSON文本');
        const size = Buffer.byteLength(event.data); this.bytes += size;
        if (size > 4 * 1024 * 1024 || this.bytes > 20 * 1024 * 1024) throw new Error('CDP消息超过单项4MiB/累计20MiB预算');
        const data = JSON.parse(event.data);
        if (data.id !== undefined) {
          const pending = this.pending.get(data.id); if (!pending) return;
          this.pending.delete(data.id); pending.finish(data.error ? new Error(String(data.error.message || 'CDP失败')) : null, data.result);
        } else this.observe(data.method, data.params || {});
      } catch (error) { this.close(error); }
    });
  }
  observe(method, p) {
    if (method === 'Debugger.scriptParsed') {
      if (this.scripts.size >= 200 && !this.scripts.has(p.scriptId)) { this.partial = true; return; }
      this.scripts.set(p.scriptId, { scriptId: p.scriptId, url: String(p.url || '').slice(0, 8192), hash: p.hash, executionContextId: p.executionContextId, scriptLanguage: p.scriptLanguage });
    }
    if (method === 'Network.requestWillBeSent') {
      if (this.requests.size >= 200 && !this.requests.has(p.requestId)) { this.partial = true; return; }
      const old = this.requests.get(p.requestId), request = p.request || {};
      this.requests.set(p.requestId, { requestId: p.requestId, url: String(request.url || '').slice(0, 8192), method: request.method, headers: headers(request.headers), timestamp: p.timestamp, redirects: [...(old?.redirects || []), ...(p.redirectResponse ? [{ url: p.redirectResponse.url, status: p.redirectResponse.status }] : [])].slice(-20) });
    }
    const record = this.requests.get(p.requestId);
    if (!record) return;
    if (method === 'Network.responseReceived') record.response = { status: p.response?.status, mimeType: p.response?.mimeType, headers: headers(p.response?.headers), fromDiskCache: p.response?.fromDiskCache, protocol: p.response?.protocol };
    if (method === 'Network.loadingFinished') { record.finished = true; record.encodedDataLength = p.encodedDataLength; }
    if (method === 'Network.loadingFailed') record.failure = { errorText: p.errorText, canceled: p.canceled };
  }
  async call(method, params = {}, signal) {
    await this.ready; if (signal?.aborted) throw new Error('CDP任务已取消');
    if (this.closed) throw new Error('CDP会话已关闭');
    if (this.pending.size >= 8) throw new Error('CDP并发请求超过8项');
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const abort = () => { this.pending.delete(id); finish(new Error('CDP任务已取消')); };
      const timer = setTimeout(() => { this.pending.delete(id); finish(new Error('CDP请求超时')); }, 7000);
      const finish = (error, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
      this.pending.set(id, { finish }); signal?.addEventListener('abort', abort, { once: true });
      try { this.socket.send(JSON.stringify({ id, method, params })); } catch (error) { this.pending.delete(id); finish(error); }
    });
  }
  close(error = new Error('CDP会话已关闭')) {
    if (this.closed) return; this.closed = true;
    this.partial = true; this.closeReason = error.message;
    for (const pending of this.pending.values()) pending.finish(error);
    this.pending.clear(); try { this.socket.close(); } catch {}
  }
}

export class WebViews {
  constructor(adb, workspace) { this.entries = new Map(); this.opening = 0; this.workspace = workspace; this.adb = adb || (async (serial, args, signal) => { const result = checked(await run(await tool('adb'), ['-s', serial, ...args], { signal, timeoutMs: 15000, maxBytes: 1024 * 1024 }), 'WebView ADB'); if (result.truncated) throw new Error('WebView ADB输出超预算'); return result; }); }
  async ledger(event, entry, detail) { if (this.workspace) await fs.appendFile(path.join(this.workspace,'webview-forwards.jsonl'), JSON.stringify({ event, id: entry.id, serial: entry.args.serial, port: entry.port, remote: entry.remote, time: new Date().toISOString(), detail })+'\n', { mode: 0o600 }); }
  async read(serial, file, root, signal) { return (await this.adb(serial, root ? ['shell', `su -c 'cat ${file}'`] : ['shell', 'cat', file], signal)).stdout; }
  async owner(args, signal) {
    validSerial(args.serial); validPackage(args.packageName);
    if (!Number.isSafeInteger(args.pid) || args.pid < 1) throw new Error('必须明确pid');
    const generation = async () => { const stat = await this.read(args.serial, `/proc/${args.pid}/stat`, args.rootRead, signal); const start = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19]; if (!/^\d+$/.test(start || '')) throw new Error('无法验证进程启动代次'); return start; };
    // long: 包名读取前后都核对启动代次，防止把退出前的包名与PID复用后的启动时间拼成同一身份。
    const epoch = await generation();
    const cmdline = (await this.read(args.serial, `/proc/${args.pid}/cmdline`, args.rootRead, signal)).split('\0')[0].trim();
    if (cmdline !== args.packageName && !cmdline.startsWith(args.packageName + ':')) throw identityError('PID不属于所选包');
    if (await generation() !== epoch) throw identityError('身份检查期间进程已重启');
    const boot = (await this.read(args.serial, '/proc/sys/kernel/random/boot_id', args.rootRead, signal)).trim();
    if (!/^[a-fA-F0-9-]{36}$/.test(boot)) throw new Error('无法验证设备启动代次');
    return { cmdline, epoch: boot + ':' + epoch };
  }
  async discover(args, signal) {
    validSerial(args.serial); validPackage(args.packageName);
    const pids = (await this.adb(args.serial, ['shell', 'pidof', args.packageName], signal)).stdout.trim().split(/\s+/).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
    const unix = await this.read(args.serial, '/proc/net/unix', args.rootRead, signal), targets = [];
    for (const pid of pids) if (unix.split('\n').some(line => line.trim().endsWith('@webview_devtools_remote_' + pid))) targets.push({ pid, socket: 'webview_devtools_remote_' + pid, ...await this.owner({ ...args, pid }, signal) });
    return { serial: args.serial, packageName: args.packageName, targets, limitation: '只列当前主包PID的已开放调试socket；不会强制开启WebView调试' };
  }
  async json(port, endpoint, signal) {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(7000), ...(signal ? [signal] : [])]) });
    if (!response.ok) throw new Error('CDP发现HTTP状态' + response.status);
    let bytes = 0; const chunks = [];
    for await (const part of response.body) { bytes += part.length; if (bytes > 256000) throw new Error('CDP发现响应超预算'); chunks.push(Buffer.from(part)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async open(args, signal) {
    if (this.entries.size + this.opening >= 2) throw new Error('最多两个WebView会话');
    this.opening++;
    const entry = { id: randomUUID(), args: { ...args } }; let committed = false;
    try {
      entry.owner = await this.owner(args, signal);
      const unix = await this.read(args.serial, '/proc/net/unix', args.rootRead, signal);
      entry.remote = 'localabstract:webview_devtools_remote_' + args.pid;
      if (!unix.split('\n').some(line => line.trim().endsWith('@webview_devtools_remote_' + args.pid))) throw new Error('所选PID未开放WebView调试socket');
      const forward = await this.adb(args.serial, ['forward', '--no-rebind', 'tcp:0', entry.remote], signal);
      entry.port = Number(forward.stdout.trim()); if (!Number.isSafeInteger(entry.port) || entry.port < 1 || entry.port > 65535) throw new Error('ADB未返回有效转发端口');
      await this.ledger('created',entry);
      const version = await this.json(entry.port, '/json/version', signal);
      if (version['Android-Package'] && version['Android-Package'] !== args.packageName) throw new Error('CDP报告的Android包名不匹配');
      const targets = await this.json(entry.port, '/json/list', signal);
      if (!Array.isArray(targets)) throw new Error('CDP页面列表无效');
      const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
      const selected = args.targetId ? pages.filter(t => t.id === args.targetId) : pages;
      if (selected.length !== 1) { const error = new Error('必须唯一选择targetId'); error.diagnostic = { targets: pages.map(t => ({ id: t.id, title: t.title, url: t.url })) }; throw error; }
      entry.cdp = new Cdp(pageSocket(selected[0], entry.port)); await entry.cdp.ready;
      const current = await this.owner(args, signal); if (current.epoch !== entry.owner.epoch) throw new Error('进程已重启，拒绝复用PID');
      await entry.cdp.call('Debugger.enable', {}, signal);
      await entry.cdp.call('Network.enable', { maxTotalBufferSize: 4 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024 }, signal);
      if (signal?.aborted) throw new Error('WebView打开已取消');
      this.entries.set(entry.id, entry); committed = true;
      return { sessionId: entry.id, pid: args.pid, processEpoch: entry.owner.epoch, target: { id: selected[0].id, title: selected[0].title, url: selected[0].url }, browser: version.Browser, networkCoverage: 'events-after-network-enable' };
    } finally { this.opening--; if (!committed) { try { await this.dispose(entry); } catch(error) { this.entries.set(entry.id,entry); const failed=new Error('WebView打开失败且转发清理未确认，请close会话 '+entry.id+': '+error.message);failed.diagnostic={sessionId:entry.id,cleanupRequired:true};throw failed; } } }
  }
  async dispose(entry) {
    entry.cdp?.close();
    if (entry.port) {
      const list = (await this.adb(entry.args.serial, ['forward', '--list'])).stdout;
      if (list.split('\n').some(line => { const [serial, local, remote] = line.trim().split(/\s+/); return serial === entry.args.serial && local === 'tcp:' + entry.port && remote === entry.remote; })) await this.adb(entry.args.serial, ['forward', '--remove', 'tcp:' + entry.port]);
      await this.ledger('released-or-no-longer-owned',entry);
    }
  }
  async use(id, signal) {
    const entry = this.entries.get(id); if (!entry) throw new Error('WebView sessionId不属于本服务');
    try { if ((await this.owner(entry.args, signal)).epoch !== entry.owner.epoch) throw identityError('WebView进程已重启'); }
    // long: 取消单个读取或暂时ADB故障不等于目标身份改变，不能因此销毁其他任务正在使用的会话。
    catch (error) { if (error.identityMismatch) await this.close(id); throw error; }
    return entry;
  }
  async close(id) { if (!id) { const results = await Promise.allSettled([...this.entries.keys()].map(key => this.close(key))); const error = results.find(r => r.status === 'rejected'); if (error) throw error.reason; return; } const entry = this.entries.get(id); if (!entry) throw new Error('WebView sessionId不属于本服务'); await this.dispose(entry); this.entries.delete(id); }
}

export async function webview(context, args) {
  return context.jobs.start(`WebView ${args.action}`, async (signal, dir) => {
    if (args.action === 'discover') return context.webviews.discover(args, signal);
    if (args.action === 'open') return context.webviews.open(args, signal);
    if (args.action === 'close') { if (!args.sessionId) throw new Error('close必须明确sessionId'); await context.webviews.close(args.sessionId); return { closed: true }; }
    const entry = await context.webviews.use(args.sessionId, signal), cdp = entry.cdp;
    if (args.action === 'scripts') return { scripts: [...cdp.scripts.values()], partial: cdp.partial };
    if (args.action === 'network') return { requests: [...cdp.requests.values()], partial: cdp.partial, captureClosed: cdp.closed, closeReason: cdp.closeReason, coverage: 'events-after-network-enable', sensitiveHeaders: 'redacted' };
    let bytes, kind, metadata;
    if (args.action === 'dom') {
      const { root } = await cdp.call('DOM.getDocument', { depth: 0, pierce: false }, signal);
      const result = await cdp.call('DOM.getOuterHTML', { nodeId: root.nodeId }, signal); bytes = Buffer.from(result.outerHTML, 'utf8'); kind = 'html';
    } else if (args.action === 'source') {
      metadata = cdp.scripts.get(args.scriptId); if (!metadata) throw new Error('scriptId不属于当前WebView已观察脚本');
      const result = await cdp.call('Debugger.getScriptSource', { scriptId: args.scriptId }, signal);
      if (result.bytecode && !result.scriptSource) { bytes = Buffer.from(result.bytecode, 'base64'); kind = 'wasm'; }
      else { bytes = Buffer.from(result.scriptSource || '', 'utf8'); kind = 'js'; }
    } else if (args.action === 'body') {
      metadata = cdp.requests.get(args.requestId); if (!metadata?.finished) throw new Error('requestId未在当前会话完成或不属于当前会话');
      const result = await cdp.call('Network.getResponseBody', { requestId: args.requestId }, signal); bytes = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8'); kind = 'body';
    } else throw new Error('未知WebView操作');
    if (bytes.length > 2 * 1024 * 1024) throw new Error('WebView产物超过2MiB');
    const artifact = 'captured.' + kind; await fs.writeFile(path.join(dir, artifact), bytes);
    return { artifact, bytes: bytes.length, sha256: digest(bytes), kind, metadata, serial:entry.args.serial,pid:entry.args.pid,sessionId: args.sessionId, processEpoch: entry.owner.epoch, partial: cdp.partial };
  });
}
