import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { locate, run, checked, tool } from './process.js';

const DEFINITIONS = {
  hermes: { variable: 'ANDROID_RESERVE_HBC_DISASSEMBLER', command: 'hbc-disassembler', probe: ['--help'], outputKind: 'hermes-disassembly', description: 'HBC反汇编；当前适配只接受72–96版本，非JS源码恢复' },
  flutter: { variable: 'ANDROID_RESERVE_BLUTTER', probe: ['--help'], outputKind: 'dart-aot-observations', description: 'Blutter Python入口；Android ARM64配对库，运行可能下载/编译Dart' },
  ilspy: { variable: 'ANDROID_RESERVE_ILSPY', command: 'ilspycmd', probe: ['--version'], outputKind: 'managed-il-decompilation', description: '已提取托管PE程序集；不自动解析MAUI assembly store或NativeAOT' },
  godot: { variable: 'ANDROID_RESERVE_GDRE', command: 'gdre_tools', probe: ['--headless', '--gdre-version'], outputKind: 'godot-resource-script-recovery', description: 'GDRETools恢复；版本/加密/自定义字节码由引擎检查' },
  il2cpp: { variable: 'ANDROID_RESERVE_IL2CPP_DUMPER', probe: ['--help'], outputKind: 'il2cpp-metadata-declarations', description: 'IL2CPP binary+metadata；DummyDll主要是声明，不等于方法体恢复' },
  ark: { variable: 'ANDROID_RESERVE_ARK_DISASM', command: 'ark_disasm', probe: ['--version'], outputKind: 'ark-bytecode-assembly', description: '目标SDK匹配的ABC反汇编器；不是ArkTS源码恢复' },
};

async function selected(name) {
  const definition = DEFINITIONS[name];
  if (!definition) throw new Error('未实现此引擎适配');
  const configured = process.env[definition.variable];
  if (configured && !path.isAbsolute(configured)) throw new Error(`${definition.variable}必须为绝对路径`);
  const base = path.join(os.homedir(), '.local/share/android-reserve-mcp/engines');
  const managed = { hermes: path.join(base, 'hermes-env/bin/hbc-disassembler'), flutter: path.join(base, 'blutter/blutter.py'), ilspy: path.join(base, 'ilspy-tools/ilspycmd'), godot: path.join(base, 'gdre-2.7.4/Godot RE Tools.app/Contents/MacOS/Godot RE Tools') }[name];
  const executable = configured || (definition.command ? await locate(definition.command) : null) || (managed && await fs.stat(managed).catch(() => null) ? managed : null);
  const exists = executable ? await fs.stat(executable).then(s => s.isFile()).catch(() => false) : false;
  return { name, ...definition, executable, configured: !!configured, exists, readiness: exists ? 'configured-not-sample-validated' : 'unavailable' };
}

export async function engineCatalog() {
  return { engines: await Promise.all(Object.keys(DEFINITIONS).map(selected)), notImplemented: ['lynx-codec', 'nativescript-snapshot', 'maui-assembly-store', 'unity-assets', 'unreal-assets'], note: '有固定参数适配器不等于已安装或验证目标；不自动安装引擎' };
}

async function identity(file, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    if (signal?.aborted) throw new Error('任务已取消');
    hash.update(chunk);
  }
  return { path: file, sha256: hash.digest('hex'), bytes: (await fs.stat(file)).size };
}

