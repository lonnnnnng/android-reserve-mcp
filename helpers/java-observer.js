import { resolveNativeAddress } from './native-location.js';
import { withJavaFactory } from './java-loaders.js';
import { javaCompatibility, verifyJavaRuntimeProfile } from './java-compatibility.js';
import { selectJavaOverload } from './java-signature.js';

// long: Java和Native共用此agent的线程栈；只将原方法执行区间内的事件关联，观测自身的JNI不混入业务证据。
export function startJavaObserver(Java, config, env = globalThis, profile) {
  const compatibility = javaCompatibility(config, profile ? verifyJavaRuntimeProfile(profile, env) : undefined);
  if (!compatibility.supported) {
    try { env.send({ event: 'java-compatibility-blocked', ...compatibility }); } catch {}
    return { stop() {} };
  }
  const { Process, Interceptor, Thread, Backtracer } = env;
  const active = new Map(), observing = new Map(), listeners = [], timers = [];
  let stopped = false, selected = null, installed = false, invocation = 0, sequence = 0, captured = 0, releaseLoader = () => {};
  function emit(payload) {
    try { env.send({ traceId: config.traceId, pid: Process.id, sequence: ++sequence, timestamp: Date.now(), ...payload }); } catch {}
  }
  function observe(tid, operation, fallback = null) {
    observing.set(tid, (observing.get(tid) || 0) + 1);
    try { return operation(); } catch { return fallback; }
    finally { const count = observing.get(tid) - 1; if (count) observing.set(tid, count); else observing.delete(tid); }
  }
  function valueView(value) {
    if (value === null) return { kind: 'null', value: null };
    const kind = typeof value;
    if (['number', 'boolean'].includes(kind)) return { kind, value };
    if (kind === 'string') return { kind, value: value.slice(0, 2048), truncated: value.length > 2048 };
    if (kind === 'undefined') return { kind: 'void' };
    // long: 不调用目标对象toString、不遍历字段，避免观测触发业务逻辑或泄露整个对象图。
    return { kind: 'object', className: value.$className || null, valueOmitted: true };
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) { env.clearInterval(timer); env.clearTimeout(timer); }
    for (const listener of listeners) { try { listener.detach(); } catch {} }
    if (installed) { try { Java.performNow(() => { selected.implementation = null; }); } catch {} }
    try { releaseLoader(); } catch {}
  }
  if (env.rpc) env.rpc.exports = { ...env.rpc.exports, stopObserver: stop, dispose: stop };
  if (!Java.available) { emit({ event: 'java-unavailable' }); return { stop }; }
  const deadline = env.setTimeout(() => { emit({ event: 'java-setup-timeout' }); stop(); }, 30000);
  timers.push(deadline);

  function nativeHook(hook) {
    let listener = null, attempts = 0, count = 0;
    function install(module) {
      if (stopped || listener) return;
      try {
        const address = resolveNativeAddress(module, hook, env);
        listener = Interceptor.attach(address, {
          onEnter(args) {
            this.capture = !stopped && !observing.get(this.threadId) && count < config.maxEvents;
            if (!this.capture) return;
            const frame = active.get(this.threadId)?.at(-1);
            this.javaInvocationId = frame?.invocationId ?? null;
            this.nativeInvocationId = `${config.traceId}:native:${++invocation}`;
            this.values = observe(this.threadId, () => Array.from({ length: hook.argumentCount ?? 4 }, (_, i) => {
              const index = i + (hook.argumentOffset ?? 0);
              return { registerIndex: index, raw: args[index].toString(), int32: args[index].toInt32() };
            }), []);
            // long: 隐藏叶函数可能没有帧链，当前设备的精确回溯会在Frida内部崩溃；RVA入口只给候选返回地址，明确降低证据强度。
            this.stackKind = config.captureStack ? (hook.rva ? 'frida-fuzzy-candidates' : 'frida-accurate') : null;
            this.stack = config.captureStack ? observe(this.threadId, () => Thread.backtrace(this.context, hook.rva ? Backtracer.FUZZY : Backtracer.ACCURATE).slice(0, 16).map(p => p.toString()), []) : [];
          },
          onLeave(retval) {
            if (!this.capture || count++ >= config.maxEvents) return;
            observe(this.threadId, () => emit({ event: 'native-call', threadId: this.threadId, nativeInvocationId: this.nativeInvocationId, javaInvocationId: this.javaInvocationId, association: this.javaInvocationId ? 'same-thread-original-scope' : 'unassociated', module: module.name, symbol: hook.symbolName, base: module.base.toString(), address: address.toString(), rva: address.sub(module.base).toString(), arguments: this.values, returnValue: { raw: retval.toString(), int32: retval.toInt32() }, stack: this.stack, stackKind: this.stackKind }));
          },
        });
        listeners.push(listener);
        emit({ event: 'native-hook-installed', module: module.name, symbol: hook.symbolName, rva: address.sub(module.base).toString() });
      } catch (error) { emit({ event: 'native-hook-error', module: hook.moduleName, symbol: hook.symbolName, description: String(error.message || error).slice(0, 1000) }); }
    }
    const current = Process.findModuleByName(hook.moduleName);
    if (current) install(current);
    else {
      // long: 不在链接器回调中装hook；等待有上限，脚本卸载后不会留下无限采样任务。
      const timer = env.setInterval(() => {
        if (stopped) return;
        const module = Process.findModuleByName(hook.moduleName);
        if (module) { env.clearInterval(timer); install(module); }
        else if (++attempts >= 300) { env.clearInterval(timer); emit({ event: 'module-wait-timeout', module: hook.moduleName }); }
      }, 100);
      timers.push(timer);
    }
  }

  Java.perform(() => {
    if (stopped) return;
    withJavaFactory(Java, config, (factory, loader, release) => {
    releaseLoader = release;
    try {
      if (config.action === 'java-loaders') { env.clearTimeout(deadline); emit({ event: 'java-loaders', ...loader }); return; }
      const type = factory.use(config.className), member = type[config.methodName];
      if (config.loaderSelector) {
        const actual = type.class.getClassLoader();
        try { if (actual === null || !Java.vm.getEnv().isSameObject(actual.$h, factory.loader.$h)) throw new Error('目标类由其他loader定义，拒绝将父委派结果冒充所选loader'); }
        finally { actual?.$dispose(); }
      }
      if (!member?.overloads) throw new Error('所选成员不是可观察的Java方法');
      const overloads = member.overloads.map(method => ({ argumentTypes: method.argumentTypes.map(t => t.className), returnType: method.returnType.className }));
      if (config.action === 'java-methods') { env.clearTimeout(deadline); emit({ event: 'java-methods', className: config.className, methodName: config.methodName, loader, overloads }); return; }
      selected = selectJavaOverload(member, config.argumentTypes, config.returnType);
      if (selected.implementation != null) throw new Error('该方法已有本agent的实现，拒绝覆盖');
      // long: 让ART自身通过Java API读取栈，避免bridge直接遍历不同Android版本的内部StackVisitor布局导致原生崩溃。
      const javaThread = config.captureStack ? Java.use('java.lang.Thread') : null;
      function javaBacktrace() {
        const frames = javaThread.currentThread().getStackTrace();
        return { source: 'java.lang.Thread.getStackTrace', frames: Array.from({ length: Math.min(frames.length, 16) }, (_, i) => ({ className: String(frames[i].getClassName()), methodName: String(frames[i].getMethodName()), fileName: frames[i].getFileName() === null ? null : String(frames[i].getFileName()), lineNumber: frames[i].getLineNumber() })), truncated: frames.length > 16 };
      }
      const key = `${config.className}.${config.methodName}(${config.argumentTypes.join(',')}):${selected.returnType.className}`;
      for (const hook of config.nativeHooks || []) nativeHook(hook);
      selected.implementation = function (...args) {
        const tid = Process.getCurrentThreadId();
        if (stopped || observing.get(tid) || captured >= config.maxEvents) return selected.apply(this, args);
        captured++;
        const stack = active.get(tid) || [];
        const frame = { invocationId: `${config.traceId}:java:${++invocation}`, parentInvocationId: stack.at(-1)?.invocationId ?? null };
        const argumentsView = observe(tid, () => args.map(valueView), []);
        const javaStack = config.captureStack ? observe(tid, javaBacktrace, null) : null;
        observe(tid, () => emit({ event: 'java-enter', ...frame, threadId: tid, methodKey: key, arguments: argumentsView, stack: javaStack }));
        stack.push(frame); active.set(tid, stack);
        let result, thrown, outcome = 'return';
        try { result = selected.apply(this, args); return result; }
        catch (error) {
          // long: 原Java Throwable必须原样抛回；不能包装成JS Error改变目标的异常与返回行为。
          thrown = error; outcome = 'throw'; throw error;
        } finally {
          stack.pop(); if (!stack.length) active.delete(tid);
          observe(tid, () => emit({ event: 'java-exit', ...frame, threadId: tid, methodKey: key, outcome, returnValue: outcome === 'return' ? valueView(result) : null, exception: outcome === 'throw' ? valueView(thrown) : null }));
        }
      };
      installed = true;
      env.clearTimeout(deadline);
      emit({ event: 'java-hook-installed', className: config.className, methodName: config.methodName, argumentTypes: config.argumentTypes, returnType: selected.returnType.className, loader, maxEvents: config.maxEvents });
    } catch (error) { emit({ event: 'java-setup-error', description: String(error.message || error).slice(0, 1200) }); stop(); }
    }, error => { emit({ event: 'java-setup-error', description: String(error.message || error).slice(0, 1200) }); stop(); }, () => stopped);
  });
  return { stop };
}
