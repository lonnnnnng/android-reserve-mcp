// long: 只对显式授权的自有App做DCL/WebView验收；页面由自有WebView拦截器提供，不依赖TCP网络或reverse。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as actions from '../src/actions.js';
import { run, tool, checked } from '../src/core/process.js';
import { fixtureApp, packageName } from './fixture-app.mjs';

const serial=process.argv[2];
if(!serial||!/^[A-Za-z0-9._:-]+$/.test(serial)||serial.startsWith('-'))throw new Error('必须显式指定已授权serial');
const root=path.resolve('output/device-smoke'), nonce=randomUUID(), results=[],captured=[];
await fs.mkdir(root,{recursive:true});
const source=`const OWNED_SCRIPT_V05=${JSON.stringify(nonce)}; function ownedTick(){document.body.dataset.bridge=String(ownedBridge.ping(7));fetch('/api.json',{headers:{Authorization:'owned-fixture-only'}}).then(r=>r.json()).then(v=>document.body.dataset.marker=v.marker);fetch('/blob.bin').then(r=>r.arrayBuffer());} setInterval(ownedTick,500); ownedTick();`;
const blob=Buffer.from([0,1,2,127,128,255]);
const adb=async args=>checked(await run(await tool('adb'),['-s',serial,...args],{timeoutMs:90000}),'自有混合样本设备操作');
const context=await actions.createContext({allowedRoots:[root],workspace:path.join(root,'hybrid-work-'+nonce)});
let installed=false,passed=false;
const unpack=value=>value?.content?value.structuredContent||JSON.parse(value.content[0].text):value;
const normal=value=>{value=unpack(value);return value.normalized_result||value;};
function events(value,list=[]){if(value&&typeof value==='object'){if(value.payload?.event)list.push(value.payload);for(const child of Object.values(value))events(child,list);}return list;}
async function complete(name,args,expectedError){const start=await actions[name](context,args);if(!start.id)return {result:start};for(let i=0;i<2400;i++){const job=await context.jobs.get(start.id);if(!['queued','running'].includes(job.state)){results.push({tool:name,action:args.action,id:job.id,state:job.state,error:job.error});if(expectedError&&job.state==='failed'){assert.match(job.error,expectedError);results.at(-1).expectedRejection=true;console.log(JSON.stringify(results.at(-1)));return{job};}console.log(JSON.stringify(results.at(-1)));assert.equal(job.state,'succeeded',job.error);return {job,result:JSON.parse(await fs.readFile(path.join(job.dir,'result.json'),'utf8'))};}await new Promise(r=>setTimeout(r,100));}throw new Error('验收任务超时');}
async function until(sessionId,scriptId,predicate){const seen=[];for(let i=0;i<40;i++){const {result}=await complete('frida',{action:'status',sessionId});const messages=normal(result).messages||[];const rows=events(messages.filter(m=>m.script_id===scriptId));seen.push(...rows);captured.push(...rows);const error=seen.find(e=>e.event.endsWith('-error')||e.event.endsWith('-timeout'));if(error)throw new Error(JSON.stringify(error));if(predicate(seen))return seen;await new Promise(r=>setTimeout(r,400));}throw new Error('未获得当前脚本预期事件');}
const scriptId=r=>normal(r).script_id;
try{
  await adb(['get-state']);const model=(await adb(['shell','getprop','ro.product.model'])).stdout.trim();
  console.log(JSON.stringify({serial,model,nonce}));
  const apk=await fixtureApp(root,{customLoader:true,webviewAssets:{mainJs:source,api:JSON.stringify({marker:'OWNED_NETWORK_V05',nonce}),binary:blob}});await adb(['install','-r',apk]);installed=true;
  await adb(['shell','am','start','-W','-n',packageName+'/.MainActivity']);
  const pid=Number((await adb(['shell','pidof',packageName])).stdout.trim());assert.ok(Number.isSafeInteger(pid)&&pid>0);
  const discovered=await complete('webview',{action:'discover',serial,packageName,rootRead:true});assert.ok(discovered.result.targets.some(t=>t.pid===pid));
  const opened=await complete('webview',{action:'open',serial,packageName,pid,rootRead:true}),webSession=opened.result.sessionId;
  const dom=await complete('webview',{action:'dom',sessionId:webSession}),html=await fs.readFile(path.join(dom.job.dir,dom.result.artifact),'utf8');
  assert.match(html,/RESERVE_WEBVIEW_V05/,html.slice(-2000));assert.match(html,/data-bridge="90"/);
  const attached=await complete('frida',{action:'attach',deviceId:serial,pid}),sessionId=normal(attached.result).session_id;
  const enumeration=await complete('frida',{action:'java-loaders',sessionId});const loaderEvents=await until(sessionId,scriptId(enumeration.result),list=>list.some(e=>e.event==='java-loaders'));
  const selected=loaderEvents.find(e=>e.event==='java-loaders').records.filter(r=>r.type==='dalvik.system.DexClassLoader'&&r.dexPaths.some(p=>p.includes('reserve-loader-')));assert.equal(selected.length,1);const loaderSelector=selected[0].selector;
  await complete('frida',{action:'unload',sessionId,scriptId:scriptId(enumeration.result)});
  const methods=await complete('frida',{action:'java-methods',sessionId,loaderSelector,className:'owned.dynamic.DexOwned',methodName:'compute'});
  await until(sessionId,scriptId(methods.result),rows=>rows.some(e=>e.event==='java-methods'&&e.overloads.some(o=>o.argumentTypes.join(',')==='int,int')));
  await complete('frida',{action:'unload',sessionId,scriptId:scriptId(methods.result)});
  // long: 子loader的父委派能够找到主类，但它不定义主类；必须明确拒绝而不是把委派成功当selector有效。
  const rejectionPattern=/其他loader|父委派/;
  let rejection=await complete('frida',{action:'java-methods',sessionId,loaderSelector,className:packageName+'.MainActivity',methodName:'compute'},rejectionPattern);
  for(let i=0;i<30&&rejection.job.state!=='failed';i++){await new Promise(r=>setTimeout(r,200));rejection=await complete('frida',{action:'status',sessionId},rejectionPattern);}
  assert.equal(rejection.job.state,'failed','必须拒绝父loader定义类');assert.equal(context.javaObservers.has(sessionId),false,'晚到失败必须释放占位');
  const trace=await complete('frida',{action:'trace-java',sessionId,loaderSelector,className:'owned.dynamic.DexOwned',methodName:'compute',argumentTypes:['int','int'],returnType:'int',maxEvents:10});
  await until(sessionId,scriptId(trace.result),rows=>rows.some(e=>e.event==='java-exit'&&e.returnValue?.value===80));
  await complete('frida',{action:'unload',sessionId,scriptId:scriptId(trace.result)});
  const bridge=await complete('frida',{action:'trace-java',sessionId,className:packageName+'.MainActivity$OwnedBridge',methodName:'ping',argumentTypes:['int'],returnType:'int',maxEvents:10});
  await until(sessionId,scriptId(bridge.result),rows=>rows.some(e=>e.event==='java-exit'&&e.returnValue?.value===90));
  await complete('frida',{action:'unload',sessionId,scriptId:scriptId(bridge.result)});await complete('frida',{action:'close',sessionId});
  const scripts=await complete('webview',{action:'scripts',sessionId:webSession}),main=scripts.result.scripts.find(s=>s.url.endsWith('/main.js'));assert.ok(main,'必须观察真实页面main.js');
  const js=await complete('webview',{action:'source',sessionId:webSession,scriptId:main.scriptId});assert.equal(await fs.readFile(path.join(js.job.dir,js.result.artifact),'utf8'),source);
  let network;
  for(let i=0;i<30;i++){network=await complete('webview',{action:'network',sessionId:webSession});if(['/api.json','/blob.bin'].every(suffix=>network.result.requests.some(r=>r.url.endsWith(suffix)&&r.finished)))break;await new Promise(r=>setTimeout(r,300));}
  for(const suffix of ['/api.json','/blob.bin']){const req=network.result.requests.find(r=>r.url.endsWith(suffix)&&r.finished);assert.ok(req,suffix);if(suffix==='/api.json')assert.equal(req.headers.Authorization,'<redacted>');const body=await complete('webview',{action:'body',sessionId:webSession,requestId:req.requestId});const bytes=await fs.readFile(path.join(body.job.dir,body.result.artifact));if(suffix==='/api.json')assert.equal(JSON.parse(bytes).nonce,nonce);else assert.deepEqual(bytes,blob);}
  const indexed=await complete('script',{action:'index',path:path.join(js.job.dir,js.result.artifact)});
  const merged=await complete('evidence',{action:'merge',jobIds:[js.job.id,indexed.job.id]});const query=await complete('evidence',{action:'query',graphJobId:merged.job.id,kind:'artifact',query:js.result.sha256});assert.equal(query.result.nodes.length,1);const captureQuery=await complete('evidence',{action:'query',graphJobId:merged.job.id,kind:'webview-capture'});assert.equal(captureQuery.result.nodes.length,1);
  await complete('webview',{action:'close',sessionId:webSession});passed=true;
  console.log('自定义DexClassLoader方法80、真实JS桥接90、WebView DOM/源码/JSON/二进制、鉴权头遮蔽、同内容证据关联通过');
}finally{
  try{await context.close();}finally{
    if(installed)await adb(['shell','am','force-stop',packageName]);
    const report=path.join(root,'hybrid-report-'+nonce+'.json');await fs.writeFile(report,JSON.stringify({passed,serial,packageName,nonce,results,captured},null,2));await fs.writeFile(path.resolve('output/hybrid-latest-report.json'),JSON.stringify({report},null,2));
  }
}
