# 稳定性与分析闭环推进

日期：2026-11-15。当前发行版为0.5.4。本轮按稳定性、诊断验收、静态与动态闭环、回归后扩展的顺序推进。完整目标仍在执行，不能以本页已完成的底座替代框架动态闭环。

## 已落地的稳定性修复

| 问题 | 当前实现 | 验证方式 |
| --- | --- | --- |
| 已知JNI崩溃入口仍被注入 | 固定兼容规则在actions、编译器与helper启动时检查；返回unsupported/partial及java_compatibility_blocked；拒绝发生在编译和进程占位之前 | 三个精确入口的单方法/分组拒绝、零load调用、零编译、无占位；helper直接调用同样拒绝 |
| 多实例把活跃任务写成interrupted | 任务记录instance UUID/PID/ps进程代次；外部读取不写回，不取消其他实例任务；只在拥有者已结束时派生interrupted，旧身份未知则保留原状态并注明未确认 | 活跃双实例、实际进程退出、旧格式、磁盘原件不变 |
| 逆序证据合并丢失请求终态 | 保留每个请求的有界来源快照；旧pending不覆盖终态，矛盾终态明确partial；正文哈希接到同CDP请求 | 真实Jobs生成两份报告后正反序合并；成功/失败冲突；来源和正文边 |
| 启动/取消/退出无完整期限 | 启动握手45秒、单次REA任务总期限600秒、任务退出10秒、各会话/资源清理默认5秒；不响应取消的操作仍返回未确认诊断 | 连接中取消、共享握手、晚到连接、不响应信号的握手/请求/退出、父CLI退出后的进程组 |

任务状态中的interrupted只说明任务拥有者不再活动，不证明其子进程或设备hook已经清理。退出开始和最终结果以原子替换方式写在workspace的shutdown-INSTANCE.json；state=closing或closed=false均表示清理未确认。WebView继续保留独立forward账本。服务不根据遗留账本自动接管或重新注入。

## 深度诊断与完整安装

默认doctor保留路径检查行为。deep=true返回任务，实际执行以下三项：

1. 独立子进程导入宿主Frida binding，不枚举或附加设备。
2. 实际编译Math.abs(int)固定Java观测模板，记录编译器、bridge实现与bundle SHA256。
3. 握手固定REA并核实所需Android/Frida工具，不打开目标APK或设备。

```json
{"tool":"doctor","arguments":{"deep":true,"timeoutSeconds":90}}
{"tool":"jobs","arguments":{"action":"status","jobId":"<doctor返回的id>"}}
```

单项failed或skipped使报告partial。REA显式禁用时深度检查不会绕过该设置。版本字符串之外保留实现哈希，因为不同bridge提交可能沿用同一个版本号。

smoke:release继续承担基础协议门；smoke:release:full在隔离目录安装实际tarball和REA6.9.0，核实lock路径、版本与integrity后只批准并rebuild宿主Frida17.26.3和REA Frida17.23.2，随后执行真实深度检查，并在客户端关闭后核对shutdown终态。临时路径先realpath归一，避免macOS /var和/private/var别名影响npm lock。报告和原件保留在输出目录；Ubuntu/macOS完整安装CI已配置，远端执行结果另行核验。

## 当前验证与边界

