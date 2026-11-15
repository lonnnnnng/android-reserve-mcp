# Android Reserve MCP 路线图

核对日期：2026-11-15。公开基线是 `0.5.4`，MCP 对外保持 20 个顶层工具。路线图按“已经能交付什么、还缺什么、下一步先做什么”整理；候选能力不算完成，静态候选不等于运行时因果。

## 状态定义

- **已完成**：代码、文档和对应验收证据都已具备，可以作为当前能力使用。
- **部分完成**：有实现或样本证据，但版本、ABI、运行链或稳定性仍有限制。
- **待开发**：尚未形成可复用实现，不能在产品说明中承诺。
- **暂缓**：按当前安排不投入，不作为其他方向的发版门槛。

## 已完成

### MCP 与工程底座

- 20 个分组工具：doctor、apk、decode、dex、packages、managed、evidence、webview、search、resources、native、artifact、script、framework、device、frida、rebuild、jobs、artifacts、guidance。
- 本地 stdio 接入 Codex CLI、Claude Code、OpenCode、Pi；配置和验证记录见 [Agent 接入指南](AGENT-INTEGRATION.md)。
- `allowedRoots` 输入边界、独立 workspace、长任务队列、取消、超时、错误产物和分页读取。
- npm 包门、tarball 实装 smoke、20 工具握手和 57 项自动测试。

### 静态 Android 能力

- APK ZIP、Manifest、签名、DEX、ABI、SHA-256、资源和 smali 解码。
- APKS/AAB/split 集合的一致性、证书、长版本、依赖环和设备 spec 选择。
- Kotlin metadata、suspend/inline、精确 JVM/DEX 签名、协程状态机和有限 Compose 编译调用候选。
- XML `android:onClick` 声明候选、JavascriptInterface 声明、JS/TS/JSX/Flow 静态索引和 source map 坐标。
- ELF/JNI、Native 函数、引用、callers/callees、Go/Rust 元数据，以及有界 assembly store/ILSpy 链。

### 已验证的运行时能力

- Java 精确重载：参数、返回、异常、Java 栈和 Java→Native 同调用范围。
- Java 分组观测：同线程父子调用、跨线程对象身份、逆序回复、TTL/预算/歧义保护。
- RN Java Promise 边界：`getValueWithPromise(false)` 到同对象 `PromiseImpl.resolve("result")`，以及 `rejectPromise` 到同对象 `PromiseImpl.reject(...)`；可修改 fixture 已补 Hermes runtime stack 与 Java Promise 身份合并。
- Mono 实验适配：ARM64、已加载 Mono、非泛型窄 ABI，完成 MVID、MethodDef、JIT 入口回核；已覆盖 `int32`、`bool`、`long`、`float`、`string`。
- WebView/CDP：DOM、脚本、Network、正文和有界 initiator 栈；同一 scriptId 可连接脚本 SHA、AST 和请求。
- 持久证据图：内容哈希、运行调用 ID、JNI 对象身份、Mono 方法身份、CDP 采集来源和 JSON pointer。

## 部分完成

| 方向 | 当前状态 | 主要限制 |
| --- | --- | --- |
| Flutter | ARM64 AOT 与 channel 注册/handler 静态候选；vendor `NewLocalRef` typed bridge 在 POCO/ART36/Frida17.23.2 上完成 success/error、数组和压力验证；自有 R8 fixture 的 MethodChannel primitive/object 与 EventChannel `k5.a(Integer)` 多次回复均通过 | 任意 Flutter/Dart ABI、完整 R8 控制流合并和 VM service 仍未完成；跨设备/ROM本轮未执行 |
| Compose | Kotlin metadata、Composer、状态读写和调用点候选；POCO上自有 `mutableIntStateOf` 与 `derivedStateOf(state*2)` 点击→写入→重组三次通过；扩展 fixture 的导航、多状态和 `LaunchedEffect` coroutine 已由 MCP 多链 matcher 闭合 | 仅覆盖POCO/Android16/ARM64与自有样本；matcher 依赖显式 hook、正常返回事件和 fixture marker，不能外推任意 Compose 应用 |
| RN/Hermes | HBC84稳定；HBC99可显式实验反汇编；Java Promise resolve/reject边界通过；POCO debug inspector取得`scriptId=3`；自有新架构 APK 的 Cxx TurboModule/JSI、Android Fabric/codegen 以及显式 `JSI_CALL_ID→native marker→Fabric event→render sequence` 连续三次通过；第三方开放 inspector 探测和 fail-closed 证据已加入 | HBC99非正式兼容；任意生产APK静默注入、`.then()`、第三方完整JSI/Fabric事件图未完成；要求目标自行开放Metro inspector或提供可修改debug fixture |
| WebView | 自有拦截页面 initiator→scriptId→SHA/AST 已通过；公网单次请求曾通过 | 公网重复请求出现 pending；JS→Java业务因果、TWA、Service Worker专项未完成 |
| Native/JNI | 静态分析、JNI注册观测和此前延迟模块样本通过 | 当前环境重新 spawn Native hook 被 REA Gadget 条件阻塞，尚未完成稳定复验 |
| MAUI/.NET | assembly store、ILSpy、Mono窄ABI和NoInlining样本通过；POCO已捕获实例Int32、字符串和 bool 方法，long/float业务fixture也已执行且 Mono observer 已通过 | 原Release内联方法只定位不命中；array/object、CoreCLR、NativeAOT、复杂托管ABI未覆盖 |
| Godot | Godot 4.3/GDRE GDScript PCK fixture 已覆盖两个脚本、两个场景和资源引用 | 更多版本、C#、复杂场景资源图和自定义加密未覆盖 |

## 待开发清单

### P0：运行时安全与兼容性

