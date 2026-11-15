// long: 只挂显式包内的精确Mono方法；由真实UI点击触发，不从agent调用托管业务函数。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, frida } from '../src/actions.js';
import { completeJob } from './smoke-utils.mjs';
import { run, checked, tool } from '../src/core/process.js';
const [serial, packageName, configPath, workspace, x, y] = process.argv.slice(2);
if (!/^[A-Za-z0-9._:-]+$/.test(serial || '') || !/^[A-Za-z][A-Za-z0-9_.]+$/.test(packageName || '') || !configPath || !workspace || ![x,y].every(v => /^\d{1,4}$/.test(v || ''))) throw new Error('用法: mono-device-smoke.mjs SERIAL PACKAGE CONFIG WORKSPACE TAP_X TAP_Y');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const expectedReturnValue = config.expectedReturnValue ?? 46;
const expectedArguments = config.expectedArguments ?? [2, 7];
const c = await createContext({ workspace }), results = [], events = new Map();
const normal = v => { const r = v.structuredContent || (v.content ? JSON.parse(v.content[0].text) : v); return r.normalized_result || r; };
const complete = args => completeJob(c, frida(c, args), results);
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 30000 }), 'Mono自有样本');
let sessionId, passed = false, driven = false, error;
try {
  const pid = Number((await adb(['shell','pidof',packageName])).stdout.trim()); assert.ok(pid > 0);
  sessionId = normal((await complete({ action: 'attach', deviceId: serial, pid })).value).session_id;
  const observed = await complete({ action: 'trace-mono', sessionId, ...config }), scriptId = normal(observed.value).script_id;
  for (let i = 0; i < 24; i++) {
    const status = normal((await complete({ action: 'status', sessionId })).value);
    for (const msg of status.messages || []) if (msg.script_id === scriptId && msg.payload?.event) events.set(msg.payload.sequence, msg.payload);
    if (status.state === 'detached') throw new Error('Mono目标意外退出');
    const rows = [...events.values()];
    if (!driven && rows.some(e => e.event === 'managed-hook-installed')) { await adb(['shell','input','tap',x,y]); driven = true; }
    if (rows.some(e => e.event === 'managed-exit' && e.returnValue === expectedReturnValue)) { passed = true; break; }
    await new Promise(r => setTimeout(r,500));
  }
  assert.equal(passed,true,`未观察到运行时回核方法的真实返回${expectedReturnValue}；内联/未触发仍属缺口`);
  const enter = [...events.values()].find(e => e.event === 'managed-enter'); assert.deepEqual(enter.arguments, expectedArguments);
  await complete({ action: 'unload', sessionId, scriptId });
  console.log(JSON.stringify({ passed, events: [...events.values()] }));
} catch (e) { error = String(e); throw e; }
finally {
  if (sessionId) await complete({ action: 'close', sessionId }).catch(() => {});
  await c.close(); await fs.mkdir(workspace,{recursive:true});
  await fs.writeFile(path.join(workspace,'validation.json'),JSON.stringify({passed,error,serial,packageName,results,events:[...events.values()]},null,2));
}
