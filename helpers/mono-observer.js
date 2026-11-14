// long: 只解析已加载程序集中的精确静态整数方法；不加载程序集、不执行托管业务方法，也不读取任意对象。
export function startMonoObserver(config, env = globalThis) {
  let listener, stopped = false, sequence = 0, captured = 0, budgetReported = false;
  const emit = row => { try { env.send({ traceId: config.traceId, pid: env.Process.id, sequence: ++sequence, ...row }); } catch {} };
  const stop = () => { if (stopped) return; stopped = true; listener?.detach(); };
  const text = (pointer, max) => {
    if (pointer.isNull()) throw new Error('Mono名称指针为空');
    for (let i = 0; i < max; i++) if (pointer.add(i).readU8() === 0) return i ? pointer.readUtf8String(i) : '';
    throw new Error('Mono名称超过有界C字符串预算');
  };
  if (env.rpc) env.rpc.exports = { ...env.rpc.exports, stopObserver: stop, dispose: stop };
  try {
    if (env.Process.arch !== 'arm64') throw new Error('Mono观测目前只验收ARM64');
    const module = env.Process.findModuleByName('libmonosgen-2.0.so');
    if (!module) throw new Error('未加载libmonosgen-2.0.so；CoreCLR/NativeAOT不适用');
    const fn = (name, returns, args) => new env.NativeFunction(module.getExportByName(name), returns, args);
    const api = {
      root: fn('mono_get_root_domain', 'pointer', []), attach: fn('mono_thread_attach', 'pointer', ['pointer']), detach: fn('mono_thread_detach', 'void', ['pointer']),
      assemblies: fn('mono_assembly_foreach', 'void', ['pointer', 'pointer']), image: fn('mono_assembly_get_image', 'pointer', ['pointer']), imageName: fn('mono_image_get_name', 'pointer', ['pointer']), imageGuid: fn('mono_image_get_guid', 'pointer', ['pointer']),
      klass: fn('mono_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']), methods: fn('mono_class_get_methods', 'pointer', ['pointer', 'pointer']), name: fn('mono_method_get_name', 'pointer', ['pointer']),
      signature: fn('mono_method_signature', 'pointer', ['pointer']), instance: fn('mono_signature_is_instance', 'int', ['pointer']), count: fn('mono_signature_get_param_count', 'uint', ['pointer']),
      parameter: fn('mono_signature_get_params', 'pointer', ['pointer', 'pointer']), returnType: fn('mono_signature_get_return_type', 'pointer', ['pointer']), type: fn('mono_type_get_type', 'int', ['pointer']), byref: fn('mono_type_is_byref','int',['pointer']),
      token: fn('mono_method_get_token', 'uint', ['pointer']), fullName: fn('mono_method_full_name', 'pointer', ['pointer','int']), free: fn('mono_free','void',['pointer']), compile: fn('mono_compile_method', 'pointer', ['pointer']),
      jitInfo: fn('mono_jit_info_table_find', 'pointer', ['pointer', 'pointer']), jitMethod: fn('mono_jit_info_get_method', 'pointer', ['pointer']), code: fn('mono_jit_info_get_code_start', 'pointer', ['pointer']),
    };
    const domain = api.root(); if (domain.isNull()) throw new Error('Mono root domain尚未建立');
    // long: Frida的专用脚本线程访问Mono前必须注册；API解析完成即detach，不把工具线程长期留在GC线程集合。
    const thread = api.attach(domain); if (thread.isNull()) throw new Error('Mono线程注册失败');
    let resolved;
    try {
      const images = []; let examined = 0, enumerationError;
      const callback = new env.NativeCallback(assembly => {
        try {
          if (++examined > 4096) throw new Error('已加载程序集超过4096项，不能证明唯一');
          const image = api.image(assembly);
          if (!image.isNull() && text(api.imageName(image),512) === config.assemblyName) images.push(image);
        } catch (error) { enumerationError = error; }
      }, 'void', ['pointer', 'pointer']);
      api.assemblies(callback, env.ptr(0));
      if (enumerationError) throw enumerationError;
      if (images.length !== 1) throw new Error('程序集名称必须唯一匹配，当前' + images.length);
      const type = api.klass(images[0], env.Memory.allocUtf8String(config.namespace), env.Memory.allocUtf8String(config.className));
      if (type.isNull()) throw new Error('未找到精确Mono类');
      const iterator = env.Memory.alloc(env.Process.pointerSize); iterator.writePointer(env.ptr(0));
      const matches = []; let count = 0;
      for (;;) {
        const method = api.methods(type, iterator); if (method.isNull()) break;
        if (++count > 4096) throw new Error('类方法超过4096项');
        if (text(api.name(method),256) !== config.methodName) continue;
        const sig = api.signature(method); if (sig.isNull() || api.instance(sig) || api.count(sig) !== config.argumentTypes.length) continue;
        const returns = api.returnType(sig); if (returns.isNull() || api.byref(returns) || api.type(returns) !== 8) continue;
        const cursor = env.Memory.alloc(env.Process.pointerSize); cursor.writePointer(env.ptr(0));
        let valid = true;
        for (let i = 0; i < config.argumentTypes.length; i++) { const t = api.parameter(sig, cursor); if (t.isNull() || api.byref(t) || api.type(t) !== 8) valid = false; }
        if (valid) matches.push(method);
      }
      if (matches.length !== 1) throw new Error('静态Int32签名必须唯一匹配，当前' + matches.length);
      const method = matches[0], token = api.token(method);
      const allocatedName = api.fullName(method,1); let fullName;
      try { fullName = text(allocatedName,1024); } finally { if (!allocatedName.isNull()) api.free(allocatedName); }
      const expectedName = (config.namespace ? config.namespace+'.' : '') + config.className+':'+config.methodName+' ('+config.argumentTypes.map(()=>'int').join(',')+')';
      if (fullName !== expectedName) throw new Error('完整Mono签名不符或含泛型参数：'+fullName);
      if (!token || (token >>> 24) !== 6) throw new Error('必须具有MethodDef token，不接受泛型共享或动态方法');
      if (config.allowRuntimeCompile !== true) throw new Error('需显式allowRuntimeCompile；解析可能触发Mono JIT/AOT入口准备');
      const address = api.compile(method); if (address.isNull()) throw new Error('Mono未返回可观测入口');
      const info = api.jitInfo(domain, address);
      // long: compile返回值可能是共享thunk；必须从运行时反查回同一MonoMethod，拒绝仅凭地址猜方法名。
      if (info.isNull() || !api.jitMethod(info).equals(method) || !api.code(info).equals(address)) throw new Error('入口无法反查到同一MonoMethod/code start');
      const range = env.Process.findRangeByAddress(address); if (!range?.protection.includes('x')) throw new Error('Mono入口不在可执行区域');
      const owner = env.Process.findModuleByAddress(address);
      resolved = { address, identity: { runtime: 'mono', assemblyName: config.assemblyName, imageGuid: text(api.imageGuid(images[0]),128), namespace: config.namespace, className: config.className, methodName: config.methodName, fullName, argumentTypes: config.argumentTypes, returnType: 'int32', static: true, metadataToken: '0x' + token.toString(16), methodHandle: method.toString(), address: address.toString(), module: owner?.name ?? null, rva: owner ? address.sub(owner.base).toString() : null, association: 'mono-jit-info-method-identity' } };
    } finally { api.detach(thread); }
    listener = env.Interceptor.attach(resolved.address, {
      onEnter(args) {
        this.capture = !stopped && captured < config.maxEvents;
        if (!stopped && !this.capture && !budgetReported) { budgetReported = true; emit({ event: 'managed-event-budget', partial: true }); }
        if (!this.capture) return;
        captured++; this.invocationId = config.traceId + ':managed:' + captured;
        this.values = config.argumentTypes.map((_, index) => args[index].toInt32());
        emit({ event: 'managed-enter', invocationId: this.invocationId, threadId: this.threadId, ...resolved.identity, arguments: this.values });
      },
      onLeave(value) { if (this.capture) emit({ event: 'managed-exit', invocationId: this.invocationId, threadId: this.threadId, ...resolved.identity, outcome: 'return', returnValue: value.toInt32() }); },
    });
    emit({ event: 'managed-hook-installed', ...resolved.identity, maxEvents: config.maxEvents, limitation: 'ARM64静态非泛型Int32边界；内联调用可能不可见，未恢复UI/异步托管因果或异常终态' });
  } catch (error) { emit({ event: 'managed-setup-error', description: String(error).slice(0, 1200), partial: true }); stop(); }
  return { stop };
}
