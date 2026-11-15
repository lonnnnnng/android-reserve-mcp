# android-reserve-mcp

[English](README.en.md)

## 是什么

`android-reserve-mcp` 是一个面向 Android 逆向和产物分析的本地 MCP 服务。它通过 stdio 接入 Codex、Claude Code、OpenCode、Pi 或其他 MCP 客户端，在本机按需分析 APK、DEX、资源、Java/JNI、Native、WebView、Hermes/Flutter、Kotlin/Compose、KMP、MAUI 和 Godot 产物。

服务不把 APK 上传到云端，也不会自动选择设备、自动安装应用、静默注入第三方脚本或把静态候选说成运行事实。长任务使用有界 workspace 保存任务、日志、报告和证据图。

当前发布版是 `0.5.4`：

- GitHub：[v0.5.4](https://github.com/lonnnnnng/android-reserve-mcp/releases/tag/v0.5.4)
- npm：`android-reserve-mcp@0.5.4`
- Node.js：`>=26.12.1`
- MCP 顶层工具：20 个

## 有什么能力

### Android 产物和静态分析

- 读取 APK、Manifest、签名、ABI、DEX、资源、smali 和 SHA-256。
- 检查 APKS、AAB、split 的包名、长版本、证书、模块依赖和设备 spec 选择。
- 查询 DEX 类、方法、引用、精确 JVM/DEX 签名和原始位置。
- 读取 Kotlin metadata、suspend/inline、Compose 编译候选和 `JavascriptInterface` 声明。
- 使用 JADX、apktool、aapt2、bundletool 等固定参数引擎，保留输入快照和预算诊断。

### Java、JNI、Native 和运行时

- 观测 Java 精确重载、Java 请求/回复对象身份、同线程父子调用和跨线程边界。
- 读取 JNI 静态/动态注册、ELF、导出函数、RVA、函数引用、callers/callees 和伪代码。
- 在明确设备、包名、PID 和所有权的前提下运行 Frida Java/JNI/Native 观测。
- 使用 Mono 窄 ABI 观测 `int32`、`bool`、`long`、`float`、`string`，并回核 MVID、MethodDef 和 JIT 身份。

### WebView、JavaScript 和框架

- 采集已开放调试 WebView 的 DOM、脚本源码、Network、正文和有界 CDP initiator 栈。
- 将同一 CDP `scriptId` 关联到脚本 SHA、AST 和网络请求。
- 对 Hermes、Flutter、ILSpy、Godot、IL2CPP、Ark 等固定引擎执行有界分析，并保留版本/兼容警告。
- 自有 Flutter R8 fixture 已验证 primitive/object MethodChannel 和 EventChannel sink 多回复。
- 自有 Compose fixture 已验证点击→状态写入→重组/派生、多状态、导航和 coroutine MCP 多链。
- 自有 RN fixture 已验证 `JSI_CALL_ID → native marker → Fabric event ID → render sequence`。
- 自有 KMP business App 已完成 `commonMain` 到 Android UI/logcat/JADX 的回链。

### 证据和任务管理

- 所有长任务返回任务 ID，通过 `jobs` 查询终态，再用 `artifacts` 分页读取报告。
- 证据可按内容哈希、精确签名、调用 ID、JNI 对象身份、Mono 身份和 JSON pointer 关联。
- `verified`、`partial`、`candidate`、`unsupported` 和清理未确认状态分开表达。

## 20 个工具

每个顶层工具内部通过 `action` 选择操作；action 数量不等于 MCP 工具数量。

| 工具 | 主要 action | 能做什么 |
| --- | --- | --- |
| `doctor` | `deep` | 检查路径、依赖和允许目录；深度模式实际导入 binding、编译 Java 模板、握手 REA |
| `apk` | `inspect`、`signature`、`manifest` | 读取 APK ZIP、DEX、ABI、签名、Manifest 和哈希 |
| `decode` | `jadx`、`apktool`、`both` | 导出 Java、资源和 smali 到独立任务目录 |
| `dex` | `classes`、`class`、`method`、`references`、`kotlin` | 查询 DEX、引用、Kotlin metadata、Compose 候选和注解 |
| `packages` | `inspect`、`validate`、`decode`、`aab-manifests`、`select` | 检查 APKS/AAB/split 一致性、依赖和设备选择 |
| `managed` | `inspect`、`extract` | 读取 .NET assembly store、ELF payload、LZ4/Zstd 等有界容器 |
| `evidence` | `merge`、`query` | 合并任务证据，按哈希、签名和调用 ID 查询 |
| `webview` | `discover`、`open`、`scripts`、`source`、`dom`、`network`、`body`、`close` | 采集已开放调试 WebView 的页面、脚本、网络和正文 |
| `search` | 无 | 在已导出的源码目录中搜索文本或正则 |
| `resources` | `strings`、`view-events` | 分页读取字符串和 XML `android:onClick` 候选 |
| `native` | `elf`、`jni`、`open`、`functions`、`function`、`references`、`callers`、`callees`、`providers` | 分析 ELF/JNI、Native 函数和调用关系 |
| `artifact` | `inspect`、`extract` | 识别产物、嵌套包、ABI、框架候选并定向提取 |
| `script` | `index`、`format`、`map` | 静态索引 JS/TS/JSX/Flow 函数、调用点和 source map |
| `framework` | `engines`、`probe`、`analyze`、`channels` | 调用固定 Hermes、Flutter、ILSpy、Godot 等框架分析器 |
| `device` | `list`、`inspect`、`packages`、`processes`、`logcat` | 只读访问明确 serial 的 ADB 设备 |
| `frida` | `devices`、`processes`、`attach`、`spawn`、`load`、`runtime`、`java-methods`、`trace-java`、`trace-java-group`、`trace-mono`、`trace-jni`、`trace-native`、`resume`、`status`、`unload`、`close` | 运行 Java/JNI/Native/Mono 和 Promise 边界观测 |
| `rebuild` | `build`、`sign` | 重建 apktool 工程、zipalign、签名和复验 |
| `jobs` | `list`、`status`、`cancel` | 查询、取消和回收长任务 |
| `artifacts` | `list`、`read` | 分页读取任务产物、日志和报告 |
| `guidance` | `list`、`read` | 读取允许的本地 Android 逆向 Skill 和参考资料 |

完整参数、常用 action 和证据字段见[工具与用法参考](docs/TOOL-REFERENCE.md)。

## 快速安装

### npm 安装

```zsh
npm install -g android-reserve-mcp@0.5.4
node "$(npm root -g)/android-reserve-mcp/src/cli.js" --version
```

启动时必须明确允许读取的目录和任务 workspace：

```zsh
node "$(npm root -g)/android-reserve-mcp/src/cli.js" \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace
```

### 从源码运行

```zsh
git clone --branch v0.5.4 https://github.com/lonnnnnng/android-reserve-mcp.git
cd android-reserve-mcp
npm ci --ignore-scripts
node src/cli.js --version
```

## 接入 Agent

这是本地 stdio MCP，不是公网 HTTP 服务。Agent 和 MCP 服务应在同一台机器上运行。

- 通用 MCP：复制 [examples/mcp.json](examples/mcp.json)，替换 `command`、`allowedRoots` 和 `workspace`。
- OpenCode：复制 [examples/opencode.json](examples/opencode.json)，或参照当前客户端配置；OpenCode 工具通常显示为 `android-reserve_*`。
- Claude Code、Codex CLI、Pi：使用 [Agent 接入指南](docs/AGENT-INTEGRATION.md) 中对应的 `mcp add` 命令。
- 需要限制某个 Agent 时，在 Agent 级权限中关闭 `android-reserve_*`，不必删除 MCP 连接。

建议优先使用独立 workspace，并让 Agent 首先调用 `doctor`。GUI Agent 如果无法继承终端 PATH，应使用 Node.js 绝对路径。

## 怎么使用

### 第一次调用

按这个顺序建立最小闭环：

```json
{"tool":"doctor","arguments":{}}
{"tool":"apk","arguments":{"action":"inspect","path":"/absolute/path/apk-projects/app.apk"}}
{"tool":"jobs","arguments":{"action":"status","jobId":"<job-id>"}}
{"tool":"artifacts","arguments":{"action":"read","jobId":"<job-id>","path":"result.json"}}
```

### 常用静态流程

1. `doctor` 检查依赖和路径。
2. `apk.inspect`、`apk.signature` 确认输入身份。
3. `packages.validate` 或 `packages.select` 处理 APKS/AAB/split。
4. `decode`、`dex`、`resources`、`search` 逐步缩小目标。
5. 长任务用 `jobs.status` 等待终态，再用 `artifacts.read` 读取原始报告。
6. 需要跨任务关系时使用 `evidence.merge/query`，不要按时间或 PID 猜因果。

### 常用动态流程

1. 明确设备 serial、包名和 PID；服务不会自动选设备。
2. `device.inspect`、`device.processes` 确认目标身份。
3. Java 先用 `frida.java-methods` 读取实际 overload；自定义 loader 先用 `frida.java-loaders`。
4. 使用 `attach`/`spawn`、`load`、`status`、`resume`、`unload`、`close` 完成生命周期。
5. 动态结果必须同时检查 PID、原方法返回、事件、清理状态和 `partial` 标记。

### 本地开发命令

```zsh
node src/cli.js --version
npm test
npm run check
npm run check:pack
npm run smoke:release
npm run smoke:release:full
```

`smoke:release` 验证 tarball、20 个工具和基础 `doctor`；`smoke:release:full` 还会安装两套 Frida binding、运行深度 doctor 和完整协议验收。

## 边界和不支持范围

- `allowedRoots` 是输入路径边界，不是操作系统沙箱；workspace 可能包含敏感分析产物。
- `partial`、`candidate` 和 `unsupported` 不能当成完整恢复；静态候选不等于运行因果。
- 动态分析必须明确 serial、packageName 和 PID；不会自动安装、启动、选择设备或提升权限。
- Flutter typed bridge、EventChannel 和 Compose 多链只在已验证的 POCO F2 Pro / Android 16 / ARM64 / Frida tuple 与自有 fixture 上成立。
- RN 第三方 APK 只支持开放 inspector 的只读探测；未开放时返回 `unsupported`，不做静默 JS/Frida 注入。
- Compose matcher 依赖显式 hooks 和自有业务 marker，不能泛化任意 Compose 应用。
- Mono 只覆盖已加载 Mono、ARM64、非泛型窄 ABI；数组/对象、CoreCLR、NativeAOT、byref 和复杂结构不支持。
- Hermes HBC99 需要显式实验开关；任意版本的 Hermes、完整 JS 源码恢复和 `.then()` 因果不保证。
- WebView 必须已开放调试；公网网络稳定性、TWA、Service Worker 全量语义和跨会话 JS→Java 因果不保证。
- Unity、Unreal、HarmonyOS NEXT 当前暂缓；Godot C# 和多版本矩阵仍未完成。
- 本轮没有做跨设备/ROM 回归，不把单设备结果推广到其他环境。

更多状态、证据和限制见[能力矩阵](docs/CAPABILITIES.md)、[动态关联指南](docs/DYNAMIC-CORRELATION.md)、[稳定性进展](docs/STABILITY-20261115.md) 和[路线图](docs/ROADMAP.md)。

## 开发接入指南

### 开发环境

```zsh
git clone https://github.com/lonnnnnng/android-reserve-mcp.git
cd android-reserve-mcp
npm ci --ignore-scripts
npm test
npm run check
npm run check:pack
```

要求 Node.js `>=26.12.1`。完整静态链还可能需要 JDK 17+、Python、JADX、apktool、Android SDK、REA 和对应框架引擎；按能力阅读 [ENVIRONMENT.md](docs/ENVIRONMENT.md) 和 [ENGINE-SETUP.md](docs/ENGINE-SETUP.md)。

### 扩展一个工具

1. 在 `src/server.js` 增加公开 schema 和工具描述。
2. 在 `src/actions.js` 或对应 `src/core/*.js` 实现 action。
3. 给路径、预算、超时、设备/PID 所有权和清理失败加边界。
4. 在 `test/` 增加离线回归；动态能力必须保留真实事件和失败现场。
5. 同步 `docs/TOOL-REFERENCE.md`、`docs/CAPABILITIES.md`、`docs/VALIDATION.md` 和 CHANGELOG。
6. 运行 `npm test`、`npm run check`、`npm run check:pack`、`git diff --check`。

### 证据和安全要求

- 不把 APK、DEX、SO、keystore、设备日志、个人路径、API Key 或私有 workspace 提交进仓库。
- 不按时间、PID、RVA 或相似文本猜跨层因果；关系必须有哈希、精确签名、调用 ID、对象身份或来源 pointer。
- 外部 CLI 必须固定参数、版本和预算，拒绝任意命令透传。
- 动态观测必须区分 setup failure、unsupported、partial、真实业务事件和清理未确认。
- 代码注释使用中文并标记作者 `long`；业务规则和安全边界要贴近实现代码。

### 发布和 CI

- 版本统一检查 `package.json`、`package-lock.json`、`src/version.js`、CHANGELOG 和文档。
- 发布前运行完整本地门禁：`npm test`、`npm run check`、`npm run check:pack`、`npm run smoke:release:full`、`npm audit --omit=dev`。
- GitHub Actions 只在 `release.published` 时运行 Ubuntu/macOS test 和 full-install 矩阵；普通 push 和 pull request 不触发。
- npm 发布需要有包维护权限；发布后回验 `npm view android-reserve-mcp version dist-tags`。
- 发布配置、Agent 接入和回滚说明见 [MAINTENANCE.md](docs/MAINTENANCE.md)。

## 相关文档

- [工具与用法参考](docs/TOOL-REFERENCE.md)
- [Agent 接入指南](docs/AGENT-INTEGRATION.md)
- [能力矩阵](docs/CAPABILITIES.md)
- [动态关联指南](docs/DYNAMIC-CORRELATION.md)
- [验证记录](docs/VALIDATION.md)
- [环境与引擎](docs/ENVIRONMENT.md)
- [路线图](docs/ROADMAP.md)

## 安全与许可

不要把 API Key、私钥、设备凭据或个人路径提交到仓库。Frida、JADX、apktool、Android SDK 和 REA 等外部工具各自遵循其许可证；本项目代码采用 MIT。

MIT © long
