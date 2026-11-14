// long: 仅分析自生成样本，真实调用本地静态工具和按需后端；不安装 APK 或连接设备。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './fixture.mjs';
import assert from 'node:assert/strict';
import { run, tool, checked } from '../src/core/process.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(),'android-reserve-smoke-'));
const sample = await fixture(root);
const client = new Client({ name:'android-reserve-smoke',version:'0.1.0' });
const transport = new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/cli.js',import.meta.url)),'--allowedRoots',root,'--workspace',path.join(root,'work')],stderr:'pipe'});
transport.stderr?.on('data',()=>{});
const results=[];
const readResult = async job => JSON.parse(await fs.readFile(path.join(root,'work/jobs',job.id,'result.json'),'utf8'));
async function call(name,args) {const r=await client.callTool({name,arguments:args});const v=JSON.parse(r.content[0].text);if(r.isError)throw new Error(JSON.stringify(v));return v;}
async function complete(name,args) {
  const started=Date.now();const initial=await call(name,args);let job;
  for(let i=0;i<1800;i++) {
    job=await call('jobs',{action:'status',jobId:initial.id});
    if(!['running','queued'].includes(job.state))break;
    await new Promise(r=>setTimeout(r,200));
  }
  results.push({name,action:args.action||args.engine,state:job.state,milliseconds:Date.now()-started,jobId:job.id});
  console.log(JSON.stringify(results.at(-1)));
  if(!['succeeded','partial'].includes(job.state))throw new Error(JSON.stringify(job));
  return job;
}
try {
  await client.connect(transport);
  await complete('apk',{action:'inspect',path:sample.apk});
  await complete('apk',{action:'manifest',path:sample.apk});
  const decoded=await complete('decode',{path:sample.apk,engine:'both'});
  await complete('search',{directory:path.join(root,'work/jobs',decoded.id,'java'),query:'hello'});
  await complete('native',{action:'elf',path:sample.elf});
  await complete('dex',{action:'classes',path:sample.apk,query:'Greeting'});
  await complete('dex',{action:'class',path:sample.apk,className:'dev.reserve.fixture.Greeting'});
  const method=await complete('dex',{action:'method',path:sample.apk,className:'dev.reserve.fixture.Greeting',methodName:'greet'});
  assert.match((await readResult(method)).structuredContent.normalized_result.source.text,/hello/);
  const mappingPath=path.join(root,'mapping.txt');
  await fs.writeFile(mappingPath,'original.Greeter -> dev.reserve.fixture.Greeting:\n    java.lang.String sayHello(java.lang.String) -> greet\n');
  const mapped=await complete('dex',{action:'method',path:sample.apk,className:'dev.reserve.fixture.Greeting',methodName:'greet',mappingPath});
  assert.match(JSON.stringify((await readResult(mapped)).structuredContent.normalized_result),/sayHello/);
  const xrefs=await complete('dex',{action:'references',path:sample.apk,className:'dev.reserve.fixture.Greeting',methodName:'greet'});
  assert.ok((await readResult(xrefs)).structuredContent.normalized_result.references.some(r=>r.containing_class==='dev.reserve.fixture.Caller'));
  await complete('resources',{path:sample.apk,limit:10});
  const jni=await complete('native',{action:'jni',path:sample.apk});
  assert.match(JSON.stringify((await readResult(jni)).structuredContent.normalized_result),/nativeGreet/);
  const built=await complete('rebuild',{action:'build',path:path.join(root,'work/jobs',decoded.id,'resources')});
  // long: 临时测试签名仅用于自有样本，不读取用户密钥，也不把密码带进命令行。
  process.env.RESERVE_FIXTURE_PASSWORD='fixture-only-password';
  checked(await run(await tool('keytool'),['-genkeypair','-keystore',path.join(root,'fixture.jks'),'-alias','fixture','-keyalg','RSA','-keysize','2048','-validity','1','-dname','CN=Reserve Fixture','-storepass:env','RESERVE_FIXTURE_PASSWORD','-keypass:env','RESERVE_FIXTURE_PASSWORD'],{env:process.env}),'生成临时测试签名');
  const unsigned=path.join(root,'work/jobs',built.id,'unsigned.apk');
  // long: MCP 子进程已启动，测试密码通过其启动环境单独传入，避免假定父进程后改 env 会自动同步。
  await client.close();
  const signTransport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/cli.js',import.meta.url)),'--allowedRoots',root,'--workspace',path.join(root,'work'),'--no-rea'],env:{...process.env},stderr:'pipe'});
  signTransport.stderr?.on('data',()=>{});
  await client.connect(signTransport);
  const signed=await complete('rebuild',{action:'sign',path:unsigned,keystore:path.join(root,'fixture.jks'),alias:'fixture',passwordEnv:'RESERVE_FIXTURE_PASSWORD'});
  await complete('apk',{action:'signature',path:path.join(root,'work/jobs',signed.id,'signed.apk')});
  const report={root,results,deviceAccessed:false,fridaInvoked:false};
  await fs.mkdir('output',{recursive:true});await fs.writeFile('output/smoke.json',JSON.stringify(report,null,2));
  console.log('静态真实依赖冒烟完成，证据 output/smoke.json');
} finally {await client.close();}
