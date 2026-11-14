import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { within } from './paths.js';
const key = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

export function indexEvidence(jobId, sources) {
  const nodes = new Map(), edges = new Map(); let partial = false, scanned = 0;
  const add = (kind, identity, data) => { const id=kind+':'+key(identity), prior=nodes.get(id); if(!prior&&nodes.size>=20000){partial=true;return null;} if(kind==='artifact'&&prior?.bytes!==undefined&&data.bytes!==undefined&&prior.bytes!==data.bytes)partial=true; nodes.set(id,{...prior,id,kind,...Object.fromEntries(Object.entries(data).filter(([,v])=>v!==undefined))});return id; };
  const edge = (from,to,relation,source,strength) => {if(!from||!to)return;if(edges.size>=40000){partial=true;return;}const e={from,to,relation,source,strength};edges.set(key(e),e);};
  const run=add('run',jobId,{jobId});
  function walk(value, pointer, source, scope, parentArtifact, depth=0) {
    if(!value||typeof value!=='object')return;
    if(++scanned>50000||depth>24){partial=true;return;}
    if(Array.isArray(value)){value.slice(0,12000).forEach((v,i)=>walk(v,pointer+'/'+i,source,scope,parentArtifact,depth+1));if(value.length>12000)partial=true;return;}
    if(value.partial === true || value.truncated === true) partial = true;
    scope={...scope}; for(const [field,target] of [['session_id','session'],['device_id','device'],['script_id','script'],['traceId','trace']])if(typeof value[field]==='string')scope[target]=value[field];
    if(Number.isSafeInteger(value.pid))scope.pid=value.pid;
    const citation={jobId,file:source,jsonPointer:pointer};
    let artifact=parentArtifact;
    const hash=sha(value.sha256)?value.sha256:sha(value.inputSha256)?value.inputSha256:sha(value.input?.sha256)?value.input.sha256:null;
    if(hash){artifact=add('artifact',hash.toLowerCase(),{sha256:hash.toLowerCase(),bytes:value.bytes,sourcePath:typeof value.path==='string'?value.path.slice(0,4096):undefined});edge(run,artifact,'uses-or-produces',citation,'content-hash');if(parentArtifact&&parentArtifact!==artifact)edge(artifact,parentArtifact,'reported-derived-from',citation,'report-structure');}
    if(typeof value.sessionId==='string'&&typeof value.processEpoch==='string'&&artifact){
      // long: CDP采集会话与进程代次是采集来源，不等于Frida的调用关联；只按实际正文哈希连到静态产物。
      const capture=add('webview-capture',[value.sessionId,value.processEpoch,jobId],{sessionId:value.sessionId,processEpoch:value.processEpoch,serial:value.serial,pid:value.pid,kindOfContent:value.kind,metadata:value.metadata});
      edge(capture,artifact,'captured-content',citation,'cdp-content-hash');
    }
    if(typeof value.event==='string'&&scope.script){
      // long: PID/类名/RVA不能跨任务当唯一身份；只在会话+脚本+trace范围按报告的调用ID关联。
      const runtime=[scope.device,scope.session,scope.pid,scope.script,scope.trace];
      const data={event:value.event,pid:value.pid,sequence:value.sequence,methodKey:value.methodKey,className:value.className,address:value.address,rva:value.rva,module:value.module,outcome:value.outcome};
      const event=add('runtime-event',[runtime,value.sequence,key(value)],data);edge(run,event,'observed-result',citation,'reported-runtime-event');
      for(const field of ['invocationId','javaInvocationId'])if(typeof value[field]==='string'){
        const call=add('runtime-call',[runtime,value[field]],{scope,reportedInvocationId:value[field]});edge(event,call,field==='javaInvocationId'?'reported-within-java-call':'reported-call-phase',citation,'reported-same-script-call-id');
      }
      if(typeof value.registrationId==='string'){const registration=add('jni-registration',[runtime,value.registrationId],{scope,registrationId:value.registrationId});edge(event,registration,'reported-registration-phase',citation,'reported-same-script-call-id');}
    }
    if(value.className&&Array.isArray(value.functions))for(const f of value.functions.slice(0,1000))if(f.jvmSignature){
      const method=add('java-method',[artifact||jobId,value.className,f.jvmSignature],{className:value.className,signature:f.jvmSignature,suspend:f.suspend,inline:f.inline});
      edge(artifact||run,method,f.exactDexMatch?'metadata-signature-matches-dex':'metadata-declares',citation,f.exactDexMatch?'exact-signature-in-same-artifact':'metadata-declaration');
    }
    if(artifact&&Array.isArray(value.functions)&&!value.className){
      const location = row => ({ line:row.line,column:row.column,end:row.end });
      const functions=new Map();for(const f of value.functions.slice(0,12000))if(Number.isInteger(f.start)){const node=add('js-function',[artifact,f.start,f.name],{name:f.name,start:f.start,location:location(f)});functions.set(f.start,node);edge(artifact,node,'contains-function',citation,'static-parser');}
      for(const c of (value.calls||[]).slice(0,12000))if(functions.has(c.bindingFunctionStart)){const call=add('js-callsite',[artifact,c.start,c.callee],{callee:c.callee,start:c.start,location:location(c)});edge(call,functions.get(c.bindingFunctionStart),'lexical-binding-reference',citation,'static-lexical-resolution');}
    }
    if(Array.isArray(value.frameworks))for(const f of value.frameworks.slice(0,100))if(f.name){const candidate=add('framework-candidate',[artifact||jobId,f.name],{name:f.name});edge(artifact||run,candidate,'candidate-framework',citation,'candidate-only');}
    for(const [field,child] of Object.entries(value))if(!['content','raw_result','annotations'].includes(field))walk(child,pointer+'/'+field.replaceAll('~','~0').replaceAll('/','~1'),source,scope,artifact,depth+1);
  }
  for(const source of sources){const hash=sha(source.artifactHash)?source.artifactHash.toLowerCase():null;const anchor=hash?add('artifact',hash,{sha256:hash}):null;walk(source.value,'',source.file,{},anchor);}
  return {schema:1,jobId,nodes:[...nodes.values()],edges:[...edges.values()],partial,limitation:'跨任务仅按内容哈希合并产物；运行关联按会话/脚本/trace及报告调用ID，不按路径、时间或PID猜测'};
}

