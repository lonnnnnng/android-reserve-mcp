import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, tool, checked } from '../src/core/process.js';
import { createContext, framework } from '../src/actions.js';

test('Flutter只关联有实参入栈与注册对象证据的静态候选；覆盖写入、缺mapping和symlink拒绝', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reserve-channels-'));
  const aot = path.join(root, 'aot'), smali = path.join(root, 'decoded/smali');
  await fs.mkdir(path.join(aot, 'asm'), { recursive: true }); await fs.mkdir(smali, { recursive: true });
  await fs.writeFile(path.join(aot, 'pp.txt'), '[pp+0x10] Obj!MethodChannel@123 : {\n off_8: "owned.channel",\n}\n');
  const asm = '// r30 = Instance_MethodChannel\n// [pp+0x10] Obj!MethodChannel@123\n// stp lr, x16, [SP, #8]\n// r16 = "ownedMethod"\n// str x16, [SP]\n// bl #0x100 ; MethodChannel::invokeMethod\n';
  await fs.writeFile(path.join(aot, 'asm/main.dart'), asm);
  const registration = '.class public LOwned;\n.method public setup()V\nnew-instance v0, LChannel;\nconst-string v1, "owned.channel"\ninvoke-direct {v0, v1}, LChannel;-><init>(Ljava/lang/String;)V\nnew-instance v2, LHandler;\ninvoke-direct {v2}, LHandler;-><init>()V\ninvoke-virtual {v0, v2}, LChannel;->b(LHandler;)V\n.end method\n';
  await fs.writeFile(path.join(smali, 'Owned.smali'), registration);
  await fs.writeFile(path.join(smali, 'Handler.smali'), '.class public LHandler;\n.method public call(Ljava/lang/String;)V\nconst-string v0, "ownedMethod"\ninvoke-virtual {p1, v0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z\n.end method\n');
  const mapping = path.join(root, 'mapping.txt'); await fs.writeFile(mapping, 'io.flutter.plugin.common.MethodChannel -> Channel:\n  1:7:void io.flutter.plugin.common.MethodChannel.setMethodCallHandler(Handler):1:1 -> b\n');
  const analyze = async (map = true) => JSON.parse(checked(await run(await tool('python3'), ['helpers/flutter-channels.py', 'analyze', aot, path.dirname(smali), ...(map ? [mapping] : [])]), 'channel夹具').stdout);
  const yes = await analyze(); assert.equal(yes.matches.length, 1); assert.equal(yes.partial, true); assert.match(yes.mapping.association, /unverified/);
  assert.equal((await analyze(false)).matches.length, 0, '缺混淆mapping不能猜setter名');
  await fs.writeFile(path.join(smali, 'Owned.smali'), registration.replace('invoke-virtual {v0, v2}', 'const/4 v0, 0x0\ninvoke-virtual {v0, v2}'));
  assert.equal((await analyze()).matches.length, 0, '接收对象被覆盖不能沿用旧注册');
  await fs.writeFile(path.join(smali, 'Owned.smali'), registration);
  await fs.writeFile(path.join(aot, 'asm/main.dart'), asm.replace('// str x16, [SP]\n', ''));
  assert.equal((await analyze()).matches.length, 0, '仅邻近字符串不能当实参');
  await fs.symlink(path.join(root, 'decoded'), path.join(aot, 'asm/link'));
  const rejected = await run(await tool('python3'), ['helpers/flutter-channels.py', 'analyze', aot, path.dirname(smali), mapping]);
  // long: 目录和文件链接均拒绝，避免引擎产物借链接读取工作区外的内容。
  assert.notEqual(rejected.code, 0); assert.match(rejected.stderr, /符号链接/);
  await fs.symlink(mapping, path.join(aot, 'asm/link.dart'));
  const linked = await run(await tool('python3'), ['helpers/flutter-channels.py', 'analyze', aot, path.dirname(smali), mapping]);
  assert.notEqual(linked.code, 0); assert.match(linked.stderr, /符号链接/);
});

test('Flutter APK配对库不匹配时不启动apktool', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reserve-channel-identity-'));
  const c = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work'), disabled: true });
  try {
    const source = await c.jobs.start('fixture', async (_signal, dir) => { await fs.mkdir(path.join(dir, 'output')); return { engine: 'flutter', input: { libraries: [] } }; });
    const wait = async id => { for (let i = 0; i < 200; i++) { const j = await c.jobs.get(id); if (!['queued', 'running'].includes(j.state)) return j; await new Promise(r => setTimeout(r, 10)); } throw new Error('timeout'); };
    await wait(source.id);
    const apk = path.join(root, 'owned.apk');
    checked(await run(await tool('python3'), ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for n in ("libapp.so","libflutter.so"):z.writestr("lib/arm64-v8a/"+n,b"owned")', apk]), '生成自有ZIP');
    const job = await wait((await framework(c, { action: 'channels', engine: 'flutter', path: apk, analysisJobId: source.id })).id);
    assert.equal(job.state, 'failed'); assert.match(job.error, /配对库不匹配/);
    assert.equal(await fs.stat(path.join(job.dir, 'decoded')).catch(() => null), null);
  } finally { await c.close(); }
});
