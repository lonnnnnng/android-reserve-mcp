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
      if(value.runtime==='mono'&&value.association==='mono-jit-info-method-identity'&&typeof value.imageGuid==='string'&&typeof value.metadataToken==='string'){
        // long: MVID和MethodDef只在本运行会话的Mono回核范围关联，不自动冒充与磁盘DLL哈希同构建。
        const method=add('managed-method',[runtime,value.imageGuid,value.metadataToken],{runtime:'mono',imageGuid:value.imageGuid,metadataToken:value.metadataToken,assemblyName:value.assemblyName,fullName:value.fullName,address:value.address,module:value.module,rva:value.rva});
        edge(event,method,'observes-resolved-managed-method',citation,'mono-jit-info-method-identity');
      }
      for(const field of ['invocationId','javaInvocationId'])if(typeof value[field]==='string'){
        const call=add('runtime-call',[runtime,value[field]],{scope,reportedInvocationId:value[field]});edge(event,call,field==='javaInvocationId'?'reported-within-java-call':'reported-call-phase',citation,'reported-same-script-call-id');
        if(field==='invocationId'&&typeof value.parentInvocationId==='string'){
          const parent=add('runtime-call',[runtime,value.parentInvocationId],{scope,reportedInvocationId:value.parentInvocationId});
          edge(call,parent,'within-java-original-call',citation,'same-agent-thread-call-stack');
        }
      }
      if(value.correlation?.association==='jni-isSameObject'&&typeof value.correlation.requestId==='string'&&typeof value.invocationId==='string'){
        const request=add('runtime-call',[runtime,value.correlation.requestId],{scope,reportedInvocationId:value.correlation.requestId});
        const reply=add('runtime-call',[runtime,value.invocationId],{scope,reportedInvocationId:value.invocationId});
        const relation=value.correlation.state==='reply-returned'?'reply-returned-for-object':value.correlation.state==='reply-threw'?'reply-threw-for-object':'reply-attempt-for-object';
        edge(reply,request,relation,citation,'same-agent-jni-object-identity');
      }
      if(typeof value.registrationId==='string'){const registration=add('jni-registration',[runtime,value.registrationId],{scope,registrationId:value.registrationId});edge(event,registration,'reported-registration-phase',citation,'reported-same-script-call-id');}
    }
    if(value.className&&Array.isArray(value.functions))for(const f of value.functions.slice(0,1000))if(f.jvmSignature){
      const method=add('java-method',[artifact||jobId,value.className,f.jvmSignature],{className:value.className,signature:f.jvmSignature,suspend:f.suspend,inline:f.inline});
      edge(artifact||run,method,f.exactDexMatch?'metadata-signature-matches-dex':'metadata-declares',citation,f.exactDexMatch?'exact-signature-in-same-artifact':'metadata-declaration');
    }
    if(value.className&&Array.isArray(value.composeSignals))for(const item of value.composeSignals.slice(0,1000))if(typeof item.jvmSignature==='string'&&item.signals&&typeof item.signals==='object'){
      const method=add('compose-method',[artifact||jobId,value.className,item.jvmSignature],{className:value.className,signature:item.jvmSignature,evidence:'composer-parameter-in-compiled-dex'});
      edge(artifact||run,method,'declares-compose-method-candidate',citation,'composer-signature-candidate');
      for(const [signal,count] of Object.entries(item.signals).slice(0,32))if(Number.isSafeInteger(count)&&count>0){
        const candidate=add('compose-signal-candidate',[method,signal],{className:value.className,signature:item.jvmSignature,signal,count});
        edge(method,candidate,'has-compiled-compose-signal',citation,'compiled-invoke-reference-candidate');
      }
      for(const call of (item.callsites||[]).slice(0,2000))if(Number.isSafeInteger(call.dexOffset)&&call.dexOffset>=0&&typeof call.targetSignature==='string'){
        const site=add('compose-callsite-candidate',[method,call.dexOffset,call.targetClass,call.targetSignature],{className:value.className,signature:item.jvmSignature,...call});
        edge(method,site,'contains-compiled-callsite',citation,'dex-invoke-offset-candidate');
      }
    }
    if(artifact&&Array.isArray(value.functions)&&!value.className){
      const location = row => ({ line:row.line,column:row.column,end:row.end });
      const functions=new Map();for(const f of value.functions.slice(0,12000))if(Number.isInteger(f.start)){const node=add('js-function',[artifact,f.start,f.name],{name:f.name,start:f.start,location:location(f)});functions.set(f.start,node);edge(artifact,node,'contains-function',citation,'static-parser');}
      for(const c of (value.calls||[]).slice(0,12000))if(functions.has(c.bindingFunctionStart)){const call=add('js-callsite',[artifact,c.start,c.callee],{callee:c.callee,start:c.start,location:location(c)});edge(call,functions.get(c.bindingFunctionStart),'lexical-binding-reference',citation,'static-lexical-resolution');}
    }
    if(Array.isArray(value.frameworks))for(const f of value.frameworks.slice(0,100))if(f.name){const candidate=add('framework-candidate',[artifact||jobId,f.name],{name:f.name});edge(artifact||run,candidate,'candidate-framework',citation,'candidate-only');}
    for(const [field,child] of Object.entries(value))if(!['content','raw_result','annotations'].includes(field)&&!(value.kind==='source-map-position'&&field==='map'))walk(child,pointer+'/'+field.replaceAll('~','~0').replaceAll('/','~1'),source,scope,artifact,depth+1);
  }
  for(const source of sources){const hash=sha(source.artifactHash)?source.artifactHash.toLowerCase():null;const anchor=hash?add('artifact',hash,{sha256:hash}):null;walk(source.value,'',source.file,{},anchor);}
  for(const source of sources){
    const value=source.value,citation=(jsonPointer)=>({jobId,file:source.file,jsonPointer});
    if(typeof value?.sessionId==='string'&&typeof value?.processEpoch==='string'){
      const runtime=[value.sessionId,value.processEpoch];
      const script=(scriptId)=>add('webview-script',[runtime,scriptId],{sessionId:value.sessionId,processEpoch:value.processEpoch,scriptId});
      if(value.kind==='js'&&value.metadata?.scriptId&&sha(value.sha256)){
        const artifact=add('artifact',value.sha256.toLowerCase(),{sha256:value.sha256.toLowerCase(),bytes:value.bytes});
        edge(script(value.metadata.scriptId),artifact,'captured-script-content',citation('/metadata'),'same-cdp-script-id-content-hash');
      }
      for(const [index,row] of (value.requests||[]).slice(0,200).entries()){
        const request=add('webview-request',[runtime,row.requestId],{sessionId:value.sessionId,processEpoch:value.processEpoch,requestId:row.requestId,url:row.url,method:row.method,status:row.response?.status,finished:row.finished,failure:row.failure});
        for(const [i,frame] of (row.initiator?.frames||[]).slice(0,64).entries()){
          const site=add('webview-initiator-frame',[runtime,row.requestId,index,i],{...frame,coordinateBase:0,sessionId:value.sessionId,processEpoch:value.processEpoch});
          edge(request,site,'reported-initiator-frame',citation('/requests/'+index+'/initiator/frames/'+i),'cdp-runtime-initiator-stack');
          if(frame.scriptObserved)edge(site,script(frame.scriptId),'references-observed-script',citation('/requests/'+index+'/initiator/frames/'+i),'same-cdp-session-script-id');
        }
      }
    }
    if(value?.kind==='flutter-channel-candidates')for(const [i,row] of (value.matches||[]).slice(0,10000).entries()){
      const scope=sha(value.input?.sha256)?value.input.sha256:jobId;
      const dart=add('flutter-dart-callsite-candidate',[scope,row.dart?.source,row.channel,row.method],{channel:row.channel,method:row.method,source:row.dart?.source,analysisJobId:value.analysisJobId});
      const android=add('flutter-android-handler-candidate',[scope,row.android?.source,row.android?.handlerClass,row.android?.handlerMethod],{...row.android,channel:row.channel,method:row.method,registration:row.registration});
      edge(run,dart,'reports-dart-callsite',citation('/matches/'+i+'/dart'),'aot-template-candidate');
      edge(dart,android,'matches-static-channel-protocol',citation('/matches/'+i),'static-protocol-candidate-not-runtime');
    }
    if(value?.kind==='source-map-position'&&sha(value.input?.sha256)&&value.generated&&value.original?.source){
      const generatedArtifact=add('artifact',value.input.sha256.toLowerCase(),{sha256:value.input.sha256.toLowerCase(),bytes:value.input.bytes});
      const mapHash=sha(value.map?.sha256)?value.map.sha256.toLowerCase():null;
      const map=mapHash?add('source-map',mapHash,{sha256:mapHash,path:typeof value.map.path==='string'?value.map.path.slice(0,4096):undefined,association:'caller-supplied-build-match-unverified'}):null;
      const generated=add('source-location',[generatedArtifact,'generated',value.generated.line,value.generated.column],{artifactHash:value.input.sha256.toLowerCase(),coordinate:'generated',line:value.generated.line,column:value.generated.column});
      const original=add('source-location',[generatedArtifact,'original',value.original.source,value.original.line,value.original.column],{artifactHash:value.input.sha256.toLowerCase(),coordinate:'source-map-original',source:value.original.source,line:value.original.line,column:value.original.column,name:value.original.name||undefined});
      edge(generatedArtifact,generated,'has-generated-position',citation('/generated'),'report-coordinate');
      edge(map,generated,'maps-generated-position',citation('/map'),'source-map-report');
      edge(generated,original,'maps-to-original-position',citation('/original'),'caller-supplied-source-map');
    }
    if(!Array.isArray(value?.containers)||!Array.isArray(value?.entries))continue;
    const rootEntry=value.entries.find(row=>Array.isArray(row.chain)&&row.chain.length===0&&sha(row.sha256));
    const rootHash=rootEntry?.sha256?.toLowerCase();
    const scope=rootHash||jobId,containers=new Map();
    value.containers.forEach((row,index)=>{
      if(!Array.isArray(row.chain)||row.chain.length>4)return;
      const id=add('artifact-container',[scope,row.chain],{chain:row.chain,containerKind:row.kind,entries:row.entries,coverage:row.coverage});
      containers.set(JSON.stringify(row.chain),id);
      const parent=containers.get(JSON.stringify(row.chain.slice(0,-1)));
      if(parent)edge(parent,id,'contains-nested-container',citation(`/containers/${index}`),'reported-container-layout');
      if(row.chain.length===0&&rootHash){const root=add('artifact',rootHash,{sha256:rootHash,bytes:rootEntry.bytes});edge(root,id,'inspected-as-container',citation(`/containers/${index}`),'reported-container-layout');}
    });
    value.entries.forEach((row,index)=>{
      if(!Array.isArray(row.chain)||row.chain.length>4)return;
      const member=add('container-member',[scope,row.chain],{chain:row.chain,name:row.chain.at(-1)||row.name,entryKind:row.kind,bytes:row.bytes,status:row.status,abi:row.abi});
      const parent=containers.get(JSON.stringify(row.chain.slice(0,-1)));
      if(parent)edge(parent,member,'contains-member',citation(`/entries/${index}`),'reported-container-layout');
      if(sha(row.sha256)){
        const child=add('artifact',row.sha256.toLowerCase(),{sha256:row.sha256.toLowerCase(),bytes:row.bytes});
        edge(member,child,'has-content',citation(`/entries/${index}/sha256`),'content-hash');
      }
      const nested=containers.get(JSON.stringify(row.chain));
      if(nested&&nested!==member)edge(member,nested,'contains-container-content',citation(`/entries/${index}`),'reported-container-layout');
    });
  }
  for(const source of sources){
    const value=source.value;
    if(value?.kind!=='android-view-onclick-declarations'||!Array.isArray(value.events))continue;
    value.events.slice(0,10000).forEach((row,index)=>{
      const citation={jobId,file:source.file,jsonPointer:`/events/${index}`};
      const node=add('view-event-candidate',[jobId,row.layout,row.viewId,row.handler,row.candidateClass],{layout:row.layout,viewClass:row.viewClass,viewId:row.viewId,handler:row.handler,candidateClass:row.candidateClass,candidateSignature:row.candidateSignature,resolution:row.resolution});
      edge(run,node,'declares-view-handler',citation,'xml-declaration-candidate');
    });
  }
  return {schema:1,jobId,nodes:[...nodes.values()],edges:[...edges.values()],partial,limitation:'跨任务仅按内容哈希合并产物；运行关联按会话/脚本/trace及报告调用ID，不按路径、时间或PID猜测'};
}

export async function evidenceForJob(job, result) {
  const sources=[{file:'result.json',value:result}]; let bytes=0; const skipped=[];
  // long: 只读固定报告名，拒绝外部解析器生成的越界符号链接；目标文本不能指定新的宿主文件。
  for(const name of ['script.json','inventory.json','kotlin.json','managed.json','packages.json','layout-events.json']){
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
