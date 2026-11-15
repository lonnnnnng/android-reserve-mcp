import test from 'node:test';
import assert from 'node:assert/strict';
import { JAVA_RUNTIME_PROFILE, javaCompatibility, verifyJavaRuntimeProfile } from '../helpers/java-compatibility.js';
import { javaBridgeIdentity } from '../src/core/java-profile.js';
import { selectJavaOverload } from '../helpers/java-signature.js';

const blocked = { action: 'trace-java', className: 'androidx.compose.runtime.SnapshotMutableIntStateImpl', methodName: 'setIntValue', argumentTypes: ['int'] };
const profile = { ...JAVA_RUNTIME_PROFILE, expectedPid: 42, experimental: true };

test('完整返回类型参与运行选择，同参数重载不能默认选第一个', () => {
  const methods = ['int','java.lang.String'].map(className => ({ argumentTypes: [], returnType: { className } }));
  assert.equal(selectJavaOverload({ overloads: methods }, [], 'java.lang.String'), methods[1]);
  assert.throws(() => selectJavaOverload({ overloads: methods }, []), /唯一/);
  assert.throws(() => selectJavaOverload({ overloads: methods }, [], 'void'), /0项/);
});

test('客户端字段不能放行兼容保护，候选需要独立环境凭证', () => {
  assert.equal(javaCompatibility({ ...blocked, _compatibilityProfile: profile }).supported, false);
  assert.equal(javaCompatibility(blocked, profile).supported, true);
  assert.equal(javaCompatibility(blocked, { ...profile, bridgeSha256: '0'.repeat(64) }).supported, false);
  // verified profiles derive trust from the immutable bridge/ART identity; a caller's experimental flag cannot revoke it.
  assert.equal(javaCompatibility(blocked, { ...profile, experimental: false }).supported, true);
});

test('Flutter MethodChannel handler和success/error回复在未知组合下fail-closed', () => {
  const handler = { action: 'trace-java-group', javaHooks: [{ id: 'handler', className: 'com.example.platformchannel.MainActivity$2', methodName: 'onMethodCall', argumentTypes: ['io.flutter.plugin.common.MethodCall', 'io.flutter.plugin.common.MethodChannel$Result'] }] };
  const success = { action: 'trace-java', className: 'io.flutter.plugin.common.MethodChannel$IncomingMethodCallHandler$1', methodName: 'success', argumentTypes: ['java.lang.Object'] };
  const error = { action: 'trace-java', className: 'io.flutter.plugin.common.MethodChannel$IncomingMethodCallHandler$1', methodName: 'error', argumentTypes: ['java.lang.String', 'java.lang.String', 'java.lang.Object'] };
  for (const candidate of [handler, success, error]) {
    assert.equal(javaCompatibility(candidate).supported, false);
    assert.equal(javaCompatibility(candidate).code, 'java_compatibility_blocked');
  }
  assert.equal(javaCompatibility(handler, profile).supported, true);
});

test('runtime同时校验Core、PID、ABI、SDK及有界ART文件，未知组合在Java之前拒绝', () => {
  let reads=0,closed=0;
  const env={Frida:{version:'17.23.2'},Process:{id:42,arch:'arm64',getModuleByName:name=>({path:JAVA_RUNTIME_PROFILE.artPath,getExportByName:()=>1})},
    NativeFunction:function(){return()=>2;},Memory:{alloc:()=>({readUtf8String:()=> '36'}),allocUtf8String:value=>value},
    File:class{static SEEK_END=2;static SEEK_SET=0;seek(){}tell(){return JAVA_RUNTIME_PROFILE.artBytes;}readBytes(size){reads++;return{byteLength:size};}close(){closed++;}},
    Checksum:{compute:()=>JAVA_RUNTIME_PROFILE.artSha256}};
  assert.equal(verifyJavaRuntimeProfile(profile,env).runtimeVerified,true);assert.equal(reads,1);assert.equal(closed,1);
  assert.equal(verifyJavaRuntimeProfile(profile,{...env,Frida:{version:'unknown'}}),null);assert.equal(reads,1);
  assert.equal(verifyJavaRuntimeProfile(profile,{...env,Process:{...env.Process,id:43}}),null);
  assert.equal(verifyJavaRuntimeProfile(profile,{...env,Checksum:{compute:()=> '0'.repeat(64)}}),null);
  assert.equal(verifyJavaRuntimeProfile({...profile,artBytes:64*1024*1024},env),null);
});

test('实际bridge全树身份覆盖入口和全部runtime js，版本字符串不足以作为凭证', async () => {
  const identity=await javaBridgeIdentity();assert.ok(identity.files>=16);assert.match(identity.sha256,/^[a-f0-9]{64}$/);
  assert.equal(identity.sha256,JAVA_RUNTIME_PROFILE.bridgeSha256);
});
