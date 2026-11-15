# android-reserve-mcp

面向 Android 逆向和产物分析的 MCP 服务。它通过本地 stdio 接入 Agent，覆盖 APK/DEX、Kotlin/Compose、Java/JNI、Native、WebView、Hermes/Flutter、.NET assembly store 和有界运行时观测。

当前发布版：`0.5.4`。本版本新增注入前兼容性拒绝、任务实例所有权、请求证据终态合并、退出期限及深度依赖检查，并补齐 Compose 扩展 MCP 多链、Flutter EventChannel、RN 自有 JSI/Fabric、KMP 业务回链和 MAUI long/float 观测，见[稳定性进展](docs/STABILITY-20261115.md)。

- GitHub：[lonnnnnng/android-reserve-mcp](https://github.com/lonnnnnng/android-reserve-mcp)
- Release：[v0.5.4](https://github.com/lonnnnnng/android-reserve-mcp/releases/tag/v0.5.4)
- npm registry 发布命令见本次交付说明；发布后 `latest` 为 `0.5.4`。

## 快速安装

要求 Node.js `>=26.12.1`。全局安装：

```zsh
npm install -g android-reserve-mcp@0.5.4
node "$(npm root -g)/android-reserve-mcp/src/cli.js" --version
```

需要本版本 `0.5.4` 的动态关联能力时，从 GitHub tag 或源码目录运行：

```zsh
git clone --branch v0.5.4 https://github.com/lonnnnnng/android-reserve-mcp.git
cd android-reserve-mcp
npm ci --ignore-scripts
node src/cli.js --version
```

启动命令必须指定允许读取的目录和任务工作区：

```zsh
node "$(npm root -g)/android-reserve-mcp/src/cli.js" \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace
```

项目源码也可以直接运行：

```zsh
npm ci --ignore-scripts
node src/cli.js --version
```

## 接入 Agent

当前优先支持并在本机验证过的四个 Agent：

- Codex CLI
- Claude Code
- OpenCode
- Pi

四个 Agent 的命令、配置文件、字段差异和本机验证结果见 [Agent 接入指南](docs/AGENT-INTEGRATION.md)。通用 MCP 客户端可以直接复用 [examples/mcp.json](examples/mcp.json) 的 stdio 配置；OpenCode 示例见 [examples/opencode.json](examples/opencode.json)。

本服务是本地 stdio MCP，不是公网 HTTP MCP。Agent 和本服务应运行在同一台机器上；如果必须远程使用，需要另行部署受控 MCP 网关。

## 第一次调用

连接完成后按这个顺序操作：

1. 调用 `doctor`，检查运行时和外部依赖。
2. 调用 `apk` 的 `inspect`，确认输入路径和 APK 身份。
3. 对长任务使用 `jobs.status` 查询终态。
4. 用 `artifacts.read` 分页读取 `result.json`、日志和报告。

示例：

```json
{"tool":"doctor","arguments":{}}
{"tool":"doctor","arguments":{"deep":true,"timeoutSeconds":90}}
{"tool":"apk","arguments":{"action":"inspect","path":"/absolute/path/apk-projects/app.apk"}}
{"tool":"jobs","arguments":{"action":"status","jobId":"<job-id>"}}
```

## 能做什么

- **静态产物**：APK、Manifest、签名、DEX、资源、smali、APKS/AAB/split、一致性和容器预算。
- **语言与框架**：Kotlin metadata、suspend/inline、Compose 编译候选、JavascriptInterface、Hermes、Flutter channel 静态协议、Godot、ILSpy 和 .NET assembly store。
- **Native 与 JNI**：ELF、导出函数、调用关系、JNI 静态/动态注册、Native 导出名或 RVA 观测。
- **WebView 与 JavaScript**：DOM、脚本源码、Network、正文、CDP initiator 栈、scriptId 到源码 SHA/AST 关联。
- **运行时观测**：Java 精确重载、Java 请求/回复对象关联、RN Promise/自有 JSI-Fabric 因果、Flutter EventChannel sink、Compose 扩展状态链、Mono ARM64 窄 ABI。
- **证据管理**：跨任务内容哈希、签名、调用 ID、来源文件和 JSON pointer。

完整的 20 个顶层工具、action、参数示例、常用工作流和能力边界见 [工具与用法参考](docs/TOOL-REFERENCE.md)。

## 重要边界

- `allowedRoots` 是输入路径边界，不是操作系统沙箱。
- `partial` 结果必须按部分结果处理，不能当成完整恢复。
- 动态分析需要明确设备序列号、包名和 PID；服务不会自动选择手机。
- Flutter typed bridge 与自有 R8 MethodChannel/EventChannel fixture 已在 POCO/ART36/Frida17.23.2 通过；任意 Flutter ABI、Dart VM service 和跨设备/ROM仍未覆盖。
- RN 自有 debug/new-architecture fixture 的 Hermes/JSI/Fabric 因果已验证；第三方 APK 仍只读开放 inspector，未开放时 `unsupported`，不做静默注入。
- Compose 扩展链依赖显式 hooks 和自有业务 marker；不泛化任意 Compose 应用。
- Mono 已补 long/float；仍不支持 CoreCLR、NativeAOT、数组/对象和复杂托管 ABI。
- Unity、Unreal、HarmonyOS NEXT 暂缓。

完整的“已完成 / 部分完成 / 待开发 / 暂缓 / 下一步”路线图见 [ROADMAP.md](docs/ROADMAP.md)。详细证据和限制见 [动态关联指南](docs/DYNAMIC-CORRELATION.md)、[能力矩阵](docs/CAPABILITIES.md)、[验证记录](docs/VALIDATION.md) 和 [环境依赖](docs/ENVIRONMENT.md)。

## 开发验证

```zsh
npm test
npm run check
npm run check:pack
npm run smoke:release
npm run smoke:release:full
```

`npm test` 覆盖离线回归与真实协议测试；`smoke:release` 验证 tarball 的 20 个工具和基础 `doctor`。`smoke:release:full` 在隔离目录安装 tarball、固定 REA、两套 Frida binding，再实际编译模板和握手 REA；保留安装报告与日志。`doctor.deep` 返回任务，使用 `jobs` 和 `artifacts` 读取；它不连接设备。设备 smoke 只对明确授权的目标执行，验收脚本不会随 npm 包发布。

## 安全与许可

不要把 API Key、私钥、设备凭据或个人路径提交到仓库。Frida、JADX、apktool、Android SDK 和 REA 等外部工具各自遵循其许可证；本项目代码采用 MIT。

MIT © long
