// long: 测试App只计算固定整数并调用自有JNI，方便验证注入，不读取手机文件或用户数据。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { run, tool, checked } from '../src/core/process.js';

export const packageName = 'dev.androidreserve.fixture';
export async function fixtureApp(root, { dynamicJni = false, dynamicNative = false, customLoader = false, webviewOrigin = null, webviewAssets = null } = {}) {
  if(webviewOrigin&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(webviewOrigin))throw new Error('自有WebView样本只接受本机回环来源');
  const useWebview=!!(webviewOrigin||webviewAssets);
  const encoded=value=>Buffer.from(value).toString('base64');
  // long: 自有请求全部在WebView内响应，设备TCP受限时仍能验收真实CDP事件，不访问外部网站。
  const webServer=webviewAssets?`public static class OwnedWebClient extends android.webkit.WebViewClient {
 public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebView view,android.webkit.WebResourceRequest request){String route=request.getUrl().getPath();String item,mime;if(route.equals("/main.js")){item="${encoded(webviewAssets.mainJs)}";mime="application/javascript";}else if(route.equals("/api.json")){item="${encoded(webviewAssets.api)}";mime="application/json";}else if(route.equals("/blob.bin")){item="${encoded(webviewAssets.binary)}";mime="application/octet-stream";}else{item="${encoded('<!doctype html><html><body>RESERVE_WEBVIEW_V05<script src="/main.js"></script></body></html>')}";mime="text/html";}android.webkit.WebResourceResponse response=new android.webkit.WebResourceResponse(mime,"UTF-8",new java.io.ByteArrayInputStream(android.util.Base64.decode(item,0)));response.setResponseHeaders(java.util.Collections.singletonMap("Cache-Control","no-store"));return response;}}
`:'';
  await fs.mkdir(root, { recursive: true });
  // long: 每次编译用新目录，避免动态样本遗留class混进普通样本；签名仍复用root中的自有keystore以便覆盖安装。
  const build = await fs.mkdtemp(path.join(root, 'build-')), classes = path.join(build, 'classes'), dex = path.join(build, 'dex');
  await fs.mkdir(classes); await fs.mkdir(dex);
  const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
  const platforms = (await fs.readdir(path.join(sdk, 'platforms'))).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
  const jar = path.join(sdk, 'platforms', platforms[0], 'android.jar');
  const ndks = (await fs.readdir(path.join(sdk, 'ndk'))).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
  const compiler = path.join(sdk, 'ndk', ndks[0], 'toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang');
  const exec = async (name, args) => checked(await run(await tool(name), args, { cwd: root, timeoutMs: 90000 }), name);
  let loaderSource='';
  if(customLoader){
    // long: 附加DEX不能同时进入主DEX，否则默认loader也能找到类，无法证明selector确实选中了自定义loader。
    const extra=path.join(build,'extra-classes'),dexAsset=path.join(build,'extra-dex');await fs.mkdir(extra);await fs.mkdir(dexAsset);
    const source=path.join(build,'DexOwned.java');await fs.writeFile(source,'package owned.dynamic; public class DexOwned {public static int compute(int a,int b){return a+b+71;}}');
    await exec('javac',['--release','8','-d',extra,source]);await exec('d8',['--lib',jar,'--output',dexAsset,path.join(extra,'owned/dynamic/DexOwned.class')]);
    loaderSource=`private ClassLoader ownedLoader; private java.lang.reflect.Method ownedMethod;
 private void prepareOwnedLoader(){try{java.io.File file=java.io.File.createTempFile("reserve-loader-",".dex",getCodeCacheDir());try(java.io.InputStream in=getAssets().open("owned.dex");java.io.FileOutputStream out=new java.io.FileOutputStream(file)){if(!file.setReadOnly())throw new java.io.IOException("readonly failed");byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}ownedLoader=new dalvik.system.DexClassLoader(file.getAbsolutePath(),getCodeCacheDir().getAbsolutePath(),null,getClassLoader());ownedMethod=ownedLoader.loadClass("owned.dynamic.DexOwned").getMethod("compute",int.class,int.class);}catch(Exception e){throw new RuntimeException(e);}}
 private int ownedCompute(){try{return ((Integer)ownedMethod.invoke(null,2,7)).intValue();}catch(Exception e){throw new RuntimeException(e);}}`;
    await fs.copyFile(path.join(dexAsset,'classes.dex'),path.join(build,'owned.dex'));
  }
  await fs.writeFile(path.join(root, 'MainActivity.java'), `package ${packageName};
public class MainActivity extends android.app.Activity {
 static {System.loadLibrary("fixture");}
 public static native int nativeAdd(int a,int b);
 public static int add(int a,int b){return a+b;}
 public static int compute(int a,int b){return nativeAdd(a,b)+37;}
 public static int throwIfNegative(int a){if(a<0)throw new IllegalArgumentException("OWNED_FIXTURE_NEGATIVE");return a+37;}
 ${loaderSource}
 ${dynamicNative?'public static class DelayedTarget { public static native int delayedAdd(int a,int b); }\n // long: 将自有测试库安排在spawn恢复后再加载，确保等待脚本先于目标模块安装。\n private volatile boolean delayedReady=false;\n private void loadOwnedDelayedNative(){try{System.load(new java.io.File(getApplicationInfo().nativeLibraryDir,"libdelayed.so").getAbsolutePath());delayedReady=true;android.util.Log.i("AndroidReserveFixture","DELAYED_NATIVE_LOADED");}catch(Exception error){android.util.Log.e("AndroidReserveFixture","DELAYED_NATIVE_LOAD_FAILED",error);}}':''}
 ${webServer}
 ${useWebview?'public static class OwnedBridge { @android.webkit.JavascriptInterface public int ping(int value){return value+83;} }':''}
 ${dynamicJni ? 'public static class DynamicTarget { public static native int dynamicAdd(int a,int b); }\n public static native int registrationExercise();\n public static int runRegistrationCycle(){return registrationExercise();}\n public static int computeDynamic(int a,int b){return DynamicTarget.dynamicAdd(a,b)+37;}\n private int iteration=0;' : ''}
 private final android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
 protected void onCreate(android.os.Bundle state){super.onCreate(state);final android.widget.TextView text=new android.widget.TextView(this);setContentView(text);${customLoader?'prepareOwnedLoader();':''}${useWebview?'android.webkit.WebView.setWebContentsDebuggingEnabled(true);android.webkit.WebView web=new android.webkit.WebView(this);web.getSettings().setJavaScriptEnabled(true);web.addJavascriptInterface(new OwnedBridge(),"ownedBridge");web.setWebViewClient(new ' +(webviewAssets?'OwnedWebClient':'android.webkit.WebViewClient')+'());setContentView(web);web.loadUrl('+(webviewAssets?'"https://owned-fixture.invalid/"':JSON.stringify(webviewOrigin+'/'))+');':''}${dynamicNative?'handler.postDelayed(new Runnable(){public void run(){loadOwnedDelayedNative();}},1600);':''}handler.post(new Runnable(){public void run(){int result=compute(2,7);${customLoader?'result=ownedCompute();':''}${dynamicJni ? 'if(iteration++%4==0)android.util.Log.i("AndroidReserveFixture","REGISTRATION_CYCLE="+runRegistrationCycle());result=computeDynamic(2,7);' : ''}${dynamicNative?'if(delayedReady)result=DelayedTarget.delayedAdd(2,7);':''}try{throwIfNegative(-1);}catch(IllegalArgumentException expected){}text.setText("android-reserve-mcp fixture: "+result);handler.postDelayed(this,500);}});}
 protected void onDestroy(){handler.removeCallbacksAndMessages(null);super.onDestroy();}
}`);
  // long: 动态方法放独立内部类，撤销注册不影响原有导出JNI；只有专门验收开启，其他smoke维持原样。
  const dynamicSource = dynamicJni ? `
static __attribute__((noinline)) jint owned_dynamic_add(JNIEnv* env,jclass type,jint a,jint b){return a+b+11;}
static JNINativeMethod owned_methods[]={{"dynamicAdd","(II)I",(void*)owned_dynamic_add}};
/* long: 隐藏实现不提供Java_*导出，只允许从JNI_OnLoad的注册事件恢复方法到地址的映射。 */
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm,void* reserved){
 JNIEnv* env=0;if((*vm)->GetEnv(vm,(void**)&env,JNI_VERSION_1_6)!=JNI_OK)return JNI_ERR;
 jclass type=(*env)->FindClass(env,"dev/androidreserve/fixture/MainActivity$DynamicTarget");
 if(!type)return JNI_ERR;int result=(*env)->RegisterNatives(env,type,owned_methods,1);(*env)->DeleteLocalRef(env,type);
 return result==JNI_OK?JNI_VERSION_1_6:JNI_ERR;
}
JNIEXPORT jint JNICALL Java_dev_androidreserve_fixture_MainActivity_registrationExercise(JNIEnv* env,jclass owner){
 jclass type=(*env)->FindClass(env,"dev/androidreserve/fixture/MainActivity$DynamicTarget");if(!type)return -10;
 int first=(*env)->RegisterNatives(env,type,owned_methods,1);
 JNINativeMethod bad[]={ {"missingNativeMethod","(II)I",(void*)owned_dynamic_add} };
 /* long: 先保存原NoSuchMethodError是否仍挂起，再由样本自身清理，123才能证明观测没有吞业务异常。 */
 int rejected=(*env)->RegisterNatives(env,type,bad,1);jboolean original_exception=(*env)->ExceptionCheck(env);
 if(original_exception)(*env)->ExceptionClear(env);
 int removed=(*env)->UnregisterNatives(env,type);int restored=(*env)->RegisterNatives(env,type,owned_methods,1);
 (*env)->DeleteLocalRef(env,type);
 return first==0&&rejected<0&&original_exception&&removed==0&&restored==0?123:-11;
}
` : '';
  let delayedLibrary=null;
  if(dynamicNative){
    // long: 延迟库用JNI_OnLoad注册自有方法，验证模块出现后再解析符号并安装hook。
    const source=path.join(build,'delayed.c');
    await fs.writeFile(source,`#include <jni.h>\n__attribute__((visibility("default"),noinline)) jint owned_delayed_add(JNIEnv* env,jclass type,jint a,jint b){return a+b+101;}\nstatic JNINativeMethod methods[]={{"delayedAdd","(II)I",(void*)owned_delayed_add}};\nJNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm,void* reserved){JNIEnv* env=0;if((*vm)->GetEnv(vm,(void**)&env,JNI_VERSION_1_6)!=JNI_OK)return JNI_ERR;jclass type=(*env)->FindClass(env,"dev/androidreserve/fixture/MainActivity$DelayedTarget");if(!type)return JNI_ERR;int result=(*env)->RegisterNatives(env,type,methods,1);(*env)->DeleteLocalRef(env,type);return result==JNI_OK?JNI_VERSION_1_6:JNI_ERR;}\n`);
    delayedLibrary=path.join(root,'libdelayed.so');checked(await run(compiler,['-shared','-fPIC','-O0','-g',source,'-o',delayedLibrary],{timeoutMs:90000}),'编译自有延迟Native模块');
  }
  await fs.writeFile(path.join(root, 'fixture.c'), '#include <jni.h>\n__attribute__((noinline)) int fixture_add(int a,int b){return a+b;}\nJNIEXPORT jint JNICALL Java_dev_androidreserve_fixture_MainActivity_nativeAdd(JNIEnv* env,jclass type,jint a,jint b){return fixture_add(a,b);}\n' + dynamicSource);
  checked(await run(compiler, ['-shared','-fPIC','-O0','-g',path.join(root,'fixture.c'),'-o',path.join(root,'libfixture.so')], { timeoutMs: 90000 }), '编译自有JNI');
  await exec('javac', ['--release','8','-cp',jar,'-d',classes,'MainActivity.java']);
  const classDirectory = path.join(classes,...packageName.split('.'));
  const classFiles = (await fs.readdir(classDirectory)).filter(n => n.endsWith('.class')).map(n => path.join(classDirectory,n));
  await exec('d8', ['--lib',jar,'--output',dex,...classFiles]);
  await fs.writeFile(path.join(root, 'AndroidManifest.xml'), `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}" android:versionCode="1" android:versionName="1"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="28"/>${useWebview?'<uses-permission android:name="android.permission.INTERNET"/>':''}<application android:label="Android Reserve Fixture" android:extractNativeLibs="true" ${useWebview?'android:usesCleartextTraffic="true"':''}><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`);
  await exec('aapt2', ['link','-o','unsigned.apk','--manifest','AndroidManifest.xml','-I',jar]);
  await exec('python3', ['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"a") as z:\n z.write(sys.argv[2],"classes.dex")\n z.write(sys.argv[3],"lib/arm64-v8a/libfixture.so")',path.join(root,'unsigned.apk'),path.join(dex,'classes.dex'),path.join(root,'libfixture.so')]);
  if(delayedLibrary)await exec('python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"a") as z:z.write(sys.argv[2],"lib/arm64-v8a/libdelayed.so")',path.join(root,'unsigned.apk'),delayedLibrary]);
  if(customLoader)await exec('python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"a") as z:z.write(sys.argv[2],"assets/owned.dex")',path.join(root,'unsigned.apk'),path.join(build,'owned.dex')]);
  process.env.RESERVE_DEVICE_FIXTURE_PASSWORD='self-owned-fixture';
  if (!await fs.stat(path.join(root,'fixture.jks')).catch(() => null)) await exec('keytool', ['-genkeypair','-keystore','fixture.jks','-alias','fixture','-keyalg','RSA','-keysize','2048','-validity','365','-dname','CN=Android Reserve Fixture','-storepass:env','RESERVE_DEVICE_FIXTURE_PASSWORD','-keypass:env','RESERVE_DEVICE_FIXTURE_PASSWORD']);
  await exec('zipalign', ['-f','-p','4','unsigned.apk','aligned.apk']);
  await exec('apksigner', ['sign','--ks','fixture.jks','--ks-key-alias','fixture','--ks-pass','env:RESERVE_DEVICE_FIXTURE_PASSWORD','--out','fixture.apk','aligned.apk']);
  await exec('apksigner', ['verify','fixture.apk']);
  return path.join(root,'fixture.apk');
}
