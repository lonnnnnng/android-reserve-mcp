// long: 兼容实验只观察自有Compose入口；补丁、设备和原方法恢复都留证据，实验不会放宽公共MCP的崩溃入口保护。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createContext, frida } from '../src/actions.js';
import { run, checked, tool } from '../src/core/process.js';

const [serial, bridgeRoot, mode, tapX, tapY] = process.argv.slice(2);
if (!serial || !path.isAbsolute(bridgeRoot || '') || !['primitive', 'retain-receiver'].includes(mode) || ![tapX, tapY].every(value => /^\d{1,4}$/.test(value || ''))) throw new Error('用法：SERIAL ABSOLUTE_BRIDGE_ROOT primitive|retain-receiver TAP_X TAP_Y');
const packageName = 'dev.androidreserve.compose';
const root = await fs.mkdtemp(path.resolve('output/bridge-compat-' + mode + '-'));
const bridge = path.join(bridgeRoot, 'index.js'), android = path.join(bridgeRoot, 'lib/android.js');
const hash = file => fs.readFile(file).then(bytes => createHash('sha256').update(bytes).digest('hex'));
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 30000 }), '兼容实验ADB');
const identity = { serial, packageName, mode, bridgeVersion: JSON.parse(await fs.readFile(path.join(bridgeRoot, 'package.json'), 'utf8')).version,
  bridgeIndexSha256: await hash(bridge), bridgeAndroidSha256: await hash(android) };
