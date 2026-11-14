# 框架动态关联

2026-11-14。GitHub/npm `0.5.3`均已发布；本版本包含以下动态关联action。仍为20个分组工具入口。验证设备为POCO F2 Pro、Android16/LineageOS23.2、ARM64；REA6.9.0设备binding/server17.23.2，宿主bundle编译器frida-compile19.1.0、bridge7.0.13。不能把单一样本通过推广到所有框架版本。

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

不调用任意对象的toString或遍历字段；只解箱final String/Integer/Boolean。对象参数仍可能含业务数据，分析报告按本地敏感产物管理。

同对象同group再次请求一律标歧义，包括已完成后复用；保留有界身份历史，避免迟到重复回复冒充新请求。对象TTL到期后释放引用并发出`java-identity-history-lost`/partial，**当前脚本此后停止确定配对**，仍可记录方法事件；不会遗忘旧请求后重新猜配。已配对历史事件不被撤销。卸载后新的脚本是新的观测窗口，不能拼接跨窗口因果。

最多500次调用、256个对象、TTL1–120秒；预算不足明确标partial。重复pending/嵌套回复、未匹配回复、过期、停止导致未完成均留状态。对象历史计入预算，不能为了延长采集默默丢弃身份。按需要缩短采集窗口，卸载/关闭后再开始独立窗口。

当前真机已验证：普通Java两个异步请求在不同线程逆序回复；RNTester `getValueWithPromise(false)`→同Promise `resolve("result")`。尚未验证RN reject分支、JSI/Fabric完整路径、Hermes JS栈及`.then()`执行。

**已知兼容阻塞：** 当前Android16环境，Flutter `DartMessenger$Reply.reply(ByteBuffer)`回调原方法时触发JNI transition frame错误；Compose `SnapshotMutableStateImpl.setValue(Object)`和整数状态入口同样未通过。预取类句柄仍不能修复。不得对这些入口声明动态关联可用；没有因此升级Frida/server、禁用CheckJNI或全局去优化。普通Java/RN通过不能抵消这些失败。

## MAUI/Mono精确方法入口

`frida.trace-mono`为实验固定适配器，**只支持ARM64、已加载Mono、非泛型静态Int32方法，0–4个Int32参数，拒绝byref**。不支持实例/对象/字符串/浮点/结构体、CoreCLR、NativeAOT或IL2CPP。

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

group smoke默认等一条正常reply；测试配置可用smokeExpectedReplies验证两条逆序回复，或smokeExpectedReplies=0、smokeExitHook/smokeParentHook验证同线程嵌套，smokeObservedExitHook仅断言另一事件出现，不生成异步因果。只有两种等待条件之一成立才可通过。Compose样本构建成功不等于该动态验收通过。

需要root时仅使用此前授权目标，不自动启动/升级server，不改手机VPN/代理。原始开发现场可能被临时目录清理；本轮摘要、产物哈希与关键事件另存[动态验收证据](evidence/framework-dynamic-20261114.json)。Unity、Unreal、HarmonyOS NEXT继续暂缓。
