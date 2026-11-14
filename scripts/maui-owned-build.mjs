// long: 样本构建与分析目录分离，防止SDK默认Compile把反编译输出再次编入样本。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { run, checked, tool } from '../src/core/process.js';

const target = path.resolve(process.argv[2] || 'output/maui-owned-' + Date.now());
if (await fs.stat(target).catch(() => null)) throw new Error('样本目录已存在，保留现场：' + target);
const base = path.join(os.homedir(), '.local/share/android-reserve-mcp/engines');
const sdk = process.env.ANDROID_RESERVE_DOTNET_ROOT || path.join(base, 'dotnet10');
const env = { ...process.env, DOTNET_ROOT: sdk, DOTNET_ROOT_ARM64: sdk, DOTNET_CLI_HOME: path.join(base, 'dotnet-state/cli-home'), NUGET_PACKAGES: path.join(base, 'dotnet-state/packages'), DOTNET_NOLOGO: 'true', DOTNET_CLI_TELEMETRY_OPTOUT: '1' };
const dotnet = path.join(sdk, 'dotnet');
await fs.mkdir(path.dirname(target), { recursive: true });
checked(await run(dotnet, ['new', 'maui', '-n', 'ReserveMaui', '-o', target, '--no-restore'], { env, timeoutMs: 60000 }), '创建自有MAUI样本');
const project = path.join(target, 'ReserveMaui.csproj');
let xml = (await fs.readFile(project, 'utf8')).replaceAll('\u005c', '/');
xml = xml.replace(/<TargetFrameworks>[^<]+<\/TargetFrameworks>/, '<TargetFrameworks>net10.0-android</TargetFrameworks>');
xml = xml.replace('</Project>', '<PropertyGroup><EnableDefaultXamlItems>false</EnableDefaultXamlItems><EnableDefaultEmbeddedResourceItems>false</EnableDefaultEmbeddedResourceItems></PropertyGroup><ItemGroup><MauiXaml Remove="**/*.xaml"/><Compile Remove="MainPage.xaml.cs;AppShell.xaml.cs"/></ItemGroup></Project>');
await fs.writeFile(project, xml);
await fs.copyFile(fileURLToPath(new URL('../examples/fixtures/maui-app.cs', import.meta.url)), path.join(target, 'App.xaml.cs'));
const manifest = path.join(target, 'Platforms/Android/AndroidManifest.xml');
await fs.writeFile(manifest, (await fs.readFile(manifest, 'utf8')).replace(/android:(?:roundIcon|icon)="[^"]*"/g, ''));
const java = process.env.JAVA_HOME || checked(await run('/usr/libexec/java_home', ['-v', '21']), 'JDK21').stdout.trim();
const android = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const result = await run(dotnet, ['build', project, '-f', 'net10.0-android', '-c', 'Release', '-p:TargetFrameworks=net10.0-android', '-p:RuntimeIdentifier=android-arm64', '-p:AndroidSdkDirectory=' + android, '-p:JavaSdkDirectory=' + java, '-p:AndroidPackageFormats=apk', '-p:AndroidEnableMarshalMethods=false'], { env, timeoutMs: 300000, maxBytes: 2 * 1024 * 1024 });
await fs.writeFile(path.join(target, 'build.log'), result.stdout + result.stderr); checked(result, '构建自有MAUI Android APK');
console.log(JSON.stringify({ target, apk: path.join(target, 'bin/Release/net10.0-android/android-arm64/com.companyname.reservemaui-Signed.apk'), limitation: '仅构建；仍需MCP静态smoke和显式设备运行验收' }));
