import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Jobs } from '../src/core/jobs.js';
import { Backend } from '../src/core/backend.js';
import { NativeTargets } from '../src/core/native.js';
import { run } from '../src/core/process.js';
import { createContext, frida } from '../src/actions.js';
import { evidence, indexEvidence, mergeEvidenceNode } from '../src/core/evidence.js';
import { startJavaGroupObserver } from '../helpers/java-group-observer.js';
import { startJavaObserver } from '../helpers/java-observer.js';

const temporary = () => fs.mkdtemp(path.join(os.tmpdir(), 'android-reserve-stability-'));
async function finished(jobs, started) {
  for (let i = 0; i < 300; i++) {
    const job = await jobs.get(started.id);
    if (!['running', 'queued'].includes(job.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('测试任务未结束');
}

test('其他实例读取和取消活跃任务不改写拥有者文件；未知旧任务保持未确认', async () => {
  const root = await temporary(), owner = new Jobs(root), reader = new Jobs(root);
  await owner.init(); await reader.init(); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  try {
    const started = await owner.start('owned', async () => { entered(); await gate; return {}; }); await ready;
    const file = path.join(root, 'jobs', started.id, 'job.json'), before = await fs.readFile(file, 'utf8');
    const foreign = await reader.get(started.id);
    assert.equal(foreign.state, 'running'); assert.equal(foreign.ownership, 'external-active');
    await assert.rejects(reader.cancel(started.id), /原实例/);
    await assert.rejects(reader.save(foreign), /其他实例/);
    assert.equal(await fs.readFile(file, 'utf8'), before);
    const id = randomUUID(), dir = path.join(root, 'jobs', id); await fs.mkdir(dir);
    const legacy = JSON.stringify({ id, state: 'running' }); await fs.writeFile(path.join(dir, 'job.json'), legacy);
    assert.equal((await reader.get(id)).recovery, 'owner-identity-unavailable');
    assert.equal(await fs.readFile(path.join(dir, 'job.json'), 'utf8'), legacy);
    release(); assert.equal((await finished(owner, started)).state, 'succeeded');
  } finally { release(); await owner.close(); await reader.close(); }
});

test('拥有者已经结束时只派生interrupted状态，不改写磁盘或承诺设备清理', async () => {
  const root = await temporary(), owner = new Jobs(root), reader = new Jobs(root);
  await owner.init(); await reader.init();
  const id = randomUUID(), dir = path.join(root, 'jobs', id); await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'job.json'), JSON.stringify({ id, state: 'running', owner: owner.owner }));
  await owner.close();
  const before = await fs.readFile(path.join(dir, 'job.json'), 'utf8'), result = await reader.get(id);
  assert.equal(result.state, 'interrupted'); assert.equal(result.recordedState, 'running'); assert.equal(result.cleanupUnconfirmed, true);
  assert.equal(await fs.readFile(path.join(dir, 'job.json'), 'utf8'), before); await reader.close();
});

test('真实拥有者进程退出后才报告interrupted，读取仍不改写原件', async () => {
  const root = await temporary(), reader = new Jobs(root); await reader.init();
  const source = "import {Jobs} from './src/core/jobs.js';const jobs=new Jobs(process.argv[1]);await jobs.init();let entered;const ready=new Promise(resolve=>entered=resolve);const job=await jobs.start('owned-process',async()=>{entered();await new Promise(()=>{});});await ready;console.log(job.id);setInterval(()=>{},1000);";
  // long: 只终止本测试创建的拥有者，核实实际进程死亡而非伪造状态；不接触开发环境的其他CLI。
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, root], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const [chunk] = await once(child.stdout, 'data'), id = String(chunk).trim();
    const file = path.join(root, 'jobs', id, 'job.json'), original = await fs.readFile(file, 'utf8');
    assert.equal((await reader.get(id)).state, 'running'); child.kill('SIGTERM'); await once(child, 'exit');
    const ended = await reader.get(id); assert.equal(ended.state, 'interrupted'); assert.equal(ended.cleanupUnconfirmed, true);
    assert.equal(await fs.readFile(file, 'utf8'), original);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await reader.close(); }
});

