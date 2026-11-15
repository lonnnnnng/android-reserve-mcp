# 0.5.4 动态关联与 fixture 扩展进展

核对日期：2026-11-15。GitHub Release为`v0.5.4`，npm `0.5.4`按本次交付命令发布。本页记录本次动态关联、fixture扩展和回归证据，MCP仍为20个分组入口。

## 动态关联新增

调用配置、环境、预算与兼容失败见[DYNAMIC-CORRELATION.md](DYNAMIC-CORRELATION.md)，关键事件/产物哈希见[evidence/framework-dynamic-20261114.json](evidence/framework-dynamic-20261114.json)。

| 范围 | 当前实际结果 | 不能扩大为 |
| --- | --- | --- |
| 通用Java | 两请求不同线程逆序回复47、46，JNI对象身份对应正确；同线程inner调用父子关系；TTL丢失身份后停止确定配对 | 任意对象复用/不可见旧请求都可区分、全程序异步图 |
| RN | POCO 真机 RNTester：`getValueWithPromise(false)`→同Promise `resolve("result")`；`rejectPromise`→同Promise `PromiseImpl.reject(...)`；隔离 fixture 主动捕获 Hermes `new Error().stack`，运行时出现 `rejectPromise`/`onPress` bundle 行列并与 Java Promise 身份合并；自有新架构 ARM64 APK 的 Cxx TurboModule/JSI 与 Android Fabric/codegen 视图命令→原生事件/重渲染通过；新增显式 `JSI_CALL_ID`、C++ `RN_NATIVE_MARKER`、Fabric `fabric-event-id` 和单调 `renderSequence`，修正后的 APK 在 POCO 连续三轮通过；通用第三方探测器对官方 RNTester APK自动发现 inspector、`scriptId=3` 和 `Bridgeless [C++ connection]`，点击后只保留同设备 debug session 边 | CDP `scriptId`、任意第三方 APK 静默注入/回溯、任意第三方完整 JSI/Fabric 事件图；通用探测器在无开放 inspector 时 fail-closed，开放 inspector 也不猜原生因果 |
| MAUI | 原Release定位ReserveAdd至AOT RVA0x45d0但无调用；NoInlining样本经Mono完整签名/MVID/token/JIT回核捕获静态/实例Int32与字符串结果（`2,7→50`、`maui→MAUI`） | 原APK内联方法覆盖、复杂托管ABI/CoreCLR/NativeAOT |
| WebView | 真实fetch的CDP initiator→本会话scriptId→采集SHA→静态AST；自有HTTPS拦截正文result46 | 新的公网稳定性成功或JS→Java跨会话因果 |
| Flutter/Compose | 自有 Flutter fixture 已完成 primitive/object MethodChannel 动态配对和 R8 mapping 类/字段投影；EventChannel matcher 已支持同一 EventSink 的多次回复保留，并在 R8 `k5.a(Integer)` 上完成 `1,2` 动态链；Compose整数状态、`derivedStateOf(state*2)` 和扩展 fixture 的导航/多状态/LaunchedEffect 均已在 POCO 通过 MCP 多链 matcher，验证 `click→write→render→derived`、多状态两次写入、`home→detail` route write、导航后 render 和 coroutine completion | 仅覆盖 POCO/Android16/ARM64 与自有 fixture；MAUI long/float observer已通过ARM64 GP/FP解码，array/object仍未投影；跨设备/ROM矩阵本轮跳过 |

原Java/JNI重载、同调用Java46/JNI9、异常、unload/spawn回归通过；trace-jni外置workspace实际编译通过。Unity/Unreal/HarmonyOS NEXT仍暂缓。以上内容已纳入`0.5.4`发行快照。

## 前次静态增量与边界