- 当前0.5.4工作树通过113项自动测试、JS/Python语法检查、94项发布清单与git diff检查；稳定性回归覆盖真实进程退出、孙进程、登记/退出并发、失败清理重试、旧sidecar未清理时阻止新连接和CLI重复退出信号。
- 当前0.5.4 tarball完成实际完整安装，三个深度检查均verified，REA6.9.0实际列出255个后端工具；本MCP仍为20个分组入口。客户端关闭后shutdown账本为finished/closed=true。DEX/Kotlin真实smoke和两个Java helper的固定JADX SHA编译也通过。
- 当前发布清单包含94个源码/文档文件（含vendor typed bridge、Compose链判定模块和RN inspector判定模块）；两套Frida原生binding均在独立子进程实际导入成功。首次深度检查遇到frida-compile默认入口缺失，已改用实际dist/cli.js入口；失败原件保留。完整归档见 `output/stability-20261115/final-validation.json`，旧动态现场的哈希与边界仍见[本轮验证证据](evidence/stability-20261115.json)。
- POCO 真机复验确认 Flutter `onMethodCall(MethodCall, Result)` 在 `IsInstanceOf`、`MethodChannel` reply 在 `CallNonvirtualVoidMethod` 触发 fatal JNI transition；新增 fail-closed 保护后同一 APK 在注入前返回 `java_compatibility_blocked`，拒绝后 PID 仍存活。更完整的 Android16 `ArtClass` 固定布局候选已让普通 Java 返回 46，但 Flutter reply 仍崩溃；旧 class-model 叠加候选在 provider 加载阶段断开，均未启用。完整现场见 `output/jni-compat-20261115/flutter-compatibility-20261115.json`。
- 进一步的隔离修复实验把根因收敛到 bridge callback 入口的 `jobject` 生命周期：ART 传入的 `kJniTransition` 原始引用被 `handleMethodInvocation` 直接带入 `fromJni -> factory.cast -> IsInstanceOf`，原方法转发也复用它进入 `CallNonvirtual*`；CheckJNI 不把它当作稳定的 local/global ref，而是在这两个检查点拒绝。入口先对 receiver 和对象/数组参数执行同一 `JNIEnv` 的 `NewLocalRef`，并保持 primitive 参数原路径后，POCO 上 `transformInt(17) -> success(54)`、`transformInt(-17) -> error(NEGATIVE_INPUT, ..., -17)`、Compose `setIntValue(int)` 和 receiver retain 对照均通过；Flutter success/error 各完成三轮，另做了 success/error 各 8 次并触发 trim pressure，均保持 reply、进程、恢复和清理通过。新增的 `ArrayList` 对象同步/跨线程回复和真正的 `typedArrayEcho([Ljava.lang.String;)` 签名也通过。现在 typed bridge 已纳入 `vendor/frida-java-bridge`，正式入口在 POCO/ART36/Frida17.23.2 上 `experimental=false` 并返回54；证据、bridge SHA `0343150a2f1670490a965e560bf9df888486fe1fff10258eec64f925b80b74d3` 见 `output/jni-compat-20261115/flutter-compatibility-20261115.json`。本轮不扩展跨设备/ROM支持。
- 同一主工作树在 POCO 上的普通 Java/JNI 基线重新通过：重载、Java46/JNI9关联、异常、unload、spawn均成功；Android16旧6.3.6候选因 `jssha/dist/sha1` 缺失在注入前编译失败，未把依赖问题误记为运行兼容结果。
- Compose自有 `mutableIntStateOf` 样本在同一POCO、同一APK、坐标 `(235,337)` 连续三次完成 `onClick → setIntValue(1) → Content/getIntValue(1) → rendered(1)`；三次均保持PID、卸载清理和ArtMethod恢复。聚合证据见 `output/jni-compat-20261115/compose-three-runs.json`。
- RNTester `rejectPromise` 在同一POCO实际完成 `getValueWithPromise(true) → PromiseImpl.reject(...)`；`request` 与 `reject` 共享 `jni-isSameObject` Promise身份，原方法正常返回，UI显示错误消息。静态调用点和构建哈希见 `output/rn-reject-run2/evidence.json`；可修改 fixture 的 Hermes runtime stack 另见 `output/rn-stack-java/evidence.json`。
- 隔离 RNTester fixture 在 `rejectPromise` JS 调用点主动保存 Hermes `new Error().stack`，同一 UI 触发中得到 `rejectPromise`、`onPress` 和 bundle 行列，并与 Java 同 Promise reject 合并；证据见 `output/rn-stack-java/evidence.json`。该方案要求自有/可修改 JS fixture，未扩展为任意第三方 APK 自动注入。
- RN debug inspector实验在POCO上通过 Metro `/json/list`、`/inspector/debug`和`Debugger.scriptParsed`取得`scriptId=3`，并与同次Java `PromiseImpl.reject`身份配对；自有新架构 APK 另通过 Cxx TurboModule/JSI 与 Android Fabric/codegen smoke，证据见 `output/rn-hermes-cdp-scriptid/merged-evidence.json` 和 `output/rn-cxx-jsi-fabric-20261115-run7/evidence.json`。这些链要求Metro inspector或可修改新架构 fixture，不代表任意第三方APK自动注入。
- MAUI宽ABI自有 fixture 已完成 artifact/store/ILSpy 静态链，并在 POCO UI 执行实例整数与字符串方法，结果为 `RESERVE_MAUI_DYNAMIC_V06: 46:50:MAUI`；同构建NoInlining APK上 Mono 动态 observer 已分别捕获 `InstanceAdd(2,7)→50` 与 `Normalize("maui")→"MAUI"`，证据见 `output/maui-wide-static-20261115/mono-instance-runtime3/validation.json` 和 `output/maui-wide-static-20261115/mono-normalize-runtime2/validation.json`。
- KMP自有 fixture 已分别编译 `commonMain` metadata、Android target 和 iOS Simulator framework，并发布到隔离 Maven 仓库，证据见 `output/kmp-owned-20261115-publication/evidence.json`。这验证自有 publication/klib 输入身份边界，不代表业务App共享代码回链。
- Compose `derivedStateOf(state*2)` 样本在同一已安装 APK、同一 POCO 上连续三次观察到同一点击后的 `rendered(1)` 与 `renderedDerived(2)`，三轮均通过 PID、清理和 ArtMethod 恢复；单轮详细事件见 `output/jni-compat-20261115/compose-derived.json`，三轮聚合见 `output/jni-compat-20261115/compose-derived-three-runs.json`。
- Compose 扩展 MCP 多链在 POCO 上通过：先清理 fixture 状态，再用三次真实 ADB tap 驱动 increment、multi-state、navigation，三轮各 70 个事件闭合基础状态写入/渲染派生、多状态两次写入、`routeWrite(detail)`、导航后重渲染与 coroutine completion；每轮关键 enter 均有正常 return、同一 trace，随后完成卸载、PID 和 ArtMethod 恢复校验。详细报告见 `output/compose-extended-mcp-20261115/three-runs.json`。
- 独立核验补修了退出与任务登记并发、握手失败清理丢失、Native失败打开的清理所有权、累计产物来源以及专用索引截断标记；回归覆盖同一清理的明确重试。
- 真机调试只使用用户指定 POCO_F2_Pro，序列号 `31936bb6`，当前 Android 16/ARM64；跨设备/ROM 回归按当前条件明确跳过，未对另一台手机进行写操作。

