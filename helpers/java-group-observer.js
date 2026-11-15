import { withJavaFactory } from './java-loaders.js';
import { javaCompatibility, verifyJavaRuntimeProfile } from './java-compatibility.js';
import { selectJavaOverload } from './java-signature.js';

// long: 同一agent共用线程栈和JNI对象身份，异步回复只凭同一个Java对象关联，不按时间或类名猜测。
export function startJavaGroupObserver(Java, config, env = globalThis, profile, inspectMethod) {
  const compatibility = javaCompatibility({ ...config, action: 'trace-java-group' }, profile ? verifyJavaRuntimeProfile(profile, env) : undefined);
  if (!compatibility.supported) {
    try { env.send({ event: 'java-compatibility-blocked', ...compatibility }); } catch {}
    return { stop() {} };
  }
  const hooks = [], objects = [], active = new Map(), observing = new Set();
  const valueTypes = new Map(), valueHandles = [], methodCallTypes = new Map();
  let stopped = false, sequence = 0, invocation = 0, objectCounter = 0, captured = 0, budgetReported = false, identityHistoryLost = false, releaseLoader = () => {};
  const now = () => Date.now();
  const emit = row => { try { env.send({ traceId: config.traceId, pid: env.Process.id, sequence: ++sequence, timestamp: now(), ...row }); } catch {} };
  const safe = (tid, fn, fallback = null) => { observing.add(tid); try { return fn(); } catch { return fallback; } finally { observing.delete(tid); } };
  function dispose(entry, reason) {
    if (entry.disposed) return; entry.disposed = true;
    // long: 失去旧对象身份后无法区分迟到回复与同对象的新请求；本脚本从此只记录事件，不再输出确定配对。
    if (reason === 'object-ttl-expired' && !identityHistoryLost) { identityHistoryLost = true; emit({ event: 'java-identity-history-lost', reason, partial: true }); }
    for (const pending of entry.pending.values()) emit({ event: 'java-correlation-incomplete', requestId: pending.requestId, reason, partial: true });
    entry.pending.clear(); try { entry.wrapper.$dispose(); } catch {}
    const index = objects.indexOf(entry); if (index >= 0) objects.splice(index, 1);
  }
  // long: 原回复执行期间可能让出JS锁，TTL不能释放仍被终态使用的引用；返回后立即释放，避免重复dispose误删其他请求。
  function expire() { for (const entry of [...objects]) if (now() - entry.seen > config.objectTtlMs && ![...entry.pending.values()].some(p => p.busy)) dispose(entry, 'object-ttl-expired'); }
  function object(value, create = true) {
    if (!value?.$h) return null;
    expire();
    if (identityHistoryLost) return null;
    const jni = Java.vm.getEnv();
    let entry = objects.find(row => jni.isSameObject(row.wrapper.$h, value.$h));
    if (!entry && !create) return null;
    if (!entry) {
      if (objects.length >= config.maxTrackedObjects) { emit({ event: 'java-identity-budget', partial: true }); return null; }
      entry = { wrapper: Java.retain(value), objectId: config.traceId + ':object:' + ++objectCounter, seen: now(), pending: new Map(), usedGroups: new Set() };
      objects.push(entry);
    }
    entry.seen = now(); return entry;
  }
  function view(value) {
    if (value === null) return { kind: 'null', value: null };
    const kind = typeof value;
    if (['number', 'boolean'].includes(kind)) return { kind, value };
    if (kind === 'string') return { kind, value: value.slice(0, 1024), truncated: value.length > 1024 };
    if (kind === 'undefined') return { kind: 'void' };
    const name = value.$className, result = { kind: 'object', className: name, valueOmitted: true };
    // long: 只解箱final基础包装类，不调用任意业务toString，也不遍历目标对象图。
    if (['java.lang.String','java.lang.Integer','java.lang.Boolean'].includes(name)) {
      const boxed = Java.cast(value, valueTypes.get(name) || Java.use(name));
      try { result.value = name === 'java.lang.String' ? String(boxed).slice(0, 1024) : name === 'java.lang.Integer' ? boxed.intValue() : boxed.booleanValue(); }
      finally { boxed.$dispose?.(); }
    }
    return result;
  }
  function stop() {
    if (stopped) return; stopped = true;
    env.clearTimeout(deadline); env.clearInterval(sweeper);
    try { Java.performNow(() => {
      for (const hook of hooks) {
        if (hook.method.implementation === hook.replacement) hook.method.implementation = null;
        try { hook.classHandle?.$dispose(); } catch {}
      }
      for (const entry of [...objects]) dispose(entry, 'observer-stopped');
      for (const handle of valueHandles) try { handle.$dispose(); } catch {}
      releaseLoader();
    }); } catch (error) { emit({ event: 'java-cleanup-error', description: String(error).slice(0, 500) }); }
  }
  const deadline = env.setTimeout(() => { emit({ event: 'java-setup-timeout' }); stop(); }, 30000);
  const sweeper = env.setInterval(() => { if (!stopped && Java.available) Java.perform(() => safe(env.Process.getCurrentThreadId(), expire)); }, 1000);
  if (env.rpc) env.rpc.exports = { ...env.rpc.exports, stopObserver: stop, dispose: stop };
  if (!Java.available) { emit({ event: 'java-unavailable' }); stop(); return { stop }; }
  Java.perform(() => {
    if (stopped) return;
    withJavaFactory(Java, config, (factory, loader, release) => {
      releaseLoader = release;
      try {
        if (config.javaHooks.some(target => target.valueCaptures?.length)) {
          for (const capture of config.javaHooks.flatMap(target => target.valueCaptures || [])) {
            const className = capture.className || 'io.flutter.plugin.common.MethodCall';
            if (!methodCallTypes.has(className)) { const type = factory.use(className); methodCallTypes.set(className, type); valueHandles.push(type.class); }
          }
          for (const name of ['java.lang.String','java.lang.Integer','java.lang.Boolean']) { const type = Java.use(name); valueTypes.set(name,type); valueHandles.push(type.class); }
        }
        const signatures = new Set();
        for (const target of config.javaHooks) {
          const type = factory.use(target.className);
          if (config.loaderSelector) {
            const actual = type.class.getClassLoader();
            try { if (!actual || !Java.vm.getEnv().isSameObject(actual.$h, factory.loader.$h)) throw new Error('目标不由所选loader定义'); }
            finally { actual?.$dispose(); }
          }
          const method = selectJavaOverload(type[target.methodName], target.argumentTypes, target.returnType);
          const key = target.className + '.' + target.methodName + '(' + target.argumentTypes.join(',') + '):' + method.returnType.className;
          if (signatures.has(key) || method.implementation != null) throw new Error('重复方法或已有implementation，拒绝覆盖');
          signatures.add(key);
          // long: 在正常Java.perform环境预取类句柄，避免原方法回调路径首次创建类全局引用；不去优化或改写业务方法。
          const classHandle = type.class;
          hooks.push({ target, method, key, classHandle, inspection: inspectMethod?.(method) });
        }
        for (const hook of hooks) {
          hook.replacement = function (...args) {
            const tid = env.Process.getCurrentThreadId();
            if (stopped || observing.has(tid)) return hook.method.apply(this, args);
            if (captured >= config.maxEvents) {
              if (!budgetReported) { budgetReported = true; emit({ event: 'java-event-budget', partial: true }); }
              return hook.method.apply(this, args);
            }
            captured++;
            const stack = active.get(tid) || [];
            const frame = { invocationId: config.traceId + ':java:' + ++invocation, parentInvocationId: stack.at(-1)?.invocationId ?? null, hookId: hook.target.id, methodKey: hook.key, threadId: tid };
            emit({ event: 'java-call-observed', ...frame });
            let matched = null;
            const details = safe(tid, () => {
              const correlation = hook.target.correlation;
              const result = { arguments: args.map(view) };
              const receiver = hook.target.captureReceiver || correlation?.receiver || correlation?.role === 'reply' && correlation.argumentIndex === undefined ? object(this, !!(hook.target.captureReceiver || correlation?.role === 'request' && correlation.receiver)) : null;
              if (hook.target.captureReceiver && receiver) result.receiverIdentity = { objectId: receiver.objectId, association: 'jni-object-identity-history' };
              if (hook.target.valueCaptures?.length) result.valueCaptures = hook.target.valueCaptures.map(capture => {
                // long: MethodCall为固定Flutter协议对象，只读其公开final字段并保留标量，不调用arguments()或未知对象业务方法。
                  const methodCallType = methodCallTypes.get(capture.className || 'io.flutter.plugin.common.MethodCall');
                  const value = Java.cast(args[capture.argumentIndex], methodCallType);
                try {
                  const field = name => {
                    try {
                      const candidate = value[name];
                      const direct = candidate?.value ?? candidate;
                      // Java字段名arguments会与Frida wrapper的JS函数属性冲突，必须继续走反射读取真正字段。
                      if (typeof direct !== 'function' && direct !== undefined && direct !== null) return direct;
                    } catch {}
                    try {
                      const reflected = value.class.getField(name).get(value);
                      return reflected?.value ?? reflected;
                    } catch { return undefined; }
                  };
                  const argument = field(capture.argumentsField || 'arguments');
                  let argumentView = view(argument);
                  try {
                    if (typeof argument === 'number') argumentView = { kind: 'number', value: argument };
                    else if (argument !== undefined && argument !== null && argument?.$h && valueTypes.has('java.lang.Integer')) {
                      const boxed = Java.cast(argument, valueTypes.get('java.lang.Integer'));
                      argumentView = { kind: 'number', value: boxed.intValue() };
                    }
                  } catch {}
                  const diagnostics = argument && typeof argument === 'object' ? { argumentType: typeof argument, argumentClassName: argument.$className || null, argumentKeys: Object.keys(argument).slice(0, 16) } : { argumentType: typeof argument };
                  return { kind: capture.kind, argumentIndex: capture.argumentIndex, method: view(field(capture.methodField || 'method')), arguments: argumentView, ...diagnostics, association: 'observed-method-call-fields' };
                }
                finally { value.$dispose(); }
              });
              if (correlation) {
                const entry = correlation.argumentIndex === undefined ? receiver : object(args[correlation.argumentIndex], correlation.role === 'request');
                if (entry) {
                  let pending = entry.pending.get(correlation.group);
                  if (correlation.role === 'request') {
                    if (pending || entry.usedGroups.has(correlation.group)) {
                      pending ||= { requestId: frame.invocationId, requestThreadId: tid, busy: false };
                      pending.ambiguous = true; entry.pending.set(correlation.group,pending);
                      result.partial = true;
                      result.correlation = { state: 'ambiguous-object-reuse', objectId: entry.objectId, group: correlation.group };
                    } else { pending = { requestId: frame.invocationId, requestThreadId: tid, busy: false, ambiguous: false, multiReply: correlation.multiReply === true }; entry.usedGroups.add(correlation.group); entry.pending.set(correlation.group, pending); result.correlation = { state: 'request', requestId: pending.requestId, objectId: entry.objectId, group: correlation.group, ...(pending.multiReply ? { multiReply: true } : {}) }; }
                  } else if (pending && !pending.ambiguous && !pending.busy) {
                    pending.busy = true; matched = { entry, pending, group: correlation.group };
                    result.correlation = { state: 'reply-attempt', requestId: pending.requestId, requestThreadId: pending.requestThreadId, objectId: entry.objectId, group: correlation.group, association: 'jni-isSameObject' };
                  } else result.correlation = { state: pending ? 'ambiguous-or-nested-reply' : 'unmatched-reply', objectId: entry.objectId, group: correlation.group };
                } else result.correlation = { state: identityHistoryLost ? 'identity-history-lost' : correlation.role === 'reply' ? 'unmatched-reply' : 'identity-unavailable', group: correlation.group };
              }
              return result;
            }, { observationFailed: true, partial: true });
            emit({ event: 'java-enter', ...frame, ...details }); stack.push(frame); active.set(tid, stack);
            let value, thrown, outcome = 'return';
            try { value = hook.method.apply(this, args); return value; }
            catch (error) { outcome = 'throw'; thrown = error; throw error; }
            finally {
              stack.pop(); if (!stack.length) active.delete(tid);
              const end = safe(tid, () => ({ returnValue: outcome === 'return' ? view(value) : null, exception: outcome === 'throw' ? view(thrown) : null }), { observationFailed: true, partial: true });
              emit({ event: 'java-exit', ...frame, outcome, ...end, ...(matched ? { correlation: { ...details.correlation, state: outcome === 'return' ? 'reply-returned' : 'reply-threw' } } : {}) });
              if (matched) {
                if (!matched.pending.multiReply) matched.entry.pending.delete(matched.group);
                else matched.pending.busy = false;
                matched.entry.seen = now();
              }
            }
          };
          hook.method.implementation = hook.replacement;
        }
        env.clearTimeout(deadline);
        // long: profile验证通过后只对精确ART/bridge组合放行，事件中的experimental必须与兼容门状态一致。
        emit({ event: 'java-group-ready', loader, hooks: hooks.map(h => ({ id: h.target.id, methodKey: h.key, nativeIdentity: h.inspection?.identity })), compatibility: compatibility.profile, maxEvents: config.maxEvents, maxTrackedObjects: config.maxTrackedObjects, objectTtlMs: config.objectTtlMs, experimental: compatibility.status !== 'verified', limitation: '方法与JNI对象关联限定本脚本；兼容profile只覆盖已验证ART与bridge组合，不证明所有框架版本或异步数据流' });
      } catch (error) { emit({ event: 'java-setup-error', description: String(error).slice(0, 1200) }); stop(); }
    }, error => { emit({ event: 'java-setup-error', description: String(error).slice(0, 1200) }); stop(); }, () => stopped);
  });
  return { stop };
}
