// long: 从实际tarball安装再启动服务，验证npm白名单没有漏掉运行文件，协议入口也与源码安装一致。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { run, checked, tool } from '../src/core/process.js';
import { VERSION } from '../src/version.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'android-reserve-release-'));
const client=new Client({name:'android-reserve-release-smoke',version:'1.0.0'});
let connected=false;
try{
  const packed=checked(await run(await tool('npm'),['pack','--ignore-scripts','--pack-destination',temporary,'--json'],{cwd:root,timeoutMs:60000,maxBytes:1024*1024}),'生成发行tarball');
  const metadata=JSON.parse(packed.stdout)[0];
  if(metadata.name!=='android-reserve-mcp'||metadata.version!==VERSION)throw new Error('tarball包名或版本不匹配');
  const archive=path.join(temporary,metadata.filename);
  checked(await run(await tool('npm'),['install','--ignore-scripts','--no-audit','--no-fund','--prefix',temporary,archive],{cwd:temporary,timeoutMs:180000,maxBytes:2*1024*1024}),'安装发行tarball');
  const cli=path.join(temporary,'node_modules/android-reserve-mcp/src/cli.js');
  await fs.access(cli);
  const transport=new StdioClientTransport({command:process.execPath,args:[cli,'--allowedRoots',temporary,'--workspace',path.join(temporary,'workspace'),'--no-rea'],stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  await client.connect(transport);connected=true;
  const tools=await client.listTools();
  if(tools.tools.length!==20)throw new Error(`发行包MCP工具数量错误：${tools.tools.length}`);
  if(client.getServerVersion().version!==VERSION)throw new Error('发行包stdio版本与源码版本不一致');
  const doctor=await client.callTool({name:'doctor',arguments:{}});
  if(doctor.isError)throw new Error('发行包doctor调用失败：'+JSON.stringify(doctor.content));
  const payload=doctor.structuredContent||JSON.parse(doctor.content[0].text);
  if(payload.rea.started!==false)throw new Error('--no-rea下发行包意外启动REA');
  console.log(`发行包实装验收通过：${metadata.name}@${metadata.version}，${tools.tools.length}个工具，doctor成功`);
}finally{
  if(connected)await client.close();
  const resolved=path.resolve(temporary),base=path.resolve(os.tmpdir())+path.sep;
  if(!resolved.startsWith(base)||!path.basename(resolved).startsWith('android-reserve-release-'))throw new Error('发行临时目录身份校验失败，保留现场：'+resolved);
  await fs.rm(resolved,{recursive:true,force:true});
}