## 继续推进的完整范围

| 顺序 | 待完成内容 | 不能替代的验收 |
| --- | --- | --- |
| 静态闭环 | DEX/Kotlin 已贯通mapping、完整raw方法ID/prototype、所选分包查询与原始DEX来源身份；已补生产形态R8 2.2多DEX重复raw类section回归 | 尚未接入真实生产APK、多版本mapping和更复杂loader；当前自有DEX/APKS/Kotlin smoke与生产形态夹具不能泛化为所有版本 |
| 动态兼容 | `NewLocalRef` typed bridge 已 vendor 化并在 POCO/ART36/Frida17.23.2 正式入口验证；typed array/error 压力也已在该 tuple 完成 | 当前 verified 只覆盖精确 bridge/ART/Frida tuple；跨设备/ROM 矩阵本轮按条件跳过 |
| 主要动态链 | Compose点击→状态→重组三次通过，`derivedStateOf` 也连续三次通过；扩展 fixture 的导航/多状态/coroutine MCP 多链已通过；RN reject已完成 debug fixture 的 Hermes `scriptId`、JS stack 与 Java Promise 身份关联；Flutter当前已定位为兼容门阻塞 | 第三方APK自动注入、Compose任意第三方应用的通用语义恢复；跨设备/ROM回归本轮显式跳过 |
| 回归与扩展 | 每条动态链连续三次通过，失败时目标存活、卸载无残留；随后MAUI/KMP/Godot | 依次通过对应门槛后扩展；Unity/Unreal/HarmonyOS NEXT仍暂缓 |

固定REA6.9.0的Android provider只接受单APK，其schema不接收descriptor或APK数组；新增选择和mapping投影必须由本适配器负责。分包应复用已验证快照并保留APK SHA、成员、DEX entry与原始method index，重复定义明确歧义。

兼容候选来自维护者合并的[bridge PR398](https://github.com/frida/frida-java-bridge/pull/398)，固定commit302a588881b40cba300bcf3acfd35deeb3888ee5。其公开验收针对Android17；POCO Android16实测仍在 `IsInstanceOf` 和 `CallNonvirtualVoidMethod` 处失败，不能宣称该候选已修复本机组合。实际JNI transition失败位置仍须按对应原件区分NewGlobalRef、IsInstanceOf与原方法回调。
