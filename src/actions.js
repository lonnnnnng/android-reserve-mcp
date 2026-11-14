import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Paths, within } from './core/paths.js';
import { Jobs } from './core/jobs.js';
import { Backend, jadxEngine } from './core/backend.js';
import { run, tool, locate, checked } from './core/process.js';
import { NativeTargets } from './core/native.js';
export { artifact, script } from './analysis.js';
export { framework } from './core/engines.js';
import { engineCatalog } from './core/engines.js';
import { runtimeScript, nativeTraceScript, validateNativeHook } from './core/frida-scripts.js';
import { VERSION } from './version.js';
import { compileJavaAgent } from './core/java-agent.js';
import { WebViews } from './core/webview.js';
import { kotlinMetadata } from './core/kotlin.js';
export { webview } from './core/webview.js';
export { packages } from './core/packages.js';
export { managed } from './core/managed.js';
export { evidence } from './core/evidence.js';

const helper = fileURLToPath(new URL('../helpers/static.py', import.meta.url));
const viewEventsHelper = fileURLToPath(new URL('../helpers/view-events.py', import.meta.url));
const skillNames = ['apk-reverse', 'mobile-reverse', 'ida-reverse', 'protocol-reverse'];
const text = value => JSON.stringify(value, null, 2);
const required = (value, name) => { if (value === undefined || value === '') throw new Error(`必须提供 ${name}`); return value; };

export async function createContext(options = {}) {
  const paths = await Paths.create(options.allowedRoots || [process.cwd()], options.workspace || path.join(os.homedir(), '.local/share/android-reserve-mcp'));
  const jobs = new Jobs(paths.workspace); await jobs.init();
  return { paths, jobs, backend: options.backend || new Backend(options), webviews: options.webviews || new WebViews(options.adb, paths.workspace), nativeTargets: new NativeTargets(options.nativeFactory || (() => new Backend({ ...options, nativeEngine: true }))), sessions: new Set(), sessionTargets: new Map(), scripts: new Map(), javaObservers: new Map(), compileJava: options.javaCompiler || compileJavaAgent,
    skillRoots: options.skillRoots || [path.join(os.homedir(), '.config/opencode/skills')],
    async close() {
      await jobs.close();
      const webviewCleanup=await Promise.allSettled([this.webviews.close()]);
      // long: 退出时仍清理其他后端，但必须把未确认的转发清理写入stderr，供用户按账本复核。
      if(webviewCleanup[0].status==='rejected')process.stderr.write('WebView清理未确认，请检查webview-forwards.jsonl：'+String(webviewCleanup[0].reason?.message).slice(0,500)+'\n');
      await this.nativeTargets.close();
      for (const id of this.sessions) { try { await this.backend.call('close_frida_session', { session_id: id }); } catch {} }
      await this.backend.close();
    } };
}

async function python(command, file, signal) {
  return JSON.parse(checked(await run(await tool('python3'), [helper, command, file], { signal }), command).stdout);
}

