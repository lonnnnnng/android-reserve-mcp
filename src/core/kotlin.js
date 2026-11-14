import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run, tool, checked } from './process.js';
import { jadxEngine } from './backend.js';

export async function kotlinMetadata(context, args) {
  const input = await context.paths.input(args.path);
  if ((await fs.stat(input)).size > 512*1024*1024) throw new Error('Kotlin输入超过512MiB');
  return context.jobs.start('Kotlin原始metadata', async (signal, dir) => {
    const base = process.env.ANDROID_RESERVE_KOTLIN_HOME || path.join(os.homedir(), '.local/share/android-reserve-mcp/engines/kotlin');
    if (!path.isAbsolute(base)) throw new Error('ANDROID_RESERVE_KOTLIN_HOME必须是绝对路径');
    const engine = await jadxEngine(), jar = engine.path;
    if (!engine.exists || !engine.absolute || !engine.checksumMatches) throw new Error('Kotlin分析需要已验证SHA256的headless JADX 0.7.1 JAR');
    const libraries = [path.join(base,'kotlin-metadata-jvm-2.3.21.jar'),path.join(base,'kotlin-stdlib-2.3.21.jar'),jar];
    for (const file of libraries) await fs.access(file).catch(() => { throw new Error('缺少Kotlin分析依赖：'+file); });
    const source = fileURLToPath(new URL('../../helpers/MetadataInspect.java', import.meta.url)), classes = path.join(dir,'classes'); await fs.mkdir(classes);
    const cp = libraries.join(path.delimiter);
    checked(await run(await tool('javac'), ['-encoding','UTF-8','-cp',cp,'-d',classes,source], { signal, timeoutMs: 90000 }), '编译Kotlin分析助手');
    const snapshot = path.join(dir,'input'+path.extname(input)); await fs.copyFile(input,snapshot);
    const result = await run(await tool('java'), ['-Xmx2048m','-XX:ActiveProcessorCount=2','-cp',classes+path.delimiter+cp,'MetadataInspect',snapshot,path.join(dir,'kotlin.json'),args.query || ''], { signal, timeoutMs: 180000, maxBytes: 512000 });
    await fs.writeFile(path.join(dir,'kotlin.log'),result.stdout+result.stderr); checked(result,'Kotlin metadata分析');
    const report = JSON.parse(await fs.readFile(path.join(dir,'kotlin.json'),'utf8'));
    const bytes = await fs.readFile(snapshot);
    return { report: 'kotlin.json', classes: report.classes.length, partial: report.partial, input: { path: input, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, engine: 'kotlin-metadata-jvm-2.3.21' };
  });
}