async function invocation(engine) {
  if (!engine.exists) throw new Error(`缺少${engine.name}，设置${engine.variable}为引擎绝对路径；见docs/ENGINES.md`);
  const env = { ...process.env }, base = path.join(os.homedir(), '.local/share/android-reserve-mcp/engines');
  if (engine.name === 'ilspy') {
    const managed = path.join(base, 'dotnet10');
    const runtime = env.ANDROID_RESERVE_DOTNET_ROOT || (engine.executable === path.join(base, 'ilspy-tools/ilspycmd') ? managed : null);
    if (runtime && !path.isAbsolute(runtime)) throw new Error('ANDROID_RESERVE_DOTNET_ROOT必须为绝对路径');
    // long: 私有apphost必须解析到配套runtime，不能误用用户全局.NET6或改动其他项目的SDK选择。
    if (runtime) { env.DOTNET_ROOT = runtime; env.DOTNET_ROOT_ARM64 = runtime; env.DOTNET_CLI_HOME = path.join(base, 'dotnet-state/cli-home'); }
    env.DOTNET_CLI_TELEMETRY_OPTOUT = '1'; env.DOTNET_NOLOGO = 'true';
  }
  if (engine.name === 'flutter') {
    const python = process.env.ANDROID_RESERVE_ENGINE_PYTHON;
    if (python && !path.isAbsolute(python)) throw new Error('ANDROID_RESERVE_ENGINE_PYTHON必须为绝对路径');
    const managedPython = path.join(base, 'blutter-env/bin/python');
    const interpreter = python || (engine.executable === path.join(base, 'blutter/blutter.py') && await fs.stat(managedPython).catch(() => null) ? managedPython : await tool('python3'));
    if (process.platform === 'darwin' && engine.executable === path.join(base, 'blutter/blutter.py')) {
      const brew = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
      const paths = ['icu4c@79', 'icu4c@78', 'icu4c'].map(name => path.join(brew, 'opt', name, 'lib/pkgconfig'));
      env.PKG_CONFIG_PATH = [env.PKG_CONFIG_PATH, ...paths, path.join(brew, 'lib/pkgconfig')].filter(Boolean).join(path.delimiter);
      env.CC ||= '/usr/bin/clang'; env.CXX ||= '/usr/bin/clang++';
      const buildBin = path.join(base, 'build-tools/bin');
      if (await fs.stat(path.join(buildBin, 'ninja')).catch(() => null)) env.PATH = buildBin + path.delimiter + env.PATH;
    }
    env.CMAKE_BUILD_PARALLEL_LEVEL ||= '4';
    return { command: interpreter, prefix: [engine.executable], env };
  }
  if (engine.name === 'il2cpp' && engine.executable.endsWith('.dll')) return { command: await tool('dotnet'), prefix: [engine.executable], env };
  await fs.access(engine.executable, fs.constants.X_OK);
  return { command: engine.executable, prefix: [], env };
}

async function header(file) {
  const handle = await fs.open(file, 'r');
  try { const buffer = Buffer.alloc(65536); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); return buffer.subarray(0, bytesRead); }
  finally { await handle.close(); }
}

async function outputFiles(base) {
  const files = []; let partial = false;
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (files.length >= 4000) { partial = true; return; }
      if (entry.isSymbolicLink()) throw new Error('引擎输出包含符号链接，不作为可读产物接受');
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files.push({ path: path.relative(base, file), bytes: (await fs.stat(file)).size });
    }
  }
  await walk(base); return { files, partial };
}