export async function doctor(context) {
  const dependencies = {};
  for (const name of ['python3', 'java', 'javac', 'npx', 'jadx', 'apktool', 'adb', 'apkanalyzer', 'apksigner', 'zipalign', 'aapt2', 'd8', 'readelf', 'rg', 'frida']) {
    const executable = await locate(name);
    dependencies[name] = { available: !!executable, executable };
  }
  const engineRoot=path.join(os.homedir(),'.local/share/android-reserve-mcp/engines');
  const dependency=async file=>({path:file,absolute:path.isAbsolute(file),exists:path.isAbsolute(file)&&await fs.stat(file).then(s=>s.isFile()).catch(()=>false),validation:'path-only'});
  // long: 可选解析器必须独立报告，不能因基础Java/Python可用就让用户误以为store压缩或Kotlin依赖已齐全。
  const kotlinHome=process.env.ANDROID_RESERVE_KOTLIN_HOME||path.join(engineRoot,'kotlin');
  const analysisDependencies={
    bundletool:await dependency(process.env.ANDROID_RESERVE_BUNDLETOOL||path.join(engineRoot,'bundletool-all-1.18.3.jar')),
    kotlin:await Promise.all(['kotlin-metadata-jvm-2.3.21.jar','kotlin-stdlib-2.3.21.jar'].map(name=>dependency(path.join(kotlinHome,name)))),
    managedPython:await dependency(process.env.ANDROID_RESERVE_MANAGED_PYTHON||path.join(engineRoot,'managed-env/bin/python')),
    compressionModules:'未导入验证；LZ4/Zstd提取需要所选Python中的lz4与zstandard',
    webview:'需要ADB与目标已开放的WebView调试socket；此检查不连接设备',
  };
  return { workspace: context.paths.workspace, allowedRoots: context.paths.roots, dependencies, analysisDependencies,
    optionalEngines: await engineCatalog(),
    rea: { enabled: !context.backend.disabled, package: context.backend.packageName, started: !!context.backend.client, jadxEngine: await jadxEngine(), validation: '仅检查文件与路径；未启动后端、加载 Frida Node binding 或连接设备' },
    devicePolicy: '设备操作必须显式 serial/device_id，不自动选择手机或启动模拟器',
    server: 'android-reserve-mcp', version: VERSION };
}

export async function apk(context, args) {
  const input = await context.paths.input(args.path);
  return context.jobs.start(`APK ${args.action}`, async (signal, dir) => {
    if (args.action === 'inspect') return python('apk', input, signal);
    if (args.action === 'signature') {
      return checked(await run(await tool('apksigner'), ['verify', '--verbose', '--print-certs', input], { signal }), '签名验证');
    }
    let xml = input;
    if (!input.endsWith('.xml')) {
      const result = checked(await run(await tool('apkanalyzer'), ['manifest', 'print', input], { signal, timeoutMs: 90000 }), 'Manifest 解码');
      if (result.truncated) throw new Error('Manifest 输出超过读取预算');
      xml = path.join(dir, 'AndroidManifest.xml'); await fs.writeFile(xml, result.stdout);
    }
    return python('manifest', xml, signal);
  });
}

export async function decode(context, args) {
  const input = await context.paths.input(args.path);
  const engines = args.engine === 'both' ? ['jadx', 'apktool'] : [args.engine];
  const commands = Object.fromEntries(await Promise.all(engines.map(async name => [name, await tool(name)])));
  return context.jobs.start(`解包 ${path.basename(input)}`, async (signal, dir) => {
    const results = [];
    for (const engine of engines) {
      if (signal.aborted) throw new Error('任务已取消');
      const output = path.join(dir, engine === 'jadx' ? 'java' : 'resources');
      const parameters = engine === 'jadx' ? ['--no-res', '--show-bad-code', '-j', '2', '-d', output, input] : ['d', input, '-o', output];
      const result = await run(commands[engine], parameters, { signal, timeoutMs: (args.timeoutSeconds || 300) * 1000 });
      await fs.writeFile(path.join(dir, `${engine}.log`), result.stdout + '\n' + result.stderr);
      results.push({ engine, code: result.code, timedOut: result.timedOut, canceled: result.canceled, truncated: result.truncated, output: path.basename(output), log: engine + '.log' });
    }
    // long: JADX 对部分坏方法可能非零退出但仍产出可读源码，必须把部分成功和全部成功区分开。
    if (results.every(r => r.code !== 0)) throw new Error('所有解包阶段均失败，请分页读取任务日志');
    return { input, stages: results, partial: results.some(r => r.code !== 0) };
  });
}

