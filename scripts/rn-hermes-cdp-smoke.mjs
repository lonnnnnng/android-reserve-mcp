// long: 该脚本只连接已开放的RN debug inspector，不开启目标调试、不注入任意脚本，也不把第三方APK提升为已支持。
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, tool, checked } from '../src/core/process.js';
import { correlateRnInspector, selectRnInspectorPage } from '../src/core/rn-cdp.js';

const [serial, packageName, workspace, metroBase = 'http://127.0.0.1:8081', tapX, tapY] = process.argv.slice(2);
if (!serial || !packageName || !workspace) throw new Error('用法: node scripts/rn-hermes-cdp-smoke.mjs SERIAL PACKAGE WORKSPACE [METRO_URL] [TAP_X TAP_Y]');
if (!/^[A-Za-z0-9._:-]+$/.test(serial) || !/^[A-Za-z][A-Za-z0-9_.]+$/.test(packageName)) throw new Error('设备/包名无效');
const metro = new URL(metroBase); if (!['http:', 'https:'].includes(metro.protocol)) throw new Error('METRO_URL必须是HTTP(S)');
const adb = async args => checked(await run(await tool('adb'), ['-s', serial, ...args], { timeoutMs: 30000, maxBytes: 512000 }), 'RN Hermes inspector');
const send = (socket, id, method, params = {}) => socket.send(JSON.stringify({ id, method, params }));
const messages = [], scripts = new Map(); let nextId = 1, opened = false, stackText = '';
const response = await fetch(new URL('/json/list', metro)); if (!response.ok) throw new Error(`Metro inspector列表HTTP ${response.status}`);
  const page = selectRnInspectorPage(await response.json(), packageName);
  const socketUrl = new URL(page.webSocketDebuggerUrl); socketUrl.protocol = metro.protocol === 'https:' ? 'wss:' : 'ws:'; socketUrl.host = metro.host;
  // Metro inspector要求使用浏览器式localhost来源，即使发现地址使用127.0.0.1。
  const socket = new WebSocket(socketUrl, { headers: { Origin: `http://localhost:${metro.port || 80}` } });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('RN inspector WebSocket连接超时')), 7000); socket.addEventListener('open', () => { clearTimeout(timer); opened = true; resolve(); }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('RN inspector WebSocket连接失败')); }, { once: true }); });
  socket.addEventListener('message', event => { try { const message = JSON.parse(String(event.data)); messages.push(message); if (message.method === 'Debugger.scriptParsed') scripts.set(String(message.params.scriptId), { scriptId: String(message.params.scriptId), url: String(message.params.url || '').slice(0, 8192), sourceMapURL: String(message.params.sourceMapURL || '').slice(0, 2048) }); } catch {} });
  send(socket, nextId++, 'Runtime.enable'); send(socket, nextId++, 'Debugger.enable');
  for (let i = 0; i < 16 && scripts.size === 0; i++) await new Promise(resolve => setTimeout(resolve, 500));
  if (scripts.size !== 1) throw new Error(`RN inspector脚本身份不唯一，观察到${scripts.size}个scriptParsed`);
  if (tapX !== undefined || tapY !== undefined) {
    if (![tapX, tapY].every(value => /^\d{1,4}$/.test(value || ''))) throw new Error('tap坐标必须是整数');
    await adb(['shell', 'input', 'tap', tapX, tapY]);
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await adb(['shell', 'uiautomator', 'dump', `/sdcard/android-reserve-rn-cdp-${process.pid}.xml`]);
      stackText = (await adb(['shell', 'cat', `/sdcard/android-reserve-rn-cdp-${process.pid}.xml`])).stdout;
      if (stackText.includes('JS_CALLER=') && stackText.includes('rejectPromise')) break;
    }
  }
  const scriptParsed = [...scripts.values()][0], stack = stackText.match(/JS_CALLER=([\s\S]*?)\s*\|\s*JAVA=/)?.[1] || stackText.match(/JS_CALLER=([\s\S]{0,8192})/)?.[1] || '';
  const correlation = correlateRnInspector({ page, scriptParsed, stack });
  if (tapX !== undefined && correlation.status !== 'passed') throw new Error('点击后未获得与CDP scriptId同源的fixture JS stack');
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'evidence.json'), JSON.stringify({ schema: 1, device: { serial }, packageName, metro: { origin: metro.origin, page }, cdp: { connected: opened, scriptParsed, observedMessages: messages.length }, trigger: tapX === undefined ? null : { tap: { x: Number(tapX), y: Number(tapY) }, stack }, correlation, limitation: '实验性debug fixture验收；Java Promise身份请与现有trace-java-group证据按同一UI触发独立比对，不按PID/时间自动合并' }, null, 2));
  console.log(JSON.stringify({ passed: correlation.status === 'passed', scriptId: correlation.scriptId, scriptUrl: correlation.scriptUrl, frame: correlation.jsFrame }));
  socket.close();
