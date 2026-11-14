import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { VERSION } from '../version.js';
import { aborted, waitWithSignal, withDeadline } from './deadline.js';

export const JADX_ENGINE = { version: '0.7.1', sha256: '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75' };

export async function jadxEngine({ signal } = {}) {
  aborted(signal);
  const configured = process.env.REA_JADX_MCP_JAR;
  const file = configured || path.join(os.homedir(), '.local/share/android-reserve-mcp/engines', `jadx-headless-mcp-${JADX_ENGINE.version}-all.jar`);
  const absolute = path.isAbsolute(file);
  let exists = false, digest = null;
  if (absolute) {
    try {
      if (!(await fs.stat(file)).isFile()) throw new Error('不是 JAR 文件');
      // long: 引擎可能很大，按块校验，避免 doctor 为读取一个文件瞬间占满内存。
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
      digest = hash.digest('hex'); exists = true;
    } catch (error) { aborted(signal); }
  }
  return { ...JADX_ENGINE, path: file, source: configured ? 'environment' : 'managed-directory', exists, absolute, checksumMatches: digest === JADX_ENGINE.sha256 };
}

const ALLOWED = new Set(['search_android_classes', 'inspect_android_class', 'inspect_android_method', 'trace_android_references', 'inspect_android_jni_bindings', 'decode_android_resources', 'list_frida_devices', 'list_frida_processes', 'start_frida_session', 'load_frida_script', 'unload_frida_script', 'resume_frida_session', 'frida_session_status', 'close_frida_session', 'open_binary', 'binary_session', 'close_binary', 'list_procedures', 'analyze_function', 'procedure_references', 'procedure_callers', 'procedure_callees', 'inspect_go_binary', 'inspect_rust_binary']);

