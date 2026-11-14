// long: 真实APK必须先经artifact提取，再读store和IL；同包引用恢复原名后只供ILSpy静态解析。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, artifact, managed, framework } from '../src/actions.js';

const [apk, member, assemblyName, marker, workspace] = process.argv.slice(2);
if (![apk, member, assemblyName, marker, workspace].every(Boolean)) throw new Error('用法: node scripts/maui-apk-smoke.mjs APK STORE_MEMBER ASSEMBLY MARKER WORKSPACE');
const c = await createContext({ allowedRoots: [path.dirname(path.resolve(apk))], workspace, disabled: true }), results = [];
async function complete(operation) {
  const initial = await operation;
  for (let i = 0; i < 3600; i++) {
    const job = await c.jobs.get(initial.id);
    if (!['queued', 'running'].includes(job.state)) {
      assert.equal(job.state, 'succeeded', job.error);
      const result = JSON.parse(await fs.readFile(path.join(job.dir, 'result.json')));
      results.push({ jobId: job.id, state: job.state, label: job.label });
      return { job, result };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('MAUI验收任务超时');
}
let passed = false;
try {
  const extracted = await complete(artifact(c, { action: 'extract', path: apk, chain: [member] }));
  const filename = 'extracted-' + path.basename(member);
  const store = await complete(managed(c, { action: 'extract', path: path.join(extracted.job.dir, filename) }));
  const refs = path.join(c.paths.workspace, 'references-' + store.job.id); await fs.mkdir(refs);
  for (const entry of store.result.entries) if (entry.artifact && entry.name?.endsWith('.dll') && path.basename(entry.name) === entry.name) {
    await fs.copyFile(path.join(store.job.dir, 'assemblies', entry.artifact), path.join(refs, entry.name));
  }
  const code = await complete(framework(c, { action: 'analyze', engine: 'ilspy', path: path.join(refs, assemblyName), referencePath: refs }));
  const sources = (await Promise.all(code.result.files.filter(row => row.path.endsWith('.cs')).map(row => fs.readFile(path.join(code.job.dir, 'output', row.path), 'utf8')))).join('\n');
  assert.ok(sources.includes(marker)); assert.match(sources, /a\s*\+\s*b\s*\+\s*37/);
  passed = true;
  console.log(JSON.stringify({ passed, storeVersion: store.result.version, assemblies: store.result.entries.length, references: code.result.references.length, results }));
} finally {
  await fs.writeFile(path.join(c.paths.workspace, 'validation.json'), JSON.stringify({ passed, apk, member, assemblyName, marker, results }, null, 2));
  await c.close();
}
