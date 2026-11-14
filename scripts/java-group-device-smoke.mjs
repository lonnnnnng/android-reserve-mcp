// long: 配置只描述精确方法和对象关联；UI驱动由显式测试命令完成，不注入模拟业务调用。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, frida } from '../src/actions.js';
import { completeJob } from './smoke-utils.mjs';
import { run, tool, checked } from '../src/core/process.js';

const [serial, packageName, configPath, workspace, tapX, tapY] = process.argv.slice(2);
if (!serial || !packageName || !configPath || !workspace) throw new Error('用法: node scripts/java-group-device-smoke.mjs SERIAL PACKAGE CONFIG WORKSPACE');
if (!/^[A-Za-z0-9._:-]+$/.test(serial) || !/^[A-Za-z][A-Za-z0-9_.]+$/.test(packageName)) throw new Error('设备/包名无效');
const { smokeExpectedReplies = 1, smokeExitHook, smokeParentHook, smokeObservedExitHook, ...config } = JSON.parse(await fs.readFile(configPath, 'utf8'));
assert.ok(Number.isInteger(smokeExpectedReplies) && smokeExpectedReplies >= 0 && smokeExpectedReplies <= 20);
assert.ok(smokeExpectedReplies > 0 || smokeExitHook);
const c = await createContext({ workspace }), results = [], captured = new Map();
const unpack = v => v?.structuredContent || (v?.content ? JSON.parse(v.content[0].text) : v);
const normal = v => { const r = unpack(v); return r.normalized_result || r; };
const complete = args => completeJob(c, frida(c, args), results);
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 30000 }), '分组观测样本');
let sessionId, passed = false, traceId, driven = false;
try {
  const pid = Number((await adb(['shell', 'pidof', packageName])).stdout.trim()); assert.ok(pid > 0);
  sessionId = normal((await complete({ action: 'attach', deviceId: serial, pid })).value).session_id;
  const loaded = await complete({ action: 'trace-java-group', sessionId, ...config });
  const scriptId = normal(loaded.value).script_id; traceId = loaded.job.id;
  console.log(JSON.stringify({ readyToDrive: true, serial, packageName, pid, scriptId }));
  for (let i = 0; i < 120; i++) {
    const status = normal((await complete({ action: 'status', sessionId })).value);
    for (const msg of status.messages || []) if (msg.script_id === scriptId && msg.payload?.event) captured.set(msg.payload.sequence, msg.payload);
    const events = [...captured.values()];
    if (status.state === 'detached') throw new Error('目标进程已分离，停止等待并保留现有事件');
    if (!driven && tapX !== undefined && events.some(e => e.event === 'java-group-ready')) {
      if (![tapX, tapY].every(v => /^\d{1,4}$/.test(v || ''))) throw new Error('tap坐标无效');
      await adb(['shell', 'input', 'tap', tapX, tapY]); driven = true;
    }
    const linkedExit = !smokeExitHook || events.some(e => e.event === 'java-exit' && e.hookId === smokeExitHook && (!smokeParentHook || events.some(parent => parent.event === 'java-enter' && parent.hookId === smokeParentHook && e.parentInvocationId === parent.invocationId)));
    const observedExit = !smokeObservedExitHook || events.some(e => e.event === 'java-exit' && e.hookId === smokeObservedExitHook);
    if (events.some(e => e.event === 'java-group-ready') && events.filter(e => e.correlation?.state === 'reply-returned').length >= smokeExpectedReplies && linkedExit && observedExit) { passed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(passed, true, '未观察到同对象回复返回；检查报告与目标UI触发');
  await complete({ action: 'unload', sessionId, scriptId });
  console.log(JSON.stringify({ passed, events: [...captured.values()] }));
} finally {
  if (sessionId) await complete({ action: 'close', sessionId }).catch(() => {});
  await c.close();
  await fs.writeFile(path.join(workspace, 'validation.json'), JSON.stringify({ passed, serial, packageName, traceId, results, captured: [...captured.values()] }, null, 2));
}
