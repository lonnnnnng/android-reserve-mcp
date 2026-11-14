import test from 'node:test';
import assert from 'node:assert/strict';
import { startJavaObserver } from '../helpers/java-observer.js';

function fixture({ failSend = false, existing = null } = {}) {
  const events = [], callbacks = [], timers = new Set();
  const pointer = value => ({ toString: () => '0x' + value.toString(16), toInt32: () => value, sub: other => pointer(value - other.toInt32()) });
  const exception = { $className: 'java.lang.IllegalArgumentException', original: true };
  const method = { argumentTypes: [{ className: 'int' }, { className: 'int' }], returnType: { className: 'int' }, implementation: existing, apply(self, args) {
    if (args[0] < 0) throw exception;
    const call = { threadId: 123 };
    for (const callback of callbacks) callback.onEnter.call(call, [pointer(0), pointer(0), ...args.map(pointer)]);
    for (const callback of callbacks) callback.onLeave.call(call, pointer(args[0] + args[1]));
    return args[0] + args[1] + 37;
  } };
  const frames = [{ getClassName: () => 'Owned', getMethodName: () => 'compute', getFileName: () => 'Owned.java', getLineNumber: () => 37 }];
  const Java = { available: true, perform: fn => fn(), performNow: fn => fn(), use: name => name === 'java.lang.Thread' ? { currentThread: () => ({ getStackTrace: () => frames }) } : { compute: { overloads: [method], overload: (...types) => { assert.deepEqual(types, ['int', 'int']); return method; } } } };
  const env = { Process: { id: 1, getCurrentThreadId: () => 123, findModuleByName: () => ({ name: 'libfixture.so', base: pointer(0x1000), getExportByName: () => pointer(0x1100) }) }, Interceptor: { attach(address, callback) { callbacks.push(callback); return { detach() { const i = callbacks.indexOf(callback); if (i >= 0) callbacks.splice(i, 1); } }; } }, Thread: { backtrace: () => [] }, Backtracer: { ACCURATE: 1 }, send(payload) { if (failSend) throw new Error('observation failed'); events.push(payload); }, rpc: { exports: {} }, setTimeout(fn) { const id = {}; timers.add(id); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval(fn) { const id = {}; timers.add(id); return id; }, clearInterval(id) { timers.delete(id); } };
  const config = { action: 'trace-java', traceId: 'owned-trace', className: 'Owned', methodName: 'compute', argumentTypes: ['int', 'int'], maxEvents: 20, captureStack: true, nativeHooks: [{ moduleName: 'libfixture.so', symbolName: 'owned', argumentOffset: 2, argumentCount: 2 }] };
  return { Java, env, config, method, exception, events, callbacks, timers, pointer };
}

test('Java与JNI按同线程原始调用范围关联，返回值保持且卸载只撤销自己的hook', () => {
  const f = fixture(), observer = startJavaObserver(f.Java, f.config, f.env);
  assert.equal(f.method.implementation.call({}, 2, 7), 46);
  const enter = f.events.find(e => e.event === 'java-enter'), native = f.events.find(e => e.event === 'native-call'), exit = f.events.find(e => e.event === 'java-exit');
  assert.equal(native.javaInvocationId, enter.invocationId); assert.equal(exit.invocationId, enter.invocationId);
  assert.equal(native.returnValue.int32, 9); assert.equal(exit.returnValue.value, 46);
  assert.equal(enter.stack.source, 'java.lang.Thread.getStackTrace'); assert.equal(enter.stack.frames[0].methodName, 'compute');
  const unassociated = { threadId: 456 }; f.callbacks[0].onEnter.call(unassociated, [0, 0, 2, 7].map(f.pointer)); f.callbacks[0].onLeave.call(unassociated, f.pointer(9));
  assert.equal(f.events.at(-1).javaInvocationId, null);
  observer.stop(); assert.equal(f.method.implementation, null); assert.equal(f.callbacks.length, 0); assert.equal(f.timers.size, 0);
});

test('Java业务异常原样抛出，观测send失败不改变原始返回或异常', () => {
  const f = fixture({ failSend: true }), observer = startJavaObserver(f.Java, f.config, f.env);
  assert.equal(f.method.implementation.call({}, 2, 7), 46);
  assert.throws(() => f.method.implementation.call({}, -1, 7), error => error === f.exception);
  observer.stop();
});

test('方法已有实现时拒绝覆盖且stop不撤销他人的hook', () => {
  const existing = () => 99, f = fixture({ existing });
  startJavaObserver(f.Java, f.config, f.env);
  assert.equal(f.method.implementation, existing); assert.equal(f.callbacks.length, 0);
  assert.ok(f.events.some(e => e.event === 'java-setup-error'));
});
