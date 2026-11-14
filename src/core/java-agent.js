import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, checked } from './process.js';

export async function compileJavaAgent(args, dir, signal) {
  const jni = args.action === 'trace-jni';
  const grouped = args.action === 'trace-java-group';
  const observer = fileURLToPath(new URL(jni ? '../../helpers/jni-observer.js' : grouped ? '../../helpers/java-group-observer.js' : '../../helpers/java-observer.js', import.meta.url));
  const startObserver = jni ? 'startJniObserver' : grouped ? 'startJavaGroupObserver' : 'startJavaObserver';
  const compiler = fileURLToPath(import.meta.resolve('frida-compile/dist/cli.js'));
  const entry = path.join(dir, 'java-entry.js'), output = path.join(dir, 'java-observer.bundle.js');
  const config = { action: args.action, traceId: path.basename(dir), className: args.className, methodName: args.methodName, loaderSelector: args.loaderSelector, argumentTypes: args.argumentTypes, returnType: args.returnType, nativeHooks: args.nativeHooks || [], maxEvents: args.maxEvents || 50, maxMethods: args.maxMethods || 64, captureStack: !!args.captureStack };
  if (grouped) Object.assign(config, { javaHooks: args.javaHooks, maxTrackedObjects: args.maxTrackedObjects || 128, objectTtlMs: args.objectTtlMs || 30000 });
  // long: import依赖来自受信任项目，目标方法选择只作为JSON配置；不编译或执行APK提供的任意脚本内容。
  await fs.writeFile(entry, `import Java from ${JSON.stringify(fileURLToPath(import.meta.resolve('frida-java-bridge')))};\nimport { ${startObserver} } from ${JSON.stringify(observer)};\n${startObserver}(Java, ${JSON.stringify(config)});\n`);
  // long: 任务工作区可以在项目外；compiler的projectRoot必须覆盖入口，不能把合法workspace误判为越界。
  const result = await run(process.execPath, ['--max-old-space-size=512', compiler, entry, '-o', output, '-B', 'iife', '-F', 'unescaped', '-T', 'none', '-S'], { signal, cwd: dir, timeoutMs: 90000, maxBytes: 256000 });
  await fs.writeFile(path.join(dir, 'compile.log'), result.stdout + '\n' + result.stderr);
  checked(result, 'Java bridge脚本编译');
  const size = (await fs.stat(output)).size;
  if (!size || size > 4 * 1024 * 1024) throw new Error('Java bridge bundle为空或超过4MiB预算');
  return output;
}

export function validateJavaGroup(args) {
  if (!Array.isArray(args.javaHooks) || !args.javaHooks.length || args.javaHooks.length > 8) throw new Error('javaHooks需1–8个精确方法');
  const ids = new Set(), signatures = new Set();
  for (const hook of args.javaHooks) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(hook.id || '') || ids.has(hook.id)) throw new Error('javaHooks.id必须有效且唯一');
    ids.add(hook.id);
    const validText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value);
    if (!validText(hook.className,512) || !validText(hook.methodName,200) || !Array.isArray(hook.argumentTypes) || hook.argumentTypes.length > 16 || hook.argumentTypes.some(t => !validText(t,200)) || (hook.returnType !== undefined && !validText(hook.returnType,200))) throw new Error('javaHooks必须明确有界类/方法/argumentTypes');
    const signature = JSON.stringify([hook.className,hook.methodName,hook.argumentTypes]);
    if (signatures.has(signature)) throw new Error('javaHooks不能重复选择同一方法');
    signatures.add(signature);
    if (hook.correlation) {
      const c = hook.correlation;
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(c.group || '') || !['request', 'reply'].includes(c.role)) throw new Error('correlation需group与request/reply角色');
      if (c.argumentIndex !== undefined && (!Number.isInteger(c.argumentIndex) || c.argumentIndex < 0 || c.argumentIndex >= hook.argumentTypes.length)) throw new Error('correlation.argumentIndex越界');
      if (c.role === 'request' && c.argumentIndex === undefined) throw new Error('request必须显式指定回复对象argumentIndex');
    }
  }
  for (const [field, fallback, min, max] of [['maxTrackedObjects', 128, 1, 256], ['objectTtlMs', 30000, 1000, 120000], ['maxEvents', 50, 1, 500]]) {
    const value = args[field] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(field + '超出预算');
  }
}