const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work') });
const results = [], events = new Map(); let sessionId, scriptId, original, failure, passed = false, closed;
const normal = value => { const unpacked = value.structuredContent || value; return unpacked.normalized_result || unpacked; };
async function complete(args) {
  const started = await frida(context, args), deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const job = await context.jobs.get(started.id);
    if (!['queued', 'running'].includes(job.state)) {
      results.push(context.jobs.summary(job)); assert.equal(job.state, 'succeeded', job.error);
      return normal(JSON.parse(await fs.readFile(path.join(job.dir, 'result.json'), 'utf8')));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await context.jobs.cancel(started.id); throw new Error('兼容实验操作超过60秒，已请求取消');
}
async function status() {
  const value = await complete({ action: 'status', sessionId });
  for (const message of value.messages || []) if (message.payload?.event?.startsWith('bridge-')) events.set(message.script_id + ':' + message.payload.sequence, message.payload);
  if (value.state === 'detached') throw new Error('兼容实验目标已经分离');
  return value;
}
try {
  identity.pid = Number((await adb(['shell', 'pidof', packageName])).stdout.trim()); assert.ok(identity.pid > 0);
  const source = path.join(root, 'entry.js'), bundle = path.join(root, 'probe.bundle.js');
  const config = { mode, className: 'androidx.compose.runtime.SnapshotMutableIntStateImpl', methodName: 'setIntValue' };
  await fs.writeFile(source, `import Java from ${JSON.stringify(bridge)};\nimport { getArtMethodSpec, makeMethodMangler, getAndroidApiLevel } from ${JSON.stringify(android)};\nconst config=${JSON.stringify(config)};\nlet sequence=0;const emit=row=>send({sequence:++sequence,...row});\nJava.perform(()=>{\n try{\n  const type=Java.use(config.className),method=type[config.methodName].overload('int');\n  if(method.returnType.className!=='void')throw new Error('实际返回类型不符');\n  globalThis.__ownedClassHandle=type.class;\n  const spec=getArtMethodSpec(Java.vm),address=makeMethodMangler(method.handle).methodId;\n  const offsets=spec.offset;\n  const snapshot=()=>({accessFlags:address.add(offsets.accessFlags).readU32(),jniCode:address.add(offsets.jniCode).readPointer().toString(),quickCode:address.add(offsets.quickCode).readPointer().toString()});\n  const baseline=snapshot();\n  // long: 首轮只隔离原调用，第二轮才触发对象global ref和IsSameObject，失败位置不能混成同一个兼容结论。\n  method.implementation=function(value){\n   emit({event:'bridge-enter',value,threadId:Process.getCurrentThreadId()});\n   let retained;\n   try{\n    if(config.mode==='retain-receiver'){emit({event:'bridge-retain-start'});retained=Java.retain(this);emit({event:'bridge-retained',sameObject:!!Java.vm.getEnv().isSameObject(retained.$h,this.$h)});}\n    emit({event:'bridge-original-start'});const result=method.call(this,value);emit({event:'bridge-original-returned',value});return result;\n   }finally{if(retained){retained.$dispose();emit({event:'bridge-reference-disposed'});}}\n  };\n  emit({event:'bridge-ready',pid:Process.id,fridaVersion:Frida.version,arch:Process.arch,apiLevel:getAndroidApiLevel(),methodId:'Landroidx/compose/runtime/SnapshotMutableIntStateImpl;->setIntValue(I)V',address:address.toString(),offsets,baseline});\n }catch(error){emit({event:'bridge-setup-error',description:String(error)});}\n});\n`);
  const compiler = fileURLToPath(import.meta.resolve('frida-compile/dist/cli.js'));
  const compiled = await run(process.execPath, ['--max-old-space-size=512', compiler, source, '-o', bundle, '-B', 'iife', '-F', 'unescaped', '-T', 'none', '-S'], { cwd: root, timeoutMs: 90000, maxBytes: 256000 });
  await fs.writeFile(path.join(root, 'compile.log'), compiled.stdout + compiled.stderr); checked(compiled, '兼容探针编译'); identity.bundleSha256 = await hash(bundle);
  sessionId = (await complete({ action: 'attach', deviceId: serial, pid: identity.pid })).session_id;
  scriptId = (await complete({ action: 'load', sessionId, scriptPath: bundle })).script_id;
  for (let count = 0; count < 100; count++) {
    await status(); const captured = [...events.values()];
    const setup = captured.find(row => row.event === 'bridge-setup-error'); if (setup) throw new Error(setup.description);
    original = captured.find(row => row.event === 'bridge-ready'); if (original) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(original, '兼容探针没有ready'); assert.equal(original.apiLevel, 36); assert.equal(original.arch, 'arm64'); assert.equal(original.fridaVersion, '17.23.2');
  await adb(['shell', 'input', 'tap', tapX, tapY]);
  for (let count = 0; count < 100; count++) {
    await status(); if ([...events.values()].some(row => row.event === 'bridge-original-returned')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok([...events.values()].some(row => row.event === 'bridge-original-returned' && row.value === 1), '没有初始0到1的原方法返回事件，请先重启自有样本');
  if (mode === 'retain-receiver') assert.ok([...events.values()].some(row => row.event === 'bridge-retained' && row.sameObject));
  await complete({ action: 'unload', sessionId, scriptId });
  assert.equal(Number((await adb(['shell', 'pidof', packageName])).stdout.trim()), identity.pid, '卸载后目标进程代次改变');
  // long: 同一PID上用不含Java/JNI的只读探针回核原ArtMethod字段，验证卸载真实恢复入口，而不是仅看后端成功信封。
  const verifyFile = path.join(root, 'verify.js');
  await fs.writeFile(verifyFile, `const expected=${JSON.stringify(original)};const address=ptr(expected.address),offsets=expected.offsets;const range=Process.findRangeByAddress(address);if(Process.id!==expected.pid||!range||!range.protection.includes('r'))throw new Error('原方法身份或可读范围失配');const observed={accessFlags:address.add(offsets.accessFlags).readU32(),jniCode:address.add(offsets.jniCode).readPointer().toString(),quickCode:address.add(offsets.quickCode).readPointer().toString()};send({event:'bridge-restoration',sequence:1,matched:JSON.stringify(observed)===JSON.stringify(expected.baseline),observed,baseline:expected.baseline});\n`);
  const verifyId = (await complete({ action: 'load', sessionId, scriptPath: verifyFile })).script_id;
  await status(); const restored = [...events.values()].find(row => row.event === 'bridge-restoration'); assert.equal(restored?.matched, true, 'ArtMethod原入口恢复未确认');
  await complete({ action: 'unload', sessionId, scriptId: verifyId });
  await adb(['shell', 'input', 'tap', tapX, tapY]);
  const log = (await adb(['shell', 'logcat', '-d', '--pid=' + identity.pid, '-s', 'ReserveCompose:I'])).stdout; await fs.writeFile(path.join(root, 'app.log'), log);
  assert.match(log, /RENDERED=2/, '卸载后的真实按钮没有完成状态变化');
  await status(); assert.equal(context.scripts.get(sessionId)?.size || 0, 0); passed = true;
} catch (error) { failure = String(error.stack || error); }
finally {
  const alive = await adb(['shell', 'pidof', packageName]).then(value => value.stdout.trim() === String(identity.pid)).catch(() => false);
  if (sessionId) await complete({ action: 'close', sessionId }).catch(error => { failure ||= String(error); });
  closed = await context.close();
  await fs.writeFile(path.join(root, 'validation.json'), JSON.stringify({ identity, passed, failure, alive, original, events: [...events.values()], results, closed }, null, 2));
  console.log(JSON.stringify({ root, identity, passed, alive, events: [...events.values()].map(row => row.event), failure, cleanupConfirmed: closed.closed }, null, 2));
}
if (!passed) process.exitCode = 1;
