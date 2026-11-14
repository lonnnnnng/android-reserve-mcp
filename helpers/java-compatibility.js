const blocked = [
  { className: 'io.flutter.embedding.engine.dart.DartMessenger$Reply', methodName: 'reply', argumentTypes: ['java.nio.ByteBuffer'] },
  { className: 'androidx.compose.runtime.SnapshotMutableStateImpl', methodName: 'setValue', argumentTypes: ['java.lang.Object'] },
  { className: 'androidx.compose.runtime.SnapshotMutableIntStateImpl', methodName: 'setIntValue', argumentTypes: ['int'] },
];

export function javaCompatibility(args) {
  if (!['trace-java', 'trace-java-group'].includes(args.action)) return { supported: true };
  const hooks = args.action === 'trace-java-group' ? args.javaHooks || [] : [args];
  const match = hooks.find(hook => blocked.some(rule => rule.className === hook.className && rule.methodName === hook.methodName && JSON.stringify(rule.argumentTypes) === JSON.stringify(hook.argumentTypes)));
  if (!match) return { supported: true };
  // long: 这些入口已有致命JNI失败实证；未知环境不能凭版本字符串放行，必须先有匹配组合的真实回归证据。
  return { supported: false, status: 'unsupported', code: 'java_compatibility_blocked', partial: true,
    method: { className: match.className, methodName: match.methodName, argumentTypes: match.argumentTypes },
    reason: '该入口在Android16/Frida组合已有fatal JNI transition记录；兼容组合尚未完成真机回归，拒绝编译和注入',
    evidence: 'docs/evidence/framework-dynamic-20261114.json', cleanupRequired: false };
}

export function assertJavaCompatibility(args) {
  const result = javaCompatibility(args);
  if (result.supported) return;
  const error = new Error(result.reason);
  error.code = result.code;
  error.diagnostic = result;
  throw error;
}