test('父CLI退出后忽略SIGTERM的孙进程仍被任务期限终止', { timeout: 6000 }, async () => {
  const descendant = "process.on('SIGTERM',()=>process.stdout.write('ignored-term\\n'));process.stdout.write('grandchild-ready\\n');setInterval(()=>{},1000);";
  const parent = "const {spawn}=require('node:child_process');spawn(process.execPath,['-e',process.argv[1]],{stdio:['ignore','inherit','inherit']});setTimeout(()=>process.exit(0),40);";
  const result = await run(process.execPath, ['-e', parent, descendant], { timeoutMs: 350 });
  assert.equal(result.code, 0); assert.equal(result.timedOut, true); assert.match(result.stdout, /grandchild-ready/); assert.match(result.stdout, /ignored-term/);
});

test('忽略取消的任务不能阻塞退出；保留未确认任务并停止接收新任务', async () => {
  const jobs = new Jobs(await temporary(), { closeTimeoutMs: 40 }); await jobs.init(); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const started = await jobs.start('uncooperative', async () => { entered(); await gate; return {}; }); await ready;
  try {
    const report = await jobs.close(); assert.equal(report.closed, false); assert.deepEqual(report.unfinished, [started.id]);
    assert.match(report.warning, /超时/); await assert.rejects(jobs.start('late', async () => ({})), /正在退出/);
  } finally { release(); await jobs.running.get(started.id)?.completion; }
});

test('已知JNI崩溃签名在编译、占位、注入前拒绝；helper直接调用同样拒绝', async () => {
  const root = await temporary(), calls = []; let compiled = 0;
  const sessionId = randomUUID();
  const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'),
    backend: { async call(name) { calls.push(name); return { structuredContent: { session_id: sessionId, pid: 1234 } }; }, async close() {} },
    javaCompiler: async () => { compiled++; return 'unexpected'; } });
  const targets = [
    { className: 'io.flutter.embedding.engine.dart.DartMessenger$Reply', methodName: 'reply', argumentTypes: ['java.nio.ByteBuffer'] },
    { className: 'androidx.compose.runtime.SnapshotMutableStateImpl', methodName: 'setValue', argumentTypes: ['java.lang.Object'] },
    { className: 'androidx.compose.runtime.SnapshotMutableIntStateImpl', methodName: 'setIntValue', argumentTypes: ['int'] },
  ];
  try {
    await finished(context.jobs, await frida(context, { action: 'attach', deviceId: 'owned-test-device', pid: 1234 }));
    for (const target of targets) {
      await assert.rejects(frida(context, { action: 'trace-java', sessionId, ...target }), error => error.code === 'java_compatibility_blocked' && error.diagnostic.cleanupRequired === false);
      const javaHooks = [{ id: 'blocked', ...target }];
      await assert.rejects(frida(context, { action: 'trace-java-group', sessionId, javaHooks }), error => error.code === 'java_compatibility_blocked');
      const events = [], Java = new Proxy({}, { get() { throw new Error('不能触及Java运行时'); } }), env = { send: row => events.push(row) };
      startJavaObserver(Java, { action: 'trace-java', ...target }, env);
      startJavaGroupObserver(Java, { javaHooks }, env);
      assert.equal(events.length, 2); assert.ok(events.every(row => row.event === 'java-compatibility-blocked'));
    }
    assert.equal(compiled, 0); assert.equal(context.javaObservers.size, 0); assert.ok(!calls.includes('load_frida_script'));
  } finally { await context.close(); }
});