这组门槛已在 POCO/ART36/Frida17.23.2 上完成本地验证；后续只在有第二台授权设备时扩展矩阵，不把当前单机结果泛化。

- 建立独立 Java/Compose/Flutter 最小复现矩阵：Android 版本、ART、Frida server、frida-java-bridge、REA transport、CheckJNI 状态。
- 分离“观测自身 JNI 操作”和“调用原 Java 方法”两个崩溃路径，形成可重复的最小失败脚本。
- 在不使用全局 deopt、不开启任意脚本的前提下，验证 bridge/server 版本组合、受控单方法 deopt、primitive-only fallback 和安全拒绝策略。
- 对可能触发 fatal JNI 的入口默认 fail-closed：返回 `partial`/`unsupported`，不能让目标进程崩溃。

**P0 完成门槛**：同一自有样本在目标 Android 版本上至少连续 3 次安装、观测、卸载通过；失败时目标进程不崩溃；报告能区分 unsupported、setup failure 和真实业务事件。

### P1：补齐主要 Android 桥接链

- Flutter：自有 fixture 的 primitive/object MethodChannel 与 R8 mapping→Dart 调用点回链已通过；下一步处理 EventChannel EventSink、更多 R8 合并分支和 Dart/VM service 调用点。
- Compose：primitive `MutableIntState`、多状态、导航和 coroutine 的自有 fixture MCP 多链已通过；后续转向对象状态、异步状态流和更多版本的显式 fail-closed matcher。
- RN：已完成可修改 debug fixture 的 Hermes inspector/CDP `scriptId` 到 TurboModule Java 入口证据链，以及自有新架构 APK 的 Cxx TurboModule/JSI 参数转换、Android Fabric/codegen 和显式跨层因果链；后续只研究第三方 APK 的安全探测，保持未开放应用 `partial/unsupported`。
- WebView：补 JS `fetch`/XHR 到 `JavascriptInterface` 的同会话关联；增加公网 pending、重定向、缓存、Service Worker 的分类报告。
- Native/JNI：在 REA Gadget 可用环境复验延迟模块、动态注册成功/失败/撤销和 Java→Native→返回链。

**P1 完成门槛**：每个链路都有真实样本、原始事件、明确终态和失败样本；不能仅以 UI 文本变化或静态候选通过。

### P2：扩展常见框架和运行时

- MAUI：已补自有实例整数/字符串和 bool 静态与真机业务结果 fixture，并在NoInlining APK上完成Mono实例Int32/字符串/bool动态观测；下一步才是复杂对象独立ABI实验、泛型共享、解释器入口、R2R/AOT映射，以及CoreCLR/NativeAOT分流。
- KMP：已用自有 fixture 编译 commonMain metadata、Android target 和 iOS Simulator framework，并发布到隔离 Maven 仓库；业务 Android App 已调用 shared `sharedNormalize` 并完成 UI/logcat/JADX 回链，下一步扩展真实业务结构和混淆样本。
- Lynx：bundle、codec、Native Module、JS runtime 和平台桥接。
- NativeScript：snapshot/metadata、JS↔Java/ObjC bridge、打包版本差异。
- Flutter：更多 Dart ABI、AOT 版本、VM service 和混淆映射。
- Godot：Godot 3/4 版本矩阵、C#、更复杂场景资源图和自定义字节码。

**P2 完成门槛**：每个新增适配器必须有版本识别、输入快照、预算、失败诊断、可复现实样本和证据图映射。

### P3：产品化和维护

- 继续维护四个 Agent 的配置示例和版本差异：Codex、Claude Code、OpenCode、Pi。
- 为工具 schema 生成简短机器可读能力清单，避免客户端只看到长描述。
- 增加不连接设备的框架回归矩阵和每次 release 的证据摘要。
- 统一报告中 `verified`、`partial`、`candidate`、`unsupported` 的语义和显示。
- 继续控制 npm 包内容，不包含 APK、DEX、SO、私有路径、设备日志和个人 Skill。

## 暂缓方向

以下方向由当前安排暂缓，不属于下一阶段阻塞项：

- **Unity**：等待自有 APK、匹配 `global-metadata.dat`/`libil2cpp`、AssetBundle 和版本环境后再恢复。
- **Unreal**：等待 Cooked Pak/IoStore、对应工程版本和必要 key 后再恢复。
- **HarmonyOS NEXT**：等待合法 SDK、匹配 ABC/ArkUI 工具、HAP/HSP/ABC 样本和设备后再恢复。

保留已有通用容器、Native、托管和 Ark 固定 CLI 适配，不把它们写成完整框架支持。

## 推荐下一步

1. **优先做当前静态缺口**：补生产混淆、多版本mapping和更复杂多DEX样本。
2. **继续做 Compose 动态链**：扩展 fixture 的导航、多状态和 coroutine 已接入 MCP 多链 matcher；下一步补对象状态、异步状态流和更多版本的受控失败样本。
3. **同步做 WebView 稳定性**：把公网 pending、缓存和 Service Worker 作为独立终态，不与脚本 initiator 关联混在一起。
4. **随后做 P2**：KMP 业务回链已通过，继续做真实业务结构/混淆样本；MAUI 做更广 ABI；Godot C# 等待匹配 .NET Editor 后再恢复。
5. **每个阶段结束再决定版本**：没有通过对应真实样本和失败样本门槛，就保留为 partial，不提升支持声明。

## 相关文档

- [能力矩阵](CAPABILITIES.md)
- [动态关联指南](DYNAMIC-CORRELATION.md)
- [验证记录](VALIDATION.md)
- [工具与用法参考](TOOL-REFERENCE.md)
- [框架缺口研究](ROADMAP-GAPS.md)
