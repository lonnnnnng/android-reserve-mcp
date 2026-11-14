import { withJavaFactory } from './java-loaders.js';

// long: 同一agent共用线程栈和JNI对象身份，异步回复只凭同一个Java对象关联，不按时间或类名猜测。
export function startJavaGroupObserver(Java, config, env = globalThis) {
  const hooks = [], objects = [], active = new Map(), observing = new Set();
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
    if (name === 'java.lang.String') result.value = String(Java.cast(value, Java.use(name))).slice(0, 1024);
    else if (name === 'java.lang.Integer') result.value = Java.cast(value, Java.use(name)).intValue();
    else if (name === 'java.lang.Boolean') result.value = Java.cast(value, Java.use(name)).booleanValue();
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
        const signatures = new Set();
        for (const target of config.javaHooks) {
          const type = factory.use(target.className);
          if (config.loaderSelector) {
            const actual = type.class.getClassLoader();
            try { if (!actual || !Java.vm.getEnv().isSameObject(actual.$h, factory.loader.$h)) throw new Error('目标不由所选loader定义'); }
            finally { actual?.$dispose(); }
          }
          const method = type[target.methodName].overload(...target.argumentTypes);
          if (target.returnType && method.returnType.className !== target.returnType) throw new Error('returnType与实际重载不符');
          const key = target.className + '.' + target.methodName + '(' + target.argumentTypes.join(',') + '):' + method.returnType.className;
          if (signatures.has(key) || method.implementation != null) throw new Error('重复方法或已有implementation，拒绝覆盖');
          signatures.add(key);
          // long: 在正常Java.perform环境预取类句柄，避免原方法回调路径首次创建类全局引用；不去优化或改写业务方法。
          const classHandle = type.class;
          hooks.push({ target, method, key, classHandle });
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
              const receiver = correlation?.role === 'reply' && correlation.argumentIndex === undefined ? object(this, false) : null;
              const result = { arguments: args.map(view) };
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
                    } else { pending = { requestId: frame.invocationId, requestThreadId: tid, busy: false, ambiguous: false }; entry.usedGroups.add(correlation.group); entry.pending.set(correlation.group, pending); result.correlation = { state: 'request', requestId: pending.requestId, objectId: entry.objectId, group: correlation.group }; }
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
                matched.entry.pending.delete(matched.group);
                matched.entry.seen = now();
              }
            }
          };
          hook.method.implementation = hook.replacement;
        }
        env.clearTimeout(deadline);
        emit({ event: 'java-group-ready', loader, hooks: hooks.map(h => ({ id: h.target.id, methodKey: h.key })), maxEvents: config.maxEvents, maxTrackedObjects: config.maxTrackedObjects, objectTtlMs: config.objectTtlMs, experimental: true, limitation: '已验普通Java与RN Promise边界；当前Android16 Flutter reply存在原方法回调崩溃，不能据此承诺任意框架方法兼容' });
      } catch (error) { emit({ event: 'java-setup-error', description: String(error).slice(0, 1200) }); stop(); }
    }, error => { emit({ event: 'java-setup-error', description: String(error).slice(0, 1200) }); stop(); }, () => stopped);
  });
  return { stop };
}
