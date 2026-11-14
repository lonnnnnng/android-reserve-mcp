// long: 无第三方PackageReference的自有程序集采用离线restore，确认反编译来自IL而非复制源文件。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createContext, framework } from '../src/actions.js';
import { run, checked } from '../src/core/process.js';
import { completeJob } from './smoke-utils.mjs';

const root = path.resolve('output/managed-smoke'); await fs.mkdir(path.join(root, 'source'), { recursive: true });
const base = path.join(os.homedir(), '.local/share/android-reserve-mcp/engines'), sdk = path.join(base, 'dotnet10');
const env = { ...process.env, DOTNET_ROOT: sdk, DOTNET_ROOT_ARM64: sdk, DOTNET_CLI_HOME: path.join(base, 'dotnet-state/cli-home'), NUGET_PACKAGES: path.join(base, 'dotnet-state/packages'), DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false', DOTNET_NOLOGO: 'true' };
await fs.writeFile(path.join(root, 'offline.nuget.config'), '<configuration><packageSources><clear /></packageSources></configuration>');
await fs.writeFile(path.join(root, 'source/ReserveManagedFixture.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
await fs.writeFile(path.join(root, 'source/ReserveManagedFixture.cs'), 'namespace OwnedFixture; public static class ReserveManagedFixture { public const string Marker="RESERVE_MANAGED_V03"; public static int ReserveAdd(int a,int b){return a+b+37;} }');
const project = path.join(root, 'source/ReserveManagedFixture.csproj');
for (const args of [['restore', project, '--configfile', path.join(root, 'offline.nuget.config'), '-p:NuGetAudit=false'], ['build', project, '-c', 'Release', '--no-restore', '-p:UseSharedCompilation=false']]) checked(await run(path.join(sdk, 'dotnet'), args, { env, timeoutMs: 120000 }), '构建自有托管程序集');
const context = await createContext({ allowedRoots: [root], workspace: path.join(root, 'work') }), results = [];
try {
  await completeJob(context, framework(context, { action: 'probe', engine: 'ilspy' }), results);
  const analyzed = await completeJob(context, framework(context, { action: 'analyze', engine: 'ilspy', path: path.join(root, 'source/bin/Release/net10.0/ReserveManagedFixture.dll') }), results);
  const source = analyzed.value.files.find(f => f.path.endsWith('ReserveManagedFixture.cs')); assert.ok(source);
  const code = await fs.readFile(path.join(analyzed.job.dir, 'output', source.path), 'utf8');
  assert.match(code, /RESERVE_MANAGED_V03/); assert.match(code, /ReserveAdd/); assert.match(code, /a\s*\+\s*b\s*\+\s*37/);
  console.log('真实ILSpy类型、方法与返回表达式通过');
} finally { await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ results }, null, 2)); await context.close(); }