| 专项 | 本轮已验证 | 仍未完成 |
| --- | --- | --- |
| Flutter | framework.channels核对APK两份ARM64库与Blutter来源任务SHA；匹配battery/getBatteryLevel的Dart实参入栈模板、smali注册对象和handler比较，并写证据图 | 始终partial/static-protocol-candidate；不是运行因果、完整数据流、返回值恢复或R8合并分支证明；EventChannel仅对象池识别，其他ABI/版本/VM service待做 |
| RN/Hermes | HBC99显式allowExperimental反汇编，真实RNTester输入1,733,312字节、输出20,033,939字节hasm，进程0；HBC84回归成功；新增自有新架构 APK 的 Cxx TurboModule/JSI 与 Android Fabric/codegen 真机 smoke | 上游仍警告not formally supported，强制partial；debug metadata未验证，不是JS源码恢复；97/98未实样覆盖、100拒绝；任意第三方APK自动注入/回溯和完整JSI/Fabric事件图仍不支持 |
| WebView公网 | POCO Android16/WebView156，官方weather.json GET收到HTTP200/h2，非磁盘缓存且finished；正文454字节，SHA256 665a9a783d6be9590a8fecb045a00abde2a2e3a8995abd8e48afb95f7919501e | 后续同URL复验60秒内仍pending，失败现场保留。单次成功不保证网络稳定；SW/cache、插件与TWA专项待做 |
| Compose | 修复包过滤前依赖耗尽预算；JetNews遍历20,568类、匹配548类、输出195类和242个带DEX偏移/被调签名的候选；自有真实编译smoke通过 | JetNews约49,989指令触及50,000预算，报告partial；没有恢复完整状态数据流、重组、导航或运行事件因果 |
| MAUI | 私有.NET10安装maui-android；真实MAUI10 ARM64 Release APK→ELF payload→v3 store→122程序集→LZ4→88同包引用→ILSpy；恢复页面及ReserveAdd(a,b)=a+b+37；全新目录关闭MarshalMethods后，真机按钮返回46，同一APK静态链再次通过 | 第一份APK的n_onCreate绑定失败与后续构建失败留档；不推断MarshalMethods为唯一根因。其他runtime与AOT/NativeAOT关联待做 |

## 调用方式

先用framework.analyze/flutter生成Blutter任务；再于同一workspace调用framework，action=channels、engine=flutter、path=APK、analysisJobId=完成的Blutter UUID，可选mappingPath。mapping缺失时不猜混淆setter；mapping SHA保留，构建匹配仍标caller-supplied-build-match-unverified。

HBC97–99用framework.analyze/hermes加allowExperimental=true。ILSpy可传referencePath显式DLL目录。下面开发验收脚本提供完整断言：

- node scripts/flutter-channels-smoke.mjs APK WORKSPACE AOT_JOB_ID MAPPING_OR_DASH CHANNEL METHOD
- node scripts/hermes-experimental-smoke.mjs HBC WORKSPACE
- node scripts/webview-public-smoke.mjs SERIAL TEST_PACKAGE EXPECTED_HTTPS_URL WORKSPACE
- node scripts/maui-apk-smoke.mjs APK STORE_MEMBER ASSEMBLY MARKER WORKSPACE
- node scripts/maui-owned-build.mjs NEW_SAMPLE_DIRECTORY（macOS自有net10 Android样本，需要私有SDK已安装maui-android；不安装到设备）
- npm run smoke:kotlin / smoke:hermes / smoke:store

channels只支持ARM64固定模板和线性寄存器候选；APK先快照，最多1GiB、目录20,000项、声明展开1GiB，库/DEX单项256MiB累计512MiB；文本单项16MiB累计128MiB，AOT4000文件/smali20000文件，每类结果10000项；拒绝链接。不是任意控制流分析。

ILSpy引用只取顶层普通DLL，最多4096目录项，单DLL128MiB累计512MiB，快照并留SHA。按store报告name恢复顶层引用名；文化子目录的resources DLL不能直接扁平化。缺引用/坏IL源码诊断令任务partial。不会执行程序集。

公网smoke对显式测试App调用Page.reload驱动请求；MCP不增加任意CDP执行。设备只用授权POCO 31936bb6，未改VPN/代理，不操作另一台手机。

## 证据定位

均为临时开发文件，系统清理后可能消失，不随npm发布。公开样本commit/APK输入哈希沿用SAMPLE-VALIDATION.md。