export async function dex(context, args) {
  if (args.action === 'kotlin') return kotlinMetadata(context, args);
  const input = await context.paths.input(args.path);
  const names = { classes: 'search_android_classes', class: 'inspect_android_class', method: 'inspect_android_method', references: 'trace_android_references' };
  const parameters = { path: input };
  if (args.action === 'classes') parameters.query = args.query || '';
  else parameters.class_name = required(args.className, 'className');
  if (args.action === 'method') parameters.method_name = required(args.methodName, 'methodName');
  if (args.action === 'references' && args.methodName) parameters.method_name = args.methodName;
  if (args.overloadIndex !== undefined) parameters.overload_index = args.overloadIndex;
  if (args.mappingPath) {
    if (!['class', 'method'].includes(args.action)) throw new Error('mappingPath仅用于class/method');
    parameters.mapping_path = await context.paths.input(args.mappingPath);
  }
  return context.jobs.start(`DEX ${args.action}`, signal => context.backend.call(names[args.action], parameters, signal));
}

export async function search(context, args) {
  const directory = await context.paths.input(args.directory, { directory: true });
  return context.jobs.start('源码文本检索', async signal => {
    const parameters = ['--json', '--max-count', '30', '--max-filesize', '2M'];
    if (!args.regex) parameters.push('--fixed-strings');
    parameters.push('--', args.query, directory);
    const result = await run(await tool('rg'), parameters, { signal, timeoutMs: 30000, maxBytes: 1024 * 1024 });
    if (![0, 1].includes(result.code)) checked(result, '文本检索');
    const matches = [];
    for (const line of result.stdout.split('\n')) {
      try { const row = JSON.parse(line); if (row.type === 'match') matches.push({ file: row.data.path.text, line: row.data.line_number, text: row.data.lines.text.slice(0, 1000) }); } catch {}
    }
    const offset = args.offset || 0, limit = args.limit || 30;
    return { kind: 'text-search-not-dex-xref', matches: matches.slice(offset, offset + limit), offset, nextOffset: matches.length > offset + limit ? offset + limit : null, captureTruncated: result.truncated };
  });
}

export async function resources(context, args) {
  if(args.action==='view-events'){
    const input=await context.paths.input(args.path,{directory:null});
    return context.jobs.start('View onClick声明扫描',async(signal,dir)=>{
      let decoded=input;
      if((await fs.stat(input)).isFile()){
        decoded=path.join(dir,'decoded');
        const result=await run(await tool('apktool'),['d','--no-src',input,'-o',decoded],{signal,timeoutMs:300000});
        await fs.writeFile(path.join(dir,'apktool.log'),result.stdout+'\n'+result.stderr);checked(result,'布局资源解码');
      }
      const report=JSON.parse(checked(await run(await tool('python3'),[viewEventsHelper,decoded,args.className||''],{signal,maxBytes:512*1024}),'View布局候选扫描').stdout);
      await fs.writeFile(path.join(dir,'layout-events.json'),JSON.stringify(report,null,2));
      return {...report,report:'layout-events.json'};
    });
  }
  const input = await context.paths.input(args.path);
  const parameters = { path: input, include_strings: true, string_offset: args.offset || 0, string_limit: args.limit || 50, max_total_strings: 500, string_tables_only: true, decode_timeout_ms: 300000 };
  if (args.locale) parameters.locale = args.locale;
  return context.jobs.start('Android 资源与字符串', signal => context.backend.call('decode_android_resources', parameters, signal));
}

