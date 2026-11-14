// long: 只有显式serial才接触设备；安装/启停的包固定为本项目自有测试App，不选择其他应用。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { run, tool, checked } from '../src/core/process.js';
import { fixtureApp, packageName } from './fixture-app.mjs';

const serial=process.argv[2];
if(!serial||!/^[A-Za-z0-9._:-]+$/.test(serial)||serial.startsWith('-'))throw new Error('必须显式提供测试设备serial');
const root=path.resolve('output/device-smoke');await fs.mkdir(root,{recursive:true});
const apk=await fixtureApp(root);
const adb=async args=>checked(await run(await tool('adb'),['-s',serial,...args],{timeoutMs:60000}),'自有测试App设备操作');
await adb(['get-state']);
await adb(['install','-r',apk]);
const workspace=path.join(root,'work');
const client=new Client({name:'device-smoke',version:'0.2.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/cli.js',import.meta.url)),'--allowedRoots',root,'--workspace',workspace],stderr:'pipe'});
transport.stderr?.on('data',()=>{});
const results=[];
async function complete(args){
 const response=await client.callTool({name:'frida',arguments:args});if(response.isError)throw new Error(JSON.stringify(response.content));const initial=JSON.parse(response.content[0].text);
 for(let i=0;i<600;i++){
  const status=await client.callTool({name:'jobs',arguments:{action:'status',jobId:initial.id}});const job=JSON.parse(status.content[0].text);
  if(!['running','queued'].includes(job.state)){results.push({action:args.action,...job});console.log(JSON.stringify(results.at(-1)));assert.equal(job.state,'succeeded',job.error);return JSON.parse(await fs.readFile(path.join(workspace,'jobs',job.id,'result.json')));}
  await new Promise(r=>setTimeout(r,100));
 }
 throw new Error('Frida测试未结束');
}
const unpack=r=>r.structuredContent||JSON.parse(r.content[0].text);
async function observe(sessionId){
 await complete({action:'runtime',sessionId});
 await complete({action:'trace-native',sessionId,moduleName:'libfixture.so',symbolName:'Java_dev_androidreserve_fixture_MainActivity_nativeAdd',argumentOffset:2,argumentCount:2,maxEvents:8,captureStack:true});
}
function payloads(value,out=[]){if(value&&typeof value==='object'){if(value.event==='native-call')out.push(value);for(const child of Object.values(value))payloads(child,out);}return out;}
try{
 await client.connect(transport);
 await adb(['shell','am','start','-W','-n',packageName+'/.MainActivity']);
 const pid=Number((await adb(['shell','pidof',packageName])).stdout.trim());assert.ok(Number.isSafeInteger(pid)&&pid>0);
 let started=unpack(await complete({action:'attach',deviceId:serial,pid}));let sessionId=started.session_id;
 await observe(sessionId);await new Promise(r=>setTimeout(r,1800));
 const attached=await complete({action:'status',sessionId});
 const events=payloads(unpack(attached));assert.ok(events.some(e=>e.arguments[0].int32===2&&e.arguments[1].int32===7&&e.returnValue.int32===9),'未捕获JNI参数和返回值');
 await complete({action:'close',sessionId});
 await adb(['shell','am','force-stop',packageName]);
 started=unpack(await complete({action:'spawn',deviceId:serial,packageName}));sessionId=started.session_id;
 await observe(sessionId);await complete({action:'resume',sessionId});await new Promise(r=>setTimeout(r,1800));
 const spawned=await complete({action:'status',sessionId});assert.ok(payloads(unpack(spawned)).some(e=>e.returnValue.int32===9),'spawn/resume未捕获JNI调用');
 await complete({action:'close',sessionId});
}finally{
 await client.close();await adb(['shell','am','force-stop',packageName]);
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify({serial,packageName,results},null,2));
}
