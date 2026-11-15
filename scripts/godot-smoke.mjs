// long: PCK只包含编译GDScript及资源，排除原始.gd，确保恢复检查不是把明文脚本拷贝回来。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createContext, framework } from '../src/actions.js';
import { engineCatalog } from '../src/core/engines.js';
import { run, checked } from '../src/core/process.js';
import { completeJob } from './smoke-utils.mjs';

const root = path.resolve('output/godot-smoke'); await fs.mkdir(root, { recursive: true });
const sample = await fs.mkdtemp(path.join(root, 'sample-')), source = path.join(sample, 'source'), packed = path.join(sample, 'packed');
await fs.mkdir(source, { recursive: true }); await fs.mkdir(packed, { recursive: true });
await fs.writeFile(path.join(source, 'main.gd'), 'extends Node\nconst MARKER = "RESERVE_GODOT_V03"\nfunc reserve_add(a: int, b: int) -> int:\n\treturn a + b + 37\n');
await fs.writeFile(path.join(source, 'secondary.gd'), 'extends Node\nconst MARKER = "RESERVE_GODOT_TYPED_V04"\nfunc scale_value(value: float) -> float:\n\treturn value * 1.5\nfunc normalize(value: String) -> String:\n\treturn value.strip_edges().to_upper()\n');
await fs.writeFile(path.join(packed, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Reserve Godot Fixture"\nrun/main_scene="res://main.tscn"\n');
await fs.writeFile(path.join(packed, 'main.tscn'), '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Reserve" type="Node"]\nscript = ExtResource("1")\n');
await fs.writeFile(path.join(packed, 'secondary.tscn'), '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://secondary.gd" id="1"]\n[node name="Typed" type="Node"]\nscript = ExtResource("1")\n');
await fs.writeFile(path.join(packed, 'main.gd.remap'), '[remap]\npath="res://main.gdc"\n');
await fs.writeFile(path.join(packed, 'secondary.gd.remap'), '[remap]\npath="res://secondary.gdc"\n');
const engine = (await engineCatalog()).engines.find(e => e.name === 'godot'); assert.ok(engine.exists);
const compile = checked(await run(engine.executable, ['--headless', '--compile=' + path.join(source, 'main.gd'), '--bytecode=4.3.0', '--output=' + packed], { timeoutMs: 90000 }), '编译自有GDScript');
const compileSecondary = checked(await run(engine.executable, ['--headless', '--compile=' + path.join(source, 'secondary.gd'), '--bytecode=4.3.0', '--output=' + packed], { timeoutMs: 90000 }), '编译第二个GDScript');
await fs.writeFile(path.join(root, 'compile.log'), compile.stdout + compile.stderr + compileSecondary.stdout + compileSecondary.stderr);
for (const bytecode of ['main.gdc', 'secondary.gdc']) {
  const gdc = await fs.readFile(path.join(packed, bytecode)); assert.ok(gdc.length > 16); assert.equal(gdc.subarray(0, 4).toString(), 'GDSC');
}
await assert.rejects(fs.stat(path.join(packed, 'main.gd')));
await assert.rejects(fs.stat(path.join(packed, 'secondary.gd')));
assert.deepEqual((await fs.readdir(packed)).sort(), ['main.gd.remap', 'main.gdc', 'main.tscn', 'project.godot', 'secondary.gd.remap', 'secondary.gdc', 'secondary.tscn']);
const pck = path.join(sample, 'fixture.pck');
checked(await run(engine.executable, ['--headless', '--pck-create=' + packed, '--pck-version=2', '--pck-engine-version=4.3.0', '--output=' + pck], { timeoutMs: 90000 }), '打包自有PCK');
const list = checked(await run(engine.executable, ['--headless', '--list-files=' + pck], { timeoutMs: 30000 }), 'PCK成员清单');
await fs.writeFile(path.join(sample, 'pck-members.txt'), list.stdout + list.stderr);
assert.deepEqual(list.stdout.split(/\r?\n/).filter(line => line.startsWith('res://')).sort(), ['res://main.gd.remap', 'res://main.gdc', 'res://main.tscn', 'res://project.godot', 'res://secondary.gd.remap', 'res://secondary.gdc', 'res://secondary.tscn']);
const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work') }), results = [];
try {
  await completeJob(context, framework(context, { action: 'probe', engine: 'godot' }), results);
  const analyzed = await completeJob(context, framework(context, { action: 'analyze', engine: 'godot', path: pck }), results);
  const scripts = analyzed.value.files.filter(f => f.path === 'main.gd' || f.path.endsWith(path.sep + 'main.gd') || f.path === 'secondary.gd' || f.path.endsWith(path.sep + 'secondary.gd'));
  assert.equal(scripts.length, 2);
  const restored = await Promise.all(scripts.map(async script => ({ name: path.basename(script.path), code: await fs.readFile(path.join(analyzed.job.dir, 'output', script.path), 'utf8') })));
  const main = restored.find(row => row.name === 'main.gd')?.code || '', secondary = restored.find(row => row.name === 'secondary.gd')?.code || '';
  assert.match(main, /RESERVE_GODOT_V03/); assert.match(main, /reserve_add/); assert.match(main, /a\s*\+\s*b\s*\+\s*37/);
  assert.match(secondary, /RESERVE_GODOT_TYPED_V04/); assert.match(secondary, /scale_value/); assert.match(secondary, /normalize/);
  console.log('真实GDRE编译字节码→PCK→脚本恢复通过');
} finally { await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ sample, results }, null, 2)); await context.close(); }
