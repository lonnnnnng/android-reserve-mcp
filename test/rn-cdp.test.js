import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRnThirdPartyTarget, correlateRnInspector, correlateRnNativeFabricCausal, parseJsCallerStack, selectRnInspectorPage } from '../src/core/rn-cdp.js';

test('RN inspector只接受唯一的本地debug页面', () => {
  const page = selectRnInspectorPage([{ id: 'p1', type: 'node', appId: 'demo.app', title: 'RN', webSocketDebuggerUrl: 'ws://127.0.0.1:8081/inspector/debug?device=d&page=1' }], 'demo.app');
  assert.equal(page.id, 'p1');
  assert.throws(() => selectRnInspectorPage([{ type: 'node', appId: 'demo.app', webSocketDebuggerUrl: 'ws://evil.test/inspector/debug?device=d&page=1' }], 'demo.app'), /唯一/);
});

test('RN fixture stack按同一bundle URL接到scriptId', () => {
  const url = 'http://localhost:8081/js/RNTesterApp.android.bundle//&platform=android&dev=true';
  const stack = `JS_CALLER=Error |     at rejectPromise (${url}:125968:38) |     at onPress (${url}:126121:70)`;
  assert.deepEqual(parseJsCallerStack(stack).frame, { functionName: 'rejectPromise', url, lineNumber: 125968, columnNumber: 38 });
  const result = correlateRnInspector({ page: {}, scriptParsed: { scriptId: '3', url }, stack });
  assert.equal(result.status, 'passed'); assert.equal(result.scriptId, '3'); assert.equal(result.sameBundle, true);
});

test('第三方或没有fixture stack时保持partial，不自动注入', () => {
  const result = correlateRnInspector({ scriptParsed: { scriptId: '3', url: 'http://127.0.0.1:8081/bundle.js' }, stack: '' });
  assert.equal(result.status, 'partial'); assert.equal(result.sameBundle, false); assert.match(result.limitation, /第三方/);
});

test('第三方RN目标没有开放inspector时fail-closed', () => {
  const result = classifyRnThirdPartyTarget({ page: null });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.injection.attempted, false);
});

test('开放C++ inspector只进入debug session，不冒充完整JSI/Fabric因果', () => {
  const result = classifyRnThirdPartyTarget({ page: { description: 'React Native Bridgeless [C++ connection]' }, scriptCount: 1 });
  assert.equal(result.status, 'open-debug-session');
  assert.equal(result.injection.policy, 'debug-session-only');
  assert.match(result.limitation, /不代表任意第三方APK自动注入/);
});

test('自有RN fixture要求JSI、native、Fabric和重组序列显式闭合', () => {
  const result = correlateRnNativeFabricCausal({
    jsiCallId: 'rn-jsi-123',
    nativeMarker: 'RN_NATIVE_MARKER:rn-jsi-123',
    fabricEventId: 'fabric-event-7',
    renderSequenceBefore: 12,
    renderSequenceAfter: 14,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.chain.length, 2);
});

test('RN因果链缺ID或重组未前进时降级partial', () => {
  const result = correlateRnNativeFabricCausal({
    jsiCallId: 'rn-jsi-123',
    nativeMarker: 'RN_NATIVE_MARKER:other',
    fabricEventId: 'fabric-event-7',
    renderSequenceBefore: 14,
    renderSequenceAfter: 14,
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.reasons, ['native-marker-mismatch', 'render-sequence-not-increasing']);
  assert.deepEqual(result.chain, []);
});
