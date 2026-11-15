import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectSnapshots, validatePackageSet } from './packages.js';

export async function fileIdentity(file, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return { sha256: hash.digest('hex'), bytes: (await fs.stat(file)).size };
}

export async function dexInputSource(context, args) {
  if (Number(!!args.path) + Number(!!args.packageJobId) !== 1) throw new Error('DEX输入必须在path与packageJobId之间选择一项');
  if (args.packageJobId) {
    if (args.members !== undefined) throw new Error('packageJobId已固定分包选择，不能同时传members');
    const job = await context.jobs.get(args.packageJobId);
    if (!['succeeded', 'partial'].includes(job.state)) throw new Error('分包来源任务尚未成功结束');
    const file = await context.paths.artifact(job.dir, 'packages.json');
    if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error('分包来源报告超过2MiB');
    const report = JSON.parse(await fs.readFile(file, 'utf8'));
    if (report.validation?.valid !== true || !Array.isArray(report.records) || !report.records.length || !validatePackageSet(report.records).valid) throw new Error('仅接受一致性验证通过的所选分包快照');
    if (report.records.length > 128) throw new Error('分包数量超过128项');
    if (report.records.some(record => typeof record.path !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256 || '') || !Number.isSafeInteger(record.bytes) || record.bytes < 0)) throw new Error('分包来源报告缺少完整路径、SHA256或字节身份');
    return { packageJobId: job.id, jobDir: job.dir, records: report.records, validation: report.validation, partial: !!report.partial };
  }
  return { path: await context.paths.input(args.path, { directory: null }), members: args.members };
}

export async function snapshotDexInputs(context, source, dir, signal) {
  let records = source.records, validation = source.validation;
  if (!records) {
    const stat = await fs.stat(source.path);
    if (stat.isDirectory() || source.members || source.path.toLowerCase().endsWith('.apks')) {
      const folder = path.join(dir, 'package-selection'); await fs.mkdir(folder);
      const report = await inspectSnapshots({ members: source.members }, source.path, folder, signal);
      if (!report.validation?.valid) throw new Error('分包选择或一致性未通过，不能建立集合查询');
      records = report.records; validation = report.validation;
    } else records = [{ path: source.path, source: path.basename(source.path) }];
  }
  let total = 0; const inputs = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const original = source.jobDir ? await context.paths.artifact(source.jobDir, path.relative(source.jobDir, record.path)) : record.path;
    const stat = await fs.stat(original); total += stat.size;
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024 || total > 1024 * 1024 * 1024) throw new Error('DEX输入快照超过单项512MiB或累计1GiB预算');
    let file = path.join(dir, 'input-' + index + '.bin'); await fs.copyFile(original, file);
    const identity = await fileIdentity(file, signal);
    if (record.sha256 && (identity.sha256 !== record.sha256 || (record.bytes !== undefined && identity.bytes !== record.bytes))) throw new Error('分包快照已改变，SHA或字节数与原验证报告不符');
    const handle = await fs.open(file, 'r'), head = Buffer.alloc(4);
    try { await handle.read(head, 0, 4, 0); } finally { await handle.close(); }
    const kind = head.toString('ascii') === 'dex\n' ? 'dex' : head[0] === 0x50 && head[1] === 0x4b ? 'apk' : null;
    if (!kind) throw new Error('输入不是APK ZIP或标准DEX');
    if (kind === 'dex' && identity.bytes > 128 * 1024 * 1024) throw new Error('单DEX超过128MiB');
    const named = path.join(dir, 'input-' + index + '.' + (kind === 'dex' ? 'dex' : 'apk')); await fs.rename(file, named); file = named;
    // long: 查询使用独立只读快照；原分包报告继续保留来源，分析期间原文件变化不会串到结果身份。
    await fs.chmod(file, 0o400);
    inputs.push({ path: file, originalPath: original, source: record.source || path.basename(original), kind, ...identity, split: record.manifest?.split });
  }
  return { inputs, validation, packageJobId: source.packageJobId, partial: !!source.partial };
}
