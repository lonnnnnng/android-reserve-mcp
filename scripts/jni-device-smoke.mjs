// long: 仅使用自有动态注册样本；先确认注册返回，再用同进程RVA追踪隐藏JNI，不操作其他应用。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { run, tool, checked } from '../src/core/process.js';
import { fixtureApp, packageName } from './fixture-app.mjs';

const serial = process.argv[2];
if (!serial || !/^[A-Za-z0-9._:-]+$/.test(serial) || serial.startsWith('-')) throw new Error('必须显式设备serial');
const root = path.resolve('output/device-smoke'), workspace = path.join(root, 'jni-work');
const apk = await fixtureApp(root, { dynamicJni: true });
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 60000 }), '自有样本设备操作');
await adb(['get-state']); await adb(['install', '-r', apk]);
const client = new Client({ name: 'jni-device-smoke', version: '0.4.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/cli.js', import.meta.url)), '--allowedRoots', root, '--workspace', workspace], stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const results = [], captured = [], fixtureEvidence = [];
const unpack = r => r.structuredContent || JSON.parse(r.content[0].text);
function events(value, expectedScriptId, output = []) {
  if (value && typeof value === 'object') { if (value.script_id === expectedScriptId && value.payload?.event) output.push({ ...value.payload, scriptId: expectedScriptId }); for (const child of Object.values(value)) events(child, expectedScriptId, output); }
  return output;
}
async function complete(args) {
  const started = await client.callTool({ name: 'frida', arguments: args }); if (started.isError) throw new Error(JSON.stringify(started.content));
  const initial = JSON.parse(started.content[0].text);
  for (let i = 0; i < 1200; i++) {
    const response = await client.callTool({ name: 'jobs', arguments: { action: 'status', jobId: initial.id } });
    const job = JSON.parse(response.content[0].text);
    if (!['running', 'queued'].includes(job.state)) {
      results.push({ action: args.action, ...job }); console.log(JSON.stringify(results.at(-1))); assert.equal(job.state, 'succeeded', job.error);
      return JSON.parse(await fs.readFile(path.join(workspace, 'jobs', job.id, 'result.json')));
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('JNI观测任务超时');
}
async function until(sessionId, predicate, expectedScriptId) {
  assert.ok(expectedScriptId, "验收必须按当前script_id过滤历史消息");
  const seen = [];
  for (let i = 0; i < 24; i++) {
    const result = unpack(await complete({ action: 'status', sessionId })); const observation = result.normalized_result || result;
    const batch = events(result, expectedScriptId); seen.push(...batch); captured.push(...batch);
    const error = seen.find(e => e.event.endsWith('-error') || e.event.endsWith('-timeout') || e.event === 'java-unavailable');
    if (error) throw new Error(JSON.stringify(error));
    assert.notEqual(observation.state, 'detached', '测试进程意外退出');
    if (predicate(seen)) return seen;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('未捕获预期JNI事件');
}
const scriptId = r => { const v = unpack(r); return (v.normalized_result || v).script_id; };
const className = packageName + '.MainActivity';
const registration = { action: 'trace-jni', className: className + '$DynamicTarget', maxEvents: 24, maxMethods: 4 };
let passed = false;
try {
  await client.connect(transport);
  await adb(['shell', 'am', 'force-stop', packageName]);
  let sessionId = unpack(await complete({ action: 'spawn', deviceId: serial, packageName })).session_id;
  const observer = await complete({ ...registration, sessionId });
  await until(sessionId, rows => rows.some(e => e.event === 'jni-observer-ready'), scriptId(observer));
  await complete({ action: 'resume', sessionId });
  const rows = await until(sessionId, list => list.some(e => e.event === 'jni-register-result' && e.outcome === 'success') && list.some(e => e.event === 'jni-register-result' && e.outcome === 'failure') && list.some(e => e.event === 'jni-unregister-result' && e.outcome === 'success'), scriptId(observer));
  const entry = rows.find(e => e.event === 'jni-register-enter' && e.methods?.some(m => m.name === 'dynamicAdd' && m.signature === '(II)I'));
  const method = entry.methods.find(m => m.name === 'dynamicAdd');
  assert.equal(method.module, 'libfixture.so'); assert.match(method.rva, /^0x[0-9a-f]+$/); assert.ok(entry.classId); assert.equal(entry.partial, false);
  assert.ok(rows.some(e => e.event === 'jni-register-result' && e.registrationId === entry.registrationId && e.returnCode === 0));
  assert.ok(rows.some(e => e.event === 'jni-register-result' && e.outcome === 'failure' && e.returnCode < 0 && e.mappingEffect === 'unknown-on-failure'));
  assert.ok(rows.some(e => e.event === 'jni-unregister-result' && e.classId === entry.classId && e.mappingEffect === 'class-unregistered'));
  const symbols = checked(await run(await tool('readelf'), ['--dyn-syms', path.join(root, 'libfixture.so')]), '自有SO导出清单');
  assert.doesNotMatch(symbols.stdout, /owned_dynamic_add|Java_dev_androidreserve_fixture_MainActivity_00024DynamicTarget_dynamicAdd/);
  // long: 必须在JNI observer仍加载时读自有PID的周期结果，防止卸载后的正常业务把异常保持验证成假阳性。
  const ownedPid = Number((await adb(['shell', 'pidof', packageName])).stdout.trim()); assert.ok(Number.isSafeInteger(ownedPid) && ownedPid > 0);
  let ownLog = '';
  for (let i = 0; i < 12; i++) {
    ownLog = (await adb(['logcat', '-d', '--pid=' + ownedPid, '-t', '100', '-s', 'AndroidReserveFixture:I'])).stdout;
    if (ownLog.includes('REGISTRATION_CYCLE=123')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.match(ownLog, /REGISTRATION_CYCLE=123/); assert.doesNotMatch(ownLog, /REGISTRATION_CYCLE=-/);
  fixtureEvidence.push({ pid: ownedPid, observerScriptId: scriptId(observer), observedWhileLoaded: true, log: ownLog });
  await complete({ action: 'unload', sessionId, scriptId: scriptId(observer) });
  const trace = await complete({ action: 'trace-java', sessionId, className, methodName: 'computeDynamic', argumentTypes: ['int', 'int'], maxEvents: 12, captureStack: process.env.ANDROID_RESERVE_JNI_SMOKE_STACK !== '0', nativeHooks: [{ moduleName: method.module, rva: method.rva, argumentOffset: 2, argumentCount: 2 }] });
  const calls = await until(sessionId, list => list.some(e => e.event === 'java-exit' && e.methodKey.includes('computeDynamic') && e.returnValue?.value === 57) && list.some(e => e.event === 'native-call' && e.rva === method.rva && e.javaInvocationId && e.returnValue.int32 === 20), scriptId(trace));
  const native = calls.find(e => e.event === 'native-call' && e.rva === method.rva && e.javaInvocationId && e.returnValue.int32 === 20);
  assert.ok(calls.some(e => e.event === 'java-exit' && e.invocationId === native.javaInvocationId && e.returnValue?.value === 57));
  assert.equal(native.arguments[0].int32, 2); assert.equal(native.arguments[1].int32, 7);
  if (process.env.ANDROID_RESERVE_JNI_SMOKE_STACK !== '0') { assert.equal(native.stackKind, 'frida-fuzzy-candidates'); assert.ok(calls.some(e => e.event === 'java-enter' && e.methodKey.includes('computeDynamic') && e.stack?.frames.some(f => f.methodName === 'computeDynamic'))); }
  await complete({ action: 'unload', sessionId, scriptId: scriptId(trace) });
  const plain = await complete({ action: 'trace-native', sessionId, moduleName: method.module, rva: method.rva, argumentOffset: 2, argumentCount: 2, maxEvents: 8, captureStack: true });
  await until(sessionId, list => list.some(e => e.event === 'hook-installed') && list.some(e => e.event === 'native-call' && e.rva === method.rva && e.returnValue.int32 === 20 && e.stackKind === 'frida-fuzzy-candidates'), scriptId(plain));
  await complete({ action: 'unload', sessionId, scriptId: scriptId(plain) });
  const outcome = await complete({ action: 'trace-java', sessionId, className, methodName: 'runRegistrationCycle', argumentTypes: [], maxEvents: 8 });
  await until(sessionId, list => list.some(e => e.event === 'java-exit' && e.methodKey.includes('runRegistrationCycle') && e.returnValue?.value === 123), scriptId(outcome));
  await complete({ action: 'unload', sessionId, scriptId: scriptId(outcome) });
  await complete({ action: 'close', sessionId });
  const pid = Number((await adb(['shell', 'pidof', packageName])).stdout.trim()); assert.ok(pid > 0 && Number.isSafeInteger(pid));
  sessionId = unpack(await complete({ action: 'attach', deviceId: serial, pid })).session_id;
  const attached = await complete({ ...registration, sessionId });
  await until(sessionId, list => list.some(e => e.event === 'jni-register-result' && e.outcome === 'success'), scriptId(attached));
  await complete({ action: 'unload', sessionId, scriptId: scriptId(attached) });
  await complete({ action: 'close', sessionId });
  passed = true;
  console.log('真实JNI动态注册/失败/撤销、隐藏函数RVA、Java57/Native20关联、原异常保持与attach/spawn通过');
} finally {
  await client.close(); await adb(['shell', 'am', 'force-stop', packageName]);
  await fs.writeFile(path.join(root, 'jni-report.json'), JSON.stringify({ passed, serial, packageName, results, captured, fixtureEvidence }, null, 2));
}
