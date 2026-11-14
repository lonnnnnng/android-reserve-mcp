// long: 自有页面触发真实fetch，CDP initiator→同会话scriptId→正文SHA，绝不以URL相似或时间接近代替。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, webview, script, evidence } from '../src/actions.js';
import { fixtureApp, packageName } from './fixture-app.mjs';
import { run, checked, tool } from '../src/core/process.js';
import { completeJob } from './smoke-utils.mjs';

const serial = process.argv[2];
if (!serial || !/^[A-Za-z0-9._:-]+$/.test(serial)) throw new Error('必须指定授权serial');
const root = path.resolve('output/device-smoke'), workspace = path.join(root, 'initiator-' + Date.now());
const source = 'const OWNED_INITIATOR_V06 = 46;\nfunction sendOwnedRequest(){fetch("/api.json").then(r=>r.json()).then(v=>document.body.dataset.result=v.result);}\nsetInterval(sendOwnedRequest,700);\n';
const c = await createContext({ allowedRoots: [root], workspace, disabled: true }), results = [];
const complete = (tool, args) => completeJob(c, tool(c, args), results);
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 60000 }), '自有WebView调用栈验收');
let passed = false;
try {
  const apk = await fixtureApp(root, { webviewAssets: { mainJs: source, api: '{"result":46}', binary: Buffer.from([1]) } });
  await adb(['install', '--no-incremental', '-r', apk]); await adb(['shell', 'am', 'start', '-W', '-n', packageName + '/.MainActivity']);
  const pid = Number((await adb(['shell', 'pidof', packageName])).stdout.trim());
  const opened = await complete(webview, { action: 'open', serial, packageName, pid, rootRead: true }), sessionId = opened.value.sessionId;
  const scripts = await complete(webview, { action: 'scripts', sessionId }), main = scripts.value.scripts.find(s => s.url.endsWith('/main.js')); assert.ok(main);
  const captured = await complete(webview, { action: 'source', sessionId, scriptId: main.scriptId });
  assert.equal(await fs.readFile(path.join(captured.job.dir, captured.value.artifact), 'utf8'), source);
  let network, request;
  for (let i = 0; i < 40; i++) {
    network = await complete(webview, { action: 'network', sessionId });
    request = network.value.requests.find(r => r.url.endsWith('/api.json') && r.finished && r.initiator?.frames.some(f => f.scriptId === main.scriptId && f.functionName === 'sendOwnedRequest'));
    if (request) break; await new Promise(r => setTimeout(r, 400));
  }
  assert.ok(request, '必须有真实fetch的initiator栈');
  const frame = request.initiator.frames.find(f => f.scriptId === main.scriptId && f.functionName === 'sendOwnedRequest');
  assert.equal(frame.scriptObserved, true); assert.equal(frame.lineNumber, 1); assert.ok(frame.columnNumber >= 0);
  const body = await complete(webview, { action: 'body', sessionId, requestId: request.requestId });
  assert.equal(JSON.parse(await fs.readFile(path.join(body.job.dir, body.value.artifact))).result, 46);
  const indexed = await complete(script, { action: 'index', path: path.join(captured.job.dir, captured.value.artifact) });
  const merged = await complete(evidence, { action: 'merge', jobIds: [network.job.id, captured.job.id, indexed.job.id] });
  const graph = JSON.parse(await fs.readFile(path.join(merged.job.dir, 'graph.json')));
  assert.ok(graph.edges.some(e => e.relation === 'reported-initiator-frame'));
  assert.ok(graph.edges.some(e => e.relation === 'captured-script-content'));
  assert.ok(graph.nodes.some(n => n.kind === 'js-function' && n.name === 'sendOwnedRequest'));
  await complete(webview, { action: 'close', sessionId }); passed = true;
  console.log(JSON.stringify({ passed, workspace, frame, requestId: request.requestId, sourceHash: captured.value.sha256 }));
} finally {
  await c.close(); await adb(['shell', 'am', 'force-stop', packageName]);
  await fs.writeFile(path.join(workspace, 'validation.json'), JSON.stringify({ passed, serial, results }, null, 2));
}
