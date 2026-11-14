// long: JNI文本为modified UTF-8；直接按普通UTF-8解码会误读NUL和UTF-16代理对，必须显式验证编码。
export function decodeModifiedUtf8(bytes) {
  const units = [];
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a > 0 && a < 0x80) units.push(a);
    else if ((a & 0xe0) === 0xc0) {
      const b = bytes[i++];
      if (b === undefined || (b & 0xc0) !== 0x80) throw new Error('无效modified UTF-8双字节序列');
      const value = ((a & 0x1f) << 6) | (b & 0x3f);
      if (value < 0x80 && !(a === 0xc0 && b === 0x80)) throw new Error('modified UTF-8含非规范过长编码');
      units.push(value);
    } else if ((a & 0xf0) === 0xe0) {
      const b = bytes[i++], c = bytes[i++];
      if (b === undefined || c === undefined || (b & 0xc0) !== 0x80 || (c & 0xc0) !== 0x80) throw new Error('无效modified UTF-8三字节序列');
      const value = ((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f);
      if (value < 0x800) throw new Error('modified UTF-8含非规范过长编码');
      units.push(value);
    } else throw new Error('modified UTF-8含未知字节序列');
  }
  return String.fromCharCode(...units);
}

export function readJniText(pointer, maxBytes = 1024) {
  const bytes = [];
  try {
    if (pointer.isNull()) throw new Error('文本指针为NULL');
    while (bytes.length < maxBytes) {
      const offset = bytes.length, count = Math.min(32, maxBytes - offset);
      let chunk;
      try { chunk = new Uint8Array(pointer.add(offset).readVolatile(count)); }
      catch { chunk = new Uint8Array(pointer.add(offset).readVolatile(1)); }
      if (!chunk.length) throw new Error('文本内存不可读');
      for (const byte of chunk) {
        if (byte === 0) return { text: decodeModifiedUtf8(bytes), encoding: 'modified-utf8', bytes: bytes.length, truncated: false };
        bytes.push(byte);
      }
    }
    return { text: null, encoding: 'modified-utf8', bytes: bytes.length, truncated: true, error: '达到文本字节预算且未见NUL' };
  } catch (error) { return { text: null, bytes: bytes.length, truncated: false, error: String(error.message || error).slice(0, 300) }; }
}

