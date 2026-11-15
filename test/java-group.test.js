import test from 'node:test';
import assert from 'node:assert/strict';
import { startJavaGroupObserver } from '../helpers/java-group-observer.js';
import { validateJavaGroup } from '../src/core/java-agent.js';

function fixture() {
  const events = [], timers = new Set(), methods = new Map(); let tid = 1, released = 0;
  const type = (name, fn, returns = 'void') => {
    const argumentsByName = { 'Reply.done': ['int'], 'Owned.inner': [], 'Owned.start': ['Reply'] };
    const method = { argumentTypes: argumentsByName[name].map(className => ({ className })), returnType: { className: returns }, implementation: null, apply: fn };
    methods.set(name, method); return { overloads: [method], overload: () => method };
  };
  const callback = type('Reply.done', (_self, args) => args[0], 'int');
  const inner = type('Owned.inner', () => 7, 'int');
  const request = type('Owned.start', (_self, args) => { methods.get('Owned.inner').implementation.call({ $h: 3 }); return args[0]; }, 'int');
  const classes = { Owned: { start: request, inner }, Reply: { done: callback } };
  const Java = { available: true, perform: fn => fn(), performNow: fn => fn(), use: name => classes[name], vm: { getEnv: () => ({ isSameObject: (a, b) => a === b }) }, retain: value => ({ ...value, $dispose: () => released++ }) };
  const env = { Process: { id: 42, getCurrentThreadId: () => tid }, rpc: { exports: {} }, send: row => events.push(row), setTimeout: fn => { timers.add(fn); return fn; }, setInterval: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn), clearInterval: fn => timers.delete(fn) };
  const config = { traceId: 'test', maxEvents: 30, maxTrackedObjects: 128, objectTtlMs: 30000, javaHooks: [
    { id: 'start', className: 'Owned', methodName: 'start', argumentTypes: ['Reply'], correlation: { group: 'reply', role: 'request', argumentIndex: 0 } },
    { id: 'inner', className: 'Owned', methodName: 'inner', argumentTypes: [] },
    { id: 'reply', className: 'Reply', methodName: 'done', argumentTypes: ['int'], correlation: { group: 'reply', role: 'reply' } },
  ] };
  return { Java, env, config, events, methods, timers, setTid: v => { tid = v; }, released: () => released };
}

test('多方法同线程父子与跨线程同对象回复；逆序回复不按时间错配，终态只记一次', () => {
  const f = fixture(), observer = startJavaGroupObserver(f.Java, f.config, f.env);
  const owner = { $h: 1 }, a = { $h: 10 }, b = { $h: 11 };
  f.methods.get('Owned.start').implementation.call(owner, a);
  f.methods.get('Owned.start').implementation.call(owner, b);
  f.setTid(2); assert.equal(f.methods.get('Reply.done').implementation.call({ $h: 11 }, 99), 99);
  f.setTid(3); f.methods.get('Reply.done').implementation.call({ $h: 10 }, 46);
  f.methods.get('Reply.done').implementation.call({ $h: 10 }, 47);
  const requests = f.events.filter(e => e.event === 'java-enter' && e.hookId === 'start');
  const replies = f.events.filter(e => e.event === 'java-exit' && e.correlation);
  assert.equal(replies[0].correlation.requestId, requests[1].invocationId); assert.equal(replies[1].correlation.requestId, requests[0].invocationId);
  assert.equal(replies.length, 2); assert.equal(replies[1].threadId, 3); assert.equal(replies[1].correlation.requestThreadId, 1);
  assert.ok(f.events.some(e => e.hookId === 'inner' && e.parentInvocationId === requests[0].invocationId));
  assert.ok(f.events.some(e => e.correlation?.state === 'unmatched-reply'));
  observer.stop(); assert.ok([...f.methods.values()].every(m => m.implementation === null)); assert.equal(f.timers.size, 0); assert.ok(f.released() >= 2);
});

