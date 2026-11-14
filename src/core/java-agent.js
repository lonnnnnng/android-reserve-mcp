import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, checked } from './process.js';

export async function compileJavaAgent(args, dir, signal) {
  const jni = args.action === 'trace-jni';
  const observer = fileURLToPath(new URL(jni ? '../../helpers/jni-observer.js' : '../../helpers/java-observer.js', import.meta.url));
  const startObserver = jni ? 'startJniObserver' : 'startJavaObserver';
  const compiler = fileURLToPath(import.meta.resolve('frida-compile/dist/cli.js'));
  const entry = path.join(dir, 'java-entry.js'), output = path.join(dir, 'java-observer.bundle.js');
  const config = { action: args.action, traceId: path.basename(dir), className: args.className, methodName: args.methodName, loaderSelector: args.loaderSelector, argumentTypes: args.argumentTypes, returnType: args.returnType, nativeHooks: args.nativeHooks || [], maxEvents: args.maxEvents || 50, maxMethods: args.maxMethods || 64, captureStack: !!args.captureStack };
  // long: import依赖来自受信任项目，目标方法选择只作为JSON配置；不编译或执行APK提供的任意脚本内容。
  await fs.writeFile(entry, `import Java from ${JSON.stringify(fileURLToPath(import.meta.resolve('frida-java-bridge')))};\nimport { ${startObserver} } from ${JSON.stringify(observer)};\n${startObserver}(Java, ${JSON.stringify(config)});\n`);
  const result = await run(process.execPath, ['--max-old-space-size=512', compiler, entry, '-o', output, '-B', 'iife', '-F', 'unescaped', '-T', 'none', '-S'], { signal, cwd: fileURLToPath(new URL('../..', import.meta.url)), timeoutMs: 90000, maxBytes: 256000 });
  await fs.writeFile(path.join(dir, 'compile.log'), result.stdout + '\n' + result.stderr);
  checked(result, 'Java bridge脚本编译');
  const size = (await fs.stat(output)).size;
  if (!size || size > 4 * 1024 * 1024) throw new Error('Java bridge bundle为空或超过4MiB预算');
  return output;
}
