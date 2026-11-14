// long: 自有同签名base/config与真实AAB/APKS验证选择边界；所有派生文件留在新目录，不安装手机。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {createContext,packages} from '../src/actions.js';
import {run,checked,tool} from '../src/core/process.js';
import {completeJob} from './smoke-utils.mjs';
const root=await fs.mkdtemp(path.resolve('output/packages-owned-'));await fixture(root);
const sdk=process.env.ANDROID_HOME||path.join(os.homedir(),'Library/Android/sdk'),android=path.join(sdk,'platforms/android-36/android.jar');
const exec=async(name,args)=>checked(await run(await tool(name),args,{cwd:root,timeoutMs:180000}),name);
await fs.mkdir(path.join(root,'res/values-en'));await fs.writeFile(path.join(root,'res/values-en/strings.xml'),'<resources><string name="app_name">OWNED_SPLIT_EN</string></resources>');
await exec('aapt2',['compile','--dir','res','-o','split-compiled.zip']);
await exec('aapt2',['link','-o','base-unsigned.apk','--split','config-unsigned.apk:en','--manifest','AndroidManifest.xml','-I',android,'split-compiled.zip']);
await exec('python3',['-c','import zipfile\nwith zipfile.ZipFile("base-unsigned.apk","a") as z:z.write("dex/classes.dex","classes.dex")']);
process.env.RESERVE_PACKAGE_FIXTURE_PASSWORD='owned-package-fixture';await exec('keytool',['-genkeypair','-keystore','owned.jks','-alias','owned','-keyalg','RSA','-keysize','2048','-validity','365','-dname','CN=Owned Package Fixture','-storepass:env','RESERVE_PACKAGE_FIXTURE_PASSWORD','-keypass:env','RESERVE_PACKAGE_FIXTURE_PASSWORD']);
await fs.mkdir(path.join(root,'selected'));
for(const name of ['base','config']){await exec('zipalign',['-p','4',name+'-unsigned.apk',name+'-aligned.apk']);await exec('apksigner',['sign','--ks','owned.jks','--ks-key-alias','owned','--ks-pass','env:RESERVE_PACKAGE_FIXTURE_PASSWORD','--out','selected/'+name+'.apk',name+'-aligned.apk']);}
const apks=path.join(root,'explicit.apks');await exec('python3',['-c','import zipfile\nwith zipfile.ZipFile("explicit.apks","w") as z:\n z.write("selected/base.apk","variants/a/base.apk")\n z.write("selected/config.apk","variants/a/config.apk")\n z.write("selected/base.apk","variants/b/base.apk")']);
await exec('aapt2',['link','--proto-format','-o','proto.apk','--manifest','AndroidManifest.xml','-I',android,'split-compiled.zip']);
await exec('python3',['-c','import zipfile\nwith zipfile.ZipFile("proto.apk") as src,zipfile.ZipFile("base-module.zip","w") as dst:\n for n in src.namelist():dst.writestr("manifest/AndroidManifest.xml" if n=="AndroidManifest.xml" else n,src.read(n))\n dst.write("dex/classes.dex","dex/classes.dex")']);
const bundle=path.join(os.homedir(),'.local/share/android-reserve-mcp/engines/bundletool-all-1.18.3.jar');
await exec('java',['-Xmx1024m','-jar',bundle,'build-bundle','--modules=base-module.zip','--output=owned.aab']);
const c=await createContext({allowedRoots:[root],workspace:path.join(root,'work'),disabled:true}),results=[];
async function assertGreeting(job){const files=[];async function scan(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await scan(p);else if(entry.name==='Greeting.java')files.push(p);}}await scan(path.join(job.dir,'java'));assert.ok(files.length);assert.match(await fs.readFile(files[0],'utf8'),/hello /);}
try{
 const inspected=await completeJob(c,packages(c,{action:'inspect',path:apks}),results);assert.equal(inspected.value.requiresSelection,true);
 const selected=await completeJob(c,packages(c,{action:'validate',path:apks,members:['variants/a/base.apk','variants/a/config.apk']}),results);assert.equal(selected.value.validation.valid,true);assert.equal(selected.value.records.length,2);
 const decoded=await completeJob(c,packages(c,{action:'decode',path:path.join(root,'selected'),engine:'jadx'}),results);await assertGreeting(decoded.job);
 const manifests=await completeJob(c,packages(c,{action:'aab-manifests',path:path.join(root,'owned.aab')}),results);assert.equal(manifests.value.manifests[0].manifest.package,'dev.reserve.fixture');
 const aab=await completeJob(c,packages(c,{action:'decode',path:path.join(root,'owned.aab'),engine:'both'}),results);await assertGreeting(aab.job);assert.ok(aab.value.derivedInputs.every(x=>x.signing==='unsigned-analysis-derivative'));
 const passwordFile=path.join(root,'owned-password.txt');await fs.writeFile(passwordFile,process.env.RESERVE_PACKAGE_FIXTURE_PASSWORD,{mode:0o600});
 await exec('java',['-Xmx1024m','-jar',bundle,'build-apks','--bundle=owned.aab','--output=bundle.apks','--ks=owned.jks','--ks-key-alias=owned','--ks-pass=file:'+passwordFile,'--key-pass=file:'+passwordFile,'--aapt2='+await tool('aapt2')]);
 const spec=path.join(root,'device-spec.json');await fs.writeFile(spec,JSON.stringify({supportedAbis:['arm64-v8a'],supportedLocales:['en'],screenDensity:420,sdkVersion:36}));
 const derived=await completeJob(c,packages(c,{action:'select',path:path.join(root,'bundle.apks'),deviceSpecPath:spec}),results);assert.equal(derived.value.validation.valid,true);assert.ok(derived.value.records.some(x=>x.manifest.split));
 console.log('同签名分包/显式APKS选择/聚合DEX/真实AAB资源与代码派生/设备spec选择通过');
}finally{await fs.writeFile(path.join(root,'report.json'),JSON.stringify({root,results,deviceAccessed:false},null,2));await fs.writeFile('output/packages-latest-report.json',JSON.stringify({root,results},null,2));await c.close();}
