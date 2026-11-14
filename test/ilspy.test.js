import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createContext, framework } from '../src/actions.js';

test('ILSpy引用只取显式普通DLL快照，源码诊断令结果partial且保留来源', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reserve-ilspy-')), prior = process.env.ANDROID_RESERVE_ILSPY;
  const executable = path.join(root, 'ilspy.mjs'), refs = path.join(root, 'references'); await fs.mkdir(refs);
  await fs.writeFile(path.join(refs, 'Owned.dll'), 'owned-reference');
  await fs.writeFile(executable, '#!/usr/bin/env node\nimport fs from "node:fs";import path from "node:path";const a=process.argv.slice(2),o=a[a.indexOf("-o")+1];fs.writeFileSync(path.join(o,"Owned.csproj"),"<Project/>");fs.writeFileSync(path.join(o,"Owned.cs"),"//IL_0000: Unknown result type (missing reference)\\nclass Owned {} ");');
  await fs.chmod(executable, 0o700); process.env.ANDROID_RESERVE_ILSPY = executable;
  const file = path.join(root, 'input.dll'), b = Buffer.alloc(512); b.write('MZ'); b.writeUInt32LE(64, 60); b.write('PE\0\0', 64); b.writeUInt16LE(0x10b, 88); b.writeUInt32LE(1, 88 + 96 + 112); await fs.writeFile(file, b);
  const c = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), disabled: true });
  const wait = async initial => { for (let i = 0; i < 200; i++) { const j = await c.jobs.get(initial.id); if (!['queued', 'running'].includes(j.state)) return j; await new Promise(r => setTimeout(r, 10)); } throw new Error('timeout'); };
  try {
    const j = await wait(await framework(c, { action: 'analyze', engine: 'ilspy', path: file, referencePath: refs }));
    assert.equal(j.state, 'partial', j.error); const report = JSON.parse(await fs.readFile(path.join(j.dir, 'result.json')));
    assert.equal(report.references.length, 1); assert.equal(report.decompilationWarnings[0].line, 1); assert.equal(report.decompilationWarnings[0].file, 'Owned.cs');
    await fs.symlink(file, path.join(refs, 'Link.dll'));
    const bad = await wait(await framework(c, { action: 'analyze', engine: 'ilspy', path: file, referencePath: refs })); assert.equal(bad.state, 'failed'); assert.match(bad.error, /普通DLL/);
  } finally { await c.close(); if (prior === undefined) delete process.env.ANDROID_RESERVE_ILSPY; else process.env.ANDROID_RESERVE_ILSPY = prior; }
});
