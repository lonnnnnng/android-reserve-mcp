// long: 只编译自有JS生成HBC，不执行目标；实际调用已安装的反汇编器并断言函数名。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, framework, artifact } from '../src/actions.js';
import { run, checked } from '../src/core/process.js';

const root=path.resolve('output/framework-smoke');await fs.mkdir(root,{recursive:true});
const compiler=process.env.ANDROID_RESERVE_HERMESC || path.join(os.homedir(),'.local/share/android-reserve-mcp/engines/hermes-compiler-0.11.0/package/osx-bin/hermesc');
await fs.writeFile(path.join(root,'fixture.js'),'function fixture_add(a,b){return a+b;} print(fixture_add(2,7));');
checked(await run(compiler,['-emit-binary','-out',path.join(root,'fixture.hbc'),path.join(root,'fixture.js')]),'编译自有HBC');
const context=await createContext({allowedRoots:[root],workspace:path.join(root,'work')});const results=[];
async function complete(operation){
 const initial=await operation;
 for(let i=0;i<600;i++){
  const job=await context.jobs.get(initial.id);
  if(!['running','queued'].includes(job.state)){results.push(context.jobs.summary(job));assert.equal(job.state,'succeeded',job.error);return{job,value:JSON.parse(await fs.readFile(path.join(job.dir,'result.json')))};}
  await new Promise(r=>setTimeout(r,50));
 }throw new Error('任务未结束');
}
try{
 const index=await complete(artifact(context,{action:'inspect',path:path.join(root,'fixture.hbc')}));
 const inventory=JSON.parse(await fs.readFile(path.join(index.job.dir,'inventory.json')));assert.equal(inventory.entries[0].kind,'hermes-hbc');assert.equal(inventory.entries[0].bytecodeVersion,84);
 await complete(framework(context,{action:'probe',engine:'hermes'}));
 const analyzed=await complete(framework(context,{action:'analyze',engine:'hermes',path:path.join(root,'fixture.hbc')}));
 assert.match(await fs.readFile(path.join(analyzed.job.dir,'output/disassembly.hasm'),'utf8'),/fixture_add/);
 console.log(JSON.stringify({hbcVersion:84,engine:'hermes-dec',results}));
}finally{await fs.writeFile(path.join(root,'report.json'),JSON.stringify({results},null,2));await context.close();}
