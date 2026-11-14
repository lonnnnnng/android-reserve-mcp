import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { decodeModifiedUtf8, readJniText, startJniObserver } from '../helpers/jni-observer.js';
import { resolveNativeAddress } from '../helpers/native-location.js';
import { validateNativeHook, nativeTraceScript } from '../src/core/frida-scripts.js';

function fixture() {
  const cells = new Map(), memory = new Map(), hooks = new Map(), events = [], disposed = [];
  let pending = 0, envCalls = 0, brokenClassName = false, stringCalls = 0;
  const ptr = value => ({ n: Number(value), add: offset => ptr(Number(value) + Number(offset)), sub: other => ptr(Number(value) - other.n), compare: other => Math.sign(Number(value) - other.n), equals: other => Number(value) === other.n, isNull: () => Number(value) === 0, toInt32: () => Number(value) | 0, toString: () => '0x' + Number(value).toString(16), readPointer() { if (!cells.has(this.n)) throw new Error('unreadable pointer'); return ptr(cells.get(this.n)); }, readVolatile(length) { return Uint8Array.from(Array.from({ length }, (_, i) => { if (!memory.has(this.n + i)) throw new Error('unreadable text'); return memory.get(this.n + i); })).buffer; } });
  const text = (address, value) => { [...Buffer.from(value), 0].forEach((b, i) => memory.set(address + i, b)); return ptr(address); };
  cells.set(0x8000, 0xa000); cells.set(0xa000 + 215 * 8, 0x2000); cells.set(0xa000 + 216 * 8, 0x2100);
  text(0x5000, 'dynamicAdd'); text(0x5100, '(II)I'); cells.set(0x4000, 0x5000); cells.set(0x4008, 0x5100); cells.set(0x4010, 0x1040);
  const jni = { handle: ptr(0x8000), javaLangClass: () => ({ getName: ptr(0x6000) }), exceptionOccurred() { envCalls++; return ptr(pending); }, deleteLocalRef() {}, exceptionClear() { pending = 0; }, vaMethod: () => () => { if (brokenClassName) { pending = 998; return ptr(0); } return ptr(0x6100); }, getStringLength() { stringCalls++; return 5; }, getStringChars() { stringCalls++; return { isNull: () => false, readUtf16String: () => 'Owned' }; }, releaseStringChars() {}, isSameObject: (a, b) => a.equals(b) };
  const Java = { available: true, vm: { perform: fn => fn(jni), tryGetEnv: () => jni }, use: () => ({}), cast: handle => ({ $h: handle, $dispose() { disposed.push(handle.n); } }) };
  const module = { name: 'libowned.so', path: '/owned/libowned.so', base: ptr(0x1000), size: 0x100 };
  const env = { Process: { id: 1, pointerSize: 8, findModuleByAddress: () => module, findRangeByAddress: () => ({ protection: 'r-x' }) }, Interceptor: { attach(address, callbacks) { hooks.set(address.n, callbacks); return { detach: () => hooks.delete(address.n) }; } }, rpc: { exports: {} }, send: payload => events.push(payload) };
  const config = { traceId: 'owned', maxEvents: 20, maxMethods: 2 };
  function enter(operation = 'register', clazz = 0x9000, count = 1) {
    const callback = hooks.get(operation === 'register' ? 0x2000 : 0x2100), call = { threadId: 7 };
    callback.onEnter.call(call, [jni.handle, ptr(clazz), ptr(0x4000), ptr(count)]);
    return code => callback.onLeave.call(call, ptr(code));
  }
  return { Java, env, config, hooks, events, disposed, ptr, text, memory, jni, module, enter, setPending: value => { pending = value; }, getPending: () => pending, envCalls: () => envCalls, stringCalls: () => stringCalls, breakClassName: () => { brokenClassName = true; } };
}

test('JNI modified UTF-8解码及NUL/不可读/截断预算，不用无上限读字符串', () => {
  assert.equal(decodeModifiedUtf8([0x41, 0xc0, 0x80, 0xe4, 0xb8, 0xad]), 'A\0中');
  assert.equal(decodeModifiedUtf8([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]), '😀');
  assert.throws(() => decodeModifiedUtf8([0xc0, 0x81]), /过长/);
  assert.throws(() => decodeModifiedUtf8([0xf0, 0x9f, 0x98, 0x80]), /未知/);
  const f = fixture(); assert.equal(readJniText(f.text(0x6000, 'Owned')).text, 'Owned');
  assert.equal(readJniText(f.text(0x6100, 'abcdefgh'), 4).truncated, true);
  assert.match(readJniText(f.ptr(0)).error, /NULL/); assert.ok(readJniText(f.ptr(0xdead)).error);
});

