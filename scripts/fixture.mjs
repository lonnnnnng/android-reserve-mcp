// long: 冒烟样本从自有 Java/XML 生成，不下载或分发用户 APK，也不接触任何设备。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { run, checked, tool } from '../src/core/process.js';

export async function fixture(root) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk');
  const platforms = (await fs.readdir(path.join(sdk, 'platforms'))).filter(n => /^android-\d+$/.test(n)).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
  const androidJar = path.join(sdk, 'platforms', platforms[0], 'android.jar');
  await fs.mkdir(path.join(root, 'res/values'), { recursive: true });
  await fs.mkdir(path.join(root, 'classes')); await fs.mkdir(path.join(root, 'dex'));
  await fs.writeFile(path.join(root, 'res/values/strings.xml'), '<resources><string name="app_name">Reserve Fixture</string></resources>');
  await fs.writeFile(path.join(root, 'AndroidManifest.xml'), '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.reserve.fixture" android:versionCode="1" android:versionName="1.0"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="28"/><uses-permission android:name="android.permission.INTERNET"/><application android:label="@string/app_name"/></manifest>');
  await fs.writeFile(path.join(root, 'Greeting.java'), 'package dev.reserve.fixture; public class Greeting { public static native String nativeGreet(String name); public static String greet(String name) { return "hello " + name; } }');
  await fs.writeFile(path.join(root, 'Caller.java'), 'package dev.reserve.fixture; public class Caller { public static String run() { return Greeting.greet("reserve"); } }');
  const exec = async (name, args) => checked(await run(await tool(name), args, { cwd: root, timeoutMs: 90000 }), name);
  await exec('javac', ['--release','8','-d','classes','Greeting.java','Caller.java']);
  await exec('d8', ['--output','dex','classes/dev/reserve/fixture/Greeting.class','classes/dev/reserve/fixture/Caller.class']);
  await exec('aapt2', ['compile','--dir','res','-o','compiled.zip']);
  await exec('aapt2', ['link','-o','fixture.apk','--manifest','AndroidManifest.xml','-I',androidJar,'compiled.zip']);
  await exec('python3', ['-c', 'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"a") as z:z.write(sys.argv[2],"classes.dex")', path.join(root,'fixture.apk'), path.join(root,'dex/classes.dex')]);
  // long: 合法的空节表 ELF 只用于验证架构读取，不把它冒充真实 JNI 动态库。
  await exec('python3', ['-c', 'import struct,sys\nh=bytearray(64);h[:16]=b"\\x7fELF\\x02\\x01\\x01"+bytes(9);struct.pack_into("<HHIQQQIHHHHHH",h,16,3,183,1,0,0,0,0,64,0,0,64,0,0);open(sys.argv[1],"wb").write(h)', path.join(root,'fixture.elf')]);
  return { apk: path.join(root,'fixture.apk'), elf: path.join(root,'fixture.elf') };
}
