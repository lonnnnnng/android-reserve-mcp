import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createContext, frida } from '../src/actions.js';

const wait = async (context, initial) => {
  for (let i = 0; i < 150; i++) {
    const job = await context.jobs.get(initial.id);
    if (!['running', 'queued'].includes(job.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('模拟任务超时');
};

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'android-reserve-java-'));
  const state = { compileError: false, loadError: false, unloadError: false, missingId: false, messages: [], calls: [], compiled: 0 };
  const backend = { async call(name, args) {
    state.calls.push({ name, args });
    if (name === 'start_frida_session') return { structuredContent: { session_id: randomUUID(), pid: 1234 } };
    if (name === 'load_frida_script') {
      if (state.loadError) throw new Error('load connection lost');
      return { structuredContent: { normalized_result: { script_id: state.missingId ? undefined : randomUUID(), messages: state.loadMessages || [] } } };
    }
    if (name === 'unload_frida_script' && state.unloadError) throw new Error('unload connection lost');
    if (name === 'frida_session_status') return { structuredContent: { normalized_result: { messages: state.messages } } };
    return { structuredContent: {} };
  }, async close() {} };
  const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), backend, javaCompiler: async (args, dir) => {
    state.compiled++; if (state.compileError) throw new Error('compiler failed'); return path.join(dir, 'mock.bundle.js');
  } });
  async function attach(deviceId = 'owned-device') {
    const job = await wait(context, await frida(context, { action: 'attach', deviceId, pid: 1234 }));
    assert.equal(job.state, 'succeeded'); return JSON.parse(await fs.readFile(path.join(job.dir, 'result.json'))).structuredContent.session_id;
  }
  const sessionId = await attach();
  const trace = { action: 'trace-java', sessionId, className: 'Owned', methodName: 'compute', argumentTypes: ['int', 'int'] };
  return { context, state, sessionId, trace, attach };
}

test('Java编译失败释放占位，成功后按设备/PID防重且卸载失败保留所有权', async () => {
  const f = await fixture(), { context, state, trace, sessionId } = f;
  try {
    state.compileError = true;
    assert.equal((await wait(context, await frida(context, trace))).state, 'failed');
    assert.equal(context.javaObservers.size, 0); assert.ok(!state.calls.some(c => c.name === 'load_frida_script'));
    state.compileError = false;
    assert.equal((await wait(context, await frida(context, trace))).state, 'succeeded');
    const other = await f.attach();
    await assert.rejects(frida(context, { ...trace, sessionId: other }), /该进程已有/);
    await assert.rejects(frida(context, { action: 'unload', sessionId, scriptId: randomUUID() }), /不属于/);
    const scriptId = context.javaObservers.get(sessionId).scriptId;
    state.unloadError = true;
    assert.equal((await wait(context, await frida(context, { action: 'unload', sessionId, scriptId }))).state, 'failed');
    await assert.rejects(frida(context, trace), /该进程已有/);
    state.unloadError = false;
    assert.equal((await wait(context, await frida(context, { action: 'unload', sessionId, scriptId }))).state, 'succeeded');
    assert.equal(context.javaObservers.size, 0);
    assert.equal((await wait(context, await frida(context, { ...trace, sessionId: other }))).state, 'succeeded');
  } finally { await context.close(); }
});

test('Java注入状态不确定或scriptId缺失时阻止覆盖，确认close后才能重试', async () => {
  for (const mode of ['loadError', 'missingId']) {
    const { context, state, trace, sessionId } = await fixture();
    try {
      state[mode] = true;
      const job = await wait(context, await frida(context, trace));
      assert.equal(job.state, 'failed'); assert.match(job.error, /close/);
      assert.equal(context.javaObservers.get(sessionId).state, 'uncertain');
      await assert.rejects(frida(context, trace), /该进程已有/);
      assert.equal((await wait(context, await frida(context, { action: 'close', sessionId }))).state, 'succeeded');
      assert.equal(context.javaObservers.size, 0); assert.equal(context.sessionTargets.size, 0);
    } finally { await context.close(); }
  }
});

test('排队取消Java任务会释放未使用的占位，不编译或注入', async () => {
  const { context, state, trace, sessionId } = await fixture(); const release = [];
  try {
    // long: 占满两槽确保测试真正覆盖queued分支，不用靠计时猜测编译是否已开始。
    for (let i = 0; i < 2; i++) await context.jobs.start('barrier', () => new Promise(resolve => release.push(resolve)));
    while (release.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
    const job = await frida(context, trace); assert.equal(job.state, 'queued');
    await assert.rejects(frida(context, { action: 'close', sessionId }), /先取消/);
    await context.jobs.cancel(job.id);
    assert.equal(context.javaObservers.size, 0); assert.equal(state.compiled, 0);
    release.forEach(resolve => resolve({}));
    assert.equal((await wait(context, await frida(context, trace))).state, 'succeeded');
    assert.equal(state.compiled, 1);
  } finally { release.forEach(resolve => resolve({})); await context.close(); }
});

test('Java晚到安装超时由status识别并撤销，历史脚本错误不影响新脚本', async () => {
  const { context, state, trace, sessionId } = await fixture();
  try {
    await wait(context, await frida(context, trace));
    const scriptId = context.javaObservers.get(sessionId).scriptId;
    state.messages = [{ script_id: scriptId, type: 'send', payload: { event: 'java-setup-timeout' } }];
    const status = await wait(context, await frida(context, { action: 'status', sessionId }));
    assert.equal(status.state, 'failed'); assert.match(status.error, /java-setup-timeout/); assert.equal(status.errorArtifact, 'error.json');
    assert.equal(context.javaObservers.size, 0); assert.equal(state.calls.at(-1).name, 'unload_frida_script');
    await wait(context, await frida(context, trace));
    assert.equal((await wait(context, await frida(context, { action: 'status', sessionId }))).state, 'succeeded');
    assert.equal(context.javaObservers.size, 1);
  } finally { await context.close(); }
});

test('JNI与Java共用进程所有权；忽略旧脚本加载错误，当前JNI失败撤销不确定时保留占位', async () => {
  const { context, state, trace, sessionId } = await fixture();
  try {
    state.loadMessages = [{ script_id: randomUUID(), type: 'error', description: 'old-script-error' }];
    const job = await wait(context, await frida(context, { action: 'trace-jni', sessionId })); assert.equal(job.state, 'succeeded');
    await assert.rejects(frida(context, trace), /该进程已有/);
    const scriptId = context.javaObservers.get(sessionId).scriptId;
    state.messages = [{ script_id: scriptId, type: 'send', payload: { event: 'jni-setup-error', description: 'owned-jni-failure' } }]; state.unloadError = true;
    const failed = await wait(context, await frida(context, { action: 'status', sessionId }));
    assert.equal(failed.state, 'failed'); assert.match(failed.error, /owned-jni-failure/); assert.equal(context.javaObservers.get(sessionId).state, 'uncertain');
    await assert.rejects(frida(context, trace), /该进程已有/);
    await wait(context, await frida(context, { action: 'close', sessionId })); assert.equal(context.javaObservers.size, 0);
  } finally { await context.close(); }
});
