// long: 使用已验证公开样本的wrapper和版本目录构建独立自有App，保留实际Compose编译器/runtime，不伪造状态类。
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, checked } from '../src/core/process.js';
const [sampleRoot, destination] = process.argv.slice(2);
if (!sampleRoot || !destination) throw new Error('用法: compose-owned-build.mjs JETNEWS_SOURCE NEW_DIRECTORY');
const source = path.resolve(sampleRoot), root = path.resolve(destination);
if (await fs.stat(root).catch(() => null)) throw new Error('保留已有样本目录：' + root);
await fs.mkdir(path.join(root,'app/src/main/java/dev/androidreserve/compose'),{recursive:true});
await fs.mkdir(path.join(root,'gradle/wrapper'),{recursive:true});
for (const file of ['gradlew','gradle/wrapper/gradle-wrapper.jar','gradle/wrapper/gradle-wrapper.properties','gradle/libs.versions.toml']) await fs.copyFile(path.join(source,file),path.join(root,file));
await fs.chmod(path.join(root,'gradlew'),0o755);
await fs.writeFile(path.join(root,'gradle.properties'),'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2048m\n');
await fs.writeFile(path.join(root,'settings.gradle.kts'),'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\nrootProject.name="ReserveCompose"\ninclude(":app")\n');
await fs.writeFile(path.join(root,'build.gradle.kts'),'plugins { alias(libs.plugins.android.application) apply false; alias(libs.plugins.compose) apply false }\n');
await fs.writeFile(path.join(root,'app/build.gradle.kts'),`plugins { alias(libs.plugins.android.application); alias(libs.plugins.compose) }
android { namespace="dev.androidreserve.compose"; compileSdk=libs.versions.compileSdk.get().toInt()
 defaultConfig { applicationId="dev.androidreserve.compose"; minSdk=24; targetSdk=33; versionCode=1; versionName="1" }
 buildFeatures { compose=true }
 compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
}
dependencies { implementation(platform(libs.androidx.compose.bom)); implementation(libs.androidx.compose.material3); implementation(libs.androidx.activity.compose) }
`);
await fs.writeFile(path.join(root,'app/src/main/AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="Reserve Compose"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>');
await fs.writeFile(path.join(root,'app/src/main/java/dev/androidreserve/compose/MainActivity.kt'),`package dev.androidreserve.compose
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.material3.*
import androidx.compose.foundation.layout.Column
class MainActivity : ComponentActivity() {
 private val counter=OwnedCounter()
 override fun onCreate(state:Bundle?){super.onCreate(state);setContent{MaterialTheme{counter.Content()}}}
}
class OwnedCounter {
 private val state=${process.argv.includes('--int-state')?'mutableIntStateOf(0)':'mutableStateOf(0)'}
 private val secondary=mutableIntStateOf(10)
 private val route=mutableStateOf("home")
 // long: 状态只在真实按钮回调中修改，渲染回调单独记录，不能用时间接近当作异步因果。
 fun onClick(){state.${process.argv.includes('--int-state')?'intValue':'value'}=state.${process.argv.includes('--int-state')?'intValue':'value'}+1}
 fun onMultiStateClick(){onClick();secondary.intValue+=5}
 fun navigate(){route.value=if(route.value=="home")"detail" else "home"}
 fun rendered(value:Int){android.util.Log.i("ReserveCompose","RENDERED="+value)}
	fun renderedDerived(value:Int){android.util.Log.i("ReserveCompose","RENDERED_DERIVED="+value)}
	fun coroutineCompleted(value:Int){android.util.Log.i("ReserveCompose","COROUTINE_COMPLETED="+value)}
	@Composable fun Content(){val value=state.${process.argv.includes('--int-state')?'intValue':'value'};val derived=remember { derivedStateOf { state.${process.argv.includes('--int-state')?'intValue':'value'} * 2 } }.value;val second=secondary.intValue;val currentRoute=route.value;${process.argv.includes('--coroutine') ? 'LaunchedEffect(value){coroutineCompleted(value)};' : ''}Column{Text("RESERVE_COMPOSE_V07: "+value);Text("DERIVED: "+derived);Text("SECONDARY: "+second);Text("ROUTE: "+currentRoute);Button(onClick={onClick()}){Text("Increment owned state")};${process.argv.includes('--multi-state')?'Button(onClick={onMultiStateClick()}){Text("Update multi state")}':''};${process.argv.includes('--navigation')?'Button(onClick={ { navigate() } }){Text("Navigate detail")}':''}};SideEffect{rendered(value);renderedDerived(derived)}}
}
`);
const result = await run(path.join(root,'gradlew'),[':app:assembleDebug',...(process.argv.includes('--offline')?['--offline']:[])],{cwd:root,timeoutMs:300000,maxBytes:2*1024*1024});
await fs.writeFile(path.join(root,'build.log'),result.stdout+result.stderr); checked(result,'构建自有Compose动态样本');
console.log(JSON.stringify({root,apk:path.join(root,'app/build/outputs/apk/debug/app-debug.apk')}));
