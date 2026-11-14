import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebViews,pageSocket,webview } from '../src/core/webview.js';
import { createContext } from '../src/actions.js';
import { cdpFixture } from './cdp-fixture.js';

const wait=async(c,started)=>{for(let i=0;i<200;i++){const j=await c.jobs.get(started.id);if(!['queued','running'].includes(j.state))return{job:j,result:j.result?JSON.parse(await fs.readFile(path.join(j.dir,j.result))):null};await new Promise(r=>setTimeout(r,10));}throw new Error('任务超时');};
test('CDP目标限定本地页面路径，外部URL和歧义ID不被连接',()=>{
  assert.equal(pageSocket({id:'owned',webSocketDebuggerUrl:'ws://localhost/devtools/page/owned'},1234),'ws://127.0.0.1:1234/devtools/page/owned');
  for(const url of ['ws://external.invalid/devtools/page/owned','ws://localhost/devtools/browser/owned','ws://localhost/devtools/page/other','ws://u:p@localhost/devtools/page/owned'])assert.throws(()=>pageSocket({id:'owned',webSocketDebuggerUrl:url},1234));
});
test('WebView固定CDP操作真实走WebSocket，采集DOM/脚本/正文并遮蔽鉴权头，取消和关闭释放自己的forward',async()=>{
  const f=await cdpFixture(),root=await fs.mkdtemp(path.join(os.tmpdir(),'reserve-cdp-')),c=await createContext({allowedRoots:[root],workspace:path.join(root,'work'),disabled:true,adb:f.adb});
  try{
    const opened=await wait(c,await webview(c,{action:'open',serial:'owned-device',packageName:'dev.owned.app',pid:42}));assert.equal(opened.job.state,'succeeded',opened.job.error);const sessionId=opened.result.sessionId;
    for(const [action,extra,marker]of[['dom',{},'OWNED_DOM'],['source',{scriptId:'1'},'OWNED_SCRIPT'],['body',{requestId:'r'},'OWNED_BODY']]){const result=await wait(c,await webview(c,{action,sessionId,...extra}));assert.equal(result.job.state,'succeeded',result.job.error);assert.match(await fs.readFile(path.join(result.job.dir,result.result.artifact),'utf8'),new RegExp(marker));}
    const network=await wait(c,await webview(c,{action:'network',sessionId}));assert.equal(network.result.requests[0].headers.Authorization,'<redacted>');assert.equal(network.result.requests[0].response.headers['set-cookie'],'<redacted>');
    const controller=new AbortController(),entry=await c.webviews.use(sessionId);const pending=entry.cdp.call('Owned.neverReply',{},controller.signal);controller.abort();await assert.rejects(pending,/取消/);
    await c.webviews.close(sessionId);assert.equal(f.forward,false);assert.equal(c.webviews.entries.size,0);assert.ok(f.received.includes('Network.getResponseBody'));
  }finally{await c.close();await f.close();}
});
test('WebView进程代次变化会关闭会话，转发清理失败时保留句柄供重试',async()=>{
  const f=await cdpFixture(),manager=new WebViews(f.adb);
  try{
    const opened=await manager.open({serial:'owned-device',packageName:'dev.owned.app',pid:42});f.failRemove(true);
    await assert.rejects(manager.close(opened.sessionId),/cleanup/);assert.equal(manager.entries.size,1);f.failRemove(false);await manager.close(opened.sessionId);assert.equal(f.forward,false);
    const next=await manager.open({serial:'owned-device',packageName:'dev.owned.app',pid:42});f.restart();await assert.rejects(manager.use(next.sessionId),/重启/);assert.equal(f.forward,false);
  }finally{await manager.close();await f.close();}
});
test('WebView身份读取被取消不关闭会话，跨PID代次快照拒绝复用',async()=>{
  const f=await cdpFixture();let cancelRead=false,reads=0,race=false;
  const manager=new WebViews(async(serial,args,signal)=>{
    if(cancelRead&&args.join(' ').includes('/stat')){signal?.throwIfAborted();throw new Error('暂时ADB故障');}
    const result=await f.adb(serial,args,signal);
    if(race&&args.join(' ').includes('/stat')&&++reads===1)f.restart();
    return result;
  });
  try{
    const opened=await manager.open({serial:'owned-device',packageName:'dev.owned.app',pid:42});
    const controller=new AbortController();controller.abort();cancelRead=true;
    await assert.rejects(manager.use(opened.sessionId,controller.signal));assert.equal(manager.entries.size,1);assert.equal(f.forward,true);
    await assert.rejects(manager.use(opened.sessionId),/暂时ADB故障/);assert.equal(manager.entries.size,1);
    cancelRead=false;await manager.use(opened.sessionId);race=true;
    await assert.rejects(manager.use(opened.sessionId),/重启/);assert.equal(manager.entries.size,0);assert.equal(f.forward,false);
  }finally{await manager.close();await f.close();}
});
