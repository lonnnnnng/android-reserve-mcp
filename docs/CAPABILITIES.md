# 当前能力与适用范围

核对日期2026-11-15。GitHub Release为`v0.5.4`，npm `0.5.4`按本次交付命令发布；本表记录当前发行能力与限制。历史验证见[VALIDATION.md](VALIDATION.md)，调用见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)、[ENGINES.md](ENGINES.md)。

项目/npm/协议服务名均为android-reserve-mcp；OpenCode连接/主模式为android-reserve，工具前缀android-reserve_。共有20个分组入口：doctor、apk、decode、dex、packages、managed、evidence、webview、search、resources、native、artifact、script、framework、device、frida、rebuild、jobs、artifacts、guidance。入口内多种action不单独计工具；后端全部工具数不代表本服务工具数。

| 类型 | 当前实现与验证证据 | 未完成或不能据此保证 |
| --- | --- | --- |
| Java/APK/split/AAB/View | Manifest/签名/DEX/资源/重建，所选分包一致性/聚合，AAB模块派生/APKS设备spec；XML `onClick` 声明候选。Platform Samples 的 Views/Compose 模块与主 App 已构建，主 App 仅验到目录页启动 | `onClick`候选不证明DEX方法存在或运行；样例构建/启动不证明 View 事件还原；所有设备/按需模块完整性、加固/动态生成内容、原始工程恢复 |
| Kotlin/Compose/KMP Android目标 | 原始metadata、suspend/inline及精确DEX签名；工作树保留DEX偏移/被调签名，JetNews输出195类、242调用候选（partial）；自有Compose基础/derived链三次通过；扩展 fixture 在 POCO MCP 多链 matcher 中闭合点击→写入→重组/派生、多状态、导航 route write 和 coroutine；自有KMP业务App已实际调用commonMain `sharedNormalize`，APK UI/logcat与JADX静态调用点均回链到 shared code | 仅覆盖POCO/Android16/ARM64与自有样本；matcher 依赖显式 hook、事件返回和 fixture 业务 marker，不能泛化任意 Compose 应用；任意KMP publication/klib语义和业务App恢复仍不能泛化 |
| C/C++/NDK | ARM64函数/伪码/引用、导出或RVA观测、标准JNI未来注册/撤销、Java同调用范围；自有延迟加载SO此前完成等待与Native hook验收 | 本次候选重跑被REA拒绝spawn（jailbroken/Gadget能力条件），未能复验；全ABI/全JNI表、完整绑定快照/数据流/精确RVA栈 |
| 自定义loader | 自有DexClassLoader枚举、唯一selector、精确类与方法观测 | 所有未知loader或InMemory loader均能唯一选择、任意父委派结果 |
| WebView/JS混合 | JavascriptInterface声明/已知重载观测；CDP DOM/源码/Network/正文；官方样本取得公网200、454字节正文，复验又有pending超时；自有页面已验证initiator→同scriptId→源码SHA/AST | 网络稳定性、强制开启调试、完整插件注册/路由、JS异步→Java因果、TWA浏览器上下文 |
| RN/JS/TS/Hermes | AST/词法绑定/source map、HBC84；真实RNTester HBC99显式实验反汇编并强制partial；POCO debug inspector取得`scriptId=3`并将fixture Hermes stack与同次Java Promise reject身份配对；自有新架构 ARM64 fixture 在 Bridgeless/C++ connection 下完成 `JSI_CALL_ID→RN_NATIVE_MARKER→fabric-event-id→renderSequence`，连续三次通过；通用第三方探测器可对开放 inspector APK做身份和脚本采集 | HBC99正式兼容、debug元数据全面恢复、JS源码恢复、任意生产APK静默注入、任意第三方完整JSI/Fabric与`.then()`链、全部版本；第三方探测器没有开放 inspector 时返回unsupported，开放 inspector 也仅partial |
| Flutter | ARM64 AOT；自有 Flutter 3.50.0 release fixture 通过 R8 mapping→Dart 调用点→混淆后的 MethodCall/Result selector；POCO 上 primitive `transformInt(17)→54` 与 object `transformObject(Map)→LinkedHashMap` 均完成同对象动态回复，EventChannel UI与R8 `k5.a(Integer)`动态链均得到`1,2`并以同一sink对象关联 | 任意 Flutter/Dart ABI、完整 R8 控制流合并和 VM service 仍未完成；mapping 必须由调用者显式提供，不能从 UI 文本推断 |
| 托管/.NET MAUI | store v1/v2/v3、ELF符号/payload、LZ4/Zstd；真实MAUI10 APK→122程序集→88引用ILSpy；自有宽样本恢复静态实例整数/字符串方法，并在POCO UI得到`46:50:MAUI`；Mono精确签名/MVID/token/JIT回核现已捕获实例`2,7→50`、字符串`maui→MAUI`和 bool `IsPositive(7)→true` | 仍限ARM64/Mono、非泛型窄ABI；long/float observer已通过ARM64 GP/FP解码；array/object 等更广 ABI、CoreCLR、NativeAOT、复杂托管类型、内联方法或完整UI/异步因果未覆盖 |
| Godot | GDRE/Godot4.3编译两个GDScript并恢复两个场景引用，PCK七成员清单和脚本语义通过 | 更多版本/C#、复杂场景资源图、未知加密格式 |
| Unity/Unreal/HarmonyOS NEXT（暂缓） | 保留通用容器/Native/托管层与IL2CPP/Ark固定CLI适配；2026-11-14起短期不推进专项 | 专用引擎/真实产物、资源/Blueprint和NEXT完整链仍未验收；移出当前迭代及发版门槛，恢复需用户明确安排 |
| Lynx/NativeScript/uni-app/Taro/低代码 | 按实际JS/DEX/Native/Web资产分流复用 | 专用codec/snapshot/UTS、多target及完整框架专项 |
| 跨任务证据 | 内容哈希、显式source map坐标、inventory容器成员结构、Kotlin精确签名、View声明候选、Compose编译调用候选、JS词法绑定、fixture提供的Hermes调用栈/CDP `scriptId`/JNI对象身份、Mono运行时方法回核、CDP initiator/scriptId与采集SHA | source map与bundle构建身份、全程序图、按相同PID/时间/RVA猜调用关系、无来源的自动跨层关联；RN链仍限debug fixture |

新增action、依赖、预算与兼容阻塞见[DYNAMIC-CORRELATION.md](DYNAMIC-CORRELATION.md)。运行观测要求明确设备与目标。POCO F2 Pro Android16上，公开样本验到JetNews详情导航、Flutter MethodChannel返回、RNTester启动、Platform Samples目录页和WebView单次公网响应。WebView复验有超时；MAUI初次启动失败，最终自有APK运行返回46。应用交互与MCP分析分别记录，详情见CURRENT-INCREMENT。不会自动安装目标、开启调试、提权或生成绕过脚本；raw load由调用者负责。

静态候选、声明、机器码伪代码、运行事件和内容同一性分别标记；能解包或CLI能启动不等于完整框架恢复。已有源码可交给客户端内置文件工具阅读，不属于MCP已恢复原工程的证据。