export async function native(context, args) {
  if (args.action === 'providers') return context.jobs.start('Native provider状态', signal => context.nativeTargets.providers(signal));
  const sessionActions = { functions: 'list_procedures', function: 'analyze_function', references: 'procedure_references', callers: 'procedure_callers', callees: 'procedure_callees', status: 'binary_session' };
  if (args.action === 'close') {
    required(args.targetId, 'targetId');
    return context.jobs.start('关闭Native目标', () => context.nativeTargets.closeTarget(args.targetId));
  }
  if (sessionActions[args.action]) {
    required(args.targetId, 'targetId');
    const parameters = { detail: 'complete' };
    if (['function', 'references', 'callers', 'callees'].includes(args.action)) parameters.procedure = required(args.procedure, 'procedure');
    if (args.action === 'references') parameters.direction = args.direction || 'incoming';
    return context.jobs.start(`Native ${args.action}`, signal => context.nativeTargets.use(args.targetId, entry => entry.backend.call(sessionActions[args.action], parameters, signal)));
  }
  const input = await context.paths.input(args.path);
  if (args.action === 'open') {
    const header = await python('elf', input);
    return context.jobs.start('打开Native目标', async signal => ({ ...await context.nativeTargets.open(input, args.provider, signal), header }));
  }
  if (['go', 'rust'].includes(args.action)) return context.jobs.start(`Native ${args.action}元数据`, signal => context.backend.call(args.action === 'go' ? 'inspect_go_binary' : 'inspect_rust_binary', { path: input, detail: 'complete' }, signal));
  return context.jobs.start(`Native ${args.action}`, async signal => {
    if (args.action === 'jni') {
      const parameters = { path: input };
      if (args.className) parameters.class_name = args.className;
      return context.backend.call('inspect_android_jni_bindings', parameters, signal);
    }
    const header = await python('elf', input, signal);
    const executable = await locate('readelf');
    const details = executable ? checked(await run(executable, ['-h', '-d', '--dyn-syms', input], { signal }), 'ELF 信息') : null;
    return { header, details, limitation: '提供 ELF 头、依赖、动态符号；不把符号摘要当作反编译或跨函数数据流分析' };
  });
}

export async function device(context, args) {
  let parameters;
  if (args.action === 'list') parameters = ['devices', '-l'];
  else {
    const serial = required(args.serial, 'serial');
    if (!/^[A-Za-z0-9._:]+(?:-[A-Za-z0-9._:]+)*$/.test(serial) || serial.startsWith('-')) throw new Error('无效设备序列号');
    const actions = { inspect: ['shell', 'getprop'], packages: ['shell', 'pm', 'list', 'packages'], processes: ['shell', 'ps', '-A'], logcat: ['logcat', '-d', '-t', String(args.limit || 100)] };
    parameters = ['-s', serial, ...actions[args.action]];
  }
  const executable = await tool('adb');
  return context.jobs.start(`ADB ${args.action}`, async signal => ({ serial: args.serial, ...checked(await run(executable, parameters, { signal, timeoutMs: 20000, maxBytes: 512000 }), 'ADB 只读观测') }));
}

function structured(result) {
  if (result.structuredContent) return result.structuredContent;
  for (const entry of result.content || []) if (entry.type === 'text') { try { return JSON.parse(entry.text); } catch {} }
  return result;
}

