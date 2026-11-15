import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { methodIdentity, parseMethodId, parseDescriptor, runtimeSelector } from '../src/core/method-id.js';
import { parseMapping } from '../src/core/mapping.js';
import { exactSelector, projectDexReport, serializeDexReport } from '../src/core/dex-query.js';
import { dexInputSource, snapshotDexInputs } from '../src/core/dex-inputs.js';
import { indexEvidence } from '../src/core/evidence.js';
import { recordMetadataAttempt } from '../src/core/kotlin.js';

const version = '# {"id":"com.android.tools.r8.mapping","version":"2.2"}\n';

test('完整DEX身份包含返回类型，数组Frida选择保留内部名称', () => {
  const identity = parseMethodId('Lowned/Service;->load([I[[Ljava/lang/String;)Ljava/lang/Object;');
  assert.equal(identity.methodId, parseMethodId('owned.Service.load([I[[Ljava/lang/String;)Ljava/lang/Object;').methodId);
  assert.deepEqual(runtimeSelector(identity), { className: 'owned.Service', methodName: 'load', argumentTypes: ['[I', '[[Ljava.lang.String;'], returnType: 'java.lang.Object' });
  assert.notEqual(methodIdentity('a.A', 'f', '()I').methodId, methodIdentity('a.A', 'f', '()V').methodId);
  for (const descriptor of ['(V)V', '()[V', '(L/foo;)V', '(Lfoo//bar;)V', '(Ljava.lang.String;)V', '()Vextra']) assert.throws(() => parseDescriptor(descriptor));
});

test('一致的冗余完整选择可接受，冲突和overloadIndex不能静默忽略', () => {
  const methodId = 'La/A;->f()V';
  assert.equal(exactSelector({ methodId, descriptor: '()V' }).methodId, methodId);
  assert.throws(() => exactSelector({ methodId, descriptor: '()I' }), /冲突/);
  assert.throws(() => exactSelector({ methodId, className: 'a.Other' }), /冲突/);
  assert.throws(() => exactSelector({ className: 'a.A', methodName: 'f', overloadIndex: 1 }), /overloadIndex/);
  assert.throws(() => exactSelector({ methodId, definitionId: 'short' }), /SHA256/);
});

test('mapping按对象类别名、数组与完整返回类型恢复名称', () => {
  const mapping = parseMapping('com.app.Value -> b:\ncom.app.Service -> a:\n    com.app.Value load(com.app.Value[],int) -> x\n    int load(com.app.Value[],int) -> x\n');
  const result = mapping.resolve('a', 'x', '([Lb;I)Lb;');
  assert.equal(result.status, 'mapped'); assert.equal(result.originalSignature, 'com.app.Service.load(com.app.Value[],int):com.app.Value');
  assert.equal(result.originalDescriptor, '([Lcom/app/Value;I)Lcom/app/Value;');
  assert.equal(mapping.resolve('a', 'x', '([Lb;I)I').originalDescriptor, '([Lcom/app/Value;I)I');
  assert.deepEqual(mapping.rawClassesForQuery('com.app.Service'), ['a']);
});

test('内联组首条残留签名传给outermost，原始参数不被替换', () => {
  const mapping = parseMapping(version + 'A -> a:\n    1:1:void B.inner(int):10:10 -> b\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}\n    1:1:void outer(int):20 -> b\n');
  const result = mapping.resolve('a', 'b', '()V');
  assert.equal(result.status, 'mapped'); assert.equal(result.originalMethodName, 'outer'); assert.equal(result.originalDescriptor, '(I)V');
  assert.equal(result.inlinedFrames.length, 1); assert.equal(result.inlinedFrames[0].originalName, 'inner');
  assert.notEqual(mapping.resolve('a', 'b', '(I)V').status, 'mapped');
});

test('无法排除的类型别名冲突阻止唯一mapping', () => {
  const mapping = parseMapping('A -> a:\n    void m(X) -> b\n    void n(Y) -> b\nX -> x:\nX -> y:\nY -> x:\n');
  assert.equal(mapping.resolve('a', 'b', '(Lx;)V').status, 'unknown');
  assert.equal(mapping.resolve('a', 'b', '(Lx;)V').reason, 'type-alias-ambiguous');
});

test('synthesized名称保持展示用途，不能声称原输入程序中存在', () => {
  const method = parseMapping(version + 'A -> a:\n    void arbitraryOriginal() -> b\n    # {"id":"com.android.tools.r8.synthesized"}\n').resolve('a', 'b', '()V');
  assert.equal(method.status, 'synthesized'); assert.equal(method.originalMethodName, undefined);
  const mapping = parseMapping(version + 'A -> a: # {"id":"com.android.tools.r8.synthesized"}\n    void arbitrary() -> b\n');
  assert.equal(mapping.classMapping('a').status, 'synthesized'); assert.deepEqual(mapping.classMapping('a').originalClassNames, []);
});

