import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContext, framework } from '../src/actions.js';

test('HBC99必须显式实验选择且结果partial；HBC100拒绝，不把未知版本交给99解析器', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reserve-hbc-'));
  const prior=process.env.ANDROID_RESERVE_HBC_DISASSEMBLER;
  const engine=path.join(root,'disassembler.mjs');
  await fs.writeFile(engine,'#!/usr/bin/env node\nimport fs from "node:fs";fs.writeFileSync(process.argv[3],"Function<owned>");console.error("Warning: not formally supported");');
  await fs.chmod(engine,0o700);process.env.ANDROID_RESERVE_HBC_DISASSEMBLER=engine;
  const c=await createContext({allowedRoots:[root],workspace:path.join(root,'work'),disabled:true});
  const run=async(version,extra={})=>{const file=path.join(root,version+'.hbc'),b=Buffer.alloc(12);b.writeBigUInt64LE(0x1f1903c103bc1fc6n);b.writeUInt32LE(version,8);await fs.writeFile(file,b);const start=await framework(c,{action:'analyze',engine:'hermes',path:file,...extra});for(let i=0;i<200;i++){const j=await c.jobs.get(start.id);if(!['queued','running'].includes(j.state))return j;await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');};
  try {
    const refused=await run(99);assert.equal(refused.state,'failed');assert.match(refused.error,/allowExperimental/);
    const accepted=await run(99,{allowExperimental:true});assert.equal(accepted.state,'partial',accepted.error);
    const result=JSON.parse(await fs.readFile(path.join(accepted.dir,'result.json')));assert.equal(result.bytecodeVersion,99);assert.match(result.compatibility,/experimental/);assert.ok(result.warnings.some(x=>x.includes('not formally supported')));
    const unknown=await run(100,{allowExperimental:true});assert.equal(unknown.state,'failed');assert.match(unknown.error,/未知版本/);
  } finally {await c.close();if(prior===undefined)delete process.env.ANDROID_RESERVE_HBC_DISASSEMBLER;else process.env.ANDROID_RESERVE_HBC_DISASSEMBLER=prior;}
});