- 根目录：/tmp/android-reserve-open-samples-20261114/。
- Flutter：mcp-work/jobs/f1b84064-5d2f-49a7-8b70-12a4bd2a0cef/；AOT任务c93d242e-1d54-448c-bb2d-623b564b7a6f。来源pp.txt:9047、asm/platform_channel/main.dart:352、smali/F/f.1.smali:2847、smali/C/b.smali:7686。
- HBC99：hermes99-final/jobs/76018741-1f21-4bbe-82c1-6237466d3b75/；输入SHA256 8e198ac81121e85fe9e2036407585ac4967627ef6d5b01d91d054a5e4aaa70d9。
- WebView成功：webview-public-mcp/validation.json；network job 944f13e3-4f3b-4847-bbc3-2ff7a05c7ae0。后续失败：webview-public-final/validation.json，60秒pending超时。
- JetNews：jetnews-kotlin-work/jobs/2ee73b26-9fe2-4cf3-a503-48576093f334/；最初0类失败报告保留，修复后195类。
- MAUI：/tmp/android-reserve-maui-owned-20261114/validated-static-release.apk，17,700,636字节，SHA256 7e9a6939c6c033e754327a0ed5a9ecfa465e51f2b242b9a709df85f3d2c980d2；同根apk-mcp-work/validation.json包含artifact/store/ILSpy三任务。
- MAUI store版本0x80010003，122项；ReserveMaui.dll提取SHA256 fadf0e0bd43e8119ad1bb9ea427d47320790e4b3666ac36316ab4a6ec0a2ec73；初次运行失败runtime-failure.log。SDK/workload只在用户私有engines/dotnet10（约4GiB），全局.NET未改。
- MAUI最终样本：/tmp/android-reserve-maui-runtime-20261114/bin/Release/net10.0-android/android-arm64/com.companyname.reservemaui-Signed.apk，SHA256 57847fa6134ab32c1ac9e45ea49bd591216f150750b357028ab52e9687345235；result-window.xml显示RESERVE_MAUI_REAL_V05: 46。MCP链在/tmp/android-reserve-maui-runtime-analysis-20261114/validation.json，store任务b7d8a537-030b-4a20-9834-0222b69b70da、ILSpy任务4930aee5-0265-4207-ab77-fe2738c94089。应用交互与MCP静态分析分别断言，不等于MCP已关联托管运行调用。

## 当前待办

- 当前 Compose 扩展 MCP 多链已通过；后续深化对象状态、异步状态流和受控失败样本，同时继续维护 WebView 网络稳定性。RN自有 fixture 的完整 JSI/Fabric 因果已通过，第三方仍保持只读 debug-session 策略。
- Flutter 自有 fixture 证据见 `output/flutter-owned-bridge-20261115/evidence.json`：R8 `MethodCall→zb`、`Result→ac`、`success→b` 的 mapping 已接入动态 selector；primitive/object 两条链在 POCO 通过。EventChannel 动态证据见 `output/flutter-owned-bridge-event-20261115-pass/validation.json`，R8 `k5.a(Integer)` 对同一 EventSink 的 `1,2` 回复已关联。
- KMP 业务 App fixture 证据见 `output/kmp-business-20261115/evidence.json`：`MainActivity.onCreate -> SharedApiKt.sharedNormalize` 在 JADX 静态结果、POCO UI 和 `KmpOwned` logcat 中均得到 `KMP_SHARED:VALUE:ANDROID`。
- MAUI bool ABI 证据见 `output/maui-bool-20261115/validation.json`：NoInlining `ReserveMaui.App:IsPositive(int)` 在 POCO 捕获参数 `7` 和返回 `true`，UI marker 为 `RESERVE_MAUI_DYNAMIC_V06: 46:50:MAUI:True`。
- EventChannel 动态证据见 `output/flutter-owned-bridge-event-20261115-pass/validation.json`：R8 `ReserveEventStreamHandler.onListen(Object,j5)` 保存 `k5` sink，`k5.a(Integer)` 连续回复 `1,2`，均通过 `jni-isSameObject` 关联。
- Compose 扩展 fixture 的 UI/logcat 快照见 `output/compose-extended-20261115/evidence.json`；MCP 多链动态验收见 `output/compose-extended-mcp-20261115/three-runs.json`。POCO 上三轮每轮 70 个事件闭合 `click→write(1)→render(1)→renderDerived(2)`、`multi→write(2/15)→render(2)→renderDerived(4)`、`navigate→routeWrite(detail)→render(2)` 和 coroutine completion，并通过卸载、PID 与 ArtMethod 恢复校验。
- MAUI long/float 动态证据见 `output/maui-long-float-dynamic-20261115/evidence.json`：`LongAdd(2,7)→50` 与 `FloatScale(2)→3` 已在 POCO 通过 Mono observer，long 使用有符号字符串、float 使用 ARM64 FP 上下文。
- MAUI宽样本已加入实例整数/字符串参数并在POCO上得到`46:50:MAUI`；KMP自有fixture已编译commonMain metadata、Android target、iOS Simulator framework，并发布到隔离 Maven 仓库取得 metadata/klib/pom/module；Godot fixture已扩展为两个 GDScript、两个场景和七个 PCK成员。MAUI long/float/array/object等更广运行时ABI、KMP更复杂业务结构/混淆回链、Lynx codec、NativeScript snapshot、更多Dart/ABI、Godot C#/版本仍属未完成项。
- RN 自有新架构 fixture 已在 POCO `31936bb6` 上构建、安装并通过 `scripts/rn-cxx-jsi-fabric-smoke.mjs`；证据见 `output/rn-cxx-jsi-fabric-20261115-run7/evidence.json`。构建使用 RNTester `-PnewArchEnabled=true`、CMake 3.22.1，验证 Cxx TurboModule JSI 参数转换与 `RNTMyNativeView` Android Fabric/codegen 命令/属性事件；不扩大为任意第三方 APK 自动注入或通用恢复。
- 通用第三方探测器 `scripts/rn-third-party-probe.mjs` 已在 POCO 官方 RNTester APK 上取得 `scriptId=3`、Metro capabilities 和点击后的 `partial` 证据；见 `output/rn-third-party-probe-20261115-tap2/evidence.json`。它不会向未开放 inspector 的 APK 注入脚本，也不会把 UI 变化升级成 JSI/Fabric 原生因果。

