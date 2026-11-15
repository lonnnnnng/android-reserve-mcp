// long: 自有smali补充Java无法表达的返回类型重载；真实签名分包和Kotlin编译产物验证原始身份，不接触设备。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { createContext, dex, packages, evidence } from '../src/actions.js';
import { jadxEngine } from '../src/core/backend.js';
import { run, checked, tool } from '../src/core/process.js';

await fs.mkdir(path.resolve('output'), { recursive: true });
const root = await fs.mkdtemp(path.resolve('output/dex-owned-')), results = [], checks = [];
const exec = async (name, args) => checked(await run(await tool(name), args, { cwd: root, timeoutMs: 180000 }), name);
const engine = await jadxEngine(); if (!engine.checksumMatches) throw new Error('smali验收要求固定JAR的SHA通过');
await fixture(root);
const assembler = path.join(root, 'AssembleOwned.java');
await fs.writeFile(assembler, 'import com.android.tools.smali.smali.Smali;\nimport com.android.tools.smali.smali.SmaliOptions;\n/** @author long */\npublic class AssembleOwned {\n  public static void main(String[] args) throws Exception {\n    // long: 固定库以API28生成标准DEX并保留完整prototype，避免尚未覆盖的API36版本映射及Java返回类型重载限制。\n    SmaliOptions options = new SmaliOptions(); options.apiLevel = 28; options.jobs = 1; options.outputDexFile = args[1];\n    if (!Smali.assemble(options,args[0])) throw new IllegalStateException("自有smali组装失败");\n  }\n}\n');
await exec('javac', ['-encoding', 'UTF-8', '-cp', engine.path, '-d', root, assembler]);
for (const [index, value] of [[1, 101], [2, 202]]) {
  const source = path.join(root, 'smali-' + index); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'A.smali'), '.class public La/A;\n.super Ljava/lang/Object;\n.method public static f()I\n .locals 1\n const/16 v0, ' + value + '\n return v0\n.end method\n.method public static f()Ljava/lang/String;\n .locals 1\n const-string v0, "owned-' + value + '"\n return-object v0\n.end method\n.method public static arrays([I[[Ljava/lang/String;)[I\n .locals 0\n return-object p0\n.end method\n.method public static caller()I\n .locals 1\n invoke-static {}, La/A;->f()I\n move-result v0\n return v0\n.end method\n');
  await exec('java', ['-cp', root + path.delimiter + engine.path, 'AssembleOwned', source, path.join(root, 'owned-' + index + '.dex')]);
}
const mappingPath = path.join(root, 'mapping.txt');
await fs.writeFile(mappingPath, 'original.Example -> a.A:\n    int selected() -> f\n    java.lang.String selectedText() -> f\n    int[] arrays(int[],java.lang.String[][]) -> arrays\n    int invokeSelected() -> caller\noriginal.Counter -> owned.Owned:\n    int increment(int,int) -> add\n');
await exec('python3', ['-c', 'import zipfile\nwith zipfile.ZipFile("duplicates.apk","w") as z:\n z.write("owned-1.dex","classes.dex")\n z.write("owned-2.dex","classes2.dex")\nwith zipfile.ZipFile("duplicate-name.apk","w") as z:\n z.write("owned-1.dex","classes.dex")\n z.write("owned-2.dex","classes.dex")']);
const kotlinLatest = JSON.parse(await fs.readFile(path.resolve('output/kotlin-latest-report.json'), 'utf8'));
const kotlinDex = path.join(kotlinLatest.root, 'dex/classes.dex'); await fs.access(kotlinDex);
const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk'), android = path.join(sdk, 'platforms/android-36/android.jar');
await fs.copyFile(path.join(root, 'fixture.apk'), path.join(root, 'base-unsigned.apk'));
await fs.writeFile(path.join(root, 'feature.xml'), '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.reserve.fixture" android:versionCode="1" android:versionName="1.0" split="feature.owned" android:isFeatureSplit="true"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="28"/><application android:hasCode="true"/></manifest>');
await exec('aapt2', ['link', '-o', 'feature-unsigned.apk', '--manifest', 'feature.xml', '-I', android, 'compiled.zip']);
await exec('python3', ['-c', 'import zipfile,sys\nwith zipfile.ZipFile("base-unsigned.apk","a") as z:\n z.write("owned-1.dex","classes2.dex")\n z.write(sys.argv[1],"classes3.dex")\nwith zipfile.ZipFile("feature-unsigned.apk","a") as z:\n z.write("owned-2.dex","classes.dex")\n z.write(sys.argv[1],"classes2.dex")', kotlinDex]);
process.env.RESERVE_DEX_FIXTURE_PASSWORD = 'owned-dex-fixture';
await exec('keytool', ['-genkeypair', '-keystore', 'owned.jks', '-alias', 'owned', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '365', '-dname', 'CN=Owned DEX Fixture', '-storepass:env', 'RESERVE_DEX_FIXTURE_PASSWORD', '-keypass:env', 'RESERVE_DEX_FIXTURE_PASSWORD']);
await fs.mkdir(path.join(root, 'selected'));
for (const name of ['base', 'feature']) {
  await exec('zipalign', ['-p', '4', name + '-unsigned.apk', name + '-aligned.apk']);
  await exec('apksigner', ['sign', '--ks', 'owned.jks', '--ks-key-alias', 'owned', '--ks-pass', 'env:RESERVE_DEX_FIXTURE_PASSWORD', '--out', 'selected/' + name + '.apk', name + '-aligned.apk']);
}
await exec('python3', ['-c', 'import zipfile\nwith zipfile.ZipFile("owned.apks","w") as z:\n z.write("selected/base.apk","base.apk")\n z.write("selected/feature.apk","feature.apk")']);
const context = await createContext({ allowedRoots: [root, kotlinLatest.root], workspace: path.join(root, 'work'), disabled: true });
async function complete(operation, allowed = ['succeeded']) {
  const initial = await operation;
  for (let count = 0; count < 2400; count++) {
    const job = await context.jobs.get(initial.id);
    if (!['queued', 'running'].includes(job.state)) {
      results.push(context.jobs.summary(job)); assert.ok(allowed.includes(job.state), job.error || job.state);
      return { job, report: JSON.parse(await fs.readFile(path.join(job.dir, 'result.json'), 'utf8')) };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('自有DEX验收任务超时');
}
async function query(args, allowed) { const result = await complete(dex(context, args), allowed); result.report = JSON.parse(await fs.readFile(path.join(result.job.dir, result.report.report), 'utf8')); return result; }
try {
  const one = await query({ action: 'method', path: path.join(root, 'owned-1.dex'), methodId: 'La/A;->f()I', mappingPath, includeSource: true });
  assert.equal(one.report.methods.length, 1); assert.equal(one.report.methods[0].mapping.originalMethodName, 'selected'); assert.equal(one.report.resolution.status, 'unique');
  const arrays = await query({ action: 'method', path: path.join(root, 'owned-1.dex'), methodId: 'La/A;->arrays([I[[Ljava/lang/String;)[I' });
  assert.deepEqual(arrays.report.methods[0].runtimeSelector.argumentTypes, ['[I', '[[Ljava.lang.String;']);
  checks.push('完整prototype含返回类型及数组重载');
  const duplicate = await query({ action: 'method', path: path.join(root, 'duplicates.apk'), methodId: 'La/A;->f()I', mappingPath }, ['partial']);
  assert.equal(duplicate.report.methods.length, 2); assert.equal(duplicate.report.resolution.status, 'ambiguous');
  assert.notEqual(duplicate.report.methods[0].definitionId, duplicate.report.methods[1].definitionId);
  const second = duplicate.report.methods.find(row => row.identity.dexEntry === 'classes2.dex');
  const selected = await query({ action: 'method', path: path.join(root, 'duplicates.apk'), methodId: 'La/A;->f()I', definitionId: second.definitionId, includeSource: true });
  assert.equal(selected.report.resolution.status, 'unique'); assert.equal(selected.report.sourceIdentity.dexEntry, 'classes2.dex');
  assert.match(await fs.readFile(path.join(selected.job.dir, selected.report.sourceArtifact), 'utf8'), /202/);
  checks.push('重复DEX定义和definitionId源码来源');
  const references = await query({ action: 'references', path: path.join(root, 'duplicates.apk'), methodId: 'La/A;->f()I', definitionId: second.definitionId, mappingPath });
  assert.equal(references.report.resolution.status, 'unique'); assert.equal(references.report.references.length, 2);
  assert.ok(references.report.references.every(row => row.target.definitionResolution.status === 'ambiguous' && row.target.definitionCandidates.length === 2 && row.target.mapping.originalMethodName === 'selected'));
  const graph = JSON.parse(await fs.readFile(path.join(references.job.dir, 'evidence.json'), 'utf8'));
  assert.ok(graph.nodes.some(row => row.kind === 'dex-reference-site')); assert.ok(graph.edges.some(row => row.relation === 'has-static-definition-candidate'));
  assert.equal(graph.nodes.filter(row => row.kind === 'runtime-call').length, 0);
  checks.push('references保留符号定义歧义和证据定位');
  const duplicateName = await query({ action: 'method', path: path.join(root, 'duplicate-name.apk'), methodId: 'La/A;->f()I' }, ['partial']);
  assert.equal(duplicateName.report.resolution.status, 'unknown'); assert.ok(duplicateName.report.warnings.some(value => value.includes('重复DEX成员')));
  checks.push('重复ZIP DEX成员拒绝猜选');
  const packageSet = await complete(packages(context, { action: 'validate', path: path.join(root, 'owned.apks'), members: ['base.apk', 'feature.apk'] }));
  assert.equal(packageSet.report.validation.valid, true);
  const classes = await query({ action: 'classes', packageJobId: packageSet.job.id, mappingPath, query: 'original.Example' });
  assert.equal(classes.report.classes.length, 2); assert.ok(classes.report.classes.every(row => row.className === 'a.A'));
  const split = await query({ action: 'method', packageJobId: packageSet.job.id, methodId: 'La/A;->f()I' }, ['partial']);
  assert.equal(split.report.methods.length, 2); assert.equal(new Set(split.report.methods.map(row => row.identity.inputSha256)).size, 2);
  checks.push('真实签名APKS快照复用、原名查询和跨split身份');
  const kotlinOne = await query({ action: 'kotlin', path: kotlinDex, query: 'original.Counter', mappingPath });
  const addOne = kotlinOne.report.classes[0].functions.find(row => row.name === 'add');
  assert.equal(addOne.exactDexMatch, true); assert.equal(addOne.mapping.originalMethodName, 'increment');
  const kotlinSet = await query({ action: 'kotlin', packageJobId: packageSet.job.id, query: 'original.Counter', mappingPath });
  assert.equal(kotlinSet.report.classes.length, 2); assert.ok(kotlinSet.report.classes.every(row => row.definitionResolution === 'ambiguous'));
  assert.ok(kotlinSet.report.classes.flatMap(row => row.functions).filter(row => row.name === 'add').every(row => !row.exactDexMatch && row.definitionResolution === 'ambiguous-class' && row.mapping.originalMethodName === 'increment'));
  checks.push('Kotlin原名贯通与重复分包metadata不误报精确匹配');
  const merged = await complete(evidence(context, { action: 'merge', jobIds: [references.job.id, kotlinSet.job.id] }));
  const evidenceQuery = await evidence(context, { action: 'query', graphJobId: merged.job.id, kind: 'mapped-method-name', query: 'increment' });
  assert.ok(evidenceQuery.nodes.length); checks.push('跨任务静态证据合并和原名查询');
  console.log(JSON.stringify({ root, checks, passed: true, deviceAccessed: false }, null, 2));
} finally {
  const closed = await context.close();
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ root, results, checks, closed, deviceAccessed: false }, null, 2));
  await fs.writeFile(path.resolve('output/dex-latest-report.json'), JSON.stringify({ root, results, checks, closed, deviceAccessed: false }, null, 2));
}
