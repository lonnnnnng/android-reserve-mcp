import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { run, tool, checked } from './process.js';
import { jadxEngine } from './backend.js';
import { dexInputSource, snapshotDexInputs, fileIdentity } from './dex-inputs.js';
import { parseMapping } from './mapping.js';
import { methodIdentity, runtimeSelector } from './method-id.js';

const OUTPUT_BYTES = 32 * 1024 * 1024;
const candidates = rows => rows.slice(0, 16).map(row => ({ definitionId: row.definitionId, identity: row.identity }));
const sameDex = (identity, dex) => ['inputSha256', 'source', 'dexEntry', 'zipIndex', 'dexSha256'].every(field => identity[field] === dex[field]);

function indexRows(rows, field) {
  const index = new Map();
  for (const row of rows) { if (!index.has(row[field])) index.set(row[field], []); index.get(row[field]).push(row); }
  return index;
}

export function recordMetadataAttempt(result, report, origin) {
  if (result.canceled) checked(result, 'Kotlin metadata分析');
  const state = result.timedOut ? 'timed-out' : result.code === 0 ? 'completed' : 'failed';
  (report.metadataAttempts ||= []).push({ inputSha256: origin.inputSha256, dexSha256: origin.dexSha256, dexEntry: origin.dexEntry, source: origin.source, state, code: result.code });
  if (state === 'completed') return true;
  // long: 后续DEX耗尽预算或解析退出不能抹掉此前完成的类；取消仍由任务处理，失败来源和已完成汇总一同保留。
  report.partial = true; report.warnings.push({ kind: 'metadata-dex-' + state, dexEntry: origin.dexEntry, source: origin.source, message: String(result.stderr || '').slice(-500) });
  return false;
}

function projectClass(row, origin, rawClasses, rawMethods, incomplete, mapping) {
  const definitions = rawClasses.get(row.className) || [];
  const local = definitions.filter(value => sameDex(value.identity, origin));
  row.inputSha256 = origin.inputSha256; row.dexSha256 = origin.dexSha256; row.source = origin.source; row.dexEntry = origin.dexEntry;
  row.definitionCandidates = candidates(definitions);
  row.definitionResolution = incomplete ? 'unknown' : definitions.length === 1 ? 'unique' : definitions.length > 1 ? 'ambiguous' : 'not-found';
  row.metadataAssociation = local.length === 1 ? 'selected-dex-class-name' : 'selected-dex-class-name-ambiguous';
  if (local.length === 1) row.identity = local[0].identity;
  if (definitions.length > 16) row.definitionCandidatesTruncated = true;
  if (mapping) row.mapping = mapping.classMapping(row.className);
  function projectSignature(target, signature) {
    try {
      const parameters = signature.indexOf('(');
      const identity = methodIdentity(row.className, signature.slice(0, parameters), signature.slice(parameters));
      const matches = rawMethods.get(identity.methodId) || [];
      const status = incomplete ? 'unknown' : definitions.length > 1 ? 'ambiguous-class' : matches.length === 1 ? 'unique' : matches.length ? 'ambiguous' : 'not-found';
      target.rawMethodId = identity.methodId; target.definitionCandidates = candidates(matches); target.definitionResolution = status;
      target.runtimeSelector = runtimeSelector(identity);
      if (matches.length > 16) target.definitionCandidatesTruncated = true;
      if ('exactDexMatch' in target) {
        // long: JVM签名必须在当前DEX和整个所选集合中同时唯一；metadata与JADX的同名去重不能证明被哪个loader加载。
        target.exactDexMatch = !!target.exactDexMatch && status === 'unique' && matches.some(value => sameDex(value.identity, origin));
      }
      if (mapping) target.mapping = mapping.resolve(identity.className, identity.methodName, identity.descriptor);
    } catch (error) {
      target.definitionResolution = 'unknown'; target.signatureError = String(error.message).slice(0, 300);
      if ('exactDexMatch' in target) target.exactDexMatch = false;
    }
  }
  for (const fn of row.functions || []) if (typeof fn.jvmSignature === 'string') projectSignature(fn, fn.jvmSignature);
  for (const signal of row.composeSignals || []) if (typeof signal.jvmSignature === 'string') projectSignature(signal, signal.jvmSignature);
  return row;
}

