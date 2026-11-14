// long: 自建release APK只提取两份配对ARM64库，不接触设备；真实AOT引擎输出必须包含样本语义标记。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, framework } from '../src/actions.js';
import { run, checked, tool } from '../src/core/process.js';

const root=path.resolve('output/flutter-owned-sample');
const apk=path.join(root,'build/app/outputs/flutter-apk/app-release.apk');
const libs=path.join(root,'arm64-libs');await fs.mkdir(libs,{recursive:true});
checked(await run(await tool('python3'),['-c','from pathlib import Path\nfrom zipfile import ZipFile\nimport sys\nwith ZipFile(sys.argv[1]) as z:\n for n in ("libapp.so","libflutter.so"):(Path(sys.argv[2])/n).write_bytes(z.read("lib/arm64-v8a/"+n))',apk,libs]),'提取自有Flutter配对库');
const c=await createContext({allowedRoots:[root],workspace:path.join(root,'analysis-work')});const results=[];
try{
 const initial=await framework(c,{action:'analyze',engine:'flutter',path:libs,allowEngineBuild:true});console.log(JSON.stringify(initial));
 let job;
 for(let i=0;i<1400;i++){
  job=await c.jobs.get(initial.id);if(!['running','queued'].includes(job.state))break;
  await new Promise(r=>setTimeout(r,500));
 }
 results.push(c.jobs.summary(job));console.log(JSON.stringify(results.at(-1)));assert.equal(job.state,'succeeded',job.error);
 const report=JSON.parse(await fs.readFile(path.join(job.dir,'result.json')));
 const out=path.join(job.dir,'output');
 const objects=(await fs.readFile(path.join(out,'objs.txt'),'utf8'))+(await fs.readFile(path.join(out,'pp.txt'),'utf8'));
 assert.match(objects,/RESERVE_FLUTTER_V03/);
 assert.ok(report.files.some(f=>f.path.startsWith('asm'+path.sep)));
 assert.match(await fs.readFile(path.join(out,'asm/reserve_flutter_fixture/main.dart'),'utf8'),/static int reserveAdd\(int, int\)/);
 assert.equal(report.input.libraries.length,2);for(const lib of report.input.libraries)assert.match(lib.sha256,/^[a-f0-9]{64}$/);
 console.log('真实Flutter AOT对象池与汇编产物通过');
}finally{await fs.writeFile(path.join(root,'analysis-report.json'),JSON.stringify({results},null,2));await c.close();}