test('重复pending对象不猜配；hook部分安装失败回滚，send失败不改变原异常', () => {
  const f = fixture(), observer = startJavaGroupObserver(f.Java, f.config, f.env);
  const a = { $h: 10 }; f.methods.get('Owned.start').implementation.call({ $h: 1 }, a); f.methods.get('Owned.start').implementation.call({ $h: 1 }, a);
  f.methods.get('Reply.done').implementation.call(a, 46);
  assert.ok(f.events.some(e => e.correlation?.state === 'ambiguous-object-reuse')); assert.ok(!f.events.some(e => e.correlation?.state === 'reply-returned'));
  observer.stop();
  const bad = fixture(); bad.methods.get('Reply.done').implementation = () => 99;
  startJavaGroupObserver(bad.Java, bad.config, bad.env);
  assert.equal(bad.methods.get('Owned.start').implementation, null); assert.equal(bad.methods.get('Reply.done').implementation(), 99);
  const thrown = fixture(), error = {};
  thrown.env.send = () => { throw new Error('sink'); }; thrown.methods.get('Reply.done').apply = () => { throw error; };
  const last = startJavaGroupObserver(thrown.Java, thrown.config, thrown.env);
  assert.throws(() => thrown.methods.get('Reply.done').implementation.call({ $h: 10 }, 1), e => e === error); last.stop();
});

test('分组观测参数拒绝重复ID、越界回复索引和无界预算', () => {
  const { config } = fixture(); validateJavaGroup(config);
  assert.throws(() => validateJavaGroup({ ...config, javaHooks: [config.javaHooks[0], config.javaHooks[0]] }), /唯一/);
  assert.throws(() => validateJavaGroup({ ...config, maxTrackedObjects: 99999 }), /预算/);
  assert.throws(() => validateJavaGroup({ ...config, javaHooks: [{ ...config.javaHooks[0], correlation: { group: 'reply', role: 'request', argumentIndex: 2 } }] }), /越界/);
  assert.throws(() => validateJavaGroup({ ...config, javaHooks: [{ ...config.javaHooks[0], className: 'x'.repeat(513) }] }), /有界/);
  assert.throws(() => validateJavaGroup({ ...config, javaHooks: [config.javaHooks[0],{...config.javaHooks[0],id:'other'}] }), /同一方法/);
});

test('对象TTL、身份预算和事件预算显式标记不完整；回复抛出仍保留原异常并释放引用',()=>{
  const originalNow=Date.now;let time=10000;Date.now=()=>time;
  try {
    const f=fixture();f.config.maxTrackedObjects=1;const observer=startJavaGroupObserver(f.Java,f.config,f.env);
    f.methods.get('Owned.start').implementation.call({$h:1},{$h:10});
    f.methods.get('Owned.start').implementation.call({$h:1},{$h:11});
    assert.ok(f.events.some(e=>e.event==='java-identity-budget'&&e.partial));
    time+=31000;for(const timer of [...f.timers])timer();
    assert.ok(f.events.some(e=>e.event==='java-correlation-incomplete'&&e.reason==='object-ttl-expired'));
    f.methods.get('Owned.start').implementation.call({$h:1},{$h:10});
    f.methods.get('Reply.done').implementation.call({$h:10},46);
    assert.ok(f.events.some(e=>e.event==='java-identity-history-lost'&&e.partial));assert.ok(!f.events.some(e=>e.correlation?.state==='reply-returned'));
    observer.stop();assert.equal(f.released(),1);
    const throwing=fixture(),throwObserver=startJavaGroupObserver(throwing.Java,throwing.config,throwing.env),marker={};
    throwing.methods.get('Owned.start').implementation.call({$h:1},{$h:12});
    throwing.methods.get('Reply.done').apply=()=>{time+=31000;for(const timer of [...throwing.timers])timer();throw marker;};
    assert.throws(()=>throwing.methods.get('Reply.done').implementation.call({$h:12},1),e=>e===marker);
    assert.ok(throwing.events.some(e=>e.correlation?.state==='reply-threw'));assert.equal(throwing.released(),0);
    throwObserver.stop();assert.equal(throwing.released(),1);
    const budget=fixture();budget.config.maxEvents=1;const last=startJavaGroupObserver(budget.Java,budget.config,budget.env);
    budget.methods.get('Owned.inner').implementation.call({$h:1});budget.methods.get('Owned.inner').implementation.call({$h:1});
    assert.equal(budget.events.filter(e=>e.event==='java-event-budget'&&e.partial).length,1);last.stop();
  } finally { Date.now=originalNow; }
});