test('JNI注册记录包含方法/签名/模块RVA，返回结果独立且按真实类对象区分同名类', () => {
  const f = fixture(), observer = startJniObserver(f.Java, f.config, f.env);
  assert.equal(f.events[0].event, 'jni-observer-ready');
  const result = f.enter(); assert.equal(f.events.at(-1).phase, 'attempt'); result(0);
  const entry = f.events.find(e => e.event === 'jni-register-enter'), returned = f.events.at(-1);
  assert.equal(entry.methods[0].name, 'dynamicAdd'); assert.equal(entry.methods[0].signature, '(II)I'); assert.equal(entry.methods[0].rva, '0x40');
  assert.equal(returned.registrationId, entry.registrationId); assert.equal(returned.outcome, 'success');
  f.enter('register', 0x9001)(0); assert.notEqual(f.events.at(-1).classId, entry.classId);
  f.enter('unregister')(0); assert.equal(f.events.at(-1).classId, entry.classId); assert.equal(f.events.at(-1).mappingEffect, 'class-unregistered');
  observer.stop(); assert.equal(f.hooks.size, 0); assert.deepEqual(f.disposed, [0x9000, 0x9001]);
});

test('JNI注册失败保留目标pending异常，观测新增异常可清理且不改变原返回', () => {
  const f = fixture(); startJniObserver(f.Java, f.config, f.env);
  const result = f.enter(); f.setPending(999); const calls = f.envCalls(); result(-7);
  assert.equal(f.getPending(), 999); assert.equal(f.envCalls(), calls); assert.equal(f.events.at(-1).returnCode, -7); assert.equal(f.events.at(-1).mappingEffect, 'unknown-on-failure');
  f.enter()(0); assert.equal(f.getPending(), 999); assert.match(f.events.at(-1).identityError, /业务已有/);
  f.setPending(0); f.breakClassName(); const strings = f.stringCalls(); f.enter()(0); assert.equal(f.getPending(), 0); assert.equal(f.events.at(-1).event, 'jni-observation-warning'); assert.equal(f.stringCalls(), strings, 'JNI抛异常后不能继续读取NULL字符串');
  const nullClass = fixture(); startJniObserver(nullClass.Java, nullClass.config, nullClass.env); nullClass.enter('register', 0)(-1); assert.equal(nullClass.stringCalls(), 0); assert.match(nullClass.events.at(-1).identityError, /NULL/);
});

test('JNI方法表过大只读预算内成员，类名过滤不会命中其他类', () => {
  const f = fixture(); f.config.maxMethods = 1; startJniObserver(f.Java, f.config, f.env); f.enter('register', 0x9000, 200)(0);
  const entry = f.events.find(e => e.event === 'jni-register-enter'); assert.equal(entry.methods.length, 1); assert.equal(entry.partial, true); assert.equal(entry.reportedMethodCount, 200);
  const other = fixture(); other.config.className = 'Another'; startJniObserver(other.Java, other.config, other.env); other.enter()(0); assert.equal(other.events.length, 1);
  const huge = fixture(); huge.module.path = 'x'.repeat(10000); startJniObserver(huge.Java, huge.config, huge.env); huge.enter()(0);
  const truncated = huge.events.find(e => e.event === 'jni-register-enter'); assert.equal(truncated.tableOutputTruncated, true); assert.equal(truncated.partial, true); assert.equal(truncated.methods.length, 0); assert.ok(Buffer.byteLength(JSON.stringify(truncated)) < 32000);
});

test('Native RVA拒绝越界/数据地址和歧义选择，生成脚本不拼入任意代码', () => {
  const f = fixture();
  assert.equal(resolveNativeAddress(f.module, { rva: '0x40' }, f.env).toString(), '0x1040');
  assert.throws(() => resolveNativeAddress(f.module, { rva: '0x100' }, f.env), /超出/);
  assert.throws(() => resolveNativeAddress(f.module, { rva: '0x1000000000000040' }, f.env), /超出/);
  assert.throws(() => resolveNativeAddress(f.module, { rva: '0x40' }, { Process: { findRangeByAddress: () => ({ protection: 'rw-' }) } }), /可执行/);
  for (const selection of [{ moduleName: 'a.so' }, { moduleName: 'a.so', rva: '0x40', symbolName: 'x' }, { moduleName: 'a.so', rva: '-1' }]) assert.throws(() => validateNativeHook(selection));
  assert.match(nativeTraceScript({ moduleName: 'a.so', rva: '0x40' }), /resolveNativeAddress/);
  const delayed=nativeTraceScript({moduleName:'late.so',symbolName:'late_fn',moduleWaitMs:700});
  assert.match(delayed,/config\.moduleWaitMs/);assert.match(delayed,/module-wait-timeout/);assert.match(delayed,/waitedMs:attempts\*100/);
  assert.throws(()=>nativeTraceScript({moduleName:'late.so',symbolName:'late_fn',moduleWaitMs:50}),/moduleWaitMs/);
  const timeoutEvents=[];let intervalCallback,clearedInterval;
  runInNewContext(nativeTraceScript({moduleName:'late.so',symbolName:'late_fn',moduleWaitMs:300}),{
    Process:{findModuleByName:()=>null},send:event=>timeoutEvents.push(event),
    setInterval:(callback,period)=>{assert.equal(period,100);intervalCallback=callback;return 9;},
    clearInterval:id=>{clearedInterval=id;}
  });
  intervalCallback();intervalCallback();intervalCallback();
  assert.equal(timeoutEvents[0].event,'waiting-module');
  assert.deepEqual(JSON.parse(JSON.stringify(timeoutEvents.at(-1))),{event:'module-wait-timeout',module:'late.so',waitedMs:300});
  assert.equal(clearedInterval,9);
});
