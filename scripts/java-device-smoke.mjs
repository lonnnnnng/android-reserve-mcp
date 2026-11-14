// long: 仅在显式设备上使用自有App验证Java/JNI关联、异常与撤销，不选择用户其他进程。
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
const root = path.resolve('output/device-smoke'), workspace = path.join(root, 'java-work');
const apk = await fixtureApp(root);
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 60000 }), '自有样本设备操作');
await adb(['get-state']); await adb(['install', '-r', apk]);
const client = new Client({ name: 'java-device-smoke', version: '0.3.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/cli.js', import.meta.url)), '--allowedRoots', root, '--workspace', workspace], stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const results = [], captured = [];
const unpack = r => r.structuredContent || JSON.parse(r.content[0].text);
function events(value, output = []) {
  if (value && typeof value === 'object') { if (value.payload?.event) output.push(value.payload); for (const child of Object.values(value)) events(child, output); }
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
  throw new Error('Java观测任务超时');
}
async function until(sessionId, predicate) {
  const seen = [];
  for (let i = 0; i < 24; i++) {
    const result = unpack(await complete({ action: 'status', sessionId })); const observation = result.normalized_result || result;
    const batch = events(result); seen.push(...batch); captured.push(...batch);
    const error = seen.find(e => e.event.endsWith('-error') || e.event.endsWith('-timeout') || e.event === 'java-unavailable');
    if (error) throw new Error(JSON.stringify(error));
    assert.notEqual(observation.state, 'detached', '测试进程意外退出');
    if (predicate(seen)) return seen;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('未捕获预期Java事件');
}
const scriptId = r => { const v = unpack(r); return (v.normalized_result || v).script_id; };
const className = packageName + '.MainActivity';
const trace = { action: 'trace-java', className, methodName: 'compute', argumentTypes: ['int', 'int'], returnType: 'int', captureStack: process.env.ANDROID_RESERVE_SMOKE_STACK !== '0', maxEvents: 12, nativeHooks: [{ moduleName: 'libfixture.so', symbolName: 'Java_dev_androidreserve_fixture_MainActivity_nativeAdd', argumentOffset: 2, argumentCount: 2 }] };
try {
  await client.connect(transport);
  await adb(['shell', 'am', 'start', '-W', '-n', packageName + '/.MainActivity']);
  const pid = Number((await adb(['shell', 'pidof', packageName])).stdout.trim()); assert.ok(pid > 0 && Number.isSafeInteger(pid));
  let sessionId = unpack(await complete({ action: 'attach', deviceId: serial, pid })).session_id;
  const methods = await complete({ action: 'java-methods', sessionId, className, methodName: 'compute' });
  await until(sessionId, list => list.some(e => e.event === 'java-methods' && e.overloads.some(o => o.argumentTypes.join(',') === 'int,int')));
  await complete({ action: 'unload', sessionId, scriptId: scriptId(methods) });
  const observed = await complete({ ...trace, sessionId });
  const list = await until(sessionId, rows => rows.some(e => e.event === 'java-exit' && e.returnValue?.value === 46) && rows.some(e => e.event === 'native-call' && e.javaInvocationId && e.returnValue.int32 === 9));
  const native = list.find(e => e.event === 'native-call' && e.javaInvocationId), java = list.find(e => e.event === 'java-exit' && e.invocationId === native.javaInvocationId);
  assert.equal(java.returnValue.value, 46); assert.equal(native.arguments[0].int32, 2); assert.equal(native.arguments[1].int32, 7);
  if (trace.captureStack) assert.ok(list.some(e => e.event === 'java-enter' && e.stack?.source === 'java.lang.Thread.getStackTrace' && e.stack.frames.some(f => f.className === className && f.methodName === 'compute')), 'Java栈必须包含本次被观测的方法');
  await complete({ action: 'unload', sessionId, scriptId: scriptId(observed) });
  const throwing = await complete({ action: 'trace-java', sessionId, className, methodName: 'throwIfNegative', argumentTypes: ['int'], maxEvents: 8 });
  await until(sessionId, rows => rows.some(e => e.event === 'java-exit' && e.outcome === 'throw'));
  await complete({ action: 'unload', sessionId, scriptId: scriptId(throwing) });
  await complete({ action: 'close', sessionId });
  await adb(['shell', 'am', 'force-stop', packageName]);
  sessionId = unpack(await complete({ action: 'spawn', deviceId: serial, packageName })).session_id;
  await complete({ ...trace, sessionId }); await complete({ action: 'resume', sessionId });
  await until(sessionId, rows => rows.some(e => e.event === 'native-call' && e.javaInvocationId && e.returnValue.int32 === 9));
  await complete({ action: 'close', sessionId });
  console.log('真实Java重载、Java46/JNI9同调用关联、异常、unload与spawn通过');
} finally {
  await client.close(); await adb(['shell', 'am', 'force-stop', packageName]);
  await fs.writeFile(path.join(root, 'java-report.json'), JSON.stringify({ serial, packageName, results, captured }, null, 2));
}
