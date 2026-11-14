// long: 两次挂起点生成真实协程状态机；从DEX原始注解核对声明和JVM签名，不用伪造注解代替Kotlin编译。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createContext,dex,evidence } from '../src/actions.js';
import { run,checked,tool } from '../src/core/process.js';
import { completeJob } from './smoke-utils.mjs';
const base=path.resolve('output');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'kotlin-owned-'));await fs.mkdir(path.join(root,'classes'));await fs.mkdir(path.join(root,'dex'));
async function cached(group,name,version){const folder=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1',group,name,version);for(const hash of await fs.readdir(folder)){for(const file of await fs.readdir(path.join(folder,hash)))if(file.endsWith('.jar')&&!file.includes('-sources'))return path.join(folder,hash,file);}throw new Error('缺少编译缓存'+name);}
const stdlib=await cached('org.jetbrains.kotlin','kotlin-stdlib','2.0.21');
const cp=await Promise.all([['org.jetbrains.kotlin','kotlin-compiler-embeddable','2.0.21'],['org.jetbrains.kotlin','kotlin-script-runtime','2.0.21'],['org.jetbrains.kotlin','kotlin-reflect','1.6.10'],['org.jetbrains.intellij.deps','trove4j','1.0.20200330'],['org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.6.4'],['org.jetbrains','annotations','13.0']].map(args=>cached(...args)));cp.push(stdlib);
const source=path.join(root,'Owned.kt');await fs.writeFile(source,'package owned\nclass Owned(val label: String) { fun add(a: Int,b: Int)=a+b+37 }\nsuspend fun pause():Int=kotlin.coroutines.suspendCoroutine { it.resumeWith(Result.success(7)) }\nsuspend fun flow():Int=pause()+pause()\ninline fun inlinePlus(block:()->Int):Int=block()+37\n');
checked(await run(await tool('java'),['-Xmx1024m','-cp',cp.join(path.delimiter),'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-jvm-target','1.8','-classpath',stdlib,'-d',path.join(root,'classes'),source],{timeoutMs:120000}),'自有Kotlin编译');
const sdk=process.env.ANDROID_HOME||path.join(os.homedir(),'Library/Android/sdk'),classes=(await fs.readdir(path.join(root,'classes/owned'))).filter(n=>n.endsWith('.class')).map(n=>path.join(root,'classes/owned',n));
const bridge=path.join(root,'Bridge.java');await fs.writeFile(bridge,'package owned; public class Bridge { @android.webkit.JavascriptInterface public int ping(int n){return n+83;} public int hidden(int n){return n;} }');
checked(await run(await tool('javac'),['--release','8','-cp',path.join(sdk,'platforms/android-36/android.jar'),'-d',path.join(root,'classes'),bridge]),'自有桥接声明编译');
classes.push(path.join(root,'classes/owned/Bridge.class'));
checked(await run(await tool('d8'),['--lib',path.join(sdk,'platforms/android-36/android.jar'),'--lib',stdlib,'--output',path.join(root,'dex'),...classes]),'自有Kotlin转DEX');
const c=await createContext({allowedRoots:[root],workspace:path.join(root,'work'),disabled:true}),results=[];
try{
 const analyzed=await completeJob(c,dex(c,{action:'kotlin',path:path.join(root,'dex/classes.dex'),query:'owned'}),results);
 const report=JSON.parse(await fs.readFile(path.join(analyzed.job.dir,'kotlin.json'),'utf8'));
 const functions=report.classes.flatMap(x=>x.functions||[]);assert.ok(functions.some(f=>f.name==='flow'&&f.suspend&&f.exactDexMatch));assert.ok(functions.some(f=>f.name==='inlinePlus'&&f.inline&&f.exactDexMatch));assert.ok(report.classes.some(x=>x.coroutineStateMachineCandidate));
 assert.deepEqual(report.classes.find(c=>c.className==='owned.Bridge').javascriptInterfaces,['ping(I)I']);
 const merged=await completeJob(c,evidence(c,{action:'merge',jobIds:[analyzed.job.id]}),results);
 const queried=await evidence(c,{action:'query',graphJobId:merged.job.id,query:'flow',kind:'java-method'});assert.ok(queried.nodes.some(n=>n.suspend));
 console.log('真实Kotlin metadata/suspend/inline/DEX签名与持久证据关联通过');
}finally{await fs.writeFile(path.join(root,'report.json'),JSON.stringify({root,results,deviceAccessed:false},null,2));await fs.writeFile(path.join(base,'kotlin-latest-report.json'),JSON.stringify({root,results},null,2));await c.close();}