test('实际任务证据逆序合并保留完成终态和两份来源，正文明确连到同一请求', async () => {
  const root = await temporary(), context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), disabled: true });
  const scope = { sessionId: 'owned', processEpoch: 'epoch' }, row = { requestId: 'request', url: 'https://example.test/owned', method: 'GET' };
  try {
    const pending = await context.jobs.start('pending', async () => ({ ...scope, capturedAt: 1, requests: [row] })); await finished(context.jobs, pending);
    const complete = await context.jobs.start('finished', async () => ({ ...scope, capturedAt: 2, requests: [{ ...row, finished: true, response: { status: 200, fromDiskCache: true, fromServiceWorker: false } }] })); await finished(context.jobs, complete);
    const results = [];
    for (const jobIds of [[complete.id, pending.id], [pending.id, complete.id]]) {
      const job = await finished(context.jobs, await evidence(context, { action: 'merge', jobIds })); assert.equal(job.state, 'succeeded', job.error);
      const graph = JSON.parse(await fs.readFile(path.join(job.dir, 'graph.json'))), request = graph.nodes.find(node => node.kind === 'webview-request');
      assert.equal(request.finished, true); assert.equal(request.status, 200); assert.equal(request.fromDiskCache, true);
      assert.deepEqual(new Set(request.observations.map(snapshot => snapshot.source.jobId)), new Set([pending.id, complete.id])); results.push(request);
    }
    assert.deepEqual(results[0], results[1]);
    const graph = indexEvidence('body', [{ file: 'result.json', value: { ...scope, kind: 'body', sha256: 'a'.repeat(64), metadata: { ...row, finished: true, response: { status: 200 } } } }]);
    assert.ok(graph.edges.some(edge => edge.relation === 'captured-response-body' && edge.strength === 'same-cdp-session-request-id-content-hash'));
  } finally { await context.close(); }
});

test('冲突终态保留双方证据并标partial，不能按合并顺序挑选成功', () => {
  const scope = { sessionId: 'owned', processEpoch: 'epoch' };
  const sources = [
    { file: 'success.json', value: { ...scope, requests: [{ requestId: 'request', finished: true, response: { status: 200 } }] } },
    { file: 'failure.json', value: { ...scope, requests: [{ requestId: 'request', failure: { errorText: 'owned-failure' } }] } },
  ];
  for (const order of [sources, [...sources].reverse()]) {
    const graph = indexEvidence('owned', order), request = graph.nodes.find(node => node.kind === 'webview-request');
    assert.equal(graph.partial, true); assert.equal(request.state, 'conflicting-terminal'); assert.equal(request.finished, false); assert.equal(request.status, undefined); assert.equal(request.observations.length, 2);
  }
});

function backendFixture(options = {}) {
  let resolve, startedResolve;
  const ready = new Promise(done => { resolve = done; }), started = new Promise(done => { startedResolve = done; });
  const state = { connects: 0, clientCloses: 0, transportCloses: 0 };
  const client = { async connect() { state.connects++; startedResolve(); await ready; }, async callTool() { return { content: [] }; }, async close() { state.clientCloses++; } };
  const transport = { async close() { state.transportCloses++; } };
  const backend = new Backend({ connectionTimeoutMs: 200, closeTimeoutMs: 100, ...options, clientFactory: () => client, transportFactory: () => transport });
  return { backend, state, started, release: resolve, client, transport };
}

test('连接中取消立即返回，其他握手等待者继续；退出不接纳晚到连接', async () => {
  const f = backendFixture(), controller = new AbortController();
  const first = f.backend.connect(controller.signal), firstResult = assert.rejects(first, /owned-cancel/), second = f.backend.connect();
  await f.started; controller.abort(new Error('owned-cancel')); await firstResult;
  assert.equal(f.state.transportCloses, 0); f.release(); assert.equal(await second, f.client); assert.equal(f.state.connects, 1); await f.backend.close();
  const other = backendFixture(), pending = other.backend.connect(), rejected = assert.rejects(pending, /正在退出/);
  await other.started; await other.backend.close(); await rejected; other.release();
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(other.backend.client, null); assert.ok(other.state.transportCloses > 0);
  await assert.rejects(other.backend.connect(), /正在退出/);
});

