import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jadxEngine } from './backend.js';
import { run, tool, checked } from './process.js';
import { dexInputSource, snapshotDexInputs, fileIdentity } from './dex-inputs.js';
import { parseMapping } from './mapping.js';
import { methodIdentity, parseMethodId, runtimeSelector, normalizeClassName } from './method-id.js';

export function exactSelector(args) {
  let identity = args.methodId ? parseMethodId(args.methodId) : null;
  if (args.descriptor) identity = methodIdentity(args.className || identity?.className, args.methodName || identity?.methodName, args.descriptor);
  if (args.methodId && args.descriptor && parseMethodId(args.methodId).methodId !== identity.methodId) throw new Error('methodId与descriptor选择冲突');
  if (identity && ((args.className && normalizeClassName(args.className) !== identity.className) || (args.methodName && args.methodName !== identity.methodName))) throw new Error('完整methodId与类/方法参数冲突');
  if (args.overloadIndex !== undefined) throw new Error('原始DEX查询不接受overloadIndex，请使用完整methodId或descriptor');
  if (args.definitionId !== undefined && !/^[a-f0-9]{64}$/.test(args.definitionId)) throw new Error('definitionId必须是报告中的完整SHA256身份');
  return identity || { className: args.className ? normalizeClassName(args.className) : undefined, methodName: args.methodName };
}

export function projectDexReport(report, mapping) {
  for (const row of report.classes || []) if (mapping) row.mapping = mapping.classMapping(row.className);
  for (const row of report.methods || []) {
    row.runtimeSelector = runtimeSelector(row);
    if (mapping) row.mapping = mapping.resolve(row.className, row.methodName, row.descriptor);
  }
  for (const row of report.targetDefinitions || []) {
    if (row.methodId) { row.runtimeSelector = runtimeSelector(row); if (mapping) row.mapping = mapping.resolve(row.className, row.methodName, row.descriptor); }
    else if (mapping) row.mapping = mapping.classMapping(row.className);
  }
  for (const row of report.references || []) {
    row.sourceMethod.runtimeSelector = runtimeSelector(row.sourceMethod);
    if (mapping) {
      const source = row.sourceMethod, target = row.target;
      source.mapping = mapping.resolve(source.className, source.methodName, source.descriptor);
      target.mapping = target.methodId ? mapping.resolve(target.className, target.methodName, target.descriptor) : mapping.classMapping(target.className);
    }
  }
  if (mapping) { report.mapping = { ...mapping.metadata, records: mapping.records, partial: mapping.partial, warnings: mapping.warnings, association: 'caller-supplied-build-match-unverified' }; report.partial ||= mapping.partial; }
  if (report.action !== 'classes' && report.resolution.status === 'ambiguous') report.partial = true;
  return report;
}

export function serializeDexReport(report, maximumBytes = 16 * 1024 * 1024) {
  const fields = ['classes', 'methods', 'references', 'targetDefinitions'];
  const header = { ...report }; for (const field of fields) if (Array.isArray(header[field])) header[field] = [];
  let bytes = Buffer.byteLength(JSON.stringify(header)), omitted = {};
  for (const field of fields) {
    if (!Array.isArray(report[field])) continue;
    const retained = [];
    for (const row of report[field]) {
      const size = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (bytes + size > maximumBytes - 16384) break;
      bytes += size; retained.push(row);
    }
    if (retained.length !== report[field].length) omitted[field] = report[field].length - retained.length;
    report[field] = retained;
  }
  // long: 名称投影和Frida重载参数会扩大结果，必须在最终写盘前重新预算，避免原始16MiB报告膨胀成无界产物。
  if (Object.keys(omitted).length) {
    report.partial = true; report.rawCoverageIncomplete = true;
    report.projectionTruncation = omitted;
    report.resolution = { ...report.resolution, status: 'unknown', reason: 'projected-report-budget' };
    delete report.sourceArtifact; delete report.sourceIdentity;
  }
  const serialized = JSON.stringify(report);
  if (Buffer.byteLength(serialized) > maximumBytes) throw new Error('DEX报告头部超过预算');
  return serialized;
}

