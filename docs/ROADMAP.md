# Android Reserve MCP 路线图

核对日期：2026-11-14。当前代码和验证基线是 `0.5.3`，MCP 对外保持 20 个顶层工具。路线图按“已经能交付什么、还缺什么、下一步先做什么”整理；候选能力不算完成，静态候选不等于运行时因果。

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
- RN Java Promise 边界：`getValueWithPromise(false)` 到同对象 `PromiseImpl.resolve("result")`。
- Mono 实验适配：ARM64、已加载 Mono、静态非泛型 `int32`，完成 MVID、MethodDef、JIT 入口回核；NoInlining 样本捕获 `2、7 -> 46`。
- WebView/CDP：DOM、脚本、Network、正文和有界 initiator 栈；同一 scriptId 可连接脚本 SHA、AST 和请求。
- 持久证据图：内容哈希、运行调用 ID、JNI 对象身份、Mono 方法身份、CDP 采集来源和 JSON pointer。

## 部分完成

| 方向 | 当前状态 | 主要限制 |
| --- | --- | --- |
| Flutter | ARM64 AOT 与 channel 注册/handler 静态候选 | Reply 动态注入在当前 Android 16/Frida 组合触发 JNI transition 崩溃 |
| Compose | Kotlin metadata、Composer、状态读写和调用点候选 | 状态入口动态观测触发同类 JNI transition 崩溃；没有完整重组/事件图 |
| RN/Hermes | HBC84稳定；HBC99可显式实验反汇编；Java Promise边界通过 | HBC99非正式兼容；Hermes JS栈、`.then()`、reject、JSI/Fabric未完成 |
| WebView | 自有拦截页面 initiator→scriptId→SHA/AST 已通过；公网单次请求曾通过 | 公网重复请求出现 pending；JS→Java业务因果、TWA、Service Worker专项未完成 |
| Native/JNI | 静态分析、JNI注册观测和此前延迟模块样本通过 | 当前环境重新 spawn Native hook 被 REA Gadget 条件阻塞，尚未完成稳定复验 |
| MAUI/.NET | assembly store、ILSpy、Mono窄ABI和NoInlining样本通过 | 原Release内联方法只定位不命中；CoreCLR、NativeAOT、复杂托管ABI未覆盖 |
| Godot | Godot 4.3/GDRE GDScript PCK样本通过 | 更多版本、C#、复杂场景引用和自定义加密未覆盖 |

## 待开发清单

### P0：运行时安全与兼容性

这是下一阶段的首要工作，因为它同时影响 Flutter、Compose 和对象型 Java 观测。

- 建立独立 Java/Compose/Flutter 最小复现矩阵：Android 版本、ART、Frida server、frida-java-bridge、REA transport、CheckJNI 状态。
- 分离“观测自身 JNI 操作”和“调用原 Java 方法”两个崩溃路径，形成可重复的最小失败脚本。
- 在不使用全局 deopt、不开启任意脚本的前提下，验证 bridge/server 版本组合、受控单方法 deopt、primitive-only fallback 和安全拒绝策略。
- 对可能触发 fatal JNI 的入口默认 fail-closed：返回 `partial`/`unsupported`，不能让目标进程崩溃。

**P0 完成门槛**：同一自有样本在目标 Android 版本上至少连续 3 次安装、观测、卸载通过；失败时目标进程不崩溃；报告能区分 unsupported、setup failure 和真实业务事件。

### P1：补齐主要 Android 桥接链

- Flutter：先完成稳定的 MethodChannel primitive 参数/返回链，再处理对象、EventChannel、R8 合并和 Dart 调用点回链。
- Compose：优先用 primitive `MutableIntState` 和明确按钮回调，验证点击→状态写入→重组回调；之后再扩展对象状态和 coroutine。
- RN：补 reject 分支、Promise 重复结算、Hermes JS 调用点到 TurboModule Java 入口的证据链；保持 HBC99 partial。
- WebView：补 JS `fetch`/XHR 到 `JavascriptInterface` 的同会话关联；增加公网 pending、重定向、缓存、Service Worker 的分类报告。
- Native/JNI：在 REA Gadget 可用环境复验延迟模块、动态注册成功/失败/撤销和 Java→Native→返回链。

**P1 完成门槛**：每个链路都有真实样本、原始事件、明确终态和失败样本；不能仅以 UI 文本变化或静态候选通过。

### P2：扩展常见框架和运行时

- MAUI：实例方法、字符串/对象参数、泛型共享、解释器入口、R2R/AOT 映射，以及 CoreCLR/NativeAOT 分流。
- KMP：`commonMain`/klib 与 Android target 的身份关联，区分共享代码和平台实现。
- Lynx：bundle、codec、Native Module、JS runtime 和平台桥接。
- NativeScript：snapshot/metadata、JS↔Java/ObjC bridge、打包版本差异。
- Flutter：更多 Dart ABI、AOT 版本、VM service 和混淆映射。
- Godot：Godot 3/4 版本矩阵、C#、场景资源引用和自定义字节码。

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

1. **优先做 P0**：建立 Android 16 JNI transition 的最小复现和 fail-closed 机制。
2. **随后做 P1**：先完成 Compose primitive 状态链和 Flutter primitive MethodChannel 链，再扩展 RN reject/JSI。
3. **同步做 WebView 稳定性**：把公网 pending、缓存和 Service Worker 作为独立终态，不与脚本 initiator 关联混在一起。
4. **P0/P1 通过后再做 P2**：优先 MAUI 更广 ABI 和 KMP，其次 Lynx/NativeScript/Godot 扩展。
5. **每个阶段结束再决定版本**：没有通过对应真实样本和失败样本门槛，就保留为 partial，不提升支持声明。

## 相关文档

- [能力矩阵](CAPABILITIES.md)
- [动态关联指南](DYNAMIC-CORRELATION.md)
- [验证记录](VALIDATION.md)
- [工具与用法参考](TOOL-REFERENCE.md)
- [框架缺口研究](ROADMAP-GAPS.md)