export async function evidenceForJob(job, result) {
  const sources=[{file:'result.json',value:result}]; let bytes=0; const skipped=[];
  // long: 只读固定报告名，拒绝外部解析器生成的越界符号链接；目标文本不能指定新的宿主文件。
  for(const name of ['script.json','inventory.json','kotlin.json','managed.json','packages.json']){
    const file=await fs.realpath(path.join(job.dir,name)).catch(()=>null);if(!file)continue;if(!within(job.dir,file)){skipped.push(name+':outside-job');continue;}
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>16*1024*1024||bytes+stat.size>32*1024*1024){skipped.push(name+':budget');continue;}
    bytes+=stat.size;try{sources.push({file:name,value:JSON.parse(await fs.readFile(file,'utf8')),artifactHash:result.input?.sha256||result.inputSha256});}catch{skipped.push(name+':invalid-json');}
  }
  const graph=indexEvidence(job.id,sources);graph.partial ||= skipped.length>0;graph.skipped=skipped;await fs.writeFile(path.join(job.dir,'evidence.json'),JSON.stringify(graph,null,2));return {artifact:'evidence.json',nodes:graph.nodes.length,edges:graph.edges.length,partial:graph.partial};
}

export async function evidence(context,args){
  if(args.action==='query'){
    const job=await context.jobs.get(args.graphJobId),file=await context.paths.artifact(job.dir,'graph.json');
    if((await fs.stat(file)).size>32*1024*1024)throw new Error('证据图超过32MiB');
    const graph=JSON.parse(await fs.readFile(file,'utf8')),q=(args.query||'').toLowerCase(),offset=args.offset||0,limit=args.limit||50;
    const filtered=graph.nodes.filter(n=>(!args.kind||n.kind===args.kind)&&JSON.stringify(n).toLowerCase().includes(q));const nodes=filtered.slice(offset,offset+limit),ids=new Set(nodes.map(n=>n.id));
    return {nodes,edges:graph.edges.filter(e=>ids.has(e.from)||ids.has(e.to)).slice(0,200),nextOffset:filtered.length>offset+limit?offset+limit:null,partial:graph.partial};
  }
  if(!args.jobIds?.length)throw new Error('merge必须提供jobIds');
  return context.jobs.start('合并证据索引',async(signal,dir)=>{
    const nodes=new Map(),edges=new Map();let bytes=0,partial=false;
    for(const id of [...new Set(args.jobIds)]){
      if(signal.aborted)throw new Error('任务已取消');const job=await context.jobs.get(id),file=await context.paths.artifact(job.dir,'evidence.json');
      const size=(await fs.stat(file)).size;bytes+=size;if(size>16*1024*1024||bytes>64*1024*1024)throw new Error('证据合并超过读取预算');
      const graph=JSON.parse(await fs.readFile(file,'utf8'));partial ||= graph.partial;
      for(const node of graph.nodes){if(nodes.size>=20000){partial=true;break;}nodes.set(node.id,node);}
      for(const e of graph.edges){if(edges.size>=40000){partial=true;break;}edges.set(key(e),e);}
    }
    const graph={schema:1,nodes:[...nodes.values()],edges:[...edges.values()].filter(e=>nodes.has(e.from)&&nodes.has(e.to)),partial};
    await fs.writeFile(path.join(dir,'graph.json'),JSON.stringify(graph,null,2));return {graph:'graph.json',nodes:nodes.size,edges:graph.edges.length,partial};
  });
}
