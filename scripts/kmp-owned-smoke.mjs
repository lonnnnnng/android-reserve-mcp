// long: 该样本故意把commonMain、Android target和Native framework分开，验证共享代码身份不能由单一APK推断。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { run, checked } from '../src/core/process.js';

const target = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'android-reserve-kmp-owned-' + Date.now()));
if (await fs.stat(target).catch(() => null)) throw new Error('KMP样本目录已存在，保留现场：' + target);
await fs.mkdir(path.join(target, 'shared/src/commonMain/kotlin/owned/kmp'), { recursive: true });
await fs.mkdir(path.join(target, 'shared/src/androidMain/kotlin/owned/kmp'), { recursive: true });
await fs.mkdir(path.join(target, 'shared/src/iosMain/kotlin/owned/kmp'), { recursive: true });
await fs.mkdir(path.join(target, 'app/src/main/java/owned/kmp/app'), { recursive: true });
await fs.writeFile(path.join(target, 'settings.gradle.kts'), `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name = "OwnedKmp"\ninclude(":shared", ":app")\n`);
await fs.writeFile(path.join(target, 'build.gradle.kts'), `plugins { id("org.jetbrains.kotlin.multiplatform") version "2.3.20" apply false; id("org.jetbrains.kotlin.android") version "2.3.20" apply false; id("com.android.library") version "8.13.1" apply false; id("com.android.application") version "8.13.1" apply false }\n`);
await fs.writeFile(path.join(target, 'gradle.properties'), 'org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\n');
await fs.writeFile(path.join(target, 'shared/build.gradle.kts'), `plugins { id("org.jetbrains.kotlin.multiplatform"); id("com.android.library"); id("maven-publish") }\nkotlin {\n  androidTarget()\n  iosArm64() { binaries.framework { baseName = "OwnedKmpShared"; isStatic = true } }\n  iosSimulatorArm64() { binaries.framework { baseName = "OwnedKmpShared"; isStatic = true } }\n  sourceSets {\n    commonMain.dependencies { }\n  }\n}\npublishing { repositories { maven { name = "fixtureRepository"; url = uri("$buildDir/fixture-repository") } } }\nandroid { namespace = "owned.kmp.shared"; compileSdk = 36; defaultConfig { minSdk = 24 } }\n`);
await fs.writeFile(path.join(target, 'shared/src/commonMain/kotlin/owned/kmp/SharedApi.kt'), `package owned.kmp\n\nexpect object PlatformName { val value: String }\n\n// long: 共享函数只依赖commonMain输入，返回值用于校验Android/iOS target都来自同一源码契约。\nfun sharedNormalize(value: String): String = "KMP_SHARED:" + value.trim().uppercase() + ":" + PlatformName.value\n`);
await fs.writeFile(path.join(target, 'shared/src/androidMain/kotlin/owned/kmp/PlatformName.android.kt'), 'package owned.kmp\nactual object PlatformName { actual val value: String = "ANDROID" }\n');
await fs.writeFile(path.join(target, 'shared/src/iosMain/kotlin/owned/kmp/PlatformName.ios.kt'), 'package owned.kmp\nactual object PlatformName { actual val value: String = "IOS" }\n');
await fs.writeFile(path.join(target, 'app/build.gradle.kts'), `plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }\nandroid { namespace = "owned.kmp.app"; compileSdk = 36\n  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }\n  defaultConfig { applicationId = "owned.kmp.app"; minSdk = 24; targetSdk = 36; versionCode = 1; versionName = "1" }\n}\ndependencies { implementation(project(":shared")) }\nkotlin { jvmToolchain(17) }\n`);
await fs.writeFile(path.join(target, 'app/src/main/AndroidManifest.xml'), `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:theme="@android:style/Theme.Material.Light.NoActionBar" android:label="Owned KMP"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`);
await fs.writeFile(path.join(target, 'app/src/main/java/owned/kmp/app/MainActivity.kt'), `package owned.kmp.app\n\nimport android.app.Activity\nimport android.os.Bundle\nimport android.widget.TextView\nimport owned.kmp.sharedNormalize\n\nclass MainActivity : Activity() {\n  override fun onCreate(state: Bundle?) {\n    super.onCreate(state)\n    val value = sharedNormalize(" value ")\n    android.util.Log.i("KmpOwned", "KMP_SHARED_MARKER=$value")\n    setContentView(TextView(this).apply { text = value })\n  }\n}\n`);
async function resolveGradle() {
  if (process.env.KMP_GRADLE) return process.env.KMP_GRADLE;
  // long: AGP 8.13.1依赖Gradle 9.5.x；优先使用本机已缓存的兼容发行版，避免系统Gradle升级后fixture误报失败。
  const cache = path.join(os.homedir(), '.gradle/wrapper/dists');
  for (const distribution of ['gradle-9.5.1-bin', 'gradle-9.5.0-bin', 'gradle-9.4.1-bin']) {
    const root = path.join(cache, distribution);
    for (const hash of await fs.readdir(root).catch(() => [])) {
      const candidate = path.join(root, hash, distribution.replace(/-bin$/, ''), 'bin/gradle');
      if (await fs.access(candidate, fs.constants.X_OK).then(() => true).catch(() => false)) return candidate;
    }
  }
  return 'gradle';
}
const gradle = await resolveGradle();
const tasks = [':shared:compileCommonMainKotlinMetadata', ':shared:compileDebugKotlinAndroid', ':app:assembleDebug'];
const result = await run(gradle, ['-p', target, '--no-daemon', ...tasks], { timeoutMs: 300000, maxBytes: 2 * 1024 * 1024 });
await fs.writeFile(path.join(target, 'build.log'), result.stdout + result.stderr); checked(result, 'KMP commonMain/Android构建');
const native = await run(gradle, ['-p', target, '--no-daemon', ':shared:linkDebugFrameworkIosSimulatorArm64'], { timeoutMs: 300000, maxBytes: 2 * 1024 * 1024 });
await fs.writeFile(path.join(target, 'native-build.log'), native.stdout + native.stderr);
const nativePassed = native.code === 0 && !native.timedOut && !native.canceled;
const publication = await run(gradle, ['-p', target, '--no-daemon', ':shared:publishAllPublicationsToFixtureRepositoryRepository'], { timeoutMs: 300000, maxBytes: 2 * 1024 * 1024 });
await fs.writeFile(path.join(target, 'publication-build.log'), publication.stdout + publication.stderr);
const publicationPassed = publication.code === 0 && !publication.timedOut && !publication.canceled;
const publicationFiles = [];
if (publicationPassed) {
  const repository = path.join(target, 'shared/build/fixture-repository');
  async function collect(dir, relative = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const current = path.join(dir, entry.name), rel = path.join(relative, entry.name);
      if (entry.isDirectory()) await collect(current, rel);
      else if (/\.(klib|jar|pom|module|aar)$/.test(entry.name)) publicationFiles.push({ path: rel, bytes: (await fs.stat(current)).size });
    }
  }
  await collect(repository);
}
const apk = path.join(target, 'app/build/outputs/apk/debug/app-debug.apk');
const appBuildPassed = await fs.access(apk).then(() => true).catch(() => false);
const evidence = { schema: 2, target, gradle: path.basename(gradle), source: { commonMain: 'shared/src/commonMain/kotlin/owned/kmp/SharedApi.kt', androidMain: 'shared/src/androidMain/kotlin/owned/kmp/PlatformName.android.kt', iosMain: 'shared/src/iosMain/kotlin/owned/kmp/PlatformName.ios.kt', businessApp: 'app/src/main/java/owned/kmp/app/MainActivity.kt' }, builds: { commonMainMetadata: 'passed', androidTarget: 'passed', businessApp: appBuildPassed ? 'passed' : 'blocked', businessApk: appBuildPassed ? apk : null, iosSimulatorFramework: nativePassed ? 'passed' : 'blocked', iosExitCode: native.code, iosDiagnostic: nativePassed ? null : (native.stderr || native.stdout).slice(-2000) }, publication: { status: publicationPassed ? 'passed' : 'blocked', repository: 'shared/build/fixture-repository', files: publicationFiles, diagnostic: publicationPassed ? null : (publication.stderr || publication.stdout).slice(-2000) }, contract: { sharedFunction: 'sharedNormalize(String)', androidExpected: 'KMP_SHARED:VALUE:ANDROID', iosExpected: 'KMP_SHARED:VALUE:IOS', businessAppMarker: 'KMP_SHARED_MARKER=KMP_SHARED:VALUE:ANDROID' }, limitation: '自有KMP业务App fixture；验证Android APK调用shared commonMain函数，不代表任意KMP publication、klib版本或业务App恢复能力' };
await fs.writeFile(path.join(target, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