test('不响应信号的握手和请求仍受总期限约束，连接清理不会遗漏transport', async () => {
  const f = backendFixture(); await assert.rejects(f.backend.connect(), /启动与握手超时/); assert.ok(f.state.transportCloses > 0); await f.backend.close();
  const request = backendFixture({ requestTimeoutMs: 60 }); request.release(); request.client.callTool = async () => new Promise(() => {});
  await assert.rejects(request.backend.call('search_android_classes', {}), /REA任务超时/); await request.backend.close();
});

test('会话与后端不响应退出时写出未确认账本，不宣称已清理', async () => {
  const root = await temporary(), session = randomUUID();
  const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), cleanupTimeoutMs: 40,
    backend: { async call() { return new Promise(() => {}); }, async close() { return new Promise(() => {}); } } });
  context.sessions.add(session);
  const report = await context.close(); assert.equal(report.closed, false); assert.deepEqual(report.unresolvedFridaSessions, [session]);
  assert.ok(report.errors.some(error => error.stage === 'Frida会话清理')); assert.ok(report.errors.some(error => error.stage === 'REA退出'));
  const retained = JSON.parse(await fs.readFile(path.join(context.paths.workspace, 'shutdown-' + context.jobs.instanceId + '.json')));
  assert.equal(retained.closed, false); assert.deepEqual(retained.unresolvedFridaSessions, [session]);
});

test('退出等待尚未完成的任务登记，并取消它的预留而不留下queued任务', async () => {
  const jobs = new Jobs(await temporary()); await jobs.init();
  const save = jobs.save.bind(jobs); let release, entered, canceled = 0, executed = 0;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  jobs.save = async job => { entered(); await gate; return save(job); };
  const pending = jobs.start('registering', async () => { executed++; return {}; }, { onQueuedCancel() { canceled++; } });
  await ready; let closed = false; const closing = jobs.close().then(report => { closed = true; return report; });
  try {
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(closed, false);
    release(); const job = await pending, report = await closing;
    assert.equal(job.state, 'canceled'); assert.equal(canceled, 1); assert.equal(executed, 0); assert.equal(jobs.queue.length, 0); assert.equal(jobs.registrations.size, 0); assert.equal(report.closed, true);
  } finally { release(); await pending; await closing; }
});

test('取消握手后清理失败仍登记连接；close明确失败并能重试同一清理', async () => {
  const f = backendFixture(), pending = f.backend.connect(), rejected = assert.rejects(pending, /正在退出/);
  await f.started; f.transport.close = async () => { throw new Error('transport-cleanup-failed'); };
  await assert.rejects(f.backend.close(), /transport-cleanup-failed/); await rejected;
  assert.equal(f.backend.connections.size, 1);
  f.transport.close = async () => {}; await f.backend.close(); assert.equal(f.backend.connections.size, 0); f.release();
});

test('握手失败的sidecar未清理时阻止新连接，确认清理后才重试握手', async () => {
  const f = backendFixture(); f.transport.close = async () => { throw new Error('owned-unconfirmed-sidecar'); };
  await assert.rejects(f.backend.connect(), /握手超时/); assert.equal(f.state.connects, 1);
  await assert.rejects(f.backend.connect(), error => error.code === 'cleanup_incomplete'); assert.equal(f.state.connects, 1);
  f.transport.close = async () => {}; f.release(); assert.equal(await f.backend.connect(), f.client); assert.equal(f.state.connects, 2); await f.backend.close();
});

test('Native打开失败后的退出错误保留targetId和清理所有权，允许明确重试关闭', async () => {
  let cleanupFailed = true;
  const native = new NativeTargets(() => ({ async call() { throw new Error('owned-open-failure'); }, async close() { if (cleanupFailed) throw new Error('owned-cleanup-failure'); } }));
  let targetId;
  await assert.rejects(native.open('/owned/input', undefined), error => { targetId = error.diagnostic?.targetId; return error.message.includes('清理未确认') && !!targetId; });
  assert.equal(native.targets.get(targetId).state, 'cleanup-unconfirmed'); cleanupFailed = false;
  assert.equal((await native.closeTarget(targetId)).cleanupOnly, true); assert.equal(native.targets.size, 0);
});

