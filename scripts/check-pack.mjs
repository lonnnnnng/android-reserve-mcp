// long: npm files目录规则可能绕过根.gitignore；发布清单必须单独验收，防止Python缓存或私有产物混入。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { TextDecoder } from 'node:util';
import { run, checked, tool } from '../src/core/process.js';
import { VERSION } from '../src/version.js';

const response=checked(await run(await tool('npm'),['pack','--dry-run','--ignore-scripts','--json'],{timeoutMs:60000}),'npm发布清单检查');
assert.equal(response.truncated,false);
const [pack]=JSON.parse(response.stdout),names=new Set(pack.files.map(f=>f.path));
assert.equal(pack.name,'android-reserve-mcp');assert.equal(pack.version,VERSION);
for(const required of ['src/cli.js','src/server.js','src/core/evidence.js','src/core/webview.js','helpers/MetadataInspect.java','helpers/flutter-channels.py','helpers/package-set.py','helpers/assembly-store.py','helpers/java-loaders.js','helpers/artifact.py','docs/ADVANCED-ANALYSIS.md'])assert.ok(names.has(required),'缺少运行/说明文件：'+required);
for(const name of names){
  assert.ok(!path.isAbsolute(name)&&!name.split('/').includes('..'),'发布路径越界：'+name);
  assert.ok(!name.split('/').some(p=>['output','workspace','backups','node_modules','__pycache__'].includes(p)),'发布包包含私有/缓存目录：'+name);
  assert.ok(/\.(?:md|js|mjs|py|java|json|dart|cs)$/.test(name)||name==='LICENSE','发布包包含非源码文件：'+name);
  assert.ok(!(await fs.lstat(name)).isSymbolicLink(),'发布包不能依赖宿主链接：'+name);
  const source=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(name));
  assert.ok(!/\/Users\/long|sk-[A-Za-z0-9_-]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source),'发布包包含私有路径或密钥候选：'+name);
}
console.log(`发布清单通过：${pack.version}，${names.size}个源码/文档文件，无缓存/引擎/样本/签名材料`);
