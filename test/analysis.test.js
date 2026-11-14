import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContext, artifact, script, frida } from '../src/actions.js';
import { NativeTargets } from '../src/core/native.js';
import { framework } from '../src/core/engines.js';
import { run, tool, checked } from '../src/core/process.js';

const wait = async (context, initial) => {
  for (let i = 0; i < 500; i++) {
    const job = await context.jobs.get(initial.id);
    if (!['running', 'queued'].includes(job.state)) return job;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('任务未结束');
};
const contextFor = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'android-reserve-analysis-'));
  return { root, context: await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), disabled: true }) };
};

test('嵌套APKS索引真实magic、来源与ABI；拒绝越界及重复成员提取', async () => {
  const { root, context } = await contextFor();
  try {
    checked(await run(await tool('python3'), ['-c', `import io,zipfile,sys,struct
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('AndroidManifest.xml','fixture')
 z.writestr('assets/index.android.bundle',struct.pack('<QI',0x1F1903C103BC1FC6,96)+b'x'*12)
 z.writestr('lib/arm64-v8a/libhermes.so',b'fixture')
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('toc.pb','fixture')
 z.writestr('splits/base.apk',b.getvalue())
 z.writestr('../outside','blocked')
 z.writestr('duplicate','one')
 z.writestr('duplicate','two')`, path.join(root, 'fixture.apks')]), '嵌套测试包');
    const inspected = await wait(context, await artifact(context, { action: 'inspect', path: path.join(root, 'fixture.apks') }));
    assert.equal(inspected.state, 'partial');
    const report = JSON.parse(await fs.readFile(path.join(inspected.dir, 'inventory.json')));
    assert.equal(report.containers[0].kind, 'apks');
    const hbc = report.entries.find(e => e.kind === 'hermes-hbc');
    assert.deepEqual(hbc.chain, ['splits/base.apk', 'assets/index.android.bundle']);
    assert.equal(hbc.bytecodeVersion, 96);
    assert.ok(report.frameworks.some(f => f.name === 'react-native'));
    const extracted = await wait(context, await artifact(context, { action: 'extract', path: path.join(root, 'fixture.apks'), chain: hbc.chain }));
    assert.equal(extracted.state, 'succeeded');
    const bytes = await fs.readFile(path.join(extracted.dir, 'extracted-index.android.bundle'));
    assert.equal(bytes.readUInt32LE(8), 96);
    const bad = await wait(context, await artifact(context, { action: 'extract', path: path.join(root, 'fixture.apks'), chain: ['../outside'] }));
    assert.equal(bad.state, 'failed');
    const duplicate = await wait(context, await artifact(context, { action: 'extract', path: path.join(root, 'fixture.apks'), chain: ['duplicate'] }));
    assert.equal(duplicate.state, 'failed');
    await assert.rejects(fs.stat(path.join(root, 'outside')));
  } finally { await context.close(); }
});

test('JS索引真实词法关系，格式化不执行目标；显式indexed map且拒绝外部section', async () => {
  const { root, context } = await contextFor();
  try {
    const source = path.join(root, 'fixture.js');
    await fs.writeFile(source, "import x from './mod.js'; function add(a,b){return a+b} const result=add(1,2); fetch('https://fixture.invalid/api'); throw new Error('TARGET_MUST_NOT_EXECUTE');");
    const indexed = await wait(context, await script(context, { action: 'format', path: source }));
    assert.equal(indexed.state, 'succeeded');
    const report = JSON.parse(await fs.readFile(path.join(indexed.dir, 'script.json')));
    const fn = report.functions.find(f => f.name === 'add');
    assert.ok(fn);
    assert.equal(report.calls.find(c => c.callee === 'add').bindingStart, fn.start);
    assert.equal(report.imports[0].source, './mod.js');
    assert.equal(report.urls[0].value, 'https://fixture.invalid/api');
    assert.match(await fs.readFile(path.join(indexed.dir, 'formatted.js'), 'utf8'), /TARGET_MUST_NOT_EXECUTE/);
    const mapPath = path.join(root, 'fixture.map');
    await fs.writeFile(mapPath, JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map: { version: 3, names: [], sources: ['original.ts'], mappings: 'AAAA' } }] }));
    const mapped = await wait(context, await script(context, { action: 'map', path: source, mapPath, line: 1, column: 0 }));
    assert.equal(mapped.state, 'succeeded');
    const mapping = JSON.parse(await fs.readFile(path.join(mapped.dir, 'script.json')));
    assert.equal(mapping.original.source, 'original.ts');
    await fs.writeFile(mapPath, JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 }, url: 'http://127.0.0.1/secret' }] }));
    const rejected = await wait(context, await script(context, { action: 'map', path: source, mapPath, line: 1, column: 0 }));
    assert.equal(rejected.state, 'failed');
    assert.match(rejected.error, /sections/);
  } finally { await context.close(); }
});

