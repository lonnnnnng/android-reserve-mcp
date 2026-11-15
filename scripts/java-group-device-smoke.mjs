// long: 配置只描述精确方法和对象关联；UI驱动由显式测试命令完成，不注入模拟业务调用。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, frida } from '../src/actions.js';
import { composeChainMatches, composeExtendedChainMatches } from '../src/core/compose-correlation.js';
import { completeJob } from './smoke-utils.mjs';
import { run, tool, checked } from '../src/core/process.js';

const [serial, packageName, configPath, workspace, tapX, tapY, bridgeRoot] = process.argv.slice(2);
if (!serial || !packageName || !configPath || !workspace) throw new Error('用法: node scripts/java-group-device-smoke.mjs SERIAL PACKAGE CONFIG WORKSPACE');
if (!/^[A-Za-z0-9._:-]+$/.test(serial) || !/^[A-Za-z][A-Za-z0-9_.]+$/.test(packageName)) throw new Error('设备/包名无效');
const { smokeExpectedReplies = 1, smokeExitHook, smokeParentHook, smokeObservedExitHook, smokeComposeChain = false, smokeComposeDerived = false, smokeComposeExtended = false, smokeTapSequence, smokeTapIntervalMs = 900, smokeExpectedMethod, smokeExpectedArgument, smokeExpectedRequestArgument, smokeExpectedReply, smokeExpectedError, smokeRequestHook = 'handler', smokeReplyHook, smokeExpectedReplyArgument, smokeExpectedReplyMessage, smokeJsCallsite, ...config } = JSON.parse(await fs.readFile(configPath, 'utf8'));
assert.ok(Number.isInteger(smokeExpectedReplies) && smokeExpectedReplies >= 0 && smokeExpectedReplies <= 20);
assert.ok(smokeExpectedReplies > 0 || smokeExitHook || smokeComposeExtended);
const c = await createContext({ workspace, allowedRoots: [path.resolve(workspace)], javaBridgeRoot: bridgeRoot }), results = [], captured = new Map();
const unpack = v => v?.structuredContent || (v?.content ? JSON.parse(v.content[0].text) : v);
const normal = v => { const r = unpack(v); return r.normalized_result || r; };
const complete = args => completeJob(c, frida(c, args), results);
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 30000 }), '分组观测样本');
let sessionId, passed = false, chainObserved = false, traceId, driven = false, tapIndex = 0, lastTapAt = 0, pid, alive = false, cleanup, restoration;
const tapSequence = Array.isArray(smokeTapSequence) && smokeTapSequence.length ? smokeTapSequence : (tapX !== undefined ? [{ x: tapX, y: tapY }] : []);
function flutterChain(events) {
  const request = events.find(row => row.event === 'java-enter' && row.hookId === smokeRequestHook && row.correlation?.state === 'request');
  if (!request) return false;
  const capture = request.valueCaptures?.[0];
  if (smokeExpectedRequestArgument !== undefined && request.arguments?.[0]?.value !== smokeExpectedRequestArgument) return false;
  if (smokeExpectedMethod !== undefined && capture?.method?.value !== smokeExpectedMethod) return false;
  if (smokeExpectedArgument !== undefined && capture?.arguments?.value !== smokeExpectedArgument) return false;
  const reply = events.find(row => row.event === 'java-exit' && (smokeReplyHook ? row.hookId === smokeReplyHook : ['success', 'error'].includes(row.hookId)) && row.correlation?.state === 'reply-returned' && row.correlation.requestId === request.invocationId);
  const replyEnter = reply && events.find(row => row.event === 'java-enter' && row.invocationId === reply.invocationId);
  if (!reply || !replyEnter) return false;
  if (smokeExpectedReply !== undefined && reply.hookId !== 'success') return false;
  if (smokeExpectedError !== undefined && (reply.hookId !== 'error' || replyEnter.arguments?.[0]?.value !== smokeExpectedError)) return false;
  if (smokeExpectedReplyArgument !== undefined && replyEnter.arguments?.some(row => row.value === smokeExpectedReplyArgument) !== true) return false;
  if (smokeExpectedReplyMessage !== undefined && replyEnter.arguments?.some(row => row.value === smokeExpectedReplyMessage) !== true) return false;
  return true;
}
// long: RN Promise 与 Flutter channel 共用请求/回复校验；只要配置声明了任一期望值，就必须把它落实到真实事件，而不是只记录静态候选。
const bridgeChainExpected = smokeExpectedMethod !== undefined || smokeReplyHook !== undefined || smokeExpectedRequestArgument !== undefined || smokeExpectedReplyArgument !== undefined || smokeExpectedReplyMessage !== undefined || smokeExpectedReply !== undefined || smokeExpectedError !== undefined;
try {
  pid = Number((await adb(['shell', 'pidof', packageName])).stdout.trim()); assert.ok(pid > 0);
  sessionId = normal((await complete({ action: 'attach', deviceId: serial, pid })).value).session_id;
  const loaded = await complete({ action: 'trace-java-group', sessionId, ...config });
  const scriptId = normal(loaded.value).script_id; traceId = loaded.job.id;
  console.log(JSON.stringify({ readyToDrive: true, serial, packageName, pid, scriptId }));
  for (let i = 0; i < 120; i++) {
    const status = normal((await complete({ action: 'status', sessionId })).value);
    for (const msg of status.messages || []) if (msg.script_id === scriptId && msg.payload?.event) captured.set(msg.payload.sequence, msg.payload);
    const events = [...captured.values()];
    if (status.state === 'detached') throw new Error('目标进程已分离，停止等待并保留现有事件');
    if (tapIndex < tapSequence.length && events.some(e => e.event === 'java-group-ready') && Date.now() - lastTapAt >= (tapIndex === 0 ? 0 : smokeTapIntervalMs)) {
      const tap = tapSequence[tapIndex];
      if (!/^\d{1,4}$/.test(String(tap?.x)) || !/^\d{1,4}$/.test(String(tap?.y))) throw new Error('tap坐标无效');
      await adb(['shell', 'input', 'tap', String(tap.x), String(tap.y)]); tapIndex += 1; lastTapAt = Date.now(); driven = true;
    }
    const linkedExit = !smokeExitHook || events.some(e => e.event === 'java-exit' && e.hookId === smokeExitHook && (!smokeParentHook || events.some(parent => parent.event === 'java-enter' && parent.hookId === smokeParentHook && e.parentInvocationId === parent.invocationId)));
    const observedExit = !smokeObservedExitHook || events.some(e => e.event === 'java-exit' && e.hookId === smokeObservedExitHook);
    if (events.some(e => e.event === 'java-group-ready') && events.filter(e => e.correlation?.state === 'reply-returned').length >= smokeExpectedReplies && linkedExit && observedExit && (!smokeComposeChain || composeChainMatches(events, { requireDerived: smokeComposeDerived })) && (!smokeComposeExtended || composeExtendedChainMatches(events)) && (!bridgeChainExpected || flutterChain(events))) { chainObserved = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(chainObserved, true, '未观察到同对象回复返回；检查报告与目标UI触发');
  if (bridgeChainExpected) assert.equal(flutterChain([...captured.values()]), true, '请求参数/回复方法或消息不符合预期');
  await complete({ action: 'unload', sessionId, scriptId });
  alive = Number((await adb(['shell', 'pidof', packageName])).stdout.trim()) === pid; assert.equal(alive, true, '卸载后目标进程不再是原进程');
  assert.equal(c.scripts.get(sessionId)?.size || 0, 0);
  const ready = [...captured.values()].find(row => row.event === 'java-group-ready'), expected = ready.hooks.map(row => ({ id: row.id, ...row.nativeIdentity }));
  assert.ok(expected.every(row => row.address && row.offsets && row.baseline), '缺少原方法恢复快照');
  const verify = path.join(workspace, 'verify-restoration.js');
  // long: 会话未分离、PID未变化时，以不含Java的只读探针核对每个原入口；清空script账本不能替代真实方法恢复。
  await fs.writeFile(verify, `const expected=${JSON.stringify(expected)},pid=${pid};if(Process.id!==pid)throw new Error('PID失配');const rows=expected.map(row=>{const address=ptr(row.address),range=Process.findRangeByAddress(address);if(!range||!range.protection.includes('r'))throw new Error('方法范围不可读');const o=row.offsets,observed={accessFlags:address.add(o.accessFlags).readU32(),jniCode:address.add(o.jniCode).readPointer().toString(),quickCode:address.add(o.quickCode).readPointer().toString()};return{id:row.id,observed,matched:JSON.stringify(observed)===JSON.stringify(row.baseline)}});send({event:'java-restoration-verification',rows,matched:rows.every(row=>row.matched)});\n`);
  const verifying = normal((await complete({ action: 'load', sessionId, scriptPath: verify })).value).script_id;
  const checkedState = normal((await complete({ action: 'status', sessionId })).value);
  restoration = (checkedState.messages || []).find(message => message.script_id === verifying && message.payload?.event === 'java-restoration-verification')?.payload;
  assert.equal(restoration?.matched, true, '原ArtMethod字段恢复未确认');
  await complete({ action: 'unload', sessionId, scriptId: verifying });
  passed = true;
  console.log(JSON.stringify({ passed, events: [...captured.values()] }));
} finally {
  if (sessionId) await complete({ action: 'close', sessionId }).catch(() => {});
  cleanup = await c.close();
  passed &&= cleanup.closed;
  await fs.writeFile(path.join(workspace, 'validation.json'), JSON.stringify({ passed, serial, packageName, pid, alive, cleanup, restoration, traceId, composeChain: smokeComposeChain && composeChainMatches([...captured.values()], { requireDerived: smokeComposeDerived }), composeExtended: smokeComposeExtended && composeExtendedChainMatches([...captured.values()]), flutterChain: bridgeChainExpected ? flutterChain([...captured.values()]) : false, jsCallsite: smokeJsCallsite ? { ...smokeJsCallsite, association: 'caller-supplied-static-callsite-candidate' } : null, results, captured: [...captured.values()] }, null, 2));
}