export class Backend {
  constructor({ disabled = false, packageName = 'rea-agents@6.9.0', nativeEngine = false, connectionTimeoutMs = 45000, requestTimeoutMs = 600000, closeTimeoutMs = 5000, clientFactory, transportFactory } = {}) {
    Object.assign(this, { disabled, packageName, nativeEngine, connectionTimeoutMs, requestTimeoutMs, closeTimeoutMs });
    this.clientFactory = clientFactory || (() => new Client({ name: 'android-reserve-adapter', version: VERSION }));
    this.transportFactory = transportFactory || (parameters => new StdioClientTransport(parameters));
    this.client = null; this.pending = null; this.connection = null; this.connections = new Set(); this.lifetime = new AbortController(); this.closing = null;
  }
  async disposeConnection(connection) {
    if (!connection || (connection.closing && !connection.cleanupError)) return connection?.closing;
    connection.cleanupError = null; connection.pid ??= connection.transport?.pid;
    connection.closing = withDeadline(async () => {
      const results = await Promise.allSettled([connection.client.close(), connection.transport?.close()]);
      const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    }, { timeoutMs: this.closeTimeoutMs, label: 'REA连接退出' }).then(result => {
      this.connections.delete(connection); return result;
    }, error => { connection.cleanupError = error.message; throw error; });
    return connection.closing;
  }
  async connect(signal) {
    const callerSignal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    aborted(callerSignal);
    if (this.disabled) throw new Error('REA 后端已禁用，此操作需要启用后端；本地 APK/解包/检索仍可使用');
    if (this.client) return this.client;
    const leftovers = [...this.connections].filter(connection => connection !== this.connection && (connection.cleanupError || connection.closing || connection.controller.signal.aborted));
    if (leftovers.length) {
      // long: 前次失败的sidecar尚未确认退出时先重试同一清理，不能靠新建连接累积无主进程。
      try { await waitWithSignal(Promise.all(leftovers.map(connection => this.disposeConnection(connection))), callerSignal); }
      catch (cause) {
        aborted(callerSignal);
        const error = new Error('REA旧连接清理未确认，未创建新连接：' + cause.message);
        error.code = 'cleanup_incomplete'; error.diagnostic = { connections: leftovers.map(connection => ({ pid: connection.pid, cleanupError: connection.cleanupError })) };
        throw error;
      }
      aborted(callerSignal);
    }
    if (!this.pending) {
      const attempt = { client: this.clientFactory(), controller: new AbortController(), waiters: 0, settled: false };
      // long: pending只表示握手等待；取消后仍可能清理失败，所有连接须独立登记，确认关闭才释放所有权。
      this.connections.add(attempt);
      this.pending = attempt;
      attempt.promise = withDeadline(async connectSignal => {
      // long: 深度 DEX/JNI/Frida 复用已验证后端，但不向前端转发它的完整工具清单。
      const client = attempt.client;
      const engine = await jadxEngine({ signal: connectSignal });
      // long: 不替换调用者显式指定的引擎；仅将校验通过的默认 JAR 交给后端，避免误用未核实下载。
      const env = { ...process.env };
      if (!env.REA_JADX_MCP_JAR && engine.checksumMatches) env.REA_JADX_MCP_JAR = engine.path;
      const managedGhidra = path.join(os.homedir(), '.local/share/android-reserve-mcp/engines/ghidra_12.2_PUBLIC');
      if (!env.GHIDRA_INSTALL_DIR && await fs.stat(path.join(managedGhidra, 'support/analyzeHeadless')).then(s => s.isFile()).catch(() => false)) env.GHIDRA_INSTALL_DIR = managedGhidra;
      if (this.nativeEngine) {
        const javaHome = env.ANDROID_RESERVE_GHIDRA_JAVA_HOME || path.join(os.homedir(), '.local/share/android-reserve-mcp/engines/jdk-25');
        // long: Ghidra12.2使用独立JDK25，不改变JADX和用户项目原来的Java环境。
        if (await fs.stat(path.join(javaHome, 'bin/java')).then(s => s.isFile()).catch(() => false)) env.JAVA_HOME = javaHome;
      }
      aborted(connectSignal);
      const transport = this.transportFactory({ command: 'npx', args: ['-y', this.packageName, 'mcp'], stderr: 'pipe', env });
      attempt.transport = transport;
      transport.stderr?.on('data', () => {});
      await client.connect(transport, { signal: connectSignal, timeout: this.connectionTimeoutMs, maxTotalTimeout: this.connectionTimeoutMs });
      // long: 超时或退出后晚到的握手不能重新登记为可用连接，也不能留下下次调用会误用的sidecar。
      aborted(connectSignal); aborted(this.lifetime.signal);
      this.connection = attempt; this.client = client;
      const previousClose = client.onclose;
      client.onclose = () => { if (this.connection === attempt) { this.client = null; this.connection = null; } previousClose?.call(client); };
      return client;
      }, { signal: attempt.controller.signal, timeoutMs: this.connectionTimeoutMs, label: 'REA启动与握手' })
        .catch(async error => { try { await this.disposeConnection(attempt); } catch (cleanup) { error.cleanupWarning = cleanup.message; } throw error; })
        .finally(() => { attempt.settled = true; if (this.pending === attempt) this.pending = null; });
      attempt.promise.catch(() => {});
    }
    const attempt = this.pending; attempt.waiters++;
    try { return await waitWithSignal(attempt.promise, callerSignal); }
    finally {
      // long: 单个排队调用取消不影响其他握手等待者；最后一个等待者取消时终止无主连接。
      if (--attempt.waiters === 0 && !attempt.settled) {
        attempt.controller.abort(new Error('REA连接等待已取消'));
        if (this.pending === attempt) this.pending = null;
      }
    }
  }
  async call(name, args, signal, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!ALLOWED.has(name)) throw new Error('非 Android 后端操作不开放');
    const callerSignal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    return withDeadline(async requestSignal => {
    const client = await this.connect(requestSignal);
    aborted(requestSignal);
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs, maxTotalTimeout: timeoutMs, signal: requestSignal });
    if (result.isError) {
      let payload = result.structuredContent;
      if (!payload) { try { payload = JSON.parse(result.content?.find(c => c.type === 'text')?.text || '{}'); } catch {} }
      const detail = payload?.error;
      const error = new Error(detail ? `[${detail.code || 'backend_error'}] ${detail.message}${detail.remediation?.action ? '\n处理方法：' + detail.remediation.action : ''}` : JSON.stringify(result.content).slice(0, 1800));
      error.diagnostic = result;
      throw error;
    }
    return result;
    }, { signal: callerSignal, timeoutMs, label: 'REA任务' });
  }
  close() {
    if (this.closing) return this.closing;
    this.lifetime.abort(new Error('REA服务正在退出'));
    const connections = [...this.connections]; connections.forEach(connection => connection.controller.abort(new Error('REA服务正在退出')));
    this.closing = withDeadline(async () => {
      await Promise.allSettled(connections.map(connection => this.disposeConnection(connection)));
      this.client = null; this.connection = null;
      const unconfirmed = [...this.connections];
      if (unconfirmed.length) throw new Error('REA连接清理未确认：' + unconfirmed.map(connection => connection.cleanupError || '清理仍在执行').join('; '));
    }, { timeoutMs: this.closeTimeoutMs + 1000, label: 'REA整体退出' }).catch(error => { this.closing = null; throw error; });
    return this.closing;
  }
}