test('Native句柄隔离独立后端，同目标请求串行且拒绝外部句柄', async () => {
  const calls = []; let created = 0, active = 0, peak = 0;
  const pool = new NativeTargets(() => {
    const backendId = ++created;
    return { call: async (name, args) => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); calls.push({ backendId, name, args }); active--; return { structuredContent: { result: { path: args.path } } }; }, close: async () => {} };
  });
  const first = await pool.open('/fixture/one.so');
  const second = await pool.open('/fixture/two.so');
  assert.notEqual(first.targetId, second.targetId);
  await assert.rejects(pool.open('/fixture/three.so'), /最多/);
  await assert.rejects(pool.use('not-owned', () => {}), /本服务/);
  peak = 0;
  await Promise.all([1, 2].map(() => pool.use(first.targetId, e => e.backend.call('analyze_function', {}))));
  assert.equal(peak, 1);
  await pool.use(second.targetId, e => e.backend.call('list_procedures', {}));
  assert.deepEqual(calls.filter(c => c.name === 'analyze_function').map(c => c.backendId), [1, 1]);
  assert.equal(calls.find(c => c.name === 'list_procedures').backendId, 2);
  await pool.closeTarget(first.targetId);
  await assert.rejects(pool.use(first.targetId, () => {}), /本服务/);
  await pool.close();
});

test('可选CLI只用固定参数，退出0但无产物时拒绝成功', async () => {
  const { root, context } = await contextFor();
  const previous = process.env.ANDROID_RESERVE_GDRE;
  try {
    const engine = path.join(root, 'fake-gdre.mjs');
    const prefix = '#!/usr/bin/env node\nimport fs from "node:fs";import path from "node:path";const args=process.argv.slice(2);if(!args.includes("--headless"))process.exit(3);const out=args.find(a=>a.startsWith("--output="))?.slice(9);';
    await fs.writeFile(engine, prefix + 'if(out){fs.writeFileSync(path.join(out,"project.godot"),"config_version=5");fs.writeFileSync(path.join(out,"main.gd"),"extends Node");}\n');
    await fs.chmod(engine, 0o700); process.env.ANDROID_RESERVE_GDRE = engine;
    const input = path.join(root, 'fixture.pck'); await fs.writeFile(input, 'GDPCfixture');
    const analyzed = await wait(context, await framework(context, { action: 'analyze', engine: 'godot', path: input }));
    assert.equal(analyzed.state, 'succeeded');
    const result = JSON.parse(await fs.readFile(path.join(analyzed.dir, 'result.json')));
    assert.ok(result.files.some(f => f.path === 'main.gd'));
    await fs.writeFile(engine, prefix + 'if(out)fs.writeFileSync(path.join(out,"project.godot"),"config_version=5");\n');
    const configOnly = await wait(context, await framework(context, { action: 'analyze', engine: 'godot', path: input }));
    assert.equal(configOnly.state, 'failed'); assert.match(configOnly.error, /实际恢复/);
    await fs.writeFile(engine, '#!/usr/bin/env node\nprocess.exit(0);\n');
    const empty = await wait(context, await framework(context, { action: 'analyze', engine: 'godot', path: input }));
    assert.equal(empty.state, 'failed'); assert.match(empty.error, /未产出/);
  } finally {
    if (previous === undefined) delete process.env.ANDROID_RESERVE_GDRE; else process.env.ANDROID_RESERVE_GDRE = previous;
    await context.close();
  }
});

test('观测脚本的异步错误不能被后端成功信封掩盖，完整诊断留档', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'android-reserve-script-error-'));
  const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), backend: { call: async () => ({ structuredContent: { normalized_result: { messages: [{ type: 'error', description: 'fixture-script-error' }] } } }), close: async () => {} } });
  const sessionId = 'ce930f3b-9385-4ea8-b9ec-449d6d3f2aa3'; context.sessions.add(sessionId);
  try {
    const failed = await wait(context, await frida(context, { action: 'runtime', sessionId }));
    assert.equal(failed.state, 'failed'); assert.match(failed.error, /fixture-script-error/);
    assert.equal(failed.errorArtifact, 'error.json'); assert.ok((await fs.stat(path.join(failed.dir, 'error.json'))).size > 0);
  } finally { await context.close(); }
});
