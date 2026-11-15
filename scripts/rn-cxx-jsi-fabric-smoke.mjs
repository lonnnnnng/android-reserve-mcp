// long: 只安装调用者明确提供的自有/隔离 RN APK；UI 文本和新架构页共同作为运行时证据。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, tool, checked } from '../src/core/process.js';
import { correlateRnNativeFabricCausal, selectRnInspectorPage } from '../src/core/rn-cdp.js';

const [serial, apkArg, workspaceArg, metroBase = 'http://127.0.0.1:8081'] = process.argv.slice(2);
if (!serial || !apkArg || !workspaceArg) {
  throw new Error('用法: node scripts/rn-cxx-jsi-fabric-smoke.mjs SERIAL APK WORKSPACE [METRO_URL]');
}
if (!/^[A-Za-z0-9._:-]+$/.test(serial)) throw new Error('设备serial无效');
const apk = path.resolve(apkArg), workspace = path.resolve(workspaceArg);
const apkStat = await fs.stat(apk).catch(() => null);
if (!apkStat?.isFile() || apkStat.size > 1024 * 1024 * 1024) throw new Error('APK不存在或超过1GiB');
const metro = new URL(metroBase);
if (!['http:', 'https:'].includes(metro.protocol)) throw new Error('METRO_URL必须是HTTP(S)');
const adbPath = await tool('adb');
const adb = async args => checked(await run(adbPath, ['-s', serial, ...args], { timeoutMs: 60000, maxBytes: 2 * 1024 * 1024 }), 'RN JSI/Fabric设备操作');

function boundsCenter(bounds) {
  const match = String(bounds || '').match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match) throw new Error(`UI节点bounds无效: ${bounds}`);
  return [Math.round((Number(match[1]) + Number(match[3])) / 2), Math.round((Number(match[2]) + Number(match[4])) / 2)];
}

function nodesFromXml(xml) {
  return [...String(xml).matchAll(/<node\b[^>]*>/g)].map(match => {
    const attrs = {};
    for (const item of match[0].matchAll(/([\w:-]+)='([^']*)'/g)) attrs[item[1]] = item[2];
    for (const item of match[0].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[item[1]] = item[2];
    return attrs;
  });
}

async function dumpUi(label) {
  const safeLabel = String(label).replace(/[^A-Za-z0-9_-]/g, '_');
  const remote = `/sdcard/android-reserve-rn-jsi-${process.pid}-${safeLabel}.xml`;
  await adb(['shell', 'uiautomator', 'dump', remote]);
  return (await adb(['shell', 'cat', remote])).stdout;
}

async function readLogcat(tag) {
  return (await adb(['logcat', '-d', '-v', 'brief', '-s', `${tag}:I`])).stdout;
}

function parseCxxCausal(texts) {
  const value = texts.find(text => text.includes('RN_RESERVE_CAUSAL_CXX JSI_CALL_ID='));
  if (!value) return null;
  const match = value.match(/JSI_CALL_ID=([A-Za-z0-9._:-]+) NATIVE_ECHO=(RN_NATIVE_MARKER:[A-Za-z0-9._:-]+)/);
  return match ? { raw: value, jsiCallId: match[1], nativeMarker: match[2] } : null;
}

function parseFabricCausal(xml) {
  const value = nodesFromXml(xml).map(node => node.text || '').find(text => text.includes('RN_FABRIC_CAUSAL'));
  if (!value) return null;
  const match = value.match(/eventId:\s*(fabric-event-[0-9]+)\s+renderSequence:\s*([0-9]+)/);
  return match ? { raw: value, fabricEventId: match[1], renderSequence: Number(match[2]) } : null;
}

function findNode(xml, predicate, label) {
  const node = nodesFromXml(xml).find(predicate);
  if (!node) throw new Error(`未找到RN UI节点: ${label}`);
  return node;
}

async function tapNode(xml, predicate, label) {
  const node = findNode(xml, predicate, label);
  const [x, y] = boundsCenter(node.bounds);
  await adb(['shell', 'input', 'tap', String(x), String(y)]);
  return { label, x, y, bounds: node.bounds };
}

async function clearSearch() {
  await adb(['shell', 'input', 'tap', '300', '275']);
  for (let i = 0; i < 48; i++) await adb(['shell', 'input', 'keyevent', '67']);
}

async function openSearchResult(query, matcher, label) {
  await clearSearch();
  await adb(['shell', 'input', 'text', query]);
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const xml = await dumpUi(`search-${label}`);
    const node = nodesFromXml(xml).find(matcher);
    if (node) {
      await tapNode(xml, matcher, label);
      await new Promise(resolve => setTimeout(resolve, 700));
      return;
    }
  }
  throw new Error(`RN搜索结果未出现: ${label}`);
}

