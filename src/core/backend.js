import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { VERSION } from '../version.js';

export const JADX_ENGINE = { version: '0.7.1', sha256: '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75' };

export async function jadxEngine() {
  const configured = process.env.REA_JADX_MCP_JAR;
  const file = configured || path.join(os.homedir(), '.local/share/android-reserve-mcp/engines', `jadx-headless-mcp-${JADX_ENGINE.version}-all.jar`);
  const absolute = path.isAbsolute(file);
  let exists = false, digest = null;
  if (absolute) {
    try {
      if (!(await fs.stat(file)).isFile()) throw new Error('不是 JAR 文件');
      // long: 引擎可能很大，按块校验，避免 doctor 为读取一个文件瞬间占满内存。
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      digest = hash.digest('hex'); exists = true;
    } catch {}
  }
  return { ...JADX_ENGINE, path: file, source: configured ? 'environment' : 'managed-directory', exists, absolute, checksumMatches: digest === JADX_ENGINE.sha256 };
}

const ALLOWED = new Set(['search_android_classes', 'inspect_android_class', 'inspect_android_method', 'trace_android_references', 'inspect_android_jni_bindings', 'decode_android_resources', 'list_frida_devices', 'list_frida_processes', 'start_frida_session', 'load_frida_script', 'unload_frida_script', 'resume_frida_session', 'frida_session_status', 'close_frida_session', 'open_binary', 'binary_session', 'close_binary', 'list_procedures', 'analyze_function', 'procedure_references', 'procedure_callers', 'procedure_callees', 'inspect_go_binary', 'inspect_rust_binary']);

export class Backend {
  constructor({ disabled = false, packageName = 'rea-agents@6.9.0', nativeEngine = false } = {}) { this.disabled = disabled; this.packageName = packageName; this.nativeEngine = nativeEngine; this.client = null; this.pending = null; }
  async connect() {
    if (this.disabled) throw new Error('REA 后端已禁用，此操作需要启用后端；本地 APK/解包/检索仍可使用');
    if (this.client) return this.client;
    if (!this.pending) this.pending = (async () => {
      // long: 深度 DEX/JNI/Frida 复用已验证后端，但不向前端转发它的完整工具清单。
      const client = new Client({ name: 'android-reserve-adapter', version: VERSION });
      const engine = await jadxEngine();
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
      const transport = new StdioClientTransport({ command: 'npx', args: ['-y', this.packageName, 'mcp'], stderr: 'pipe', env });
      transport.stderr?.on('data', () => {});
      try { await client.connect(transport); this.client = client; return client; }
      catch (error) { await transport.close().catch(() => {}); throw error; }
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  async call(name, args, signal) {
    if (!ALLOWED.has(name)) throw new Error('非 Android 后端操作不开放');
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 600000, signal });
    if (result.isError) {
      let payload = result.structuredContent;
      if (!payload) { try { payload = JSON.parse(result.content?.find(c => c.type === 'text')?.text || '{}'); } catch {} }
      const detail = payload?.error;
      const error = new Error(detail ? `[${detail.code || 'backend_error'}] ${detail.message}${detail.remediation?.action ? '\n处理方法：' + detail.remediation.action : ''}` : JSON.stringify(result.content).slice(0, 1800));
      error.diagnostic = result;
      throw error;
    }
    return result;
  }
  async close() { await this.client?.close(); this.client = null; }
}
