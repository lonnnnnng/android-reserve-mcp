# 框架动态关联

2026-11-15。GitHub Release为`v0.5.4`，npm `0.5.4`按本次交付命令发布；本页包含动态关联action及自有fixture扩展。仍为20个分组工具入口。验证设备为POCO F2 Pro、Android16/LineageOS23.2、ARM64；REA6.9.0设备binding/server17.23.2，宿主bundle编译器frida-compile19.1.0、bridge7.0.13。不能把单一样本通过推广到所有框架版本。

## Java/RN请求与回复

先attach显式deviceId/pid取得session_id，再使用`frida.trace-java-group`。示例是RNTester关闭R8的开发样本，方法名必须以实际目标重载为准：

```json
{
  "action": "trace-java-group",
  "sessionId": "<session UUID>",
  "maxEvents": 80,
  "maxTrackedObjects": 128,
  "objectTtlMs": 30000,
  "javaHooks": [
    {
      "id": "request",
      "className": "com.facebook.fbreact.specs.SampleTurboModule",
      "methodName": "getValueWithPromise",
      "argumentTypes": ["boolean", "com.facebook.react.bridge.Promise"],
      "correlation": {"group": "promise", "role": "request", "argumentIndex": 1}
    },
    {
      "id": "resolve",
      "className": "com.facebook.react.bridge.PromiseImpl",
      "methodName": "resolve",
      "argumentTypes": ["java.lang.Object"],
      "correlation": {"group": "promise", "role": "reply"}
    }
  ]
}
```

`java-group-ready`才表示全部方法已安装；加载任务成功本身不证明触发过。最多8个精确方法，共用同一agent的OS线程原调用栈；`parentInvocationId`仅证明在原Java方法执行范围内嵌套。跨线程不继承父栈。

request明确指定保存回调对象的参数；reply默认以receiver匹配，也可指定对象参数索引。只凭JNI `IsSameObject`匹配同一对象、同一group，记录`reply-attempt`和原方法正常返回后的`reply-returned`；抛出则为`reply-threw`，原Throwable原样传播。它们是Java方法边界，resolve返回不证明JS Promise已结算，reject返回也不能当成业务成功。

EventChannel 的 `onListen(..., EventSink)` 可把 EventSink 参数作为 request 对象；对同一 sink 的连续 `success(Object)` 回复使用 `correlation.multiReply=true` 保留 pending，直到观测窗口结束。每次回复仍必须通过同一 JNI 对象身份关联；实现类或重载无法唯一选择时直接失败，不按时间或 UI 文本猜测。

不调用任意对象的toString或遍历字段；只解箱final String/Integer/Boolean。对象参数仍可能含业务数据，分析报告按本地敏感产物管理。

同对象同group再次请求一律标歧义，包括已完成后复用；保留有界身份历史，避免迟到重复回复冒充新请求。对象TTL到期后释放引用并发出`java-identity-history-lost`/partial，**当前脚本此后停止确定配对**，仍可记录方法事件；不会遗忘旧请求后重新猜配。已配对历史事件不被撤销。卸载后新的脚本是新的观测窗口，不能拼接跨窗口因果。

最多500次调用、256个对象、TTL1–120秒；预算不足明确标partial。重复pending/嵌套回复、未匹配回复、过期、停止导致未完成均留状态。对象历史计入预算，不能为了延长采集默默丢弃身份。按需要缩短采集窗口，卸载/关闭后再开始独立窗口。

当前真机已验证：普通Java两个异步请求在不同线程逆序回复；RNTester `getValueWithPromise(false)`→同Promise `resolve("result")`；RNTester `rejectPromise` 的 `getValueWithPromise(true)`→同 `PromiseImpl` `reject(code 1, intentional promise rejection, Throwable, null)`，原请求正常返回，UI捕获到相同错误消息。隔离 RNTester 还在 JS 调用点主动保存 `new Error().stack`，同一次 UI 触发中得到 `rejectPromise`、`onPress` 及 bundle 行列，并与 Java 同 Promise 事件合并，证据为 `output/rn-stack-java/evidence.json`。随后 debug inspector 实验已取得 `scriptId=3` 并完成同次UI触发配对；自有新架构 APK 又通过 Cxx TurboModule/JSI 参数转换与 Android Fabric/codegen 视图命令/属性重渲染，证据为 `output/rn-cxx-jsi-fabric-20261115-run7/evidence.json`。仍没有把任意第三方 APK 的 JS stack 自动注入为 MCP能力，`.then()`内部调度和完整Fabric事件图仍未验证。

RN Hermes debug inspector 实验已在 POCO 上完成：Metro `/json/list` 唯一返回 RNTester 页面，`/inspector/debug` 的 `Debugger.scriptParsed` 得到 `scriptId=3`；同一 UI 触发的 fixture `rejectPromise`/`onPress` stack 与该 bundle URL 同源，并与 Java `PromiseImpl.reject` 的 `jni-isSameObject` Promise 身份独立配对。聚合证据为 `output/rn-hermes-cdp-scriptid/merged-evidence.json`，可复用脚本为 `scripts/rn-hermes-cdp-smoke.mjs`。仅适用于可修改 debug fixture 和已开放 Metro inspector，不扩展到任意第三方 APK。

