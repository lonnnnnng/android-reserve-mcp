// long: 公网验收必须观察启用Network之后的新请求；重载仅限调用方明确指定的测试App。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, webview } from '../src/actions.js';
import { run, tool, checked } from '../src/core/process.js';

const [serial, packageName, expectedUrl, workspaceArg] = process.argv.slice(2);
if (!serial || !packageName || !expectedUrl?.startsWith('https://') || !workspaceArg) throw new Error('用法: node scripts/webview-public-smoke.mjs SERIAL TEST_PACKAGE EXPECTED_HTTPS_URL WORKSPACE');
const workspace = path.resolve(workspaceArg), results = [];
const c = await createContext({ allowedRoots: [workspace], workspace, disabled: true });
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 15000 }), '测试App操作');
async function complete(args) {
  const start = await webview(c, args);
  for (let i = 0; i < 300; i++) {
    const job = await c.jobs.get(start.id);
    if (!['queued', 'running'].includes(job.state)) {
      assert.equal(job.state, 'succeeded', job.error);
      const result = JSON.parse(await fs.readFile(path.join(job.dir, 'result.json')));
      results.push({ action: args.action, jobId: job.id, result });
      return { job, result };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('WebView任务超时');
}
let passed = false;
try {
  const discovery = await complete({ action: 'discover', serial, packageName });
  assert.equal(discovery.result.targets.length, 1, '测试App须唯一调试进程');
  const opened = await complete({ action: 'open', serial, packageName, pid: discovery.result.targets[0].pid });
  const sessionId = opened.result.sessionId;
  const entry = await c.webviews.use(sessionId);
  // long: 重载是验收驱动动作，不把任意CDP执行能力加入MCP公开接口。
  await entry.cdp.call('Page.reload', { ignoreCache: true });
  let request;
  for (let i = 0; i < 120; i++) {
    request = [...entry.cdp.requests.values()].find(row => row.url === expectedUrl && (row.finished || row.failure));
    if (request) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const network = await complete({ action: 'network', sessionId });
  assert.ok(request, '60秒内没有观察到指定公网请求终态');
  assert.equal(request.failure, undefined, JSON.stringify(request.failure));
  assert.equal(request.response.status, 200);
  assert.equal(request.finished, true);
  assert.notEqual(request.response.fromDiskCache, true, '磁盘缓存不能作为本次公网响应验收');
  assert.notEqual(request.response.fromServiceWorker, true, 'ServiceWorker响应不能作为公网验收');
  const body = await complete({ action: 'body', sessionId, requestId: request.requestId });
  const data = JSON.parse(await fs.readFile(path.join(body.job.dir, body.result.artifact)));
  assert.ok(Object.keys(data).length > 0);
  await complete({ action: 'dom', sessionId });
  await complete({ action: 'close', sessionId });
  passed = true;
  console.log(JSON.stringify({ passed, request, body: body.result, networkJobId: network.job.id }));
} finally {
  await c.close();
  await fs.writeFile(path.join(workspace, 'validation.json'), JSON.stringify({ passed, serial, packageName, expectedUrl, results }, null, 2));
}