## 暂缓方向

2026-11-14按用户决定，Unity、Unreal、HarmonyOS NEXT短期不再推进，不属于当前迭代待办、发版门槛或阻塞项。保留历史研究、通用能力及已有IL2CPP/Ark固定CLI适配，不删除代码、不提升支持声明；只有用户明确恢复后才重新评估专项。Godot不在本次暂缓范围。

| 暂缓方向 | 保留的未验证边界 | 恢复时再准备的条件 |
| --- | --- | --- |
| Unity | IL2CPP真实引擎/产物、Mono与IL2CPP分流、资源关联未验收 | 可用Editor/导出环境、自有APK、同构建metadata/libil2cpp/AssetBundle |
| Unreal | Pak/IoStore、资源/Blueprint专项解析尚未实现 | 自有Cooked产物、对应工程/版本、加密时必要的已知key |
| HarmonyOS NEXT | SDK/ABC/ArkUI与设备链未验收，现有Ark适配不代表NEXT支持 | 合法SDK、匹配ark_disasm、真实HAP/HSP/ABC和设备；OpenHarmony旧样本或ADB不能代替 |

## 源码核对与回归

.NET Android载荷与索引定义核对上游commit f3c3354f71245976607801c657f6c3d1e39a3529 的 tests/Utilities/AssemblyStore/Utils.cs（符号优先、缺符号时payload节）与StoreReader_V2.Classes.cs（索引9/13字节）；固定正文已读取，未复制上游实现到本包。

前次静态增量自动测试45项通过，JS/Python语法检查通过；HBC84、Kotlin/Compose与store回归通过。`0.5.4` tarball 实装握手 20 工具/doctor 通过，包清单不含缓存/引擎/样本二进制/私有路径。

最终包清单55个源码/文档文件。新增maui-owned-build.mjs已在全新目录/tmp/android-reserve-maui-repro-20261114独立构建通过（42.58秒，两个JDK版本识别警告、零错误）；没有将该复现APK再次安装手机。已验收的MAUI/WebView测试App均force-stop，ADB forward无本轮残留。

本轮没有安装Unity/Unreal闭源Editor，也没有把容器识别或CLI探测计为框架支持。
