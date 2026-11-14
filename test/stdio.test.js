import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { run, checked, tool } from '../src/core/process.js';
import { VERSION } from '../src/version.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('真实 stdio 握手、分组工具、APK/Manifest任务、分页及错误协议', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'android-reserve-stdio-'));
  const xml = path.join(root, 'AndroidManifest.xml');
  await fs.writeFile(xml, '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="demo.fixture"><uses-sdk android:targetSdkVersion="28"/><uses-permission android:name="android.permission.INTERNET"/><application><activity android:name=".Main"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>');
  const apk = path.join(root, 'fixture.apk');
  checked(await run(await tool('python3'), ['-c', 'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.write(sys.argv[2],"AndroidManifest.xml")\n z.writestr("classes.dex",b"dex\\n035\\0fixture")\n z.writestr("lib/arm64-v8a/libfixture.so",b"fixture")', apk, xml]), '生成自有 ZIP 样本');
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, '--allowedRoots', root, '--workspace', path.join(root, 'work'), '--no-rea'], stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'android-reserve-test', version: '1.0' });
  try {
    await client.connect(transport);
    const list = await client.listTools(); assert.equal(list.tools.length, 20);
    assert.equal(client.getServerVersion().version, VERSION);
    const fridaSchema = list.tools.find(t => t.name === 'frida').inputSchema;
    for (const action of ['java-methods', 'java-loaders', 'trace-java', 'trace-jni', 'unload']) assert.ok(fridaSchema.properties.action.enum.includes(action));
    assert.ok(fridaSchema.properties.loaderSelector);
    for (const name of ['packages','managed','evidence','webview']) assert.ok(list.tools.some(t=>t.name===name));
    assert.ok(list.tools.find(t=>t.name==='dex').inputSchema.properties.action.enum.includes('kotlin'));
    assert.ok(fridaSchema.properties.rva && fridaSchema.properties.maxMethods);
    assert.ok(list.tools.some(t => t.name === 'artifact') && list.tools.some(t => t.name === 'script'));
    assert.ok(!list.tools.some(t => t.name.includes('browser') || t.name.includes('execute_shell')));
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      return { ...JSON.parse(result.content[0].text), isError: result.isError };
    };
    const doctor = await call('doctor', {}); assert.equal(doctor.rea.started, false);
    assert.equal(doctor.analysisDependencies.bundletool.validation,'path-only');assert.equal(doctor.analysisDependencies.kotlin.length,2);
    const wait = async id => {
      for (let i = 0; i < 100; i++) {
        const job = await call('jobs', { action: 'status', jobId: id });
        if (!['running', 'queued'].includes(job.state)) return job;
        await new Promise(r => setTimeout(r, 30));
      }
      throw new Error('任务超时');
    };
    const inspect = await call('apk', { action: 'inspect', path: apk });
    assert.equal((await wait(inspect.id)).state, 'succeeded');
    const read = await call('artifacts', { action: 'read', jobId: inspect.id, path: 'result.json', limit: 4000 });
    assert.equal(JSON.parse(read.text).abis[0], 'arm64-v8a');
    const manifest = await call('apk', { action: 'manifest', path: xml });
    assert.equal((await wait(manifest.id)).state, 'succeeded');
    const parsed = JSON.parse((await call('artifacts', { action: 'read', jobId: manifest.id, path: 'result.json' })).text);
    assert.equal(parsed.components[0].declared_exported, null);
    const page = await call('artifacts', { action: 'read', jobId: inspect.id, path: 'result.json', limit: 10 });
    assert.equal(page.bytes, 10); assert.equal(page.nextOffset, 10);
    const outside = await call('apk', { action: 'inspect', path: '/etc/hosts' }); assert.equal(outside.isError, true);
    const escaped = await call('artifacts', { action: 'read', jobId: inspect.id, path: '/etc/hosts' }); assert.equal(escaped.isError, true);
    const unavailable = await call('dex', { action: 'classes', path: apk });
    assert.equal((await wait(unavailable.id)).state, 'failed');
    assert.equal((await call('doctor', {})).rea.started, false);
  } finally { await client.close(); }
});