test('mapping版本作用域和未来扩展明确降级，无版本不解释2.2扩展', () => {
  const unknown = parseMapping('# {"id":"com.android.tools.r8.mapping","version":"99.0"}\nA -> a:\n    void m(int) -> b\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}\n');
  assert.equal(unknown.partial, true); assert.equal(unknown.resolve('a', 'b', '()V').status, 'unknown');
  assert.ok(unknown.warnings.some(row => row.kind === 'unsupported-mapping-version'));
  const old = parseMapping('A -> a:\n    void m(int) -> b\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}\n');
  assert.notEqual(old.resolve('a', 'b', '()V').status, 'mapped'); assert.equal(old.resolve('a', 'b', '(I)V').status, 'mapped');
  const scoped = parseMapping(version + 'A -> a:\n    void m(int) -> b\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}\n# {"id":"com.android.tools.r8.mapping","version":"1.0"}\nB -> c:\n    void n(int) -> d\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}\n');
  assert.equal(scoped.resolve('a', 'b', '()V').status, 'mapped'); assert.notEqual(scoped.resolve('c', 'd', '()V').status, 'mapped');
});

test('重复行去重但冲突残留签名、类section与预算不能变成唯一结果', () => {
  const duplicate = parseMapping(version + 'A -> a:\n    1:1:void m(int):10:10 -> b\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}\n    2:2:void m(int):11:11 -> b\n');
  assert.equal(duplicate.resolve('a', 'b', '()V').status, 'mapped');
  const conflict = parseMapping(version + 'A -> a:\n    void m(int) -> b\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()V"}\n    void m(int) -> b\n    # {"id":"com.android.tools.r8.residualsignature","signature":"()I"}\n');
  assert.equal(conflict.resolve('a', 'b', '()V').status, 'ambiguous');
  assert.equal(parseMapping('A -> a:\nA -> a:\n').classMapping('a').status, 'ambiguous');
  const limited = parseMapping('A -> a:\n    void m() -> b\n    void n() -> c\n', { maximumRecords: 2 });
  assert.equal(limited.resolve('a', 'b', '()V').status, 'unknown');
  assert.throws(() => parseMapping('A -> a:\n', { maximumRecords: NaN }), /预算/);
});

test('生产多DEX mapping的重复raw类section保持歧义并隔离2.2残留签名', () => {
  const production = parseMapping(version +
    'com.prod.base.Service -> a.A:\n' +
    '    1:1:void dispatch(int):10:10 -> d\n' +
    '    # {"id":"com.android.tools.r8.residualsignature","signature":"(I)V"}\n' +
    '# {"id":"com.android.tools.r8.mapping","version":"2.2"}\n' +
    'com.prod.feature.Service -> a.A:\n' +
    '    1:1:void dispatch(int):20:20 -> d\n' +
    '    # {"id":"com.android.tools.r8.residualsignature","signature":"(I)V"}\n');
  assert.equal(production.classMapping('a.A').status, 'ambiguous');
  assert.equal(production.resolve('a.A', 'd', '(I)V').status, 'ambiguous');
  assert.equal(production.resolve('a.A', 'd', '()V').status, 'ambiguous');
});

test('最终投影字节预算覆盖扩大的重载参数，裁剪后唯一选择降为unknown', () => {
  const descriptor = '(' + 'I'.repeat(150) + ')V';
  const methods = Array.from({ length: 600 }, (_, index) => ({ ...methodIdentity('a.A', 'f' + index, descriptor), definitionId: index.toString() }));
  const report = projectDexReport({ action: 'method', classes: [], methods, references: [], resolution: { status: 'unique', matches: 1 }, sourceArtifact: 'class-source.java' });
  const serialized = serializeDexReport(report, 512 * 1024);
  assert.ok(Buffer.byteLength(serialized) <= 512 * 1024); assert.equal(report.partial, true);
  assert.equal(report.resolution.status, 'unknown'); assert.ok(report.projectionTruncation.methods > 0); assert.equal(report.sourceArtifact, undefined);
});

test('分包来源缺损身份和重选参数必须在复用前拒绝', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reserve-dex-source-'));
  const record = { path: path.join(dir, 'base.apk'), source: 'base.apk', manifest: { package: 'owned.app', version_code: '1', split: null }, signature: { verified: true, certificates: ['a'.repeat(64)] } };
  await fs.writeFile(path.join(dir, 'packages.json'), JSON.stringify({ validation: { valid: true }, records: [record] }));
  const context = { jobs: { get: async () => ({ id: 'job', state: 'succeeded', dir }) }, paths: { artifact: async (root, file) => path.join(root, file) } };
  await assert.rejects(dexInputSource(context, { packageJobId: 'job' }), /身份/);
  await assert.rejects(dexInputSource(context, { packageJobId: 'job', members: ['base.apk'] }), /members/);
  await assert.rejects(dexInputSource(context, { path: 'base.apk', packageJobId: 'job' }), /选择一项/);
});