test('累计产物来源和字节冲突在两种合并顺序下都完整保留', () => {
  const first = { id: 'artifact', kind: 'artifact', sha256: 'a'.repeat(64), bytes: 10, sourcePath: 'a', sourcePaths: ['a', 'b'], byteCounts: [10, 11] };
  const second = { id: 'artifact', kind: 'artifact', sha256: 'a'.repeat(64), bytes: 10, sourcePath: 'c', sourcePaths: ['c', 'd'], byteCounts: [10, 12] };
  const a = mergeEvidenceNode(first, second), b = mergeEvidenceNode(second, first);
  assert.equal(a.partial, true); assert.equal(b.partial, true); assert.deepEqual(a.node.sourcePaths, ['a', 'b', 'c', 'd']); assert.deepEqual(a.node.byteCounts, [10, 11, 12]); assert.deepEqual(a.node, b.node);
});

test('专用请求、方法和initiator索引超过预算时传播partial', () => {
  const requests = Array.from({ length: 201 }, (_, index) => ({ requestId: String(index), finished: true }));
  const network = indexEvidence('owned', [{ file: 'network.json', value: { sessionId: 'owned', processEpoch: 'epoch', requests } }]);
  assert.equal(network.partial, true); assert.equal(network.nodes.filter(node => node.kind === 'webview-request').length, 200);
  const methods = indexEvidence('owned', [{ file: 'kotlin.json', value: { className: 'Owned', functions: Array.from({ length: 1001 }, (_, index) => ({ jvmSignature: 'method' + index + '()V' })) } }]);
  assert.equal(methods.partial, true); assert.equal(methods.nodes.filter(node => node.kind === 'java-method').length, 1000);
  const frames = indexEvidence('owned', [{ file: 'network.json', value: { sessionId: 'owned', processEpoch: 'epoch', requests: [{ requestId: 'one', initiator: { frames: Array.from({ length: 65 }, (_, index) => ({ scriptId: String(index) })) } }] } }]);
  assert.equal(frames.partial, true); assert.equal(frames.nodes.filter(node => node.kind === 'webview-initiator-frame').length, 64);
});

test('真实CLI的EOF和SIGTERM重复到达仍等待同一份清理终态', { timeout: 8000 }, async () => {
  const root = await temporary(), bin = path.join(root, 'bin'), marker = path.join(root, 'ready'), workspace = path.join(root, 'work');
  await fs.mkdir(bin);
  const executable = path.join(bin, 'jadx');
  // long: 自有CLI故意忽略TERM，用真实1.5秒进程组清理制造窗口；第二个退出信号不能让MCP提前退出。
  await fs.writeFile(executable, '#!' + process.execPath + '\n' + "const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.env.ANDROID_RESERVE_EXIT_PROBE,'ready');setInterval(()=>{},1000);\n", { mode: 0o700 });
  const apk = path.join(root, 'owned.apk'); await fs.writeFile(apk, 'owned-cli-fixture');
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/cli.js', import.meta.url)), '--no-rea', '--allowedRoots', root, '--workspace', workspace],
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ANDROID_RESERVE_EXIT_PROBE: marker }, stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'owned-exit-test', version: '1' });
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'decode', arguments: { path: apk, engine: 'jadx' } }); assert.ok(!response.isError);
    let ready = false;
    for (let i = 0; i < 100; i++) { ready = await fs.access(marker).then(() => true).catch(() => false); if (ready) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.equal(ready, true);
    const pid = transport.pid, closing = client.close();
    await new Promise(resolve => setTimeout(resolve, 100)); process.kill(pid, 'SIGTERM'); await closing;
    const files = (await fs.readdir(workspace)).filter(name => name.startsWith('shutdown-') && name.endsWith('.json'));
    assert.equal(files.length, 1); const report = JSON.parse(await fs.readFile(path.join(workspace, files[0])));
    assert.equal(report.state, 'finished'); assert.equal(report.closed, true); assert.deepEqual(report.tasks.unfinished, []);
  } finally { await client.close(); }
});
