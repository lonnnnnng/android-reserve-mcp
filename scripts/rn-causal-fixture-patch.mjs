// long: 给隔离的 RNTester 新架构样本加上可复核的跨层 marker，不把第三方 APK 当作可写目标。
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '');
if (!root) throw new Error('用法: node scripts/rn-causal-fixture-patch.mjs RN_BUILD_ROOT');

const files = {
  cxxJs: path.join(root, 'packages/rn-tester/js/examples/TurboModule/NativeCxxModuleExampleExample.js'),
  cxxImpl: path.join(root, 'packages/rn-tester/NativeCxxModuleExample/NativeCxxModuleExample.cpp'),
  cxxCmake: path.join(root, 'packages/rn-tester/NativeCxxModuleExample/CMakeLists.txt'),
  fabricJs: path.join(root, 'packages/rn-tester/NativeComponentExample/js/MyNativeView.js'),
  fabricManager: path.join(root, 'packages/rn-tester/android/app/src/main/java/com/facebook/react/uiapp/component/MyNativeViewManager.kt'),
};

const changed = [];
async function replaceOnce(file, marker, before, after) {
  let source = await fs.readFile(file, 'utf8');
  if (source.includes(marker)) return;
  if (!source.includes(before)) throw new Error(`RN fixture patch anchor missing: ${file}`);
  source = source.replace(before, after);
  await fs.writeFile(file, source);
  changed.push(path.relative(root, file));
}

await replaceOnce(
  files.cxxJs,
  'RN_RESERVE_CAUSAL_CXX JSI_CALL_ID=',
  "  | 'callback'\n",
  "  | 'causal'\n  | 'callback'\n",
);
await replaceOnce(
  files.cxxJs,
  "const callId = 'rn-jsi-'",
  '  _tests = {\n',
  `  _tests = {
    // long: call id 由 JS 生成并作为字符串参数进入 C++，native marker 再由 logcat 回读。
    causal: () => {
      const callId = 'rn-jsi-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
      const nativeValue = NativeCxxModuleExample?.getString('RN_NATIVE_MARKER:' + callId);
      return 'RN_RESERVE_CAUSAL_CXX JSI_CALL_ID=' + callId + ' NATIVE_ECHO=' + nativeValue;
    },
`,
);
await replaceOnce(
  files.cxxImpl,
  '#include <android/log.h>',
  '#include <React/Debug.h>\n',
  `#include <React/Debug.h>
#if defined(__ANDROID__)
#include <android/log.h>
#endif
`,
);
await replaceOnce(
  files.cxxCmake,
  '        log',
  '        reactnative\n)\n',
  '        reactnative\n        log\n)\n',
);
await replaceOnce(
  files.cxxImpl,
  'native-marker=%s',
  `std::string NativeCxxModuleExample::getString(
    jsi::Runtime& /*rt*/,
    std::string arg) {
  return arg;
}
`,
  `std::string NativeCxxModuleExample::getString(
    jsi::Runtime& /*rt*/,
    std::string arg) {
#if defined(__ANDROID__)
  if (arg.rfind("RN_NATIVE_MARKER:", 0) == 0) {
    __android_log_print(ANDROID_LOG_INFO, "RNReserveCausal", "native-marker=%s", arg.c_str());
  }
#endif
  return arg;
}
`,
);

await replaceOnce(
  files.fabricJs,
  'const [fabricEventId',
  '  const [legacyStyleEventCount, setLegacyStyleEventCount] = useState<number>(0);\n',
  `  const [legacyStyleEventCount, setLegacyStyleEventCount] = useState<number>(0);
  const [fabricEventId, setFabricEventId] = useState<number>(0);
  const renderSequenceRef = useRef<number>(0);
  // long: 每次组件函数执行都推进序号，脚本只接受点击前后严格增加的重组证据。
  renderSequenceRef.current += 1;
`,
);
await replaceOnce(
  files.fabricJs,
  'values={[fabricEventId',
  '        values={arrayValues}\n',
  '        values={[fabricEventId, ...arrayValues]}\n',
);
await replaceOnce(
  files.fabricJs,
  'setFabricEventId(previous',
  `            setOpacity(computeNextOpacity(opacity));
            setArrayValues([
`,
  `            setOpacity(computeNextOpacity(opacity));
            setFabricEventId(previous => previous + 1);
            setArrayValues([
`,
);
await replaceOnce(
  files.fabricJs,
  'RN_FABRIC_CAUSAL eventId',
  `      <Text style={{color: 'green', textAlign: 'center'}}>
        Opacity: {opacity.toFixed(1)}
      </Text>
`,
  `      <Text style={{color: 'green', textAlign: 'center'}}>
        Opacity: {opacity.toFixed(1)}
      </Text>
      <Text style={{color: 'green', textAlign: 'center'}}>
        RN_FABRIC_CAUSAL eventId: fabric-event-{fabricEventId} renderSequence: {renderSequenceRef.current}
      </Text>
`,
);

await replaceOnce(
  files.fabricManager,
  'fabric-event-id=fabric-event-',
  `  override fun setValues(view: MyNativeView, value: ReadableArray?) {
    val values = mutableListOf<Int>()
`,
  `  override fun setValues(view: MyNativeView, value: ReadableArray?) {
    val eventId = value?.takeIf { it.size() > 0 }?.getDouble(0)?.toInt() ?: 0
    // long: Fabric 属性提交的首个值是 fixture 自有 event id，native 日志用它闭合到重组序列。
    android.util.Log.i("RNReserveFabric", "fabric-event-id=fabric-event-$eventId")
    val values = mutableListOf<Int>()
`,
);

console.log(JSON.stringify({ root, changed, markerContract: {
  jsiCallId: 'rn-jsi-<timestamp>-<random>',
  nativeMarker: 'RN_NATIVE_MARKER:<jsiCallId>',
  fabricEventId: 'fabric-event-<number>',
  renderSequence: 'strictly increasing across the opacity prop update',
} }, null, 2));