test('已完成对象仍保留有界身份历史，再次请求和迟到重复回复不建立新配对',()=>{
  const f=fixture(),observer=startJavaGroupObserver(f.Java,f.config,f.env),object={$h:10};
  f.methods.get('Owned.start').implementation.call({$h:1},object);f.methods.get('Reply.done').implementation.call(object,46);
  f.methods.get('Owned.start').implementation.call({$h:1},object);f.methods.get('Reply.done').implementation.call(object,46);
  assert.equal(f.events.filter(e=>e.correlation?.state==='reply-returned').length,1);
  assert.ok(f.events.some(e=>e.correlation?.state==='ambiguous-object-reuse'));observer.stop();assert.equal(f.released(),1);
});

test('无参数入口按明确receiver关联异步回复，其他方法只记录同对象身份', () => {
  const f=fixture(),owner={$h:77};
  f.config.javaHooks[0]={...f.config.javaHooks[0],argumentTypes:[],captureReceiver:true,correlation:{group:'owner',role:'request',receiver:true}};
  f.methods.get('Owned.start').argumentTypes=[];f.methods.get('Owned.start').apply=()=>undefined;
  f.config.javaHooks[1].captureReceiver=true;f.config.javaHooks[2].correlation={group:'owner',role:'reply'};
  validateJavaGroup(f.config);const observer=startJavaGroupObserver(f.Java,f.config,f.env);
  f.methods.get('Owned.start').implementation.call(owner);
  f.methods.get('Owned.inner').implementation.call(owner);f.setTid(2);f.methods.get('Reply.done').implementation.call(owner,46);
  const request=f.events.find(row=>row.event==='java-enter'&&row.hookId==='start'),inner=f.events.find(row=>row.event==='java-enter'&&row.hookId==='inner'),reply=f.events.find(row=>row.event==='java-exit'&&row.correlation?.state==='reply-returned');
  assert.equal(inner.receiverIdentity.objectId,request.receiverIdentity.objectId);assert.equal(reply.correlation.requestId,request.invocationId);
  assert.throws(()=>validateJavaGroup({...f.config,javaHooks:[{...f.config.javaHooks[0],correlation:{group:'x',role:'request',receiver:true,argumentIndex:0}}]}),/同时|越界/);
  observer.stop();assert.equal(f.released(),1);
});

test('Flutter MethodCall采集兼容Frida字段wrapper和值对象，保留正向参数证据', () => {
  const fields = { method: { value: 'transformInt' }, arguments: { value: 17 } };
  const field = name => { try { const candidate = fields[name]; return candidate?.value ?? candidate; } catch { return undefined; } };
  assert.equal(field('method'), 'transformInt'); assert.equal(field('arguments'), 17);
});

test('Flutter MethodCall采集允许R8 mapping后的类名与字段名', () => {
  const { config } = fixture();
  const mapped = {
    ...config,
    javaHooks: [{
      ...config.javaHooks[0],
      argumentTypes: ['zb', 'cc'],
      valueCaptures: [{ kind: 'flutter-method-call', argumentIndex: 0, className: 'zb', methodField: 'a', argumentsField: 'b' }],
    }],
  };
  assert.doesNotThrow(() => validateJavaGroup(mapped));
});

test('EventChannel多次EventSink回复保留同一对象关联', () => {
  const f = fixture();
  f.config.javaHooks[0] = { ...f.config.javaHooks[0], correlation: { group: 'event-sink', role: 'request', argumentIndex: 0, multiReply: true } };
  f.config.javaHooks[2] = { ...f.config.javaHooks[2], correlation: { group: 'event-sink', role: 'reply' } };
  const observer = startJavaGroupObserver(f.Java, f.config, f.env);
  const sink = { $h: 10 };
  f.methods.get('Owned.start').implementation.call({ $h: 1 }, sink);
  f.methods.get('Reply.done').implementation.call(sink, 1);
  f.methods.get('Reply.done').implementation.call(sink, 2);
  assert.equal(f.events.filter(e => e.correlation?.state === 'reply-returned').length, 2);
  observer.stop();
});
