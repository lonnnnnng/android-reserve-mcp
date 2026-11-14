import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePackageSet } from '../src/core/packages.js';
import { indexEvidence } from '../src/core/evidence.js';
import { withJavaFactory } from '../helpers/java-loaders.js';
import { run, tool } from '../src/core/process.js';

const member = (split, options={}) => ({ source:split||'base',manifest:{package:'dev.owned.app',version_code:'7',version_code_major:'1',split,is_feature_split:!!split,uses_splits:[],...options},signature:{verified:true,certificates:['a'.repeat(64)]} });
test('分包校验同时覆盖长版本/全部证书/缺base/依赖环，不把设备完整性当一致性',()=>{
  const valid=validatePackageSet([member(null),member('feature'),member('config.en',{is_feature_split:false,config_for_split:'feature'})]);assert.equal(valid.valid,true);assert.equal(valid.deviceCompleteness,'not-evaluated');
  assert.equal(validatePackageSet([member('feature')]).valid,false);
  assert.equal(validatePackageSet([member(null),member('feature',{version_code_major:'2'})]).valid,false);
  const bad=member('feature');bad.signature.certificates.push('b'.repeat(64));assert.equal(validatePackageSet([member(null),bad]).valid,false);
  assert.match(validatePackageSet([member(null),member('a',{uses_splits:['b']}),member('b',{uses_splits:['a']})]).errors.join(),/环/);
  assert.match(validatePackageSet([member(null),member('config.x',{config_for_split:'missing'})]).errors.join(),/configForSplit/);
});

test('APKS必须明确成员选择，拒绝路径穿越/重复项而不按归档路径写文件',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reserve-packages-')), archive=path.join(root,'a.apks');
  await run(await tool('python3'),['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr("../bad.apk",b"apk")\n z.writestr("base.apk",b"apk")',archive]);
  const invoke=async(members,dir)=>run(await tool('python3'),['helpers/package-set.py',archive,path.join(root,dir),JSON.stringify(members)]);
  assert.equal(JSON.parse((await invoke([],'inspect')).stdout).requiresSelection,true);
  assert.notEqual((await invoke(['../bad.apk'],'bad')).code,0);assert.notEqual((await invoke(['base.apk','base.apk'],'duplicate')).code,0);
  const good=JSON.parse((await invoke(['base.apk'],'good')).stdout);assert.equal(good.records[0].source,'base.apk');assert.match(good.records[0].sha256,/^[a-f0-9]{64}$/);
});

test('证据不按PID/调用ID跨脚本合并，内容相同产物按SHA关联且保留定位',()=>{
  const base={session_id:'session',device_id:'device',pid:42,messages:[{script_id:'a',payload:{event:'java-enter',pid:42,traceId:'trace',sequence:1,invocationId:'same'}} ,{script_id:'b',payload:{event:'native-call',pid:42,traceId:'trace',sequence:1,javaInvocationId:'same'}}]};
  const graph=indexEvidence('job',[{file:'result.json',value:base},{file:'kotlin.json',artifactHash:'a'.repeat(64),value:{className:'Owned',functions:[{jvmSignature:'run()I',exactDexMatch:true}]}}]);
  assert.equal(graph.nodes.filter(n=>n.kind==='runtime-call').length,2);assert.ok(graph.edges.every(e=>e.source.file&&e.source.jsonPointer!==undefined));
  assert.ok(graph.edges.some(e=>e.relation==='metadata-signature-matches-dex'));assert.ok(graph.nodes.some(n=>n.kind==='artifact'&&n.sha256==='a'.repeat(64)));
});

test('loader selector必须唯一且不调用未知toString，不修改默认factory',()=>{
  const disposed=[], wrappers=[1,2].map(i=>({$className:'dalvik.system.DexClassLoader',id:i,toString(){throw new Error('MUST_NOT_CALL');},$dispose(){disposed.push(i);}}));
  const Java={classFactory:{loader:'default'},use:()=>({}),cast:wrapper=>({pathList:{value:{dexElements:{value:[{dexFile:{value:{mFileName:{value:wrapper.id===1?'/owned/first.dex':'/owned/second.dex'}}}}]}}},$dispose(){}}),enumerateClassLoaders(callbacks){wrappers.forEach(w=>callbacks.onMatch(w));callbacks.onComplete();},ClassFactory:class{}};
  let factory,release;withJavaFactory(Java,{traceId:'t',loaderSelector:{type:'dalvik.system.DexClassLoader',dexPaths:['/owned/second.dex']}},(f,l,r)=>{factory=f;release=r;},e=>{throw e;});
  assert.equal(factory.loader,wrappers[1]);assert.equal(Java.classFactory.loader,'default');assert.deepEqual(disposed,[1]);release();assert.deepEqual(disposed,[1,2]);
  Java.cast=()=>({pathList:{value:{dexElements:{value:[]}}},$dispose(){}});let failure;
  withJavaFactory(Java,{traceId:'t',loaderSelector:{type:'dalvik.system.DexClassLoader',dexPaths:[]}},()=>assert.fail('必须拒绝不唯一匹配'),e=>{failure=e;});assert.match(failure.message,/当前2/);
});

test('证据图保留直接函数绑定位置与上游partial，统一哈希大小写',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reserve-lexical-')),source=path.join(root,'owned.js'),report=path.join(root,'script.json');
  await fs.writeFile(source,'const direct = () => 7; direct(); let changed = () => 8; changed = other; changed();');
  const result=await run(process.execPath,['helpers/script.mjs','index',source,report]);assert.equal(result.code,0,result.stderr);
  const parsed=JSON.parse(await fs.readFile(report,'utf8'));
  const graph=indexEvidence('owned',[{file:'script.json',artifactHash:parsed.input.sha256.toUpperCase(),value:{...parsed,partial:true}}]);
  assert.equal(graph.partial,true);assert.equal(graph.nodes.filter(n=>n.kind==='artifact').length,1);
  const calls=graph.nodes.filter(n=>n.kind==='js-callsite');assert.equal(calls.length,1);assert.equal(calls[0].callee,'direct');assert.equal(calls[0].location.line,1);
});

test('外部bundletool运行前拒绝高压缩比和展开超额容器',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reserve-preflight-')),file=path.join(root,'oversized.apks');
  const generated=await run(await tool('python3'),['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:z.writestr("base.apk",b"0"*(2*1024*1024))',file]);assert.equal(generated.code,0);
  const result=await run(await tool('python3'),['helpers/package-set.py',file,path.join(root,'snapshot.apks'),'preflight']);assert.notEqual(result.code,0);assert.match(result.stderr,/预算/);
  const safe=path.join(root,'safe.apks');await run(await tool('python3'),['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.writestr("base.apk",b"owned")',safe]);
  const prepared=await run(await tool('python3'),['helpers/package-set.py',safe,path.join(root,'safe-snapshot.apks'),'preflight']);assert.equal(prepared.code,0,prepared.stderr);
  assert.equal(JSON.parse(prepared.stdout).sha256,createHash('sha256').update(await fs.readFile(safe)).digest('hex'));
});
