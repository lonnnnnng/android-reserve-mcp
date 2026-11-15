import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { run, tool, checked } from './process.js';

const collector = fileURLToPath(new URL('../../helpers/package-set.py', import.meta.url));
const manifestHelper = fileURLToPath(new URL('../../helpers/static.py', import.meta.url));

export function parseSignerCertificates(output) {
  const certificates = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    // long: build-tools新旧版本分别输出“Signer #N ...”和“V3.0 Signer: ...”，两者都表示同一签名摘要。
    if (!/(?:Signer #\d+\s+certificate|V\d+(?:\.\d+)? Signer:\s+certificate)/.test(line)) continue;
    const match = line.match(/certificate SHA-256 digest:\s*([a-fA-F0-9]{64})\s*$/);
    if (match) certificates.push(match[1].toLowerCase());
  }
  return [...new Set(certificates)];
}

async function bundletool(signal, args) {
  const jar = process.env.ANDROID_RESERVE_BUNDLETOOL || path.join(os.homedir(), '.local/share/android-reserve-mcp/engines/bundletool-all-1.18.3.jar');
  if (!path.isAbsolute(jar)) throw new Error('ANDROID_RESERVE_BUNDLETOOL必须为绝对路径');
  const bytes = await fs.readFile(jar).catch(() => { throw new Error('缺少bundletool-all-1.18.3.jar'); });
  if (!process.env.ANDROID_RESERVE_BUNDLETOOL && createHash('sha256').update(bytes).digest('hex') !== 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29') throw new Error('默认bundletool SHA256不匹配');
  return checked(await run(await tool('java'), ['-Xmx1024m','-XX:ActiveProcessorCount=2','-jar',jar,...args], { signal, timeoutMs: 180000, maxBytes: 2*1024*1024 }), 'bundletool');
}

async function aabManifests(input, dir, signal) {
  const list = checked(await run(await tool('python3'), ['-c', 'import zipfile,json,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n n=z.namelist()\n if len(n)>12000:raise ValueError("AAB目录超预算")\n print(json.dumps([p.split("/")[0] for p in n if p.count("/")==2 and p.endswith("/manifest/AndroidManifest.xml")]))',input], { signal }), 'AAB模块目录');
  const modules = JSON.parse(list.stdout);
  if (!modules.length || modules.length > 64 || modules.some(m => !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(m)) || new Set(modules).size !== modules.length) throw new Error('AAB模块无效、重复或超过64项');
  const manifests = [];
  for (let i=0;i<modules.length;i++) {
    const dumped = await bundletool(signal,['dump','manifest','--bundle='+input,'--module='+modules[i]]);
    if (dumped.truncated) throw new Error('AAB Manifest超过预算');
    const file=path.join(dir,`aab-manifest-${i}.xml`); await fs.writeFile(file,dumped.stdout);
    const parsed=JSON.parse(checked(await run(await tool('python3'),[manifestHelper,'manifest',file],{signal}),'解析AAB Manifest').stdout);
    manifests.push({module:modules[i],artifact:path.basename(file),manifest:parsed});
  }
  return { manifests, authorSignature:'not-verified', limitation:'原AAB的只读模块Manifest；不是已签名APK安装集合' };
}

export function validatePackageSet(records) {
  const errors = [], warnings = [], splits = new Map();
  const first = records[0];
  let baseCount = 0;
  const versions = new Map();
  for (const record of records) {
    const m = record.manifest || {};
    if (!m.package) errors.push(`${record.source}: 缺少包名或Manifest无法读取`);
    if (m.package !== first?.manifest?.package) errors.push(`${record.source}: 包名不一致`);
    let version;
    try {
      const low = BigInt(m.version_code ?? ''), high = BigInt(m.version_code_major || '0');
      if (m.version_code == null || low < 0n || high < 0n || low > 0xffffffffn || high > 0xffffffffn) throw new Error();
      version = ((high << 32n) | low).toString(); versions.set(record.source, version);
    } catch { errors.push(`${record.source}: versionCode/major无效`); }
    if (!record.signature?.verified || !record.signature.certificates?.length) errors.push(`${record.source}: 签名未验证`);
    const key = m.split || '';
    if (!key) baseCount++;
    if (splits.has(key)) errors.push(`${record.source}: 重复split ${key || '<base>'}`);
    splits.set(key, record);
    if (m.truncated) errors.push(`${record.source}: Manifest摘要被截断`);
    if (m.split_required) warnings.push(`${record.source}: 声明需要分包，设备配置完整性仍需单独验证`);
  }
  if (baseCount !== 1) errors.push(`必须恰有一个base，当前${baseCount}`);
  if (new Set(versions.values()).size > 1) errors.push('longVersionCode不一致');
  if (new Set(records.map(r => JSON.stringify([...(r.signature?.certificates || [])].sort()))).size > 1) errors.push('签名证书集合不一致');
  const graph = new Map();
  for (const [name, record] of splits) {
    const m = record.manifest || {}, deps = [...(m.uses_splits || [])];
    if (m.config_for_split) {
      deps.push(m.config_for_split);
      if (!splits.get(m.config_for_split)?.manifest?.is_feature_split) errors.push(`${name}: configForSplit未指向所选feature`);
    }
    for (const dep of deps) if (!dep || !splits.has(dep)) errors.push(`${name}: 缺少依赖${dep}`);
    graph.set(name, deps);
  }
  const visiting = new Set(), done = new Set();
  function visit(name) {
    if (visiting.has(name)) { errors.push(`split依赖存在环: ${name}`); return; }
    if (done.has(name)) return;
    visiting.add(name); for (const dep of graph.get(name) || []) if (graph.has(dep)) visit(dep);
    visiting.delete(name); done.add(name);
  }
  for (const name of graph.keys()) visit(name);
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings, package: first?.manifest?.package, versions: Object.fromEntries(versions), deviceCompleteness: 'not-evaluated', limitation: '校验所选集合的一致性和显式依赖，不证明所有设备/按需模块均齐全' };
}

export async function inspectSnapshots(args, input, dir, signal) {
  const result = checked(await run(await tool('python3'), [collector, input, path.join(dir, 'inputs'), JSON.stringify(args.members || [])], { signal, timeoutMs: 120000, maxBytes: 512000 }), '收集所选分包');
  const collected = JSON.parse(result.stdout);
  if (result.truncated) throw new Error('分包收集报告超预算');
  if (collected.requiresSelection) return collected;
  const python = await tool('python3'), analyzer = await tool('apkanalyzer'), signer = await tool('apksigner');
  for (let i = 0; i < collected.records.length; i++) {
    const record = collected.records[i];
    try {
      const xml = checked(await run(analyzer, ['manifest', 'print', record.path], { signal, maxBytes: 2 * 1024 * 1024 }), '分包Manifest');
      if (xml.truncated) throw new Error('Manifest超预算');
      const file = path.join(dir, `manifest-${i}.xml`); await fs.writeFile(file, xml.stdout);
      record.manifest = JSON.parse(checked(await run(python, [manifestHelper, 'manifest', file], { signal }), '解析分包Manifest').stdout);
      const verify = await run(signer, ['verify', '--verbose', '--print-certs', record.path], { signal });
      if (verify.canceled || verify.timedOut) checked(verify, '签名验证');
      await fs.writeFile(path.join(dir, `signature-${i}.log`), verify.stdout + verify.stderr);
      record.signature = { verified: verify.code === 0 && !verify.truncated, certificates: parseSignerCertificates(verify.stdout) };
    } catch (error) { if (signal.aborted) throw error; record.error = String(error.message).slice(0, 1000); }
  }
  return { ...collected, validation: validatePackageSet(collected.records) };
}

export async function packages(context, args) {
  const original = await context.paths.input(args.path, { directory: null });
  return context.jobs.start(`分包 ${args.action}`, async (signal, dir) => {
    let input = original; const stat=await fs.stat(original), inputIdentity={path:original,kind:stat.isDirectory()?'directory':'file'},isAab=original.toLowerCase().endsWith('.aab'),isApk=original.toLowerCase().endsWith('.apk');
    if (args.action === 'select' || args.action === 'aab-manifests' || (stat.isFile() && !isApk)) {
      const snapshot=path.join(dir,isAab?'input.aab':'input.apks');
      const prepared=JSON.parse(checked(await run(await tool('python3'),[collector,input,snapshot,'preflight'],{signal,timeoutMs:120000}),'容器前置预算检查').stdout);
      Object.assign(inputIdentity,{sha256:prepared.sha256,bytes:prepared.bytes});
      input=snapshot;
    }
    if (args.action === 'aab-manifests' || (isAab && args.action === 'inspect')) return {...await aabManifests(input,dir,signal),input:inputIdentity};
    if(isAab&&args.action==='decode'){
      const snapshot=input;await bundletool(signal,['validate','--bundle='+snapshot]);
      const manifests=await aabManifests(snapshot,dir,signal);
      const modules=JSON.parse(checked(await run(await tool('python3'),[collector,snapshot,path.join(dir,'modules'),'aab-modules'],{signal,timeoutMs:180000}),'AAB分析派生').stdout);
      const inputs=[];
      for(let i=0;i<modules.length;i++){const file=path.join(dir,`derived-${i}.apk`);checked(await run(await tool('aapt2'),['convert','--output-format','binary','-o',file,modules[i].path],{signal,timeoutMs:90000}),'AAB资源格式转换');inputs.push({...modules[i],path:file,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});}
      const stages=[];
      if(args.engine!=='apktool'){const result=await run(await tool('jadx'),['--no-res','-j','2','-d',path.join(dir,'java'),...inputs.map(x=>x.path)],{signal,timeoutMs:600000});await fs.writeFile(path.join(dir,'jadx.log'),result.stdout+result.stderr);stages.push({engine:'jadx',code:result.code});}
      if(args.engine!=='jadx')for(let i=0;i<inputs.length;i++){const result=await run(await tool('apktool'),['d',inputs[i].path,'-o',path.join(dir,`resources-${i}`)],{signal,timeoutMs:300000});await fs.writeFile(path.join(dir,`apktool-${i}.log`),result.stdout+result.stderr);stages.push({engine:'apktool',module:inputs[i].module,code:result.code});}
      if(!stages.some(s=>s.code===0))throw new Error('AAB所有分析阶段失败，查看日志');
      return {...manifests,derivedInputs:inputs,input:inputIdentity,structure:'bundletool-validated',stages,partial:stages.some(s=>s.code!==0),limitation:'原AAB模块聚合DEX与分模块资源；派生APK无原作者签名，不作为可安装集合'};
    }
    if (args.action === 'select') {
      const spec=await context.paths.input(args.deviceSpecPath), snapshot=path.join(dir,'device-spec.json');
      if ((await fs.stat(spec)).size > 256000) throw new Error('device spec超过256KB');
      await fs.copyFile(spec,snapshot);
      await bundletool(signal,['extract-apks','--apks='+input,'--device-spec='+snapshot,'--output-dir='+path.join(dir,'selected')]);
      const selected=await inspectSnapshots({},path.join(dir,'selected'),dir,signal);
      await fs.writeFile(path.join(dir,'packages.json'),JSON.stringify(selected,null,2));
      return {...selected,input:inputIdentity, selection:'bundletool-explicit-device-spec', report:'packages.json'};
    }
    const report = await inspectSnapshots(args, input, dir, signal);
    if(stat.isFile()&&isApk&&report.records?.length===1)Object.assign(inputIdentity,{sha256:report.records[0].sha256,bytes:report.records[0].bytes});
    report.input=inputIdentity;
    await fs.writeFile(path.join(dir, 'packages.json'), JSON.stringify(report, null, 2));
    if (args.action !== 'decode' || report.requiresSelection) return { ...report, report: 'packages.json' };
    if (!report.validation.valid) { const error = new Error('分包校验未通过，未合并分析；见packages.json'); error.diagnostic = report.validation; throw error; }
    const stages = [], engine = args.engine || 'both';
    if (engine !== 'apktool') {
      const result = await run(await tool('jadx'), ['--no-res', '--show-bad-code', '-j', '2', '-d', path.join(dir, 'java'), ...report.records.map(r => r.path)], { signal, timeoutMs: 600000 });
      await fs.writeFile(path.join(dir, 'jadx.log'), result.stdout + result.stderr); stages.push({ engine: 'jadx', code: result.code, timedOut: result.timedOut });
    }
    if (engine !== 'jadx') for (let i = 0; i < report.records.length; i++) {
      const result = await run(await tool('apktool'), ['d', report.records[i].path, '-o', path.join(dir, `resources-${i}`)], { signal, timeoutMs: 300000 });
      await fs.writeFile(path.join(dir, `apktool-${i}.log`), result.stdout + result.stderr); stages.push({ engine: 'apktool', source: report.records[i].source, code: result.code, timedOut: result.timedOut });
    }
    if (!stages.some(s => s.code === 0)) throw new Error('所有聚合分析阶段失败，请读取日志');
    return { ...report, stages, partial: stages.some(s => s.code !== 0), limitation: 'DEX向JADX提供所选集合；资源按模块独立导出，不覆盖合并同名文件，不证明安装完整性' };
  });
}
