const blocked = [
  { className: 'io.flutter.embedding.engine.dart.DartMessenger$Reply', methodName: 'reply', argumentTypes: ['java.nio.ByteBuffer'] },
  { className: 'io.flutter.plugin.common.MethodChannel$IncomingMethodCallHandler$1', methodName: 'success', argumentTypes: ['java.lang.Object'] },
  { className: 'io.flutter.plugin.common.MethodChannel$IncomingMethodCallHandler$1', methodName: 'error', argumentTypes: ['java.lang.String', 'java.lang.String', 'java.lang.Object'] },
  { className: 'io.flutter.plugin.common.MethodChannel$IncomingMethodCallHandler$1', methodName: 'notImplemented', argumentTypes: [] },
  { className: 'androidx.compose.runtime.SnapshotMutableStateImpl', methodName: 'setValue', argumentTypes: ['java.lang.Object'] },
  { className: 'androidx.compose.runtime.SnapshotMutableIntStateImpl', methodName: 'setIntValue', argumentTypes: ['int'] },
];

const flutterHandlerArgumentTypes = ['io.flutter.plugin.common.MethodCall', 'io.flutter.plugin.common.MethodChannel$Result'];

function isBlocked(rule, hook) {
  // long: Flutter业务handler类名由宿主应用生成，按标准MethodCall签名保护整个入口，避免只修补一个样本类名。
  const classMatches = rule.className === '*' ? hook.className?.length > 0 : rule.className === hook.className;
  return classMatches && rule.methodName === hook.methodName && JSON.stringify(rule.argumentTypes) === JSON.stringify(hook.argumentTypes);
}

export const JAVA_RUNTIME_PROFILE = Object.freeze({ id: 'bridge302-art-b72c9963', status: 'verified',
  bridgeSha256: '0343150a2f1670490a965e560bf9df888486fe1fff10258eec64f925b80b74d3',
  artSha256: 'b72c99634be4a2ab4386e4a3be4258b842cc97f26b26d207c4ee11225b0d5a8d', artBytes: 12901264,
  artPath: '/apex/com.android.art/lib64/libart.so', apiLevel: 36, arch: 'arm64', fridaVersion: '17.23.2' });

function profileMatches(profile) {
  return profile?.id === JAVA_RUNTIME_PROFILE.id && ['bridgeSha256', 'artSha256', 'artBytes', 'apiLevel', 'arch', 'fridaVersion'].every(field => profile[field] === JAVA_RUNTIME_PROFILE[field]) &&
    (JAVA_RUNTIME_PROFILE.status === 'verified' || profile.experimental === true);
}

export function verifyJavaRuntimeProfile(profile, env = globalThis) {
  if (!profileMatches(profile)) return null;
  try {
    if (env.Frida.version !== profile.fridaVersion || env.Process.arch !== profile.arch || env.Process.id !== profile.expectedPid) return null;
    const get = new env.NativeFunction(env.Process.getModuleByName('libc.so').getExportByName('__system_property_get'), 'int', ['pointer', 'pointer'], { exceptions: 'propagate' });
    const value = env.Memory.alloc(92), size = get(env.Memory.allocUtf8String('ro.build.version.sdk'), value);
    if (size < 1 || size > 91 || Number(value.readUtf8String(size)) !== profile.apiLevel) return null;
    const art = env.Process.getModuleByName('libart.so'), file = new env.File(art.path, 'rb'); let bytes;
    try {
      file.seek(0, env.File.SEEK_END);
      if (file.tell() !== profile.artBytes || profile.artBytes > 32 * 1024 * 1024) return null;
      file.seek(0, env.File.SEEK_SET); bytes = file.readBytes(profile.artBytes);
    } finally { file.close(); }
    // long: 版本字符串与ROM fingerprint可能不反映主线ART更新；以有界文件哈希重新核对实际加载模块的磁盘来源。
    if (bytes.byteLength !== profile.artBytes || env.Checksum.compute('sha256', bytes) !== profile.artSha256) return null;
    return { ...profile, runtimeVerified: true, artPath: art.path };
  } catch { return null; }
}

export function javaCompatibility(args, profile) {
  if (!['trace-java', 'trace-java-group'].includes(args.action)) return { supported: true };
  const hooks = args.action === 'trace-java-group' ? args.javaHooks || [] : [args];
  const match = hooks.find(hook => blocked.some(rule => isBlocked(rule, hook)) || (hook.methodName === 'onMethodCall' && JSON.stringify(hook.argumentTypes) === JSON.stringify(flutterHandlerArgumentTypes)));
  if (!match) return { supported: true };
  if (profileMatches(profile)) return { supported: true, status: profile.experimental ? 'experimental' : 'verified', profile: { id: profile.id, bridgeSha256: profile.bridgeSha256, artSha256: profile.artSha256, apiLevel: profile.apiLevel, arch: profile.arch, fridaVersion: profile.fridaVersion, runtimeVerified: profile.runtimeVerified === true } };
  // long: 这些入口已有致命JNI失败实证；未知环境不能凭版本字符串放行，必须先有匹配组合的真实回归证据。
  return { supported: false, status: 'unsupported', code: 'java_compatibility_blocked', partial: true,
    method: { className: match.className, methodName: match.methodName, argumentTypes: match.argumentTypes },
    reason: '该入口在Android16/Frida组合已有fatal JNI transition记录；兼容组合尚未完成真机回归，拒绝编译和注入',
    evidence: 'docs/evidence/framework-dynamic-20261114.json', cleanupRequired: false };
}

export function assertJavaCompatibility(args, profile) {
  const result = javaCompatibility(args, profile);
  if (result.supported) return;
  const error = new Error(result.reason);
  error.code = result.code;
  error.diagnostic = result;
  throw error;
}
