// long: 通用第三方RN探测只连接目标自行开放的debug inspector；未开放时明确unsupported，不执行静默注入。
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, tool, checked } from '../src/core/process.js';
import { classifyRnThirdPartyTarget, selectRnInspectorPage } from '../src/core/rn-cdp.js';

const [serial, packageName, workspaceArg, metroBase = 'http://127.0.0.1:8081', tapX, tapY] = process.argv.slice(2);
if (!serial || !packageName || !workspaceArg) throw new Error('用法: node scripts/rn-third-party-probe.mjs SERIAL PACKAGE WORKSPACE [METRO_URL] [TAP_X TAP_Y]');
if (!/^[A-Za-z0-9._:-]+$/.test(serial) || !/^[A-Za-z][A-Za-z0-9_.]+$/.test(packageName)) throw new Error('设备或包名无效');
if ((tapX === undefined) !== (tapY === undefined) || (tapX !== undefined && ![tapX, tapY].every(value => /^\d{1,4}$/.test(value)))) throw new Error('点击坐标必须成对提供整数');
const workspace = path.resolve(workspaceArg), metro = new URL(metroBase), adbPath = await tool('adb');
const adb = async args => checked(await run(adbPath, ['-s', serial, ...args], { timeoutMs: 30000, maxBytes: 1024 * 1024 }), 'RN第三方探测');
const evidence = { schema: 1, framework: 'react-native', device: { serial }, target: { packageName }, policy: { injectionAttempted: false, mode: 'debug-inspector-only' }, cdp: { connected: false, scripts: [] }, causal: { status: 'unsupported', edges: [], limitation: '通用第三方APK没有稳定的JSI/Fabric符号和事件协议；没有显式debug fixture标记时不猜测原生因果' } };

try {
  await adb(['get-state']);
  const pidResult = await adb(['shell', 'pidof', packageName]);
  evidence.target.pid = Number(pidResult.stdout.trim()) || null;
  const pageResponse = await fetch(new URL('/json/list', metro));
  if (!pageResponse.ok) throw new Error(`Metro inspector列表HTTP ${pageResponse.status}`);
  let page;
  try { page = selectRnInspectorPage(await pageResponse.json(), packageName); } catch (error) {
    evidence.inspector = { status: 'unsupported', error: String(error.message) };
    evidence.causal = classifyRnThirdPartyTarget({ page: null });
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ status: evidence.inspector.status, injectionAttempted: false }));
    process.exitCode = 0;
  }
  if (page) {
    evidence.inspector = { id: page.id, title: page.title, description: page.description, capabilities: page.capabilities, websocketHost: new URL(page.webSocketDebuggerUrl).hostname };
    const socketUrl = new URL(page.webSocketDebuggerUrl); socketUrl.protocol = metro.protocol === 'https:' ? 'wss:' : 'ws:'; socketUrl.host = metro.host;
    const socket = new WebSocket(socketUrl, { headers: { Origin: `http://localhost:${metro.port || 80}` } });
    const scripts = new Map(); let nextId = 1;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('RN inspector WebSocket连接超时')), 7000); socket.addEventListener('open', () => { clearTimeout(timer); evidence.cdp.connected = true; resolve(); }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('RN inspector WebSocket连接失败')); }, { once: true }); });
    socket.addEventListener('message', event => { try { const message = JSON.parse(String(event.data)); if (message.method === 'Debugger.scriptParsed') scripts.set(String(message.params.scriptId), { scriptId: String(message.params.scriptId), url: String(message.params.url || '').slice(0, 8192), sourceMapURL: String(message.params.sourceMapURL || '').slice(0, 2048) }); } catch {} });
    socket.send(JSON.stringify({ id: nextId++, method: 'Runtime.enable', params: {} })); socket.send(JSON.stringify({ id: nextId++, method: 'Debugger.enable', params: {} }));
    for (let i = 0; i < 16 && scripts.size === 0; i++) await new Promise(resolve => setTimeout(resolve, 500));
    evidence.cdp.scripts = [...scripts.values()];
    evidence.causal = classifyRnThirdPartyTarget({ page, scriptCount: scripts.size });
    if (tapX !== undefined) {
      await adb(['shell', 'input', 'tap', tapX, tapY]);
      evidence.trigger = { tap: { x: Number(tapX), y: Number(tapY) }, uiHash: crypto.createHash('sha256').update((await adb(['shell', 'uiautomator', 'dump', '/sdcard/android-reserve-rn-third-party.xml'])).stdout).digest('hex') };
      evidence.causal.status = evidence.causal.status === 'open-debug-session' ? 'partial' : evidence.causal.status;
      (evidence.causal.edges ||= []).push({ from: 'ui-tap', to: 'cdp-session', strength: 'same-device-debug-session', runtimeNative: false });
    }
    socket.close();
  }
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: evidence.causal.status, injectionAttempted: false, scriptCount: evidence.cdp.scripts.length }));
} catch (error) {
  evidence.error = String(error?.stack || error);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  throw error;
}