test('分包已验证字节身份发生变化时不复用旧一致性结论', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reserve-dex-sha-')), original = path.join(dir, 'changed.apk'), out = path.join(dir, 'query');
  await fs.mkdir(out); await fs.writeFile(original, Buffer.from('PKowned'));
  const context = { paths: { artifact: async (root, file) => path.join(root, file) } };
  await assert.rejects(snapshotDexInputs(context, { jobDir: dir, records: [{ path: original, source: 'base.apk', sha256: 'a'.repeat(64), bytes: 7 }] }, out, new AbortController().signal), /SHA/);
});

test('静态引用保留两个定义候选和原始DEX位置，不生成运行因果边', () => {
  const origin = index => ({ inputSha256: 'a'.repeat(64), dexSha256: String(index + 1).repeat(64), dexEntry: 'classes' + index + '.dex', zipIndex: index, classIndex: 0, source: 'owned.apk', methodIndex: 0 });
  const definitions = [0, 1].map(index => ({ ...methodIdentity('a.A', 'f', '()I'), definitionId: String(index + 3).repeat(64), identity: origin(index) }));
  const sourceMethod = { ...methodIdentity('a.Caller', 'call', '()I'), definitionId: '5'.repeat(64), identity: origin(0) };
  const graph = indexEvidence('owned', [{ file: 'result.json', value: { kind: 'raw-dex-query', classes: 2, methods: 2, references: 1 } }, { file: 'dex.json', value: { kind: 'raw-dex-query', classes: [], methods: [], targetDefinitions: definitions, dexes: [origin(0), origin(1)], references: [{ sourceMethod, dexOffset: 4, offsetUnit: '16-bit-code-unit', opcode: 'invoke-static', dispatch: 'declared-reference-not-runtime-dispatch', target: { ...methodIdentity('a.A', 'f', '()I'), definitionCandidates: definitions.map(row => row.definitionId), definitionResolution: { status: 'ambiguous' } } }] } }]);
  assert.equal(graph.partial, false);
  assert.equal(graph.nodes.filter(row => row.kind === 'dex-method-definition').length, 3);
  assert.equal(graph.edges.filter(row => row.relation === 'has-static-definition-candidate').length, 2);
  assert.ok(graph.nodes.some(row => row.kind === 'dex-reference-site' && row.dexOffset === 4));
  assert.ok(graph.edges.every(row => row.source.file === 'dex.json' && typeof row.source.jsonPointer === 'string'));
  assert.equal(graph.nodes.filter(row => row.kind === 'runtime-call').length, 0);
});

test('同名字段按完整类型保留两个独立符号，不覆盖先前指令类型', () => {
  const identity = { inputSha256: 'a'.repeat(64), dexSha256: 'b'.repeat(64), dexEntry: 'classes.dex', zipIndex: 0, classIndex: 0, source: 'owned.apk' };
  const sourceMethod = { ...methodIdentity('a.Caller', 'f', '()V'), definitionId: 'c'.repeat(64), identity };
  const references = ['I', 'Ljava/lang/String;'].map((fieldType, dexOffset) => ({ sourceMethod, dexOffset, opcode: 'sget', offsetUnit: '16-bit-code-unit', target: { className: 'a.A', fieldName: 'same', fieldType, definitionResolution: { status: 'not-evaluated' } } }));
  const graph = indexEvidence('owned', [{ file: 'dex.json', value: { kind: 'raw-dex-query', classes: [], methods: [], dexes: [identity], references } }]);
  const symbols = graph.nodes.filter(row => row.kind === 'dex-field-symbol');
  assert.equal(symbols.length, 2); assert.equal(new Set(symbols.map(row => row.fieldType)).size, 2); assert.equal(graph.partial, false);
  assert.equal(new Set(graph.edges.filter(row => row.relation === 'references-declared-symbol').map(row => row.to)).size, 2);
});

test('后续metadata超时保留已完成汇总，取消仍传播任务取消语义', () => {
  const report = { classes: [{ className: 'owned.Completed' }], partial: false, warnings: [] }, origin = { dexEntry: 'classes2.dex', source: 'split.apk' };
  assert.equal(recordMetadataAttempt({ timedOut: true, code: null, stderr: '' }, report, origin), false);
  assert.equal(report.partial, true); assert.equal(report.classes[0].className, 'owned.Completed');
  assert.equal(report.metadataAttempts[0].state, 'timed-out'); assert.ok(report.warnings.some(row => row.kind === 'metadata-dex-timed-out'));
  assert.throws(() => recordMetadataAttempt({ canceled: true, code: null }, report, origin), /取消/);
});