export async function frida(context, args) {
  const names = { devices: 'list_frida_devices', processes: 'list_frida_processes', attach: 'start_frida_session', spawn: 'start_frida_session', load: 'load_frida_script', runtime: 'load_frida_script', 'trace-native': 'load_frida_script', 'java-methods': 'load_frida_script', 'java-loaders': 'load_frida_script', 'trace-java': 'load_frida_script', 'trace-jni': 'load_frida_script', unload: 'unload_frida_script', resume: 'resume_frida_session', status: 'frida_session_status', close: 'close_frida_session' };
  const javaAction = ['java-methods', 'java-loaders', 'trace-java', 'trace-jni'].includes(args.action);
  const parameters = {};
  if (['processes', 'attach', 'spawn'].includes(args.action)) {
    parameters.device_id = required(args.deviceId, 'deviceId');
    if (parameters.device_id === 'local') throw new Error('Android 观测不接受宿主机 local，请明确 Android deviceId');
  }
  if (args.action === 'attach') { parameters.mode = 'attach'; parameters.pid = required(args.pid, 'pid'); }
  if (args.action === 'spawn') { parameters.mode = 'spawn'; parameters.program = required(args.packageName, 'packageName'); }
  if (['attach', 'spawn'].includes(args.action)) parameters.capture_limits = { session_bytes: 1048576, message_type_bytes: 32768, message_text_bytes: 8192, json_nodes: 2000, json_depth: 20 };
  if (['load', 'runtime', 'trace-native', 'java-methods', 'java-loaders', 'trace-java', 'trace-jni', 'unload', 'resume', 'status', 'close'].includes(args.action)) {
    parameters.session_id = required(args.sessionId, 'sessionId');
    if (!context.sessions.has(parameters.session_id)) throw new Error('仅能操作本服务器创建的 Frida 会话');
  }
  if (['java-methods', 'trace-java'].includes(args.action)) { required(args.className, 'className'); required(args.methodName, 'methodName'); }
  if (args.action === 'trace-java' && !Array.isArray(args.argumentTypes)) throw new Error('trace-java必须显式argumentTypes，空参数使用[]；先java-methods读取实际重载');
  if (args.action === 'trace-java') for (const hook of args.nativeHooks || []) validateNativeHook(hook);
  if (args.action === 'unload') {
    parameters.script_id = required(args.scriptId, 'scriptId');
    if (!context.scripts.get(args.sessionId)?.has(args.scriptId)) throw new Error('scriptId不属于本服务该会话');
  }
  if (args.action === 'load') { parameters.source_kind = 'file'; parameters.path = await context.paths.input(required(args.scriptPath, 'scriptPath')); }
  const generated = args.action === 'runtime' ? runtimeScript() : args.action === 'trace-native' ? nativeTraceScript(args) : null;
  let reservation;
  if (args.action === 'close' && ['queued', 'compiling', 'loading'].includes(context.javaObservers.get(args.sessionId)?.state)) throw new Error('Java observer正在排队或注入，请先取消并等待该任务结束，再close会话');
  if (javaAction) {
    const targetKey = context.sessionTargets.get(args.sessionId);
    if (!targetKey) throw new Error('会话缺少设备/PID身份，请close后重新attach或spawn');
    // long: 独立bridge无法识别其他脚本的replacement；同设备/PID的多会话也必须共用一份观测所有权。
    if ([...context.javaObservers.values()].some(observer => observer.targetKey === targetKey)) throw new Error('该进程已有Java observer，请先unload其scriptId或close所属会话，避免覆盖已有hook');
    reservation = { scriptId: null, state: 'queued', targetKey }; context.javaObservers.set(args.sessionId, reservation);
  }
  const releaseReservation = () => { if (reservation && context.javaObservers.get(args.sessionId) === reservation) context.javaObservers.delete(args.sessionId); };
  try { return await context.jobs.start(`Frida ${args.action}`, async (signal, dir) => {
    let loadedId, managedFailure = false;
    try {
    if (generated) {
      parameters.source_kind = 'file'; parameters.path = path.join(dir, 'observer.js');
      await fs.writeFile(parameters.path, generated);
    }
    if (javaAction) {
      if (reservation) reservation.state = 'compiling';
      parameters.source_kind = 'file'; parameters.path = await context.compileJava(args, dir, signal);
      if (signal.aborted) throw new Error('Java observer任务已取消，未继续注入');
      if (!context.sessions.has(args.sessionId)) throw new Error('Frida会话已关闭，未继续注入');
      if (reservation) reservation.state = 'loading';
    }
    const result = await context.backend.call(names[args.action], parameters, signal);
    const record = structured(result), observation = record.normalized_result || record;
    if (args.action === 'status') {
      const observer = context.javaObservers.get(args.sessionId);
      const failure = observer?.scriptId && (observation.messages || []).find(message => message.script_id === observer.scriptId && (message.type === 'error' || ['java-setup-error', 'java-setup-timeout', 'java-unavailable', 'jni-setup-error', 'jni-unavailable', 'native-hook-error', 'module-wait-timeout'].includes(message.payload?.event)));
      if (failure) {
        // long: spawn的Java安装会延后到resume；只处理当前脚本的晚到失败，旧脚本历史消息不能撤销新观测。
        reservation = observer; loadedId = observer.scriptId; managedFailure = true;
        const error = new Error('Java observer运行失败：' + String(failure.description || failure.payload?.description || failure.payload?.event || '查看error.json').slice(0, 800));
        error.diagnostic = result; throw error;
      }
    }
    if (names[args.action] === 'load_frida_script' && observation.script_id) {
      loadedId = observation.script_id;
      if (!context.scripts.has(args.sessionId)) context.scripts.set(args.sessionId, new Set());
      context.scripts.get(args.sessionId).add(loadedId);
      if (reservation) { reservation.scriptId = loadedId; reservation.state = 'loaded'; }
    }
    if (generated || javaAction) {
      const failure = (observation.messages || []).find(message => (!loadedId || !message.script_id || message.script_id === loadedId) && (message.type === 'error' || ['java-setup-error', 'java-setup-timeout', 'java-unavailable', 'jni-setup-error', 'jni-unavailable', 'native-hook-error'].includes(message.payload?.event)));
      if (failure) {
        const error = new Error('观测脚本加载失败：' + String(failure.description || failure.stack || failure.payload?.description || failure.payload?.event || '查看error.json').slice(0, 800));
        error.diagnostic = result; throw error;
      }
      if (!loadedId) throw new Error('后端未返回script_id，脚本注入状态不确定，请close会话');
    }
    if (['attach', 'spawn'].includes(args.action)) {
      const id = record.session_id;
      if (!id) throw new Error('后端未返回 session_id，无法登记会话');
      context.sessions.add(id);
      const pid = record.pid || args.pid;
      if (Number.isSafeInteger(pid) && pid > 0) context.sessionTargets.set(id, JSON.stringify([parameters.device_id, pid]));
    }
    if (args.action === 'unload') {
      context.scripts.get(args.sessionId).delete(args.scriptId);
      if (context.javaObservers.get(args.sessionId)?.scriptId === args.scriptId) context.javaObservers.delete(args.sessionId);
    }
    if (args.action === 'close') { context.sessions.delete(parameters.session_id); context.sessionTargets.delete(args.sessionId); context.scripts.delete(args.sessionId); context.javaObservers.delete(args.sessionId); }
    return result;
    } catch (error) {
      let cleanupConfirmed = reservation ? ['queued', 'compiling'].includes(reservation.state) : !loadedId;
      if (loadedId && (generated || javaAction || managedFailure)) {
        try { await context.backend.call('unload_frida_script', { session_id: args.sessionId, script_id: loadedId }); context.scripts.get(args.sessionId)?.delete(loadedId); cleanupConfirmed = true; } catch {}
      }
      // long: 注入结果或撤销状态不确定时保留占位，要求close会话，不能允许下一次trace覆盖可能仍在运行的hook。
      if (reservation && context.javaObservers.get(args.sessionId) === reservation) {
        if (cleanupConfirmed) context.javaObservers.delete(args.sessionId);
        else { reservation.state = 'uncertain'; error.message += '\nJava observer清理未确认，请close此会话后重试。'; }
      }
      throw error;
    }
  }, { onQueuedCancel: releaseReservation }); } catch (error) {
    releaseReservation();
    throw error;
  }
}