export function startJniObserver(Java, config, env = globalThis) {
  const { Process, Interceptor } = env;
  const listeners = [], classes = [], observing = new Set();
  let stopped = false, sequence = 0, invocation = 0, captured = 0, callbacks = 0, methodBudget = 1024, Class, classNameMethodId;
  function emit(payload) { try { env.send({ traceId: config.traceId, pid: Process.id, sequence: ++sequence, timestamp: Date.now(), ...payload }); } catch {} }
  function stop() {
    if (stopped) return; stopped = true;
    for (const listener of listeners) { try { listener.detach(); } catch {} }
    for (const entry of classes) { try { entry.wrapper.$dispose(); } catch {} }
    classes.length = 0;
  }
  if (env.rpc) env.rpc.exports = { ...env.rpc.exports, stopObserver: stop, dispose: stop };
  if (!Java.available) { emit({ event: 'jni-unavailable' }); return { stop }; }

  function checkObservationException(jni) {
    const error = jni.exceptionOccurred();
    if (!error.isNull()) { jni.deleteLocalRef(error); throw new Error('类身份观测新增JNI异常，已停止后续JNI步骤'); }
  }
  function safeClassName(jni, classHandle) {
    let name = null, chars = null;
    try {
      // long: bridge的getClassName会在CallObjectMethod失败后直接读NULL字符串；必须逐步检查，不能靠外围finally阻止CheckJNI abort。
      name = jni.vaMethod('pointer', [])(jni.handle, classHandle, classNameMethodId);
      checkObservationException(jni); if (name.isNull()) throw new Error('Class.getName返回NULL');
      const length = jni.getStringLength(name); checkObservationException(jni);
      if (length < 0 || length > 2048) throw new Error('类名超出2048个UTF-16单元预算');
      chars = jni.getStringChars(name); checkObservationException(jni);
      if (chars.isNull()) throw new Error('类名字符不可读取');
      return chars.readUtf16String(length);
    } finally {
      if (chars && !chars.isNull()) jni.releaseStringChars(name, chars);
      if (name && !name.isNull()) jni.deleteLocalRef(name);
    }
  }

  function classIdentity(handle, classHandle) {
    if (classHandle.isNull()) return { classId: null, className: null, identityError: '注册类引用为NULL，跳过类解析' };
    const jni = Java.vm.tryGetEnv();
    if (!jni || !jni.handle.equals(handle)) return { classId: null, className: null, identityError: '当前线程JNIEnv与回调不符' };
    const pending = jni.exceptionOccurred();
    // long: 进入前已有业务异常时不调用Class方法、不清异常；onLeave也不执行JNI，保留原注册失败异常。
    if (!pending.isNull()) { jni.deleteLocalRef(pending); return { classId: null, className: null, identityError: '业务已有pending exception，跳过类解析' }; }
    try {
      const className = safeClassName(jni, classHandle);
      if (typeof className !== 'string') throw new Error('无法解析注册类名');
      if (config.className && className !== config.className) return null;
      let entry = classes.find(item => jni.isSameObject(item.wrapper.$h, classHandle));
      if (!entry && classes.length < 128) {
        // long: local jclass不能跨回调保存；cast生成有弱绑定清理的global ref，同名但不同loader的类仍有独立身份。
        const wrapper = Java.cast(classHandle, Class); checkObservationException(jni);
        if (wrapper.$h.isNull()) throw new Error('无法保留类global reference');
        entry = { classId: `${config.traceId}:class:${classes.length + 1}`, wrapper }; classes.push(entry);
      }
      return { classId: entry?.classId ?? null, className, identityError: entry ? null : '超过128个类身份预算' };
    } finally {
      // long: 仅清除本次观测新增的异常；进入前的业务异常已在上方提前返回，绝不使用会吞原异常的通用清理函数。
      const introduced = jni.exceptionOccurred();
      if (!introduced.isNull()) { jni.exceptionClear(); jni.deleteLocalRef(introduced); }
    }
  }

  function methods(pointer, count) {
    const rows = [], limit = Math.min(Math.max(count, 0), config.maxMethods || 64, methodBudget);
    let outputBytesUpperBound = 0, tableOutputTruncated = false;
    for (let i = 0; i < limit; i++) {
      methodBudget--;
      try {
        const item = pointer.add(i * 3 * Process.pointerSize);
        const name = readJniText(item.readPointer()), signature = readJniText(item.add(Process.pointerSize).readPointer());
        const address = item.add(2 * Process.pointerSize).readPointer(), module = Process.findModuleByAddress(address);
        const row = { index: i, name: name.text, signature: signature.text, nameRead: name, signatureRead: signature, address: address.toString(), module: module?.name ?? null, modulePath: module?.path ?? null, base: module?.base.toString() ?? null, rva: module ? address.sub(module.base).toString() : null };
        // long: 后端单消息预算32KiB；按UTF-16单元的UTF-8最坏上界留20KiB给方法表，避免长签名让整条事件被截掉。
        const upperBound = JSON.stringify(row).length * 3;
        if (outputBytesUpperBound + upperBound > 20000) { tableOutputTruncated = true; break; }
        outputBytesUpperBound += upperBound; rows.push(row);
      } catch (error) { rows.push({ index: i, error: String(error.message || error).slice(0, 300) }); break; }
    }
    return { methods: rows, reportedMethodCount: count, emittedMethodCount: rows.length, tableOutputTruncated, partial: count < 1 || rows.length < count || rows.some(row => row.error || !row.name || !row.signature), methodBudgetRemaining: methodBudget };
  }

  function install(address, operation) {
    listeners.push(Interceptor.attach(address, {
      onEnter(args) {
        this.observation = null;
        if (stopped || observing.has(this.threadId) || captured >= (config.maxEvents || 50)) return;
        if (++callbacks > 4096) { if (callbacks === 4097) emit({ event: 'jni-budget-exhausted', budget: 'callback-limit-4096' }); return; }
        observing.add(this.threadId);
        try {
          const identity = classIdentity(args[0], args[1]);
          if (!identity || (config.className && identity.className !== config.className)) return;
          captured++;
          const details = operation === 'register' ? methods(args[2], args[3].toInt32()) : {};
          this.observation = { ...identity, ...details, operation, registrationId: `${config.traceId}:jni:${++invocation}`, threadId: this.threadId };
          emit({ event: `jni-${operation}-enter`, phase: 'attempt', ...this.observation });
        } catch (error) { emit({ event: 'jni-observation-warning', description: String(error.message || error).slice(0, 500) }); }
        finally { observing.delete(this.threadId); }
      },
      onLeave(retval) {
        if (!this.observation || stopped) return;
        // long: 返回0才记录成功；负值失败可能存在部分副作用，不用入口记录冒充有效绑定，也不清原NoSuchMethodError。
        const code = retval.toInt32(), { methods: ignored, ...identity } = this.observation;
        emit({ event: `jni-${operation}-result`, phase: 'returned', ...identity, returnCode: code, outcome: code === 0 ? 'success' : 'failure', mappingEffect: code === 0 ? (operation === 'register' ? 'registered' : 'class-unregistered') : 'unknown-on-failure' });
      },
    }));
  }

  try {
    // long: vm.perform不等待app loader，保证spawn恢复前能观察JNI_OnLoad注册；只取得当前线程表，不承诺所有CheckJNI变体。
    Java.vm.perform(jni => {
      Class = Java.use('java.lang.Class'); classNameMethodId = jni.javaLangClass().getName;
      const table = jni.handle.readPointer();
      const register = table.add(215 * Process.pointerSize).readPointer(), unregister = table.add(216 * Process.pointerSize).readPointer();
      install(register, 'register'); install(unregister, 'unregister');
      emit({ event: 'jni-observer-ready', source: 'jni-interface-table', table: table.toString(), registerAddress: register.toString(), unregisterAddress: unregister.toString(), slots: [215, 216], coverage: 'future-calls-through-observed-entrypoints', maxEvents: config.maxEvents || 50, maxMethods: config.maxMethods || 64 });
    });
  } catch (error) { emit({ event: 'jni-setup-error', description: String(error.message || error).slice(0, 1000) }); stop(); }
  return { stop };
}