通用探测脚本 `scripts/rn-third-party-probe.mjs` 已对官方 RNTester APK（包名 `com.facebook.react.uiapp`）做过一次非仓库样本验证：自动发现目标 PID、唯一 inspector、`scriptId=3`、source map URL 和 `Bridgeless [C++ connection]`，可选点击后保存 UI 哈希；证据为 `output/rn-third-party-probe-20261115-tap2/evidence.json`。该脚本的注入策略固定为 `injectionAttempted=false`：未开放 inspector 返回 `unsupported`，开放 inspector 只建立 debug session，不执行任意 JS、不加载 Frida 脚本、不把 UI 变化解释成 JSI/Fabric 原生调用。

自有 RN 新架构 fixture 另有显式因果 smoke：JS 先生成 `JSI_CALL_ID` 并传入 Cxx TurboModule，Android C++ 入口输出 `RN_NATIVE_MARKER:<JSI_CALL_ID>`；Fabric 属性提交输出 `fabric-event-id`，组件函数带单调 `renderSequence`。`src/core/rn-cdp.js` 只接受四段 ID/序列严格闭合的自有证据；POCO 连续三轮证据见 `output/rn-cxx-causal-20261115-run7/`、`run8/`、`run9/`。第三方 APK 仍不使用这套 marker 协议。

**已知兼容边界：** POCO F2 Pro（Android16/ARM64）原始 7.0.13/PR398 bridge 上，Flutter `onMethodCall(MethodCall, Result)` 的对象参数转换在 `IsInstanceOf` 触发 fatal JNI transition，`MethodChannel$IncomingMethodCallHandler$1.success(Object)` 的原方法转发在 `CallNonvirtualVoidMethod` 触发同类 fatal。根因是 bridge 复用原始 `kJniTransition jobject`；vendor typed bridge 已在同一 POCO/ART36/Frida17.23.2 tuple 上用 `NewLocalRef` 修复，并通过 success/error、ArrayList 同步/跨线程和 typed `String[]` 签名。自有 Flutter 3.50.0 R8 fixture 又验证了 mapping 后的 `MethodCall→zb`、`Result→ac`、`success→b` 选择以及 primitive/object MethodChannel 动态回复；证据见 `output/flutter-owned-bridge-20261115/evidence.json`。EventChannel matcher 现支持 `correlation.multiReply=true`，R8 EventSink 实现已定位为 `ReserveEventStreamHandler.onListen(Object,j5)` 保存 `k5`，并由 `k5.a(Integer)` 连续回复 `1,2`，两次均以 `jni-isSameObject` 关联同一 sink；动态证据见 `output/flutter-owned-bridge-event-20261115-pass/validation.json`。`DartMessenger$Reply.reply(ByteBuffer)`、Compose正式入口以及其他设备/ROM仍受保护，不能由本 tuple 外推。没有因此升级Frida/server、禁用CheckJNI或全局去优化。普通Java/RN通过不能抵消这些边界。

## MAUI/Mono精确方法入口

自有宽ABI静态/应用结果fixture已验证：`output/maui-wide-static-20261115/device-validation.json`。它在同一MAUI10 ARM64 APK中包含`ReserveAdd(int,int)`、实例`InstanceAdd(int,int)`和`Normalize(string)`，POCO按钮结果为`RESERVE_MAUI_DYNAMIC_V06: 46:50:MAUI`，artifact/store/ILSpy静态链通过。随后使用同构建NoInlining APK，Mono observer 在 POCO 上分别捕获实例`InstanceAdd(2,7)→50`和`Normalize("maui")→"MAUI"`，证据见`output/maui-wide-static-20261115/mono-instance-runtime3/validation.json`与`output/maui-wide-static-20261115/mono-normalize-runtime2/validation.json`。

`frida.trace-mono`为实验固定适配器，**只支持ARM64、已加载Mono、非泛型窄ABI方法，0–4个`int32`/`bool`/`long`/`float`/`string`参数和对应返回值；实例方法必须显式`instance:true`**。字符串只输出有界UTF-8快照，实例receiver只输出地址，拒绝byref、对象、结构体、CoreCLR、NativeAOT或IL2CPP。

```json
{
  "action": "trace-mono",
  "sessionId": "<session UUID>",
  "maxEvents": 20,
  "monoTarget": {
    "assemblyName": "ReserveMaui",
    "namespace": "ReserveMaui",
    "className": "App",
    "methodName": "ReserveAdd",
    "argumentTypes": ["int32", "int32"],
    "returnType": "int32",
    "instance": false,
    "allowRuntimeCompile": true
  }
}
```

assemblyName使用运行时image名称（本样本为ReserveMaui），不是猜测的磁盘路径。已加载程序集必须唯一；签名、完整名称、MethodDef token均匹配后，通过公开`mono_compile_method`准备入口，再用JIT info反查同一MonoMethod/code start，地址必须可执行。不会加载新程序集或调用目标业务方法。`allowRuntimeCompile`必须显式为true，因为入口准备可能触发JIT/AOT初始化，不能描述为完全被动。

