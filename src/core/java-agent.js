import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, checked } from './process.js';
import { assertJavaCompatibility } from '../../helpers/java-compatibility.js';
import { javaBridgeIdentity } from './java-profile.js';

export async function compileJavaAgent(args, dir, signal, options = {}) {
  assertJavaCompatibility(args, args._compatibilityProfile);
  const bridge = await javaBridgeIdentity(options.bridgeRoot);
  if (args._compatibilityProfile && bridge.sha256 !== args._compatibilityProfile.bridgeSha256) throw new Error('编译bridge身份与兼容凭证不符');
  const jni = args.action === 'trace-jni';
  const grouped = args.action === 'trace-java-group';
  const observer = fileURLToPath(new URL(jni ? '../../helpers/jni-observer.js' : grouped ? '../../helpers/java-group-observer.js' : '../../helpers/java-observer.js', import.meta.url));
  const startObserver = jni ? 'startJniObserver' : grouped ? 'startJavaGroupObserver' : 'startJavaObserver';
  const compiler = fileURLToPath(import.meta.resolve('frida-compile/dist/cli.js'));
  const entry = path.join(dir, 'java-entry.js'), output = path.join(dir, 'java-observer.bundle.js');
  const config = { action: args.action, traceId: path.basename(dir), className: args.className, methodName: args.methodName, loaderSelector: args.loaderSelector, argumentTypes: args.argumentTypes, returnType: args.returnType, nativeHooks: args.nativeHooks || [], maxEvents: args.maxEvents || 50, maxMethods: args.maxMethods || 64, captureStack: !!args.captureStack };
  if (grouped) Object.assign(config, { javaHooks: args.javaHooks, maxTrackedObjects: args.maxTrackedObjects || 128, objectTtlMs: args.objectTtlMs || 30000 });
  // long: import依赖来自受信任项目，目标方法选择只作为JSON配置；不编译或执行APK提供的任意脚本内容。
  const inspection = jni ? '' : `import { getArtMethodSpec, makeMethodMangler } from ${JSON.stringify(path.join(bridge.root, 'lib/android.js'))};\nconst inspectMethod=method=>{const offsets=getArtMethodSpec(Java.vm).offset,address=makeMethodMangler(method.handle).methodId;const read=()=>({accessFlags:address.add(offsets.accessFlags).readU32(),jniCode:address.add(offsets.jniCode).readPointer().toString(),quickCode:address.add(offsets.quickCode).readPointer().toString()});return {identity:{address:address.toString(),offsets,baseline:read()},read};};\n`;
  await fs.writeFile(entry, `import Java from ${JSON.stringify(bridge.entry)};\nimport { ${startObserver} } from ${JSON.stringify(observer)};\n${inspection}${startObserver}(Java, ${JSON.stringify(config)}, globalThis, ${JSON.stringify(args._compatibilityProfile || null)}${jni ? '' : ', inspectMethod'});\n`);
  // long: 任务工作区可以在项目外；compiler的projectRoot必须覆盖入口，不能把合法workspace误判为越界。
  const result = await run(process.execPath, ['--max-old-space-size=512', compiler, entry, '-o', output, '-B', 'iife', '-F', 'unescaped', '-T', 'none', '-S'], { signal, cwd: dir, timeoutMs: 90000, maxBytes: 256000 });
  await fs.writeFile(path.join(dir, 'compile.log'), result.stdout + '\n' + result.stderr);
  checked(result, 'Java bridge脚本编译');
  if ((await javaBridgeIdentity(options.bridgeRoot)).sha256 !== bridge.sha256) throw new Error('Java bridge源码在编译过程中改变');
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
    const signature = JSON.stringify([hook.className,hook.methodName,hook.argumentTypes,hook.returnType || null]);
    if (signatures.has(signature)) throw new Error('javaHooks不能重复选择同一方法');
    signatures.add(signature);
    if (hook.correlation) {
      const c = hook.correlation;
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(c.group || '') || !['request', 'reply'].includes(c.role)) throw new Error('correlation需group与request/reply角色');
      if (c.argumentIndex !== undefined && (!Number.isInteger(c.argumentIndex) || c.argumentIndex < 0 || c.argumentIndex >= hook.argumentTypes.length)) throw new Error('correlation.argumentIndex越界');
      if (c.receiver !== undefined && typeof c.receiver !== 'boolean') throw new Error('correlation.receiver必须是布尔值');
      if (c.multiReply !== undefined && typeof c.multiReply !== 'boolean') throw new Error('correlation.multiReply必须是布尔值');
      if (c.receiver && c.argumentIndex !== undefined) throw new Error('correlation不能同时选择receiver与argumentIndex');
      if (c.role === 'request' && c.argumentIndex === undefined && !c.receiver) throw new Error('request必须显式指定回复对象argumentIndex或receiver');
    }
    if (hook.captureReceiver !== undefined && typeof hook.captureReceiver !== 'boolean') throw new Error('captureReceiver必须是布尔值');
    if (hook.valueCaptures !== undefined) {
      if (!Array.isArray(hook.valueCaptures) || hook.valueCaptures.length > 4) throw new Error('valueCaptures最多4项');
      for (const capture of hook.valueCaptures) {
        const expected = capture.className || 'io.flutter.plugin.common.MethodCall';
        if (capture.kind !== 'flutter-method-call' || !Number.isInteger(capture.argumentIndex) || typeof expected !== 'string' || expected.length > 512 || hook.argumentTypes[capture.argumentIndex] !== expected) throw new Error('Flutter值采集必须明确MethodCall参数索引和可选mapping类名');
      }
    }
  }
  for (const [field, fallback, min, max] of [['maxTrackedObjects', 128, 1, 256], ['objectTtlMs', 30000, 1000, 120000], ['maxEvents', 50, 1, 500]]) {
    const value = args[field] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(field + '超出预算');
  }
}
