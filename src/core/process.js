import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function locate(name) {
  const home = os.homedir();
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.platform === 'darwin' ? path.join(home, 'Library/Android/sdk') : path.join(home, 'Android/Sdk'));
  const extras = {
    adb: [path.join(sdk, 'platform-tools/adb')],
    apkanalyzer: [path.join(sdk, 'cmdline-tools/latest/bin/apkanalyzer')],
    frida: [path.join(home, '.local/bin/frida')],
    readelf: ['/opt/homebrew/opt/llvm/bin/llvm-readelf', '/usr/bin/readelf'],
  };
  const candidates = (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, name));
  if (name === 'readelf') candidates.push(...(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'llvm-readelf')));
  candidates.push(...(extras[name] || []));
  if (['apksigner', 'zipalign', 'aapt2', 'd8'].includes(name)) {
    const base = path.join(sdk, 'build-tools');
    const versions = await fs.readdir(base).catch(() => []);
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) candidates.push(path.join(base, version, name));
  }
  for (const candidate of candidates) {
    try { await fs.access(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  return null;
}

export function run(command, args, { cwd, signal, timeoutMs = 60000, maxBytes = 2 * 1024 * 1024, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('任务已取消'));
    // long: 参数数组直接传给进程，不经 shell，APK 路径中的空格和元字符不能变成命令。
    const child = spawn(command, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, truncated = false, timedOut = false;
    let force;
    const terminate = () => {
      if (!child.pid || child.exitCode !== null) return;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
      force = setTimeout(() => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {} }, 1500);
      force.unref();
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    const collect = key => data => {
      const remaining = Math.max(0, maxBytes - bytes);
      const part = data.subarray(0, remaining).toString('utf8');
      bytes += Math.min(data.length, remaining);
      if (data.length > remaining) truncated = true;
      if (key === 'stdout') stdout += part; else stderr += part;
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    signal?.addEventListener('abort', terminate, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(force); signal?.removeEventListener('abort', terminate); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', (code, exitSignal) => { cleanup(); resolve({ code, exitSignal, stdout, stderr, truncated, timedOut, canceled: !!signal?.aborted }); });
  });
}

export async function tool(name) {
  const command = await locate(name);
  if (!command) throw new Error(`缺少 ${name}，请先运行 doctor 检查依赖`);
  return command;
}

export function checked(result, label) {
  if (result.canceled) throw new Error('任务已取消');
  if (result.timedOut) throw new Error(`${label} 超时`);
  if (result.code !== 0) throw new Error(`${label} 失败 (${result.code}): ${result.stderr.slice(-1200)}`);
  return result;
}
