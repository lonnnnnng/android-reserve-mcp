import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { run, tool, checked } from './process.js';
import { JAVA_RUNTIME_PROFILE, javaCompatibility, assertJavaCompatibility } from '../../helpers/java-compatibility.js';

export async function javaBridgeIdentity(selectedRoot) {
  const entry = selectedRoot ? path.join(selectedRoot, 'index.js') : fileURLToPath(import.meta.resolve('frida-java-bridge'));
  if ((await fs.lstat(entry)).isSymbolicLink()) throw new Error('Java bridge入口不能依赖链接');
  const root = await fs.realpath(path.dirname(entry)), metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (metadata.name !== 'frida-java-bridge' || path.basename(entry) !== 'index.js') throw new Error('Java bridge入口身份不符');
  const names = ['index.js'];
  async function list(directory) {
    for (const item of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = directory + '/' + item.name;
      if (item.isSymbolicLink()) throw new Error('Java bridge源码不能依赖链接');
      if (item.isDirectory()) await list(relative); else if (item.isFile() && relative.endsWith('.js')) names.push(relative);
      if (names.length > 128) throw new Error('Java bridge文件预算耗尽');
    }
  }
  await list('lib'); names.sort(); let total = 0;
  const files = [];
  for (const file of names) {
    const bytes = await fs.readFile(path.join(root, file)); total += bytes.length;
    if (bytes.length > 2 * 1024 * 1024 || total > 4 * 1024 * 1024) throw new Error('Java bridge源码字节预算耗尽');
    files.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { root, entry: path.join(root, 'index.js'), version: metadata.version, files: files.length, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}

export async function prepareJavaCompatibility(context, args) {
  if (javaCompatibility(args).supported) return undefined;
  let diagnostic;
  try {
    const bridge = await javaBridgeIdentity(context.javaBridgeRoot);
    if (bridge.sha256 !== JAVA_RUNTIME_PROFILE.bridgeSha256 || (JAVA_RUNTIME_PROFILE.status !== 'verified' && !context.javaBridgeRoot)) throw new Error('bridge组合尚未完成公开回归');
    if (context.backend.packageName !== 'rea-agents@6.9.0') throw new Error('REA binding组合未验证');
    const target = context.sessionTargets.get(args.sessionId); if (!target) throw new Error('缺少会话设备与PID身份');
    const [serial, pid] = JSON.parse(target), adb = await tool('adb');
    const invoke = parameters => run(adb, ['-s', serial, 'shell', ...parameters], { timeoutMs: 5000, maxBytes: 16000 }).then(result => checked(result, 'Java兼容环境检查').stdout.trim());
    const [api, abi, sha, bytes] = await Promise.all([
      invoke(['getprop', 'ro.build.version.sdk']), invoke(['getprop', 'ro.product.cpu.abi']),
      invoke(['sha256sum', JAVA_RUNTIME_PROFILE.artPath]), invoke(['stat', '-c', '%s', JAVA_RUNTIME_PROFILE.artPath]),
    ]);
    if (Number(api) !== JAVA_RUNTIME_PROFILE.apiLevel || abi !== 'arm64-v8a' || sha.split(/\s/)[0] !== JAVA_RUNTIME_PROFILE.artSha256 || Number(bytes) !== JAVA_RUNTIME_PROFILE.artBytes) throw new Error('ART二进制、SDK或ABI与已验证组合不符');
    // long: 内部测试可指定固定候选源码；CLI未开放绕过参数，公开入口仍等待完整动态回归完成后才启用。
    return { ...JAVA_RUNTIME_PROFILE, expectedPid: pid, experimental: JAVA_RUNTIME_PROFILE.status !== 'verified' };
  } catch (error) { diagnostic = String(error.message).slice(0, 500); }
  try { assertJavaCompatibility(args); } catch (error) { error.diagnostic.profileFailure = diagnostic; throw error; }
}
