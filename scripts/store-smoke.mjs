// long: 校验提取字节与自有DLL完全相同，再接ILSpy验证语义；布局夹具不能冒充完整MAUI产物验收。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createContext,managed,framework} from '../src/actions.js';
import {run,checked,tool} from '../src/core/process.js';
import {completeJob} from './smoke-utils.mjs';
const root=await fs.mkdtemp(path.resolve('output/store-owned-')),dll=path.resolve('output/managed-smoke/source/bin/Release/net10.0/ReserveManagedFixture.dll');
await fs.access(dll);const python=path.join(os.homedir(),'.local/share/android-reserve-mcp/engines/managed-env/bin/python');
checked(await run(python,['scripts/store-fixture.py',root,dll]),'自有store夹具');
const sdk=process.env.ANDROID_HOME||path.join(os.homedir(),'Library/Android/sdk'),versions=(await fs.readdir(path.join(sdk,'ndk'))).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
const clang=path.join(sdk,'ndk',versions[0],'toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang');
checked(await run(clang,['-shared','-fPIC',path.join(root,'store.c'),'-o',path.join(root,'libassembly-store.so')]),'自有ELF store封装');
const expected=createHash('sha256').update(await fs.readFile(dll)).digest('hex'),c=await createContext({allowedRoots:[root],workspace:path.join(root,'work'),disabled:true}),results=[];
try{
 let extracted;
 for(const file of (await fs.readdir(root)).filter(n=>(n.endsWith('.blob')&&!n.startsWith('bad-'))||n.endsWith('.so'))){const analyzed=await completeJob(c,managed(c,{action:'extract',path:path.join(root,file)}),results);assert.equal(analyzed.value.entries[0].sha256,expected);extracted=path.join(analyzed.job.dir,'assemblies',analyzed.value.entries[0].artifact);}
 const code=await completeJob(c,framework(c,{action:'analyze',engine:'ilspy',path:extracted}),results);const source=code.value.files.find(f=>f.path.endsWith('ReserveManagedFixture.cs'));assert.ok(source);assert.match(await fs.readFile(path.join(code.job.dir,'output',source.path),'utf8'),/RESERVE_MANAGED_V03/);
 for(const file of ['bad-version.blob','bad-length.blob']){const initial=await managed(c,{action:'extract',path:path.join(root,file)});let job;do{await new Promise(r=>setTimeout(r,20));job=await c.jobs.get(initial.id);}while(['queued','running'].includes(job.state));assert.equal(job.state,'failed');}
 console.log('store v1/v2(32/64)/v3、LZ4/Zstd、ELF符号定位→提取SHA一致→ILSpy通过');
}finally{await fs.writeFile(path.join(root,'report.json'),JSON.stringify({root,results,syntheticContainers:true,deviceAccessed:false},null,2));await fs.writeFile('output/store-latest-report.json',JSON.stringify({root,results,syntheticContainers:true},null,2));await c.close();}
