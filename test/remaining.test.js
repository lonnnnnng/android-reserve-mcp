import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePackageSet } from '../src/core/packages.js';
import { indexEvidence } from '../src/core/evidence.js';
import { createContext, resources, script } from '../src/actions.js';
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

test('ClassLoader超出枚举预算或同类型字段读取失败时拒绝唯一选择并释放全部wrapper',()=>{
  for(const mode of ['partial','same-type-error']){
    const wrappers=Array.from({length:mode==='partial'?130:2},(_,id)=>({$className:'dalvik.system.DexClassLoader',id,$dispose(){this.disposals=(this.disposals||0)+1;}}));
    const Java={classFactory:{loader:'default'},use:()=>({}),cast(wrapper){if(mode==='same-type-error'&&wrapper.id===1)throw new Error('hidden paths');return{pathList:{value:{dexElements:{value:[{dexFile:{value:{mFileName:{value:'/owned/'+wrapper.id+'.dex'}}}}]}}},$dispose(){}};},enumerateClassLoaders(callbacks){wrappers.forEach(w=>callbacks.onMatch(w));callbacks.onComplete();},ClassFactory:class{}};
    let failure;withJavaFactory(Java,{traceId:'reject',loaderSelector:{type:'dalvik.system.DexClassLoader',dexPaths:['/owned/0.dex']}},()=>assert.fail('不完整或不可读loader必须fail closed'),error=>{failure=error;});
    assert.match(failure.message,mode==='partial'?/超预算/:/读取失败/);assert.equal(Java.classFactory.loader,'default');assert.ok(wrappers.every(w=>w.disposals===1),mode+'路径必须逐个释放wrapper');
  }
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

test('source map显式关联生成位置、原位置与map哈希，保留构建匹配未知状态',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reserve-map-evidence-')),bundle=path.join(root,'bundle.js'),mapPath=path.join(root,'bundle.map');
  await fs.writeFile(bundle,'const generated=1;');await fs.writeFile(mapPath,JSON.stringify({version:3,names:['originalFn'],sources:['src/original.ts'],mappings:'AAAAA'}));
  const context=await createContext({allowedRoots:[root],workspace:path.join(root,'work'),disabled:true});
  try{
    const started=await script(context,{action:'map',path:bundle,mapPath,line:1,column:0});let job;
    for(let i=0;i<100;i++){job=await context.jobs.get(started.id);if(!['queued','running'].includes(job.state))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(job.state,'succeeded',job.error);const report=JSON.parse(await fs.readFile(path.join(job.dir,'script.json'),'utf8'));
    const graph=JSON.parse(await fs.readFile(path.join(job.dir,'evidence.json'),'utf8'));
    assert.equal(report.map.sha256,createHash('sha256').update(await fs.readFile(mapPath)).digest('hex'));
    assert.ok(graph.nodes.some(n=>n.kind==='source-map'&&n.association==='caller-supplied-build-match-unverified'));
    assert.ok(graph.edges.some(e=>e.relation==='maps-to-original-position'&&e.strength==='caller-supplied-source-map'));
    assert.ok(graph.nodes.some(n=>n.kind==='source-location'&&n.coordinate==='source-map-original'&&n.source==='src/original.ts'));
  }finally{await context.close();}
});

test('容器成员与嵌套容器在证据图中保留inventory结构和内容哈希',()=>{
  const rootHash='1'.repeat(64),memberHash='2'.repeat(64),innerHash='3'.repeat(64);
  const inventory={entries:[{chain:[],bytes:8,sha256:rootHash,kind:'zip',status:'indexed'},{chain:['base.apk'],bytes:6,sha256:memberHash,kind:'zip',status:'indexed'},{chain:['base.apk','classes.dex'],bytes:6,sha256:innerHash,kind:'dex',status:'indexed'}],containers:[{chain:[],kind:'apks',entries:1,coverage:'directory-only'},{chain:['base.apk'],kind:'apk',entries:1,coverage:'directory-only'}]};
  const graph=indexEvidence('job',[{file:'inventory.json',value:inventory}]);
  assert.equal(graph.nodes.filter(n=>n.kind==='artifact-container').length,2);
  assert.equal(graph.nodes.filter(n=>n.kind==='container-member').length,3);
  assert.ok(graph.edges.some(e=>e.relation==='contains-nested-container'&&e.strength==='reported-container-layout'));
  assert.ok(graph.edges.some(e=>e.relation==='has-content'&&e.strength==='content-hash'));
});

test('View资源扫描提取onClick声明但不冒称DEX解析，拒绝DTD实体',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reserve-view-events-')),layout=path.join(root,'res/layout');await fs.mkdir(layout,{recursive:true});
  await fs.writeFile(path.join(layout,'screen.xml'),'<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools" tools:context=".MainActivity"><Button android:id="@+id/save" android:onClick="saveClicked"/><TextView android:id="@+id/label"/></LinearLayout>');
  const c=await createContext({allowedRoots:[root],workspace:path.join(root,'work'),disabled:true});
  try{
    const started=await resources(c,{action:'view-events',path:root,className:'demo.MainActivity'});let job;
    for(let i=0;i<100;i++){job=await c.jobs.get(started.id);if(!['queued','running'].includes(job.state))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(job.state,'succeeded',job.error);const report=JSON.parse(await fs.readFile(path.join(job.dir,'layout-events.json'),'utf8'));
    assert.equal(report.events.length,1);assert.equal(report.events[0].handler,'saveClicked');assert.equal(report.events[0].viewId,'@+id/save');assert.equal(report.events[0].candidateSignature,'demo.MainActivity#saveClicked(android.view.View)');assert.equal(report.events[0].resolution,'declaration-only-not-verified-in-dex');
    const graph=JSON.parse(await fs.readFile(path.join(job.dir,'evidence.json'),'utf8'));assert.ok(graph.nodes.some(n=>n.kind==='view-event-candidate'&&n.candidateSignature==='demo.MainActivity#saveClicked(android.view.View)'));assert.ok(graph.edges.some(e=>e.relation==='declares-view-handler'&&e.strength==='xml-declaration-candidate'));
  }finally{await c.close();}
  const malicious=path.join(layout,'malicious.xml');await fs.writeFile(malicious,'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>');
  const result=await run(await tool('python3'),['helpers/view-events.py',root]);assert.equal(result.code,0,result.stderr);const parsed=JSON.parse(result.stdout);assert.equal(parsed.events.length,1);assert.ok(parsed.warnings.some(w=>w.reason==='doctype-or-entity-blocked'));
});
