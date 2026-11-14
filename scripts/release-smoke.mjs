// long: 从实际tarball安装再启动服务，验证npm白名单没有漏掉运行文件，协议入口也与源码安装一致。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { run, checked, tool } from '../src/core/process.js';
import { VERSION } from '../src/version.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const full=process.argv.includes('--full');
if(process.argv.slice(2).some(arg=>arg!=='--full'))throw new Error('仅支持--full完整安装验收');
// long: macOS的/var与/private/var指向同一目录；统一真实路径，避免npm把本地依赖写成越出安装根的相对路径。
const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'android-reserve-release-')));
const client=new Client({name:'android-reserve-release-smoke',version:'1.0.0'});
const report={mode:full?'full-install':'protocol-only',temporary,startedAt:new Date().toISOString(),checks:{}};
let connected=false;
try{
  const packed=checked(await run(await tool('npm'),['pack','--ignore-scripts','--pack-destination',temporary,'--json'],{cwd:root,timeoutMs:60000,maxBytes:1024*1024}),'生成发行tarball');
  const metadata=JSON.parse(packed.stdout)[0];
  if(metadata.name!=='android-reserve-mcp'||metadata.version!==VERSION)throw new Error('tarball包名或版本不匹配');
  const archive=path.join(temporary,metadata.filename);
  await fs.writeFile(path.join(temporary,'package.json'),JSON.stringify({name:'android-reserve-release-validation',private:true,type:'module'}));
  const installed=await run(await tool('npm'),['install','--ignore-scripts','--no-audit','--no-fund','--prefix',temporary,archive,...(full?['rea-agents@6.9.0']:[])],{cwd:temporary,timeoutMs:180000,maxBytes:2*1024*1024});
  await fs.writeFile(path.join(temporary,'install.log'),installed.stdout+'\n'+installed.stderr);checked(installed,'安装发行tarball');
  if(full){
    const lock=JSON.parse(await fs.readFile(path.join(temporary,'package-lock.json'),'utf8'));
    const bindings=Object.entries(lock.packages).filter(([name])=>name.endsWith('/frida'));
    if(!bindings.length||bindings.some(([name,pkg])=>!name.startsWith('node_modules/')||name.split('/').includes('..')||!['17.26.3','17.23.2'].includes(pkg.version)||!pkg.integrity))throw new Error('Frida路径、版本或registry integrity与完整安装基线不符');
    const versions=new Set(bindings.map(([,pkg])=>pkg.version));if(!versions.has('17.26.3')||!versions.has('17.23.2'))throw new Error('宿主编译与REA两套Frida binding未同时安装');
    // long: 宿主项目不会继承依赖包的安装脚本许可；只批准已核实版本的Frida，不执行其他依赖的安装脚本。
    const project=JSON.parse(await fs.readFile(path.join(temporary,'package.json'),'utf8'));
    project.allowScripts=Object.fromEntries([...versions].map(version=>['frida@'+version,true]));
    await fs.writeFile(path.join(temporary,'package.json'),JSON.stringify(project,null,2));
    const policy=await run(await tool('npm'),['install-scripts','ls','--json','--prefix',temporary],{cwd:temporary,timeoutMs:30000});
    await fs.writeFile(path.join(temporary,'install-policy.log'),policy.stdout+'\n'+policy.stderr);checked(policy,'核对安装脚本授权');
    const rebuilt=await run(await tool('npm'),['rebuild','frida','--ignore-scripts=false','--prefix',temporary],{cwd:temporary,timeoutMs:300000,maxBytes:2*1024*1024});
    await fs.writeFile(path.join(temporary,'binding-build.log'),rebuilt.stdout+'\n'+rebuilt.stderr);checked(rebuilt,'安装Frida原生binding');
    report.checks.bindings=bindings.map(([name,pkg])=>({path:name,version:pkg.version,integrity:pkg.integrity}));
    report.checks.bindingImports=await Promise.all(bindings.map(async ([name,pkg])=>{
      const entry=createRequire(import.meta.url).resolve(path.join(temporary,name));
      // long: 两套Frida原生模块分别在独立进程加载，避免版本间全局状态干扰，也不枚举或附加手机。
      const code=`const binding=await import(${JSON.stringify(pathToFileURL(entry).href)});if(typeof binding.getDeviceManager!=='function')throw new Error('binding API不完整');process.stdout.write('verified');`;
      const imported=await run(process.execPath,['--max-old-space-size=128','--input-type=module','-e',code],{cwd:temporary,timeoutMs:30000,maxBytes:32000});
      await fs.writeFile(path.join(temporary,'binding-import-'+pkg.version+'.log'),imported.stdout+'\n'+imported.stderr);checked(imported,'Frida '+pkg.version+'导入');
      if(imported.stdout!=='verified')throw new Error('Frida '+pkg.version+'未返回导入确认');
      return {version:pkg.version,status:'verified',deviceConnected:false};
    }));
  }
  const cli=path.join(temporary,'node_modules/android-reserve-mcp/src/cli.js');
  await fs.access(cli);
  const transport=new StdioClientTransport({command:process.execPath,args:[cli,'--allowedRoots',temporary,'--workspace',path.join(temporary,'workspace'),...(full?[]:['--no-rea'])],cwd:temporary,stderr:'pipe'});
  let serverLog='';transport.stderr?.on('data',chunk=>{serverLog=(serverLog+String(chunk)).slice(-32000);});
  await client.connect(transport);connected=true;
  const tools=await client.listTools();
  if(tools.tools.length!==20)throw new Error(`发行包MCP工具数量错误：${tools.tools.length}`);
  if(client.getServerVersion().version!==VERSION)throw new Error('发行包stdio版本与源码版本不一致');
  report.checks.protocol={version:VERSION,tools:tools.tools.length};
  const doctor=await client.callTool({name:'doctor',arguments:{}});
  if(doctor.isError)throw new Error('发行包doctor调用失败：'+JSON.stringify(doctor.content));
  const payload=doctor.structuredContent||JSON.parse(doctor.content[0].text);
  if(payload.rea.started!==false)throw new Error('基础doctor意外启动REA');
  if(full){
    const response=await client.callTool({name:'doctor',arguments:{deep:true,timeoutSeconds:120}}),started=JSON.parse(response.content[0].text);
    if(response.isError||!started.id)throw new Error('无法启动发行包深度检查');
    let job;
    const deadline=Date.now()+150000;
    while(Date.now()<deadline){
      const state=await client.callTool({name:'jobs',arguments:{action:'status',jobId:started.id}});job=JSON.parse(state.content[0].text);
      if(!['running','queued'].includes(job.state))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(job?.state!=='succeeded')throw new Error('发行包深度检查未通过：'+JSON.stringify(job));
    const result=JSON.parse(await fs.readFile(path.join(temporary,'workspace/jobs',job.id,'result.json'),'utf8'));
    report.checks.deep=result.deep;
    if(result.deep?.partial||Object.values(result.deep?.checks||{}).some(check=>check.status!=='verified'))throw new Error('完整安装验收存在未通过检查');
    await fs.writeFile(path.join(temporary,'server.log'),serverLog);
  }
  report.passed=true;
}catch(error){
  report.passed=false;report.error=String(error.message);throw error;
}finally{
  let cleanupError;
  if(connected){try{await client.close();}catch(error){cleanupError=error.message;}}
  if(connected){
    const workspace=path.join(temporary,'workspace');
    const files=(await fs.readdir(workspace)).filter(name=>/^shutdown-[0-9a-f-]+\.json$/.test(name));
    const records=await Promise.all(files.map(async name=>({file:name,...JSON.parse(await fs.readFile(path.join(workspace,name),'utf8'))})));
    report.checks.cleanup={records:records.length,confirmed:records.length>0&&records.every(record=>record.closed===true&&record.state==='finished')};
    if(!report.checks.cleanup.confirmed)cleanupError='MCP退出未留下全部确认的清理终态';
  }
  if(cleanupError){report.passed=false;report.cleanupError=cleanupError;}
  report.finishedAt=new Date().toISOString();
  await fs.writeFile(path.join(temporary,'validation.json'),JSON.stringify(report,null,2));
  // long: 完整安装、原生构建和深度诊断需要可复核原件；保留隔离目录，失败时同样不删除现场。
  if(!report.passed)console.error('验收现场：'+temporary);
  else console.log(`发行包${full?'完整安装':'协议'}验收通过：android-reserve-mcp@${VERSION}，20个工具；报告 ${path.join(temporary,'validation.json')}`);
  if(cleanupError&&!report.error)throw new Error(cleanupError);
}