export async function rebuild(context, args) {
  const input = await context.paths.input(args.path, { directory: args.action === 'build' });
  let keystore;
  if (args.action === 'sign') {
    keystore = await context.paths.input(required(args.keystore, 'keystore'));
    required(args.alias, 'alias');
    required(args.passwordEnv, 'passwordEnv');
    if (!process.env[args.passwordEnv]) throw new Error('指定的签名密码环境变量未设置');
  }
  return context.jobs.start(`APK ${args.action}`, async (signal, dir) => {
    if (args.action === 'build') {
      const output = path.join(dir, 'unsigned.apk');
      const result = checked(await run(await tool('apktool'), ['b', input, '-o', output], { signal, timeoutMs: 300000 }), 'APK 重建');
      return { output: 'unsigned.apk', process: result, signed: false, installed: false };
    }
    const aligned = path.join(dir, 'aligned.apk'), signed = path.join(dir, 'signed.apk');
    checked(await run(await tool('zipalign'), ['-p', '4', input, aligned], { signal }), 'zipalign');
    // long: 密码只通过进程环境读取，不把密码明文放入工具参数、进程命令行或日志。
    checked(await run(await tool('apksigner'), ['sign', '--ks', keystore, '--ks-key-alias', args.alias, '--ks-pass', 'env:' + args.passwordEnv, '--out', signed, aligned], { signal }), 'APK 签名');
    const verification = checked(await run(await tool('apksigner'), ['verify', '--verbose', '--print-certs', signed], { signal }), '签名复验');
    return { output: 'signed.apk', verification, installed: false };
  });
}