const packageName = 'com.facebook.react.uiapp';
const evidence = {
  schema: 2,
  framework: 'react-native',
  sample: { kind: 'owned-build-of-rn-new-architecture-shape', apk, apkSha256: crypto.createHash('sha256').update(await fs.readFile(apk)).digest('hex'), packageName, abi: 'arm64-v8a' },
  device: { serial },
  build: { newArchEnabled: true, cxxModule: 'NativeCxxModuleExample', fabricComponent: 'RNTMyNativeView' },
  cxx: { passed: false, results: {}, causal: { passed: false } },
  fabric: { passed: false, results: {}, causal: { passed: false } },
  limitation: 'POCO debug fixture运行证据；不代表任意第三方APK自动注入、任意RN版本或完整Fabric事件图。',
};

try {
  await adb(['get-state']);
  // long: POCO Android 16 偶发让增量流式安装长时间无回包；固定关闭增量，避免设备传输假失败污染因果回归。
  await adb(['install', '-r', '--no-incremental', apk]);
  await adb(['shell', 'am', 'force-stop', packageName]);
  await adb(['shell', 'am', 'start', '-W', '-n', `${packageName}/.RNTesterActivity`]);
  await new Promise(resolve => setTimeout(resolve, 2500));

  const pageResponse = await fetch(new URL('/json/list', metro));
  if (!pageResponse.ok) throw new Error(`Metro inspector列表HTTP ${pageResponse.status}`);
  const page = selectRnInspectorPage(await pageResponse.json(), packageName);
  evidence.build.inspector = { pageId: page.id, description: page.description || null, capabilities: page.capabilities };
  assert.match(String(page.description || ''), /C\+\+ connection|Bridgeless/);

  // Cxx TurboModule: 运行多种 JSI bridge 转换，避免只用一个 primitive 结果误判。
  let homeXml = await dumpUi('cxx-home');
  await tapNode(homeXml, node => node['resource-id'] === 'apis-tab', 'APIs tab');
  await new Promise(resolve => setTimeout(resolve, 500));
  await openSearchResult('Turbo', node => node['resource-id'] === 'Cxx TurboModule', 'Cxx TurboModule');
  let xml = await dumpUi('cxx-page');
  const runButton = await tapNode(xml, node => node['content-desc'] === 'Run function call tests', 'Run function call tests');
  await new Promise(resolve => setTimeout(resolve, 1800));
  xml = await dumpUi('cxx-results');
  let cxxText = [];
  const cxxExpected = ['value from callback!', 'sum=205', '99.95', 'Hello', 'x: 1.44, y: Two'];
  for (let page = 0; page < 10; page += 1) {
    cxxText = [...new Set([...cxxText, ...nodesFromXml(xml).map(node => node.text || '').filter(Boolean)])];
    if (cxxExpected.every(expected => cxxText.some(text => text.includes(expected))) && parseCxxCausal(cxxText)) break;
    await adb(['shell', 'input', 'swipe', '500', '1500', '500', '300', '350']);
    await new Promise(resolve => setTimeout(resolve, 250));
    xml = await dumpUi(`cxx-results-${page}`);
  }
  if (!parseCxxCausal(cxxText)) {
    const causalButton = findNode(xml, node => node.text === 'causal', 'causal JSI call');
    const [x, y] = boundsCenter(causalButton.bounds);
    await adb(['shell', 'input', 'tap', String(x), String(y)]);
    await new Promise(resolve => setTimeout(resolve, 700));
    xml = await dumpUi('cxx-causal');
    cxxText = [...new Set([...cxxText, ...nodesFromXml(xml).map(node => node.text || '').filter(Boolean)])];
  }
  for (const expected of cxxExpected) {
    assert.ok(cxxText.some(text => text.includes(expected)), `Cxx结果缺少 ${expected}`);
  }
  const cxxCausal = parseCxxCausal(cxxText);
  assert.ok(cxxCausal, 'Cxx fixture缺少显式JSI call ID');
  assert.match(await readLogcat('RNReserveCausal'), new RegExp(`native-marker=${cxxCausal.nativeMarker.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
  evidence.cxx = {
    passed: true,
    trigger: runButton,
    observed: cxxText.filter(text => /callback|sum=205|99\.95|Hello|x: 1\.44, y: Two/.test(text)),
    conversions: ['callback string', 'ArrayBuffer async Promise', 'number', 'string', 'union/object'],
    causal: { passed: true, jsiCallId: cxxCausal.jsiCallId, nativeMarker: cxxCausal.nativeMarker, mechanism: 'JS string argument -> Cxx getString -> Android log marker' },
  };

  // Fabric/codegen view: 新架构页面同时挂载Fabric与Legacy视图，并由命令驱动背景和属性更新。
  await adb(['shell', 'am', 'force-stop', packageName]);
  await adb(['shell', 'am', 'start', '-W', '-n', `${packageName}/.RNTesterActivity`]);
  await new Promise(resolve => setTimeout(resolve, 1800));
  await openSearchResult('New', node => node['resource-id'] === 'New Architecture Examples', 'New Architecture Examples');
  xml = await dumpUi('fabric-before');
  assert.ok(nodesFromXml(xml).some(node => node.text === 'Fabric View'));
  assert.ok(nodesFromXml(xml).some(node => node.text === 'Legacy View'));
  assert.ok(nodesFromXml(xml).some(node => node.text?.includes('HSBA: h: 0, s: 0, b: 0, a: 0')));
  const fabricBeforeCausal = parseFabricCausal(xml);
  assert.ok(fabricBeforeCausal, 'Fabric fixture缺少初始event/render序列');
  const backgroundButton = await tapNode(xml, node => node['content-desc'] === 'CHANGE BACKGROUND', 'CHANGE BACKGROUND');
  await new Promise(resolve => setTimeout(resolve, 900));
  xml = await dumpUi('fabric-after-background');
  const afterBackground = nodesFromXml(xml).map(node => node.text || '').filter(Boolean);
  assert.ok(afterBackground.some(text => text.includes('HSBA: h: 0, s: 1, b: 1, a: 255')), 'Fabric/interop背景命令未产生原生事件结果');
  const opacityButton = await tapNode(xml, node => node['content-desc'] === 'SET OPACITY', 'SET OPACITY');
  await new Promise(resolve => setTimeout(resolve, 700));
  xml = await dumpUi('fabric-after-opacity');
  const afterOpacity = nodesFromXml(xml).map(node => node.text || '').filter(Boolean);
  assert.ok(afterOpacity.some(text => text.includes('Opacity: 0.8')), 'Fabric属性更新未产生重渲染结果');
  const fabricAfterCausal = parseFabricCausal(xml);
  assert.ok(fabricAfterCausal, 'Fabric fixture缺少更新后的event/render序列');
  const fabricCausal = correlateRnNativeFabricCausal({
    jsiCallId: cxxCausal.jsiCallId,
    nativeMarker: cxxCausal.nativeMarker,
    fabricEventId: fabricAfterCausal.fabricEventId,
    renderSequenceBefore: fabricBeforeCausal.renderSequence,
    renderSequenceAfter: fabricAfterCausal.renderSequence,
  });
  assert.equal(fabricCausal.status, 'passed', `RN因果链未闭合: ${JSON.stringify(fabricCausal)}`);
  assert.match(await readLogcat('RNReserveFabric'), new RegExp(`fabric-event-id=${fabricAfterCausal.fabricEventId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
  evidence.fabric = {
    passed: true,
    trigger: { backgroundButton, opacityButton },
    before: ['Fabric View', 'Legacy View', 'HSBA: h: 0, s: 0, b: 0, a: 0'],
    after: ['HSBA: h: 0, s: 1, b: 1, a: 255', 'Opacity: 0.8'],
    component: 'RNTMyNativeView codegen component with Android ViewManager delegate and native commands/events',
    causal: { passed: true, ...fabricCausal, before: fabricBeforeCausal, after: fabricAfterCausal, fabricNativeMarker: fabricAfterCausal.fabricEventId },
  };
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, packageName, cxx: evidence.cxx.passed, fabric: evidence.fabric.passed, apkSha256: evidence.sample.apkSha256 }));
} catch (error) {
  await fs.mkdir(workspace, { recursive: true });
  evidence.error = String(error?.stack || error);
  await fs.writeFile(path.join(workspace, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  throw error;
} finally {
  await adb(['shell', 'am', 'force-stop', packageName]).catch(() => {});
}
