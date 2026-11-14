// long: 目标脚本只进入解析器，不使用 eval/vm/require 执行；独立进程限制AST分析的内存与时间。
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { generate } from '@babel/generator';
import { AnyMap, originalPositionFor } from '@jridgewell/trace-mapping';

const [action, input, output, rawOptions = '{}'] = process.argv.slice(2);
const options = JSON.parse(rawOptions);
const MAX_FILE = 12 * 1024 * 1024, MAX_ROWS = 12000;
async function read(file) {
  if ((await fs.stat(file)).size > MAX_FILE) throw new Error('脚本/map 超过12MiB预算，请先分离目标模块');
  return fs.readFile(file);
}
const bytes = await read(input);
const identity = { path: input, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
const location = node => ({ start: node.start, end: node.end, line: node.loc?.start.line, column: node.loc?.start.column });
let report;
if (action === 'map') {
  const mapBytes = await read(options.mapPath), mapDigest = createHash('sha256').update(mapBytes).digest('hex');
  const map = JSON.parse(mapBytes.toString('utf8'));
  let sections = 0;
  function validate(value, depth = 0) {
    if (depth > 8 || value?.version !== 3) throw new Error('无效source map版本或嵌套超限');
    if (value.sections) {
      let previous = [-1, -1];
      for (const section of value.sections) {
        if (++sections > 1000 || section.url !== undefined || !section.map) throw new Error('仅支持内联sections，不自动读取外部map URL');
        const { line, column } = section.offset || {};
        if (!Number.isSafeInteger(line) || line < 0 || !Number.isSafeInteger(column) || column < 0 || line < previous[0] || (line === previous[0] && column <= previous[1])) throw new Error('无效或无序section offset');
        previous = [line, column]; validate(section.map, depth + 1);
      }
    } else if (!Array.isArray(value.sources) || typeof value.mappings !== 'string') throw new Error('无效普通source map');
  }
  validate(map);
  // long: sources/sourceRoot只作为结果标签，不把map内容当成文件读取或网络访问授权。
  const position = originalPositionFor(new AnyMap(map), { line: options.line, column: options.column });
  report = { kind: 'source-map-position', input: identity, map: { path: options.mapPath, sha256: mapDigest, bytes: mapBytes.length }, generated: { line: options.line, column: options.column }, original: position, status: position.source === null ? 'unmapped' : 'mapped', limitation: '映射关系来自调用者提供的map，未证明它与当前bundle同一构建' };
} else {
  if (bytes.includes(0)) throw new Error('目标包含二进制数据；请先识别Hermes/Wasm等格式');
  const source = bytes.toString('utf8');
  const plugins = ['jsx'];
  if (options.syntax === 'typescript') plugins.push('typescript');
  if (options.syntax === 'flow') plugins.push('flow');
  const ast = parse(source, { sourceType: 'unambiguous', sourceFilename: input, ranges: true, createImportExpressions: true, plugins });
  const functions = [], imports = [], calls = [], strings = [], urls = [];
  let nodes = 0, truncated = false;
  const add = (rows, item) => { if (rows.length < MAX_ROWS) rows.push(item); else truncated = true; };
  const label = node => source.slice(node.start, Math.min(node.end, node.start + 200));
  traverse(ast, {
    enter(p) { if (++nodes > 700000) throw new Error('AST节点超过预算，请缩小目标脚本'); },
    Function(p) {
      const parent = p.parent;
      const name = p.node.id?.name || (parent.type === 'VariableDeclarator' ? parent.id.name : p.node.key?.name) || null;
      add(functions, { name, type: p.node.type, async: p.node.async, generator: p.node.generator, parameters: p.node.params.map(label), ...location(p.node) });
    },
    'ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration'(p) { if (p.node.source) add(imports, { type: p.node.type, source: p.node.source.value, ...location(p.node) }); },
    ImportExpression(p) { add(imports, { type: 'dynamic-import', source: p.node.source.type === 'StringLiteral' ? p.node.source.value : null, expression: label(p.node.source), ...location(p.node) }); },
    'CallExpression|OptionalCallExpression|NewExpression'(p) {
      const callee = p.node.callee;
      const binding = callee.type === 'Identifier' ? p.scope.getBinding(callee.name) : null;
      const bound = binding?.path.node;
      // long: 变量声明起点不同于函数表达式起点；只对直接绑定函数保留精确目标，不猜测赋值后的运行值。
      const target = bound?.type === 'VariableDeclarator' ? bound.init : bound;
      add(calls, { callee: label(callee), type: p.node.type, enclosingFunction: p.getFunctionParent()?.node.start ?? null, bindingStart: bound?.start ?? null, bindingFunctionStart: binding?.constant && /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(target?.type || '') ? target.start : null, ...location(p.node) });
      if (callee.type === 'Identifier' && callee.name === 'require' && !binding && p.node.arguments[0]?.type === 'StringLiteral') add(imports, { type: 'commonjs-candidate', source: p.node.arguments[0].value, ...location(p.node) });
    },
    StringLiteral(p) {
      const value = p.node.value;
      add(strings, { value: value.slice(0, 4000), valueTruncated: value.length > 4000, ...location(p.node) });
      if (/^(?:https?|wss?):\/\//i.test(value)) add(urls, { value: value.slice(0, 4000), ...location(p.node) });
    },
    TemplateLiteral(p) {
      if (!p.node.expressions.length) add(strings, { value: p.node.quasis[0].value.cooked?.slice(0, 4000), ...location(p.node) });
    },
  });
  report = { kind: 'javascript-static-index', input: identity, syntax: options.syntax || 'javascript', coordinate: '原输入UTF-16 offset，line从1、column从0', nodes, functions, imports, calls, strings, urls, partial: truncated, limitation: '静态调用点和词法binding不是完整运行时调用图；不恢复已删除的类型、原名或动态生成代码' };
  if (action === 'format') {
    const formatted = generate(ast, { comments: true, compact: false, minified: false, sourceMaps: true, sourceFileName: path.basename(input) }, source);
    await fs.writeFile(path.join(path.dirname(output), 'formatted.js'), formatted.code);
    await fs.writeFile(path.join(path.dirname(output), 'formatted.js.map'), JSON.stringify(formatted.map));
    report.formatted = 'formatted.js';
  }
}
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: path.basename(output), kind: report.kind, functions: report.functions?.length, calls: report.calls?.length, imports: report.imports?.length, partial: !!report.partial, status: report.status, formatted: report.formatted }));