export async function rawDexQuery(context, args) {
  const source = await dexInputSource(context, args), selector = exactSelector(args);
  if (args.action !== 'classes' && !selector.className) throw new Error('查询必须明确className或完整methodId');
  if (args.action === 'method' && !selector.methodName) throw new Error('方法查询必须明确methodName或完整methodId');
  if (args.action === 'classes' && (selector.className || selector.methodName || args.definitionId || args.includeSource)) throw new Error('classes只接受类名query，不接受单一定义选择或源码展示');
  if (args.action === 'class' && (selector.methodName || selector.descriptor)) throw new Error('class查询不能同时选择方法');
  if (args.action !== 'classes' && args.query) throw new Error('query只用于classes查询');
  if (args.action === 'references' && args.includeSource) throw new Error('references不展示单个定义源码，请先查询class或method');
  const mappingPath = args.mappingPath ? await context.paths.input(args.mappingPath) : null;
  return context.jobs.start('原始DEX ' + args.action, async (signal, dir) => {
    const prepared = await snapshotDexInputs(context, source, dir, signal);
    let mapping;
    if (mappingPath) {
      if ((await fs.stat(mappingPath)).size > 16 * 1024 * 1024) throw new Error('mapping超过16MiB');
      const file = path.join(dir, 'mapping.txt'); await fs.copyFile(mappingPath, file);
      mapping = parseMapping(await fs.readFile(file, 'utf8')); mapping.identity = await fileIdentity(file, signal);
    }
    const engine = await jadxEngine({ signal });
    if (!engine.exists || !engine.checksumMatches) throw new Error('原始DEX查询需要已核验SHA的headless JADX 0.7.1 JAR');
    const classes = path.join(dir, 'query-classes'); await fs.mkdir(classes);
    const helper = fileURLToPath(new URL('../../helpers/DexQuery.java', import.meta.url));
    checked(await run(await tool('javac'), ['-encoding', 'UTF-8', '-cp', engine.path, '-d', classes, helper], { signal, timeoutMs: 90000 }), '编译原始DEX查询助手');
    const mappedClasses = mapping && args.query ? mapping.rawClassesForQuery(args.query) : [];
    const selectionIncomplete = mappedClasses.length > 5000 || !!(mapping?.partial && args.query);
    const config = { action: args.action, ...selector, query: args.query || '', definitionId: args.definitionId,
      inputs: prepared.inputs, extraClasses: mappedClasses.slice(0, 5000), includeSource: !!args.includeSource, inputIncomplete: prepared.partial || selectionIncomplete };
    const configFile = path.join(dir, 'query-config.json'); await fs.writeFile(configFile, JSON.stringify(config));
    const result = await run(await tool('java'), ['-Xmx1536m', '-XX:ActiveProcessorCount=2', '-cp', classes + path.delimiter + engine.path, 'DexQuery', configFile, path.join(dir, 'dex.json')], { signal, timeoutMs: 180000, maxBytes: 256000 });
    await fs.writeFile(path.join(dir, 'dex-query.log'), result.stdout + '\n' + result.stderr); checked(result, '原始DEX查询');
    const reportFile = path.join(dir, 'dex.json'); if ((await fs.stat(reportFile)).size > 16 * 1024 * 1024) throw new Error('DEX报告超过16MiB');
    const report = projectDexReport(JSON.parse(await fs.readFile(reportFile, 'utf8')), mapping);
    report.inputs = prepared.inputs.map(({ path: snapshot, ...input }) => ({ ...input, snapshot: path.basename(snapshot) }));
    report.packageSource = { packageJobId: prepared.packageJobId, validation: prepared.validation };
    report.partial ||= prepared.partial;
    if (selectionIncomplete || prepared.partial) report.resolution = { ...report.resolution, status: 'unknown', reason: 'input-or-selection-incomplete' };
    if (mapping) report.mapping.input = mapping.identity;
    await fs.writeFile(reportFile, serializeDexReport(report));
    return { report: 'dex.json', kind: 'raw-dex-query', classes: report.classes.length, methods: report.methods.length, references: report.references.length,
      resolution: report.resolution, inputs: report.inputs, mapping: report.mapping, partial: report.partial, sourceArtifact: report.sourceArtifact };
  });
}
