// long: 复用已完成Blutter任务只验证同APK静态协议候选，不将样本运行结果冒充MCP动态关联。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, framework } from '../src/actions.js';

const [apk, workspace, analysisJobId, mappingPath, channel, method] = process.argv.slice(2);
if (![apk, workspace, analysisJobId, channel, method].every(Boolean)) throw new Error('用法: node scripts/flutter-channels-smoke.mjs APK WORKSPACE AOT_JOB_ID MAPPING_OR_DASH CHANNEL METHOD');
const c = await createContext({ allowedRoots: [path.dirname(path.resolve(apk)), ...(mappingPath && mappingPath !== '-' ? [path.dirname(path.resolve(mappingPath))] : [])], workspace, disabled: true });
try {
  const start = await framework(c, { action: 'channels', engine: 'flutter', path: apk, analysisJobId, ...(mappingPath !== '-' ? { mappingPath } : {}) });
  let job;
  for (let i = 0; i < 3600; i++) { job = await c.jobs.get(start.id); if (!['queued', 'running'].includes(job.state)) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(job.state, 'partial', job.error);
  const report = JSON.parse(await fs.readFile(path.join(job.dir, 'result.json')));
  assert.ok(report.matches.some(row => row.channel === channel && row.method === method));
  const evidence = JSON.parse(await fs.readFile(path.join(job.dir, 'evidence.json')));
  assert.ok(evidence.edges.some(edge => edge.relation === 'matches-static-channel-protocol'));
  console.log(JSON.stringify({ jobId: job.id, state: job.state, matches: report.matches, apk: report.apk }));
} finally { await c.close(); }
