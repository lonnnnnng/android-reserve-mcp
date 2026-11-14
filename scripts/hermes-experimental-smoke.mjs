// long: 新版HBC只能显式实验反汇编，非空产物仍须保留版本警告与partial证据。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, framework } from '../src/actions.js';
const [input, workspace] = process.argv.slice(2);
if (!input || !workspace) throw new Error('用法: node scripts/hermes-experimental-smoke.mjs HBC WORKSPACE');
const c = await createContext({ allowedRoots: [path.dirname(path.resolve(input))], workspace, disabled: true });
try {
  const initial = await framework(c, { action: 'analyze', engine: 'hermes', path: input, allowExperimental: true });
  let job;
  for (let i = 0; i < 3600; i++) { job = await c.jobs.get(initial.id); if (!['queued', 'running'].includes(job.state)) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(job.state, 'partial', job.error);
  const report = JSON.parse(await fs.readFile(path.join(job.dir, 'result.json')));
  assert.ok(report.bytecodeVersion >= 97 && report.bytecodeVersion <= 99);
  assert.match(report.compatibility, /experimental/);
  assert.ok((await fs.stat(path.join(job.dir, 'output/disassembly.hasm'))).size > 0);
  console.log(JSON.stringify({ jobId: job.id, ...report }));
} finally { await c.close(); }
