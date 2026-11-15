function decodeXml(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
}

function comparableUrl(value) {
  try { const url = new URL(value); if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = '__local__'; return url.toString(); } catch { return value; }
}

export function selectRnInspectorPage(pages, packageName) {
  if (!Array.isArray(pages)) throw new Error('RN inspector页面列表无效');
  const matches = pages.filter(page => {
    if (page?.appId !== packageName || page?.type !== 'node' || typeof page.webSocketDebuggerUrl !== 'string') return false;
    try {
      const url = new URL(page.webSocketDebuggerUrl);
      return url.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname === '/inspector/debug' && url.searchParams.has('device') && url.searchParams.has('page');
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new Error(`RN inspector页面必须唯一匹配，实际${matches.length}个`);
  const page = matches[0], url = new URL(page.webSocketDebuggerUrl);
  return { id: String(page.id || ''), title: String(page.title || '').slice(0, 512), description: String(page.description || '').slice(0, 1024), appId: packageName, type: 'node', deviceName: String(page.deviceName || '').slice(0, 256), webSocketDebuggerUrl: url.toString(), capabilities: page.reactNative?.capabilities || {} };
}

export function parseJsCallerStack(value, functionName = 'rejectPromise') {
  const stack = decodeXml(value);
  const pattern = new RegExp(`at ${functionName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')} \\((.+?):(\\d+):(\\d+)\\)`);
  const match = stack.match(pattern);
  if (!match) return { raw: stack.slice(0, 8192), frame: null };
  return { raw: stack.slice(0, 8192), frame: { functionName, url: match[1].slice(0, 8192), lineNumber: Number(match[2]), columnNumber: Number(match[3]) } };
}

export function correlateRnInspector({ page, scriptParsed, stack, functionName = 'rejectPromise' }) {
  const parsed = parseJsCallerStack(stack, functionName);
  const scriptUrl = decodeXml(scriptParsed?.url || '');
  const sameBundle = !!parsed.frame && !!scriptParsed?.scriptId && comparableUrl(scriptUrl) === comparableUrl(parsed.frame.url);
  return { status: sameBundle ? 'passed' : 'partial', mechanism: 'same-cdp-script-url-and-fixture-js-stack', scriptId: scriptParsed?.scriptId ? String(scriptParsed.scriptId) : null, scriptUrl, jsFrame: parsed.frame, sameBundle, limitation: '只证明可修改debug fixture的CDP bundle与主动保存的JS stack同源；不证明任意第三方APK自动注入或Java业务身份' };
}

export function classifyRnThirdPartyTarget({ page, scriptCount = 0, debuggable = null }) {
  if (!page) return { status: 'unsupported', reason: 'rn-inspector-not-open', injection: { attempted: false, policy: 'fail-closed' }, limitation: '目标未开放Metro inspector，MCP不启用静默注入' };
  const bridgeless = /Bridgeless|C\+\+ connection/i.test(String(page.description || ''));
  if (!bridgeless) return { status: 'partial', reason: 'rn-architecture-unclassified', scriptCount, injection: { attempted: false, policy: 'debug-session-only' }, limitation: '页面可连接但未证明新架构Cxx/Fabric；不推断JSI/Fabric因果' };
  return { status: scriptCount === 1 && debuggable !== false ? 'open-debug-session' : 'partial', reason: 'open-rn-debug-inspector', scriptCount, bridgeless, injection: { attempted: false, policy: 'debug-session-only' }, limitation: '只证明目标自行开放的debug inspector可读；不代表任意第三方APK自动注入或完整原生因果' };
}

// long: 自有 fixture 才能提供跨 JS、C++、Fabric 和重组的显式 ID；缺一段就降级，不能按时间或 UI 文本猜因果。
export function correlateRnNativeFabricCausal({ jsiCallId, nativeMarker, fabricEventId, renderSequenceBefore, renderSequenceAfter }) {
  const callId = String(jsiCallId || '');
  const marker = String(nativeMarker || '');
  const eventId = String(fabricEventId || '');
  const before = Number(renderSequenceBefore);
  const after = Number(renderSequenceAfter);
  const validId = value => /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value);
  const validSequence = Number.isSafeInteger(before) && Number.isSafeInteger(after) && after > before;
  const reasons = [];
  if (!validId(callId)) reasons.push('jsi-call-id-invalid');
  if (marker !== `RN_NATIVE_MARKER:${callId}`) reasons.push('native-marker-mismatch');
  if (!/^fabric-event-[A-Za-z0-9._:-]{1,127}$/.test(eventId)) reasons.push('fabric-event-id-invalid');
  if (!validSequence) reasons.push('render-sequence-not-increasing');
  return {
    status: reasons.length === 0 ? 'passed' : 'partial',
    reasons,
    chain: reasons.length === 0 ? [
      { from: 'jsi-call', id: callId, to: 'native-marker', marker },
      { from: 'fabric-event', id: eventId, to: 'render-sequence', before, after },
    ] : [],
    limitation: '仅适用于主动提供显式 marker 的自有 RN fixture；第三方 APK 不按时间、PID 或 UI 文本推断因果',
  };
}