export async function framework(context, args) {
  if (args.action === 'engines') return engineCatalog();
  const engine = await selected(args.engine);
  const exec = await invocation(engine);
  if (args.action === 'probe') return context.jobs.start(`探测${args.engine}`, async signal => {
    const result = await run(exec.command, [...exec.prefix, ...engine.probe], { signal, env: exec.env, timeoutMs: 20000, maxBytes: 64000 });
    // long: ark_disasm当前--version打印后退出1，仅该探测且正文含版本标识时接受；分析仍必须退出0。
    const versionText = result.stdout + result.stderr;
    const knownVersionExit = !result.timedOut && !result.canceled && result.code === 1 && ((engine.name === 'ark' && /(?:ark|file\s*format).*version/i.test(versionText)) || (engine.name === 'godot' && /Godot RE Tools v\d+\.\d+\.\d+/.test(versionText)));
    if (!knownVersionExit) checked(result, '引擎探测');
    return { engine, identity: await identity(engine.executable, signal), process: result, validation: '只验证启动/帮助/版本，不代表样本分析通过' };
  });
  if (!args.path) throw new Error('analyze要求path');
  const isDirectory = args.engine === 'flutter';
  const input = await context.paths.input(args.path, { directory: isDirectory });
  const metadata = args.metadataPath ? await context.paths.input(args.metadataPath) : null;
  return context.jobs.start(`${args.engine}分析`, async (signal, dir) => {
    const out = path.join(dir, 'output'); await fs.mkdir(out);
    let parameters, inputIdentity;
    if (args.engine === 'flutter') {
      if (!args.allowEngineBuild) throw new Error('Blutter分析可能联网下载/编译Dart，需显式allowEngineBuild=true；引擎目录应独立可写');
      const libraries = [];
      for (const name of ['libapp.so', 'libflutter.so']) {
        const file = await context.paths.input(path.join(input, name)), bytes = await header(file);
        if (bytes.length < 20 || !bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 183) throw new Error('Flutter输入目录需ARM64小端libapp.so和libflutter.so；调用方负责提供同构建配对库');
        libraries.push(await identity(file, signal));
      }
      // long: 目录名无法标识实际二进制；两份输入各自留哈希，便于回查混用库或后续替换。
      inputIdentity = { path: input, libraries, pairing: 'caller-supplied-not-independently-verified' };
      parameters = [input, out];
    } else if (args.engine === 'hermes') {
      const bytes = await header(input);
      if (bytes.length < 12 || bytes.readBigUInt64LE(0) !== 0x1f1903c103bc1fc6n) throw new Error('不是普通Hermes HBC，delta或JS文本须另行分析');
      const version = bytes.readUInt32LE(8);
      if (version < 72 || version > 96) throw new Error(`HBC ${version}超出当前已声明适配范围72–96；不强制套用未知opcode`);
      parameters = [input, path.join(out, 'disassembly.hasm')];
    } else if (args.engine === 'ilspy') {
      const bytes = await header(input), pe = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
      const opt = pe + 24, directory = opt >= 24 && opt + 2 < bytes.length && bytes.readUInt16LE(opt) === 0x20b ? 112 : 96;
      if (bytes.subarray(0, 2).toString() !== 'MZ' || pe < 0 || opt + directory + 120 > bytes.length || bytes.subarray(pe, pe + 4).toString() !== 'PE\0\0' || bytes.readUInt32LE(opt + directory + 112) === 0) throw new Error('输入不是具有CLI目录的托管PE；MAUI store需先提取，NativeAOT不能按IL恢复');
      parameters = ['--disable-updatecheck', '-p', '-o', out, input];
    } else if (args.engine === 'godot') parameters = ['--headless', '--recover=' + input, '--output=' + out];
    else if (args.engine === 'il2cpp') {
      if (!metadata) throw new Error('IL2CPP要求metadataPath');
      const bytes = await header(metadata);
      if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfab11baf) throw new Error('metadata magic无效；不自动绕过加密');
      const config = JSON.parse(await fs.readFile(path.join(path.dirname(engine.executable), 'config.json'), 'utf8'));
      if (config.RequireAnyKey !== false) throw new Error('Il2CppDumper配置RequireAnyKey必须显式为false，不修改现有引擎配置');
      parameters = [input, metadata, out];
    } else if (args.engine === 'ark') {
      const bytes = await header(input);
      if (bytes.subarray(0, 5).toString() !== 'PANDA') throw new Error('输入不是可识别的Panda/ABC文件');
      parameters = [input, path.join(out, 'disassembly.pa')];
    }
    const result = await run(exec.command, [...exec.prefix, ...parameters], { signal, env: exec.env, timeoutMs: args.engine === 'flutter' ? 600000 : 300000, maxBytes: 1024 * 1024 });
    await fs.writeFile(path.join(dir, 'engine.log'), result.stdout + '\n' + result.stderr);
    checked(result, args.engine + '分析');
    const produced = await outputFiles(out);
    if (!produced.files.some(f => f.bytes > 0 && !f.path.endsWith('.log'))) throw new Error('引擎未产出非空分析文件，不能仅凭退出码判成功');
    const nonempty = predicate => produced.files.some(f => f.bytes > 0 && predicate(f.path));
    // long: 诊断文件或项目配置并不证明反编译完成；按引擎要求实际代码/汇编/资源产物。
    if (args.engine === 'flutter' && (!nonempty(p => p === 'objs.txt') || !nonempty(p => p === 'pp.txt') || !nonempty(p => p.startsWith('asm' + path.sep)))) throw new Error('Blutter缺少非空对象池或汇编产物');
    if (args.engine === 'ilspy' && (!nonempty(p => p.endsWith('.cs')) || !nonempty(p => p.endsWith('.csproj')))) throw new Error('ILSpy未产生非空C#源码和项目文件');
    if (args.engine === 'hermes' && !nonempty(p => p === 'disassembly.hasm')) throw new Error('Hermes未产生非空反汇编');
    if (args.engine === 'ark' && !nonempty(p => p === 'disassembly.pa')) throw new Error('Ark未产生非空反汇编');
    if (args.engine === 'godot') {
      const project = nonempty(p => p === 'project.godot') ? (await header(path.join(out, 'project.godot'))).toString() : '';
      if (!/^config_version\s*=\s*\d+/m.test(project) || !nonempty(p => p !== 'project.godot' && !/\.(?:log|json|md|txt|import|remap)$/i.test(p))) throw new Error('GDRE缺少有效project.godot或实际恢复的脚本/资源');
    }
    if (args.engine === 'il2cpp' && !produced.files.some(f => f.path === 'dump.cs' || f.path.startsWith('DummyDll' + path.sep))) throw new Error('未产生IL2CPP类型声明；查看engine.log是否进入手动模式或抛错');
    return { engine: args.engine, outputKind: engine.outputKind, engineIdentity: await identity(engine.executable, signal), input: inputIdentity || await identity(input, signal), metadata: metadata ? await identity(metadata, signal) : null, output: 'output', ...produced, process: { code: result.code, truncated: result.truncated }, limitation: engine.description };
  });
}
