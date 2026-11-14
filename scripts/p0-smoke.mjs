// long: 使用自有ARM64库和静态JS验证真实MCP/引擎，不分析用户应用。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve('output/p0-smoke');
const workspace = path.join(root, 'work');
const client = new Client({ name: 'p0-smoke', version: '0.2.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/cli.js', import.meta.url)), '--allowedRoots', root, '--workspace', workspace], stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const results = [];
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(JSON.stringify(response.content));
  return JSON.parse(response.content[0].text);
}
async function complete(name, args) {
  const initial = await call(name, args);
  for (let i = 0; i < 1800; i++) {
    const job = await call('jobs', { action: 'status', jobId: initial.id });
    if (!['running', 'queued'].includes(job.state)) {
      results.push({ tool: name, action: args.action, ...job }); console.log(JSON.stringify(results.at(-1)));
      assert.ok(['succeeded', 'partial'].includes(job.state), JSON.stringify(job));
      return { job, value: JSON.parse(await fs.readFile(path.join(workspace, 'jobs', job.id, 'result.json'))) };
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('任务未结束');
}
try {
  await client.connect(transport);
  await complete('artifact', { action: 'inspect', path: path.join(root, 'libfixture.so') });
  await fs.writeFile(path.join(root, 'fixture.js'), "export function fixture_add(a,b){return a+b} const n=fixture_add(2,7); fetch('https://fixture.invalid/api');");
  await complete('script', { action: 'format', path: path.join(root, 'fixture.js') });
  const opened = await complete('native', { action: 'open', path: path.join(root, 'libfixture.so'), provider: 'ghidra' });
  const targetId = opened.value.targetId;
  const functions = await complete('native', { action: 'functions', targetId });
  assert.match(JSON.stringify(functions.value.structuredContent), /fixture_add/);
  const addEntry = functions.value.structuredContent.normalized_result.find(f => f.value === 'fixture_add' && !f.procedure?.thunk).address;
  const analyzed = await complete('native', { action: 'function', targetId, procedure: 'fixture_compute' });
  assert.match(analyzed.value.structuredContent.normalized_result.pseudocode, /fixture_add\s*\(\s*a\s*,\s*7\s*\)/);
  assert.ok(analyzed.value.structuredContent.normalized_result.assembly.some(line => /\bbl\b/.test(line)));
  await complete('native', { action: 'references', targetId, procedure: addEntry, direction: 'incoming' });
  await complete('native', { action: 'callers', targetId, procedure: addEntry });
  await complete('native', { action: 'close', targetId });
} finally {
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ results, deviceAccessed: false }, null, 2));
  await client.close();
}
