import { methodIdentity, parseDescriptor, normalizeClassName } from './method-id.js';

const primitives = { void: 'V', boolean: 'Z', byte: 'B', short: 'S', char: 'C', int: 'I', long: 'J', float: 'F', double: 'D' };
function descriptorType(type, aliases, allowVoid = false) {
  let dimensions = 0;
  while (type.endsWith('[]')) { dimensions++; type = type.slice(0, -2); }
  if (!type || dimensions > 255 || (type === 'void' && (!allowVoid || dimensions))) throw new Error('mapping类型无效');
  const renamed = aliases.has(type) ? aliases.get(type) : type;
  if (renamed === null) throw new Error('mapping类型别名不唯一');
  if (!primitives[type] && /[\s;()[\]<>]/.test(renamed)) throw new Error('mapping对象类型无效');
  return '['.repeat(dimensions) + (primitives[type] || 'L' + renamed.replaceAll('.', '/') + ';');
}

function methodDescriptor(record, aliases) {
  if (record.residualDescriptor) return record.residualDescriptor;
  return '(' + record.parameters.map(type => descriptorType(type, aliases)).join('') + ')' + descriptorType(record.returnType, aliases, true);
}

export function parseMapping(source, { maximumRecords = 200000 } = {}) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 16 * 1024 * 1024) throw new Error('mapping超过16MiB');
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > 200000) throw new Error('mapping记录预算必须是1–200000的整数');
  const groups = new Map(), aliases = new Map(), originalClasses = new Map();
  const warnings = [], metadata = { versions: [] }; let group, pending, pendingKind, records = 0, malformed = 0, partial = false, activeVersion = 0;
  function warn(value) { if (warnings.length < 100) warnings.push(value); else partial = true; }
  function flush() {
    if (!pending || pendingKind !== 'method') { pending = null; return; }
    const key = JSON.stringify([pending.rawName, pending.originalOwner, pending.originalName, pending.returnType, pending.parameters]);
    const existing = group.methods.get(key);
    if (existing) {
      existing.sourceLines.push(...pending.sourceLines);
      if (existing.residualDescriptor && pending.residualDescriptor && existing.residualDescriptor !== pending.residualDescriptor) existing.conflict = true;
      else existing.residualDescriptor ||= pending.residualDescriptor;
      existing.conflict ||= pending.conflict;
      existing.synthesized ||= pending.synthesized;
    } else group.methods.set(key, pending);
    pending = null;
  }
  function comment(text, sourceLine) {
    let value;
    try { value = JSON.parse(text); } catch { return; }
    if (value?.id === 'com.android.tools.r8.mapping') {
      flush(); metadata.version = value.version;
      if (metadata.versions.length < 100) metadata.versions.push({ version: value.version, sourceLine }); else partial = true;
      activeVersion = typeof value.version === 'string' && /^(?:0|1\.0|2\.[012])$/.test(value.version) ? Number(value.version) : NaN;
      // long: 新版本注释的作用域从当前位置开始；未来版本的扩展不能按旧语义解释成确定的原始名称。
      if (!Number.isFinite(activeVersion)) { partial = true; warn({ kind: 'unsupported-mapping-version', version: value.version, sourceLine }); }
      return;
    }
    if (typeof value?.pg_map_id === 'string') metadata.mapId = value.pg_map_id.slice(0, 256);
    if (value?.id === 'sourceFile' && group && typeof value.fileName === 'string') group.sourceFile = value.fileName.slice(0, 1024);
    const minimum = value?.id === 'com.android.tools.r8.residualsignature' ? 2.2 : value?.id === 'com.android.tools.r8.synthesized' ? 1 : null;
    if (minimum === null) return;
    if (!Number.isFinite(activeVersion) || activeVersion < minimum) { warn({ kind: 'ignored-extension-version', id: value.id, sourceLine }); return; }
    if (value.id === 'com.android.tools.r8.synthesized') {
      if (pendingKind === 'method' && pending) pending.synthesized = true;
      else if (pendingKind === 'class' && group) group.synthesized = true;
    } else if (pendingKind === 'method' && pending) {
      try {
        parseDescriptor(value.signature);
        if (pending.residualDescriptor && pending.residualDescriptor !== value.signature) pending.conflict = true;
        pending.residualDescriptor = value.signature;
      } catch { pending.conflict = true; malformed++; partial = true; }
    }
  }
  const lines = source.split(/\r?\n/);
  if (lines.length > 300000) throw new Error('mapping行数超过预算');
  for (let index = 0; index < lines.length; index++) {
    const originalLine = lines[index];
    const marker = originalLine.indexOf('#'), tail = marker < 0 ? null : originalLine.slice(marker + 1).trim();
    const line = marker < 0 ? originalLine : originalLine.slice(0, marker), trimmed = line.trim();
    if (originalLine.length > 4096) { partial = true; malformed++; continue; }
    if (!trimmed) { if (tail !== null) comment(tail, index + 1); continue; }
    const header = /^([^\s]+)\s+->\s+([^\s]+):$/.exec(trimmed);
    if (header && !/^\s/.test(line)) {
      flush(); let original, raw;
      try { original = normalizeClassName(header[1]); raw = normalizeClassName(header[2]); } catch { malformed++; partial = true; group = null; continue; }
      if (++records > maximumRecords) { partial = true; break; }
      group = { original, raw, methods: new Map(), sourceLine: index + 1 };
      if (!groups.has(raw)) groups.set(raw, []); groups.get(raw).push(group);
      if (aliases.has(original) && aliases.get(original) !== raw) aliases.set(original, null); else if (!aliases.has(original)) aliases.set(original, raw);
      if (!originalClasses.has(original)) originalClasses.set(original, new Set()); originalClasses.get(original).add(raw);
      pendingKind = 'class'; if (tail !== null) comment(tail, index + 1); continue;
    }
    if (!group) { malformed++; partial = true; continue; }
    if (++records > maximumRecords) { partial = true; break; }
    const member = /^(?:(\d+):(\d+):)?([^\s]+)\s+([^\s(]+)\(([^)]*)\)(?::(\d+)(?::(\d+))?)?\s+->\s+([^\s]+)$/.exec(trimmed);
    if (!member) {
      flush(); pendingKind = 'field';
      if (!/^[^\s]+\s+[^\s]+\s+->\s+[^\s]+$/.test(trimmed)) { malformed++; partial = true; }
      continue;
    }
    const [, start, end, returnType, qualifiedName, params, originalStart, originalEnd, rawName] = member;
    const split = qualifiedName.lastIndexOf('.'), originalOwner = split < 0 ? group.original : qualifiedName.slice(0, split), originalName = qualifiedName.slice(split + 1);
    const record = { rawName, originalOwner, originalName, returnType, parameters: params ? params.split(',').map(type => type.trim()) : [], sourceLines: [index + 1], residualRange: start == null ? null : [Number(start), Number(end)], originalRange: originalStart == null ? null : [Number(originalStart), originalEnd == null ? null : Number(originalEnd)] };
    try {
      methodIdentity(originalOwner, originalName, methodDescriptor(record, new Map()));
      if (start != null && Number(start) > Number(end)) throw new Error('行范围倒序');
    } catch { malformed++; partial = true; flush(); pendingKind = null; continue; }
    const inline = pendingKind === 'method' && pending && start != null && pending.rawName === rawName &&
      JSON.stringify(pending.residualRange) === JSON.stringify(record.residualRange) && originalStart != null && originalEnd == null;
    // long: 内联记录的最后一层caller才对应残留方法；原始行范围完整的记录仍是独立候选，不能按同名直接折叠。
    if (inline) {
      const { inlinedFrames, ...frame } = pending;
      record.inlinedFrames = [...(inlinedFrames || []), frame].slice(-16);
      // long: residualsignature写在内联组首条记录下，却描述同一个残留方法；折叠caller时必须继承，原始descriptor仍由原始参数生成。
      record.residualDescriptor = pending.residualDescriptor;
      record.conflict = pending.conflict;
      if ((inlinedFrames || []).length >= 16) partial = true;
    }
    else flush();
    pending = record; pendingKind = 'method';
    if (tail !== null) comment(tail, index + 1);
  }
  flush();
  if (!groups.size) throw new Error('mapping没有有效类记录');
  if (malformed) warn({ kind: 'malformed-records', count: malformed });
  if (records > maximumRecords) warn({ kind: 'mapping-record-budget', maximumRecords });
  function classMapping(raw) {
    const found = groups.get(raw) || [];
    if (!partial && found.length === 1 && found[0].synthesized) return { status: 'synthesized', rawClassName: raw, originalClassNames: [], displayClassName: found[0].original, reason: 'not-in-original-program' };
    return { status: partial ? 'unknown' : !found.length ? 'unmapped' : found.length === 1 ? 'mapped' : 'ambiguous', rawClassName: raw, originalClassNames: found.map(value => value.original), ...(found.length > 1 ? { reason: 'ambiguous-class' } : partial ? { reason: 'mapping-incomplete' } : {}) };
  }
  function resolve(rawOwner, rawName, descriptor) {
    parseDescriptor(descriptor); const found = groups.get(rawOwner) || [];
    if (!found.length) return { status: partial ? 'unknown' : 'unmapped', reason: partial ? 'mapping-incomplete' : 'class-not-listed' };
    if (found.length !== 1) return { status: 'ambiguous', reason: 'ambiguous-class', candidates: found.map(value => value.original) };
    const byName = [...found[0].methods.values()].filter(record => record.rawName === rawName);
    if (byName.some(record => record.conflict)) return { status: 'ambiguous', reason: 'residual-signature-conflict' };
    let unresolved = false;
    const matches = byName.filter(record => { try { return methodDescriptor(record, aliases) === descriptor; } catch { unresolved = true; return false; } });
    // long: 类型别名冲突的记录仍可能匹配当前prototype，不能排除它后把剩余记录包装成唯一名称。
    if (unresolved) return { status: 'unknown', reason: 'type-alias-ambiguous' };
    if (matches.length !== 1) return { status: partial ? 'unknown' : matches.length || byName.length ? 'ambiguous' : 'unmapped', reason: partial ? 'mapping-incomplete' : matches.length ? 'multiple-records' : byName.length ? 'descriptor-mismatch' : 'method-not-listed', candidates: matches.map(record => ({ originalOwner: record.originalOwner, originalName: record.originalName, parameters: record.parameters, returnType: record.returnType, sourceLines: record.sourceLines })) };
    const record = matches[0];
    if (partial) return { status: 'unknown', reason: 'mapping-incomplete', candidates: [{ originalOwner: record.originalOwner, originalName: record.originalName }] };
    if (record.synthesized || found[0].synthesized) return { status: 'synthesized', reason: 'not-in-original-program', displayClassName: record.originalOwner, displayMethodName: record.originalName, sourceLines: record.sourceLines };
    // long: mapping仅投影名称，原始DEX选择与位置保留；没有同构建凭证时不把投影标成构建身份已验证。
    return { status: 'mapped', originalClassName: record.originalOwner, originalMethodName: record.originalName,
      originalSignature: record.originalOwner + '.' + record.originalName + '(' + record.parameters.join(',') + '):' + record.returnType,
      originalDescriptor: methodDescriptor({ ...record, residualDescriptor: undefined }, new Map()), sourceLines: [...new Set(record.sourceLines)], inlinedFrames: record.inlinedFrames || [], association: 'caller-supplied-build-match-unverified' };
  }
  return { resolve, classMapping, aliases, originalClasses, groups, partial, warnings, metadata, records,
    rawClassesForQuery(query, { prefix = false, limit = 5001 } = {}) {
      const output = new Set();
      for (const values of groups.values()) for (const group of values) if (prefix ? group.original.startsWith(query) : group.original.includes(query)) {
        output.add(group.raw); if (output.size >= limit) return [...output];
      }
      return [...output];
    } };
}