输出MVID（imageGuid）、token、完整名称、入口、模块/RVA以及`managed-enter`/`managed-exit`同调用ID。只读原寄存器，不替换方法或修改返回。一次最多500次调用；托管异常、内联、共享泛型、thunk、解释器入口及复杂ABI仍不保证覆盖。没有exit时不能补造终态。

真实MAUI10 AOT验证分两份APK：原Release APK入口定位到`libaot-ReserveMaui.dll.so+0x45d0`，按钮返回46但未捕获方法调用；另一份明确NoInlining的自有APK由真实按钮触发，MCP捕获参数2、7和原返回46。后者证明窄边界可用，不证明能捕获原APK被内联的方法。

运行依赖是可连接的REA/Frida及目标导出的Mono公开API；分析已有APK不要求安装MAUI SDK。构建开发样本才需要私有.NET10 SDK、maui-android workload、Android SDK/NDK与JDK21。公开ABI签名以随样本.NET10.0.14 runtime pack的mono头文件核对，线程注册依据[Mono embedding正文](https://www.mono-project.com/docs/advanced/embedding/)。

## WebView脚本到网络请求

沿用`webview.open/scripts/source/network/body/close`，不新增任意CDP执行接口。Network保存真实CDP initiator调用栈，含scriptId、functionName、URL、lineNumber/columnNumber；坐标为**0开始**，与文本编辑器的1开始行号不同。保留最多4层parent栈、每层16帧；超限或只有parentId未解析时partial。

只有同CDP session/进程代次中已观察到的scriptId才标`scriptObserved`，证据图连接request→initiator frame→scriptId→已采集正文SHA→静态AST。scriptParsed保留sourceMapURL，但不会自动请求该URL。源码映射仍由调用者显式提供并核对构建身份。

自有HTTPS拦截页面通过：`sendOwnedRequest`的真实fetch、同脚本scriptId、0开始第1行、响应正文result46与AST函数。响应由自有shouldInterceptRequest提供，**不是公网稳定性验收**；此前官方天气请求单次公网200与重复超时的结论保持。

CDP/Frida使用不同会话身份，不能据URL、相近时间或相同PID推断JS→Java业务因果。

## 生命周期与开发验收

Java/JNI/Mono共用本服务每设备/PID的观测所有权。先卸载当前scriptId或close所属session再切换；安装/撤销不确定时保留占位，禁止覆盖。其他客户端/raw脚本不在冲突识别范围。status只读取本次脚本事件；收到setup-error要检查error.json，而不是只看load成功。

开发命令均须在源码仓库运行，验收脚本不随npm包发布：

```zsh
# 显式真机；config为上面的action字段以外参数，测试脚本会attach当前运行包。
node scripts/java-group-device-smoke.mjs SERIAL PACKAGE CONFIG_JSON WORKSPACE TAP_X TAP_Y
node scripts/mono-device-smoke.mjs SERIAL PACKAGE CONFIG_JSON WORKSPACE TAP_X TAP_Y
node scripts/webview-initiator-smoke.mjs SERIAL

# 仅构建；必须给不存在的新目录。
node scripts/maui-owned-build.mjs NEW_DIRECTORY --dynamic
node scripts/compose-owned-build.mjs JETNEWS_SOURCE NEW_DIRECTORY --int-state
```

```zsh
# Compose扩展 matcher：配置声明 smokeComposeExtended=true、显式 click/multi/navigate/write/routeWrite/render/renderDerived/coroutine hooks，
# 并用 smokeTapSequence 驱动 increment、multi-state、navigation 三次真实 ADB tap。
node scripts/java-group-device-smoke.mjs SERIAL dev.androidreserve.compose /tmp/compose-extended-mcp-config.json WORKSPACE
```

group smoke默认等一条正常reply；测试配置可用smokeExpectedReplies验证两条逆序回复，或smokeExpectedReplies=0、smokeExitHook/smokeParentHook验证同线程嵌套，smokeObservedExitHook仅断言另一事件出现，不生成异步因果。配置声明 `smokeRequestHook`、`smokeReplyHook`、`smokeExpectedRequestArgument`、`smokeExpectedReplyArgument` 或 `smokeExpectedReplyMessage` 时，脚本会对真实请求/回复事件执行同一组断言，适用于RN Promise和Flutter channel。`smokeComposeExtended=true` 时，matcher 还要求关键 enter 均有正常 return、同一 trace、状态值 `1→2`、derived 值 `2→4`、两次多状态写入 `2/15`、`routeWrite(detail)`、导航后的 `render(2)` 和 coroutine completion；缺一项返回 `false`。只有两种等待条件之一成立才可通过。Compose样本构建成功不等于该动态验收通过。

需要root时仅使用此前授权目标，不自动启动/升级server，不改手机VPN/代理。原始开发现场可能被临时目录清理；本轮摘要、产物哈希与关键事件另存[动态验收证据](evidence/framework-dynamic-20261114.json)。Unity、Unreal、HarmonyOS NEXT继续暂缓。
