import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { run, checked } from './process.js';
import { withDeadline } from './deadline.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
async function identity(specifier) {
  const entry = fileURLToPath(import.meta.resolve(specifier === 'frida-compile' ? 'frida-compile/dist/cli.js' : specifier));
  let directory = path.dirname(entry);
  for (let depth = 0; depth < 5; depth++, directory = path.dirname(directory)) {
    const metadata = await fs.readFile(path.join(directory, 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (metadata?.name === specifier) {
      const target = specifier === 'frida-java-bridge' ? path.join(directory, 'lib/android.js') : entry;
      return { package: specifier, version: metadata.version, implementationSha256: createHash('sha256').update(await fs.readFile(target)).digest('hex') };
    }
  }
  throw new Error('无法核实依赖包身份：' + specifier);
}

export async function deepDiagnostics(context, dir, signal, timeoutMs) {
  const checks = {};
  const check = async (name, operation) => {
    try { checks[name] = { status: 'verified', ...(await withDeadline(operation, { signal, timeoutMs, label: name + '深度检查' })) }; }
    catch (error) { checks[name] = { status: 'failed', code: error.code || 'probe_failed', error: String(error.message).slice(0, 1200) }; }
  };
  const compilerDir = path.join(dir, 'java-compiler'); await fs.mkdir(compilerDir);
  await Promise.all([
    check('fridaBinding', async probeSignal => {
      const entry = import.meta.resolve('frida');
      // long: 原生binding在受限子进程中加载，导入失败或卡住不会破坏MCP服务；检查不枚举或附加设备。
      const result = await run(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', `const binding=await import(${JSON.stringify(entry)});if(typeof binding.getDeviceManager!=='function')throw new Error('Frida API不完整');process.stdout.write('binding-import-ok');`], { cwd: packageRoot, signal: probeSignal, timeoutMs, maxBytes: 32000 });
      await fs.writeFile(path.join(dir, 'binding.log'), result.stdout + '\n' + result.stderr);
      checked(result, 'Frida binding导入');
      if (result.stdout !== 'binding-import-ok') throw new Error('binding探测未返回确认标记');
      return { ...(await identity('frida')), deviceConnected: false };
    }),
    check('javaCompiler', async probeSignal => {
      const bundle = await context.compileJava({ action: 'trace-java', className: 'java.lang.Math', methodName: 'abs', argumentTypes: ['int'], maxEvents: 1 }, compilerDir, probeSignal);
      const bytes = await fs.readFile(bundle);
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('编译结果为空或超过预算');
      return { bridge: await identity('frida-java-bridge'), compiler: await identity('frida-compile'), bundle: 'java-compiler/' + path.basename(bundle), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), injected: false };
    }),
    context.backend.disabled ? Promise.resolve(checks.rea = { status: 'skipped', reason: 'REA后端显式禁用' }) : check('rea', async probeSignal => {
      const client = await context.backend.connect(probeSignal);
      const available = await client.listTools({}, { signal: probeSignal, timeout: timeoutMs, maxTotalTimeout: timeoutMs });
      const names = new Set(available.tools.map(tool => tool.name));
      const required = ['search_android_classes', 'inspect_android_class', 'inspect_android_method', 'trace_android_references', 'start_frida_session', 'load_frida_script', 'close_frida_session'];
      const missing = required.filter(name => !names.has(name));
      if (missing.length) throw new Error('REA缺少必须的工具：' + missing.join(', '));
      return { server: client.getServerVersion(), tools: names.size, requiredTools: required, targetOpened: false, deviceConnected: false };
    }),
  ]);
  return { checks, partial: Object.values(checks).some(check => check.status !== 'verified'),
    scope: '宿主binding导入、固定Java模板实际编译、REA协议握手；不打开APK、不连接设备，不证明Android运行兼容性' };
}
