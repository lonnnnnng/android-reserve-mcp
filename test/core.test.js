import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/core/paths.js';
import { run } from '../src/core/process.js';
import { Jobs } from '../src/core/jobs.js';
import { createContext, dex, frida, device, guidance } from '../src/actions.js';

const temporary = () => fs.mkdtemp(path.join(os.tmpdir(), 'android-reserve-test-'));
const waitFor = async (jobs, id) => {
  for (let i = 0; i < 150; i++) {
    const job = await jobs.get(id);
    if (!['running', 'queued'].includes(job.state)) return job;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('测试任务未结束');
};

test('允许根目录按 realpath 防止 symlink 和父目录越界', async () => {
  const root = await temporary(), outside = await temporary();
  await fs.writeFile(path.join(outside, 'secret'), 'not-readable');
  await fs.symlink(path.join(outside, 'secret'), path.join(root, 'link'));
  const guard = await Paths.create([root], path.join(root, 'work'));
  await assert.rejects(guard.input(path.join(root, 'link')), /allowedRoots/);
  await assert.rejects(guard.artifact(root, '../secret'));
  await fs.writeFile(path.join(root, 'owned'), 'ok');
  assert.equal(await guard.input(path.join(root, 'owned')), await fs.realpath(path.join(root, 'owned')));
});

test('参数不经 shell，输出有上限且取消/超时可结束进程组', async () => {
  const literal = 'a b; $(echo BAD)';
  const result = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal]);
  assert.equal(result.stdout, literal);
  const flood = await run(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { maxBytes: 500 });
  assert.equal(flood.stdout.length, 500); assert.equal(flood.truncated, true);
  const timeout = await run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 60 });
  assert.equal(timeout.timedOut, true);
  const controller = new AbortController();
  const pending = run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  assert.equal((await pending).canceled, true);
});

test('长任务区分部分成功、失败和取消，结果持久化', async () => {
  const jobs = new Jobs(await temporary()); await jobs.init();
  const partial = await jobs.start('partial', async () => ({ partial: true, stages: [0, 1] }));
  assert.equal((await waitFor(jobs, partial.id)).state, 'partial');
  const broken = await jobs.start('broken', async () => { throw new Error('fixture failure'); });
  assert.equal((await waitFor(jobs, broken.id)).state, 'failed');
  const active = await jobs.start('cancel', async signal => { await run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { signal }); return {}; });
  await jobs.cancel(active.id); assert.equal((await waitFor(jobs, active.id)).state, 'canceled');
  const restored = new Jobs(path.dirname(jobs.root)); await restored.init();
  assert.equal((await restored.get(partial.id)).state, 'partial');
  await jobs.close();
});

test('DEX 使用精确后端函数，Frida 不接受隐式设备和其他客户端会话', async () => {
  const root = await temporary(); const apk = path.join(root, 'fixture.apk'); await fs.writeFile(apk, 'fixture');
  const calls = [];
  const backend = { call: async (name, args) => { calls.push({ name, args }); return { structuredContent: { session_id: 'ce930f3b-9385-4ea8-b9ec-449d6d3f2aa3' }, content: [] }; }, close: async () => {} };
  const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), backend });
  const job = await dex(context, { action: 'references', path: apk, className: 'demo.Sample', methodName: 'run' });
  await waitFor(context.jobs, job.id);
  assert.equal(calls[0].name, 'trace_android_references');
  await assert.rejects(frida(context, { action: 'attach', pid: 123 }), /deviceId/);
  await assert.rejects(frida(context, { action: 'attach', deviceId: 'local', pid: 123 }), /local/);
  await assert.rejects(frida(context, { action: 'status', sessionId: 'ce930f3b-9385-4ea8-b9ec-449d6d3f2aa3' }), /本服务器/);
  const attach = await frida(context, { action: 'attach', deviceId: 'explicit-device', pid: 123 });
  await waitFor(context.jobs, attach.id);
  assert.equal(context.sessions.size, 1);
  const resumed = await frida(context, { action: 'resume', sessionId: 'ce930f3b-9385-4ea8-b9ec-449d6d3f2aa3' });
  await waitFor(context.jobs, resumed.id);
  assert.equal(calls.at(-1).name, 'resume_frida_session');
  await context.close();
});

test('ADB 非 list 操作必须明确 serial；资料按允许列表读取并阻止路径穿越', async () => {
  const root = await temporary(), skill = path.join(root, 'skills/apk-reverse');
  await fs.mkdir(skill, { recursive: true }); await fs.writeFile(path.join(skill, 'SKILL.md'), '---\nname: apk-reverse\ndescription: fixture\n---\nread this only');
  const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), skillRoots: [path.join(root, 'skills')] });
  // long: 缺设备在创建任务前拒绝，不允许测试意外向默认手机发出命令。
  await assert.rejects(device(context, { action: 'inspect' }), /serial|adb/);
  assert.equal((await guidance(context, { action: 'list' })).skills[0].name, 'apk-reverse');
  assert.ok((await guidance(context, { action: 'read', name: 'apk-reverse' })).text.includes('fixture'));
  await assert.rejects(guidance(context, { action: 'read', name: 'not-allowed' }), /未开放/);
  await context.close();
});