export async function kotlinMetadata(context, args) {
  const source = await dexInputSource(context, args);
  if (args.methodId || args.descriptor || args.definitionId || args.methodName || args.className || args.overloadIndex !== undefined || args.includeSource) throw new Error('kotlin只接受输入集合、mappingPath与类名前缀query');
  const mappingPath = args.mappingPath ? await context.paths.input(args.mappingPath) : null;
  return context.jobs.start('Kotlin原始metadata', async (signal, dir) => {
    const deadline = Date.now() + 600000;
    const prepared = await snapshotDexInputs(context, source, dir, signal);
    let mapping;
    if (mappingPath) {
      if ((await fs.stat(mappingPath)).size > 16 * 1024 * 1024) throw new Error('mapping超过16MiB');
      const file = path.join(dir, 'mapping.txt'); await fs.copyFile(mappingPath, file); await fs.chmod(file, 0o400);
      mapping = parseMapping(await fs.readFile(file, 'utf8')); mapping.identity = await fileIdentity(file, signal);
    }
    const base = process.env.ANDROID_RESERVE_KOTLIN_HOME || path.join(os.homedir(), '.local/share/android-reserve-mcp/engines/kotlin');
    if (!path.isAbsolute(base)) throw new Error('ANDROID_RESERVE_KOTLIN_HOME必须是绝对路径');
    const engine = await jadxEngine(), jar = engine.path;
    if (!engine.exists || !engine.absolute || !engine.checksumMatches) throw new Error('Kotlin分析需要已验证SHA256的headless JADX 0.7.1 JAR');
    const libraries = [path.join(base,'kotlin-metadata-jvm-2.3.21.jar'),path.join(base,'kotlin-stdlib-2.3.21.jar'),jar];
    for (const file of libraries) await fs.access(file).catch(() => { throw new Error('缺少Kotlin分析依赖：'+file); });
    const helpers = ['MetadataInspect.java', 'DexQuery.java'].map(name => fileURLToPath(new URL('../../helpers/' + name, import.meta.url)));
    const classes = path.join(dir,'classes'); await fs.mkdir(classes);
    const cp = libraries.join(path.delimiter);
    checked(await run(await tool('javac'), ['-encoding','UTF-8','-cp',cp,'-d',classes,...helpers], { signal, timeoutMs: 90000 }), '编译Kotlin分析助手');
    const java = await tool('java'), javaArgs = ['-Xmx1536m','-XX:ActiveProcessorCount=2','-cp',classes+path.delimiter+cp];
    const mappedClasses = mapping && args.query ? mapping.rawClassesForQuery(args.query, { prefix: true }) : [];
    const selectionIncomplete = mappedClasses.length > 5000 || !!(mapping?.partial && args.query);
    const config = path.join(dir, 'kotlin-query-config.json'), rawFile = path.join(dir, 'kotlin-dex-index.json');
    await fs.writeFile(config, JSON.stringify({ action: 'classes', query: args.query || '', queryPrefix: true, inputs: prepared.inputs,
      extraClasses: mappedClasses.slice(0, 5000), indexMethods: true, exportDex: true, inputIncomplete: prepared.partial || selectionIncomplete }));
    const indexed = await run(java, [...javaArgs, 'DexQuery', config, rawFile], { signal, timeoutMs: 180000, maxBytes: 256000 });
    await fs.writeFile(path.join(dir, 'kotlin-dex-index.log'), indexed.stdout + indexed.stderr); checked(indexed, 'Kotlin原始DEX索引');
    if ((await fs.stat(rawFile)).size > 16 * 1024 * 1024) throw new Error('Kotlin原始DEX索引超过16MiB');
    const raw = JSON.parse(await fs.readFile(rawFile, 'utf8'));
    const rawClasses = indexRows(raw.classes, 'className'), rawMethods = indexRows(raw.methods, 'methodId');
    const incomplete = raw.rawCoverageIncomplete || raw.partial || prepared.partial || selectionIncomplete;
    const report = { kind: 'kotlin-metadata', classes: [], inputs: prepared.inputs.map(({ path: file, ...input }) => ({ ...input, snapshot: path.basename(file) })),
      packageSource: { packageJobId: prepared.packageJobId, validation: prepared.validation }, rawIndex: path.basename(rawFile),
      partial: !!(incomplete || mapping?.partial), warnings: [...(raw.warnings || [])], examined: 0, visited: 0, composeInstructions: 0,
      limitation: '按所选原始DEX读取metadata与完整JVM签名；分包重复定义保持歧义，静态引用不证明loader选择、重组或异步运行因果' };
    if (prepared.inputs.length === 1) report.input = { path: prepared.inputs[0].originalPath, bytes: prepared.inputs[0].bytes, sha256: prepared.inputs[0].sha256 };
    if (mapping) report.mapping = { ...mapping.metadata, records: mapping.records, input: mapping.identity, partial: mapping.partial, warnings: mapping.warnings, association: 'caller-supplied-build-match-unverified' };
    let retained = 0, analyzedDexes = 0;
    for (const origin of raw.dexes) {
      if (signal.aborted) throw new Error('Kotlin分析已取消');
      const selected = raw.classes.filter(row => sameDex(row.identity, origin)).map(row => row.className);
      if (!selected.length) continue;
      if (++analyzedDexes > 256 || Date.now() >= deadline || report.classes.length >= 5000) { report.partial = true; report.warnings.push('metadata累计DEX、时间或5000类预算耗尽'); break; }
      const input = await context.paths.artifact(dir, origin.artifact);
      if ((await fileIdentity(input, signal)).sha256 !== origin.dexSha256) throw new Error('metadata DEX快照SHA与原始索引不符');
      await fs.chmod(input, 0o400);
      const selection = path.join(dir, 'metadata-selection-' + analyzedDexes + '.json'); await fs.writeFile(selection, JSON.stringify([...new Set(selected)]));
      const output = path.join(dir, 'metadata-' + analyzedDexes + '.json');
      // long: 每个DEX单独交给JADX，先核对原始定义，再读取metadata，避免聚合输入去重使不同split的注解来源串换。
      const result = await run(java, [...javaArgs, 'MetadataInspect', input, output, '', '@' + selection, 'selected-only'], { signal, timeoutMs: Math.max(1, Math.min(180000, deadline - Date.now())), maxBytes: 256000 });
      await fs.writeFile(path.join(dir, 'metadata-' + analyzedDexes + '.log'), result.stdout + result.stderr);
      if (!recordMetadataAttempt(result, report, origin)) { if (result.timedOut) break; continue; }
      if ((await fs.stat(output)).size > 16 * 1024 * 1024) throw new Error('单DEX metadata报告超过16MiB');
      const metadata = JSON.parse(await fs.readFile(output, 'utf8'));
      report.partial ||= metadata.partial; report.examined += metadata.examined; report.visited += metadata.visited; report.composeInstructions += metadata.composeInstructions;
      for (const value of metadata.classes) {
        const row = projectClass(value, origin, rawClasses, rawMethods, incomplete, mapping);
        const size = Buffer.byteLength(JSON.stringify(row)) + 1;
        if (retained + size > OUTPUT_BYTES - 2 * 1024 * 1024 || report.classes.length >= 5000) { report.partial = true; report.warnings.push('metadata投影报告预算耗尽'); break; }
        retained += size; report.classes.push(row);
      }
    }
    const serialized = JSON.stringify(report); if (Buffer.byteLength(serialized) > OUTPUT_BYTES) throw new Error('Kotlin投影报告超过32MiB');
    await fs.writeFile(path.join(dir, 'kotlin.json'), serialized);
    return { report: 'kotlin.json', classes: report.classes.length, partial: report.partial, input: report.input, inputs: report.inputs,
      packageSource: report.packageSource, mapping: report.mapping, rawIndex: report.rawIndex, engine: 'kotlin-metadata-jvm-2.3.21' };
  });
}