export async function jobAction(context, args) {
  if (args.action === 'list') return context.jobs.list();
  const id = required(args.jobId, 'jobId');
  if (args.action === 'cancel') return context.jobs.cancel(id);
  return context.jobs.summary(await context.jobs.get(id));
}

export async function artifacts(context, args) {
  const job = await context.jobs.get(required(args.jobId, 'jobId'));
  if (args.action === 'list') {
    const selected = args.path ? path.resolve(job.dir, args.path) : job.dir;
    const real = await fs.realpath(selected);
    if (!within(job.dir, real)) throw new Error('产物目录越界');
    const entries = await fs.readdir(real, { withFileTypes: true });
    const offset = args.offset || 0, limit = Math.min(args.limit || 50, 100);
    return { entries: entries.slice(offset, offset + limit).map(e => ({ name: e.name, directory: e.isDirectory(), symlink: e.isSymbolicLink() })), nextOffset: entries.length > offset + limit ? offset + limit : null };
  }
  const file = await context.paths.artifact(job.dir, required(args.path, 'path'));
  const handle = await fs.open(file, 'r');
  try {
    const offset = args.offset || 0, limit = Math.min(args.limit || 12000, 32000);
    const buffer = Buffer.alloc(limit); const { bytesRead } = await handle.read(buffer, 0, limit, offset);
    const size = (await handle.stat()).size;
    return { path: args.path, offset, bytes: bytesRead, totalBytes: size, text: buffer.subarray(0, bytesRead).toString('utf8'), nextOffset: offset + bytesRead < size ? offset + bytesRead : null };
  } finally { await handle.close(); }
}

export async function guidance(context, args) {
  if (args.action === 'list') {
    const entries = [];
    for (const root of context.skillRoots) for (const name of skillNames) {
      try {
        const file = path.join(root, name, 'SKILL.md'); const body = await fs.readFile(file, 'utf8');
        entries.push({ name, description: body.match(/^description:\s*(.+)$/m)?.[1] || name });
      } catch {}
    }
    return { skills: entries, note: '本地技能按需读取，服务不复制或公开分发个人 Skill 内容' };
  }
  const name = required(args.name, 'name'); if (!skillNames.includes(name)) throw new Error('未开放这个 Skill');
  for (const root of context.skillRoots) {
    let base, file;
    try { base = await fs.realpath(path.join(root, name)); file = await fs.realpath(path.join(base, args.path || 'SKILL.md')); } catch { continue; }
    if (!within(base, file)) throw new Error('Skill 资料路径越界');
    const relative = path.relative(base, file);
    if (relative !== 'SKILL.md' && !relative.startsWith('references' + path.sep)) throw new Error('仅提供 Skill 说明与 references 文档');
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(args.limit || 8000, 20000)), offset = args.offset || 0;
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); const total = (await handle.stat()).size;
      return { name, path: relative, text: buffer.subarray(0, bytesRead).toString('utf8'), nextOffset: offset + bytesRead < total ? offset + bytesRead : null };
    } finally { await handle.close(); }
  }
  throw new Error('本地未安装该 Skill 或资料不存在');
}
