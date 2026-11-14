import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { run, checked, tool } from './process.js';

export async function managed(context, args) {
  const input = await context.paths.input(args.path);
  if ((await fs.stat(input)).size > 512*1024*1024) throw new Error('托管输入超过512MiB');
  return context.jobs.start(`托管程序集 ${args.action}`, async (signal, dir) => {
    const python = process.env.ANDROID_RESERVE_MANAGED_PYTHON || path.join(os.homedir(),'.local/share/android-reserve-mcp/engines/managed-env/bin/python');
    if (!path.isAbsolute(python)) throw new Error('ANDROID_RESERVE_MANAGED_PYTHON必须为绝对路径');
    const command = await fs.access(python).then(()=>python).catch(()=>{if(process.env.ANDROID_RESERVE_MANAGED_PYTHON)throw new Error('显式配置的托管Python不可访问：'+python);return tool('python3');});
    const helper = fileURLToPath(new URL('../../helpers/assembly-store.py',import.meta.url));
    const snapshot = path.join(dir,'input.bin'); await fs.copyFile(input,snapshot);
    const result=await run(command,[helper,snapshot,path.join(dir,'assemblies'),args.action,path.join(dir,'managed.json')],{signal,timeoutMs:180000,maxBytes:256000});
    await fs.writeFile(path.join(dir,'managed.log'),result.stdout+result.stderr);checked(result,'程序集/store读取');
    const report=JSON.parse(await fs.readFile(path.join(dir,'managed.json'),'utf8'));
    return {...report,report:'managed.json',output:'assemblies',inputPath:input};
  });
}
