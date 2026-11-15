import test from 'node:test';
import assert from 'node:assert/strict';
import { startMonoObserver } from '../helpers/mono-observer.js';
import { monoTraceScript } from '../src/core/mono-agent.js';

function fixture() {
  const events = [], state = { compiled: 0, detached: 0, freed: 0, hooks: 0 };
  const pointer = (id, text = null, offset = 0) => ({ id, offset, text, isNull: () => id === 0, equals: other => id === other.id, toString: () => '0x'+id.toString(16), toInt32: () => id, add: n => pointer(id,text,offset+n), sub: other => pointer(id-other.id), readU8: () => offset >= text.length ? 0 : text.charCodeAt(offset), readUtf8String: n => text.slice(offset,offset+n), writePointer(v) { this.current=v; }, readPointer() { return this.current; } });
  const p = pointer, nil = p(0), method = p(60), address = p(4096), image = p(40);
  const config = { assemblyName:'Owned', namespace:'Owned',className:'App',methodName:'Add',argumentTypes:['int32','int32'],returnType:'int32',allowRuntimeCompile:true,maxEvents:2,traceId:'owned' };
  const api = {
    mono_get_root_domain: () => p(1), mono_thread_attach: () => p(2), mono_thread_detach: () => state.detached++,
    mono_assembly_foreach: callback => { callback(p(30)); if(state.duplicate)callback(p(31)); }, mono_assembly_get_image: () => image,
    mono_image_get_name: () => p(100,'Owned'), mono_image_get_guid: () => p(101,'owned-mvid'), mono_class_from_name: () => p(50),
    mono_class_get_methods: (_class,cursor) => { if(cursor.current.id)return nil;cursor.current=method;return method; }, mono_method_get_name: () => p(102,'Add'),
    mono_method_signature: () => p(70), mono_signature_is_instance: () => state.instance ? 1 : 0, mono_signature_get_param_count: () => 2,
    mono_signature_get_return_type: () => p(80), mono_signature_get_params: () => p(81), mono_type_get_type: () => 8, mono_type_is_byref:type=> (state.byrefReturn&&type.id===80)||(state.byrefArgument&&type.id===81)?1:0,
    mono_method_get_token: () => 0x06000001, mono_method_full_name: () => p(103,state.generic?'Owned.App:Add<T> (int,int)':'Owned.App:Add (int,int)'), mono_free: () => state.freed++,
    mono_compile_method: () => { state.compiled++;return address; }, mono_jit_info_table_find: () => p(90), mono_jit_info_get_method: () => state.wrongMethod?p(61):method, mono_jit_info_get_code_start: () => address,
  };
  const env = { ptr:p, Process:{id:42,arch:'arm64',pointerSize:8,findModuleByName:()=>({getExportByName:name=>name}),findRangeByAddress:()=>({protection:'r-x'}),findModuleByAddress:()=>({name:'libaot-Owned.so',base:p(2048)})}, Memory:{alloc:()=>p(200),allocUtf8String:text=>p(201,text)}, NativeFunction: function(name){return api[name];}, NativeCallback:function(callback){return callback;},Interceptor:{attach(_address,hooks){state.hooks++;state.callbacks=hooks;return{detach(){state.unloaded=true;}};}}, send:row=>events.push(row),rpc:{exports:{}} };
  return {env,config,state,events,p};
}

test('Mono入口反查同一方法后才观测；原参数/返回寄存器保持只读并共享调用ID',()=>{
  const f=fixture(),observer=startMonoObserver(f.config,f.env);
  assert.equal(f.state.detached,1);assert.equal(f.state.compiled,1);assert.equal(f.state.freed,1);assert.equal(f.state.hooks,1);
  const call={threadId:7};f.state.callbacks.onEnter.call(call,[f.p(2),f.p(7)]);f.state.callbacks.onLeave.call(call,f.p(46));
  const enter=f.events.find(e=>e.event==='managed-enter'),exit=f.events.find(e=>e.event==='managed-exit');
  assert.deepEqual(enter.arguments,[2,7]);assert.equal(exit.returnValue,46);assert.equal(exit.invocationId,enter.invocationId);assert.equal(exit.metadataToken,'0x6000001');
  observer.stop();observer.stop();assert.equal(f.state.unloaded,true);
});

test('Mono拒绝歧义程序集/实例/泛型与错误JIT反查；失败仍detach，不安装猜测地址',()=>{
  for(const field of ['duplicate','instance','generic','wrongMethod','byrefReturn','byrefArgument']){
    const f=fixture();f.state[field]=true;startMonoObserver(f.config,f.env);
    assert.equal(f.state.hooks,0,field);assert.equal(f.state.detached,1,field);assert.ok(f.events.some(e=>e.event==='managed-setup-error'&&e.partial),field);
    if(field!=='wrongMethod')assert.equal(f.state.compiled,0);
  }
});

test('Mono固定模板要求明确编译许可与窄ABI，不接受泛型/任意脚本选择',()=>{
  const f=fixture(),args={monoTarget:f.config};assert.ok(monoTraceScript(args).includes('startMonoObserver'));
  assert.throws(()=>monoTraceScript({monoTarget:{...f.config,allowRuntimeCompile:false}}),/allowRuntimeCompile/);
  assert.throws(()=>monoTraceScript({monoTarget:{...f.config,argumentTypes:['pointer']}}),/Int32/);
  assert.throws(()=>monoTraceScript({monoTarget:{...f.config,className:'App`1'}}),/非泛型/);
  assert.throws(()=>monoTraceScript({...args,maxEvents:99999}),/预算/);
});

test('Mono允许显式实例与字符串及float窄ABI，并拒绝未知类型', () => {
  const f = fixture();
  const script = monoTraceScript({ monoTarget: { ...f.config, methodName: 'Normalize', argumentTypes: ['string'], returnType: 'string', instance: true, captureReceiver: true } });
  assert.match(script, /Normalize/);
  assert.doesNotThrow(() => monoTraceScript({ monoTarget: { ...f.config, argumentTypes: ['float'], returnType: 'float' } }));
  assert.throws(() => monoTraceScript({ monoTarget: { ...f.config, argumentTypes: ['pointer'] } }), /Int32\/bool\/long\/float\/string/);
  assert.throws(() => monoTraceScript({ monoTarget: { ...f.config, instance: 'yes' } }), /instance/);
});
