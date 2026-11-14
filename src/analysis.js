import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, tool, checked } from './core/process.js';

const artifactHelper = fileURLToPath(new URL('../helpers/artifact.py', import.meta.url));
const scriptHelper = fileURLToPath(new URL('../helpers/script.mjs', import.meta.url));

export async function artifact(context, args) {
  const input = await context.paths.input(args.path, { directory: null });
  const stat = await fs.stat(input);
  if (args.action === 'extract' && stat.isDirectory()) throw new Error('extract要求归档文件；目录输入使用inspect');
  if (args.action === 'extract' && !args.chain?.length) throw new Error('必须提供从inspect结果复制的chain数组');
  return context.jobs.start(`产物 ${args.action}`, async (signal, dir) => {
    const output = path.join(dir, 'inventory.json');
    const parameters = [artifactHelper, args.action, input, output];
    if (args.action === 'extract') {
      const name = path.posix.basename(args.chain.at(-1));
      parameters.push(JSON.stringify(args.chain), path.join(dir, 'extracted-' + name));
    }
    const result = checked(await run(await tool('python3'), parameters, { signal, timeoutMs: 180000, maxBytes: 256000 }), '产物索引/提取');
    return { ...JSON.parse(result.stdout), input, limitation: '框架指纹是候选；包名/签名/分包完整性尚未验证' };
  });
}

export async function script(context, args) {
  const input = await context.paths.input(args.path);
  const options = { syntax: args.syntax || 'javascript' };
  if (args.action === 'map') {
    if (!args.mapPath || args.line === undefined || args.column === undefined) throw new Error('map要求mapPath、line(从1)、column(从0)');
    options.mapPath = await context.paths.input(args.mapPath); options.line = args.line; options.column = args.column;
  }
  return context.jobs.start(`JS ${args.action}`, async (signal, dir) => {
    const result = checked(await run(process.execPath, ['--max-old-space-size=512', scriptHelper, args.action, input, path.join(dir, 'script.json'), JSON.stringify(options)], { signal, timeoutMs: 60000, maxBytes: 256000 }), 'JS静态分析');
    return JSON.parse(result.stdout);
  });
}
