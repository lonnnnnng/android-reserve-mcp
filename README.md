# android-reserve-mcp

聚焦Android产物、DEX、JS、SO、资源和运行观测的MCP服务。使用本地CLI和静态解析器，复杂查询按需启动REA后端；对模型提供20个分组入口，避免加载整个通用逆向工具集。

当前本地发行候选版本为 `0.5.2`，基于此前本地 `v0.5.1` tag 增补。核对日期为2026-11-14：当前未配置 Git remote，GitHub 仓库查询未成功，公开 npm registry 查询返回404，因此没有可见的 GitHub/npm 发布。发布条件与状态见[首发待办](docs/FIRST-RELEASE-TODO.md)，实现与验证边界见[实施进展](docs/PROGRESS.md)和[验证记录](docs/VALIDATION.md)。

OpenCode 连接名和专用模式名均为 `android-reserve`，协议服务名与 npm 包名为 `android-reserve-mcp`。OpenCode 工具前缀为 `android-reserve_`。各类应用的覆盖范围见 [能力与限制](docs/CAPABILITIES.md)。

## 先准备环境

**完整能力依赖与安装检查见 [环境与工具依赖](docs/ENVIRONMENT.md)。** 最小启动需要 Node.js ≥26.12.1；APK 摘要需要 Python ≥3.11。完整静态分析还需要完整 JDK 17+、JADX CLI、apktool、Android SDK、ripgrep、LLVM readelf，以及 REA 6.9.0 和独立的 JADX headless MCP 0.7.1 JAR。动态分析还需要 Frida Node binding 和可连接的 Android 设备环境。

发布后可通过`npm install android-reserve-mcp`安装CLI；首发前请按下方步骤从源码运行，或从Release候选tarball安装。npm/GitHub首次发布状态见[首发待办](docs/FIRST-RELEASE-TODO.md)。

JS分析依赖随npm安装，不需要浏览器。Native函数分析需要配置可用provider；本机已验证Ghidra12.2、macOS ARM64原生decompiler及独立JDK25。Hermes HBC84、Flutter/Dart3.11.5、ILSpy托管程序集、Godot4.3脚本字节码已有自有样本通过；这不等于完整RN/MAUI/游戏恢复。可选环境、固定参数和安装记录见 [引擎说明](docs/ENGINES.md)与[引擎安装](docs/ENGINE-SETUP.md)。

安装本项目依赖：

```zsh
cd /absolute/path/android-reserve-mcp
npm ci --ignore-scripts
node src/cli.js --help
```

上面跳过依赖安装脚本，可用于基础静态能力与自动测试。`java-methods/trace-java`还需要frida-compile的Node原生binding；本仓库npm 11配置已锁定允许`frida@17.26.3`。安装后用`npm install-scripts ls`确认授权，再执行`npm rebuild frida --ignore-scripts=false`并验证binding可导入。若作为依赖装入另一个npm项目，项目级授权不会继承；需在那个项目确认锁文件中Frida确为17.26.3后，显式批准该包脚本。设备注入仍由REA的Frida17.23.2完成，勿因此更换设备server版本。安装条件和许可见[环境文档](docs/ENVIRONMENT.md)。

在 MCP 客户端配置中合并下面的服务器项，替换两个绝对路径，不覆盖原有服务器或模型设置：

```json
{
  "mcp": {
    "android-reserve": {
      "type": "local",
      "command": ["node", "/absolute/path/android-reserve-mcp/src/cli.js", "--allowedRoots", "/absolute/path/apk-projects"],
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

这是 OpenCode 的格式；通用 stdio 客户端使用相同 command/args，参见 [示例](examples/mcp.json)。启动命令保持运行等待 MCP 消息是正常现象。先让客户端调用 `doctor`，再分析 APK。

## 工具入口

| 工具 | 能力 |
| --- | --- |
| `doctor` | 检查依赖路径、headless JAR 校验、后端状态，不连接设备 |
| `apk` | ZIP/DEX/ABI/SHA256、Manifest、签名复验 |
| `decode` | JADX Java 导出、apktool 资源/smali 解包，可报告部分成功 |
| `dex` | 类/方法/静态引用、mappingPath；Kotlin原始metadata/suspend/inline、协程/Compose候选及JavascriptInterface声明 |
| `packages` | APK集合包名/长版本/签名/split依赖校验、聚合DEX/分模块资源、AAB派生与APKS显式设备spec选择 |
| `managed` | store v1/v2/v3、ELF封装与XALZ/LZ4、XAZS/Zstd有界提取 |
| `webview` | 显式设备/包/PID的已开放WebView调试会话，DOM/源码/网络与正文采集 |
| `evidence` | 跨任务内容哈希、签名、词法绑定、受限运行调用ID的持久证据索引 |
| `search` | 导出源码的文本检索，给出文件和行号 |
| `resources` | 解码资源并按语言分页读取字符串；`view-events`列出XML `android:onClick`声明候选，不代表DEX/运行确认 |
| `native` | ELF/JNI；独立target的函数清单、伪代码、引用/callers/callees、provider状态；Go/Rust元数据接口 |
| `artifact` | 文件/目录/嵌套归档索引、magic/ABI/框架候选、按chain安全提取 |
| `script` | JS/TS/JSX/Flow静态索引、格式化及显式source map位置映射 |
| `framework` | 可选引擎状态/探测/固定CLI分析：Hermes、Flutter、ILSpy、Godot、IL2CPP、Ark |
| `device` | ADB 列设备、属性、包、进程、有限 logcat，只读操作 |
| `frida` | attach/spawn、Java精确方法观测、动态JNI注册/撤销、导出名或模块RVA Native观测、Java↔Native同调用关联、load/unload/resume/status/close |
| `rebuild` | apktool 重建、zipalign、自选 keystore 签名并复验 |
| `jobs` | 任务列表、状态、取消 |
| `artifacts` | 列任务文件，按字节分页读取结果/日志/源码 |
| `guidance` | 按需读取本地 Android 逆向 Skill 与参考资料 |

## 一个完整调用流程

工具参数示例（在客户端发起工具调用，并非 shell 命令）：

```json
{"tool":"apk","arguments":{"action":"inspect","path":"/absolute/path/apk-projects/app.apk"}}
```

长任务立即返回 `id`。把它作为 `jobId` 查询：

```json
{"tool":"jobs","arguments":{"action":"status","jobId":"<返回的 id>"}}
{"tool":"artifacts","arguments":{"action":"read","jobId":"<返回的 id>","path":"result.json","offset":0,"limit":12000}}
```

根据 `nextOffset` 继续读取。`succeeded`、`partial`、`failed`、`canceled`、`interrupted` 是不同终态；失败先看 `error` 和任务日志，不能仅凭拿到 id 判断成功。

建议：`doctor → artifact → apk/decode/dex/script/native/framework → artifacts`。artifact的框架指纹是候选；source map、静态引用和运行证据有不同语义，不能相互冒充。Native用法见 [引擎说明](docs/ENGINES.md)。

Frida：先明确设备与目标；`spawn` 创建暂停进程，读取任务结果中的 `session_id` 后执行 `load → resume → status → close`。`attach` 对已运行进程操作，不需要 resume。脚本可能改变目标行为，服务不会自行生成或加载绕过脚本。

Java专项：默认先`java-methods`读取app loader的真实重载；自定义loader先`java-loaders`复制唯一selector，再读取真实重载，卸载枚举脚本，再以显式`argumentTypes`调用`trace-java`。需要关联JNI时，使用该action的`nativeHooks`，不要另load一份Native脚本后按时间猜关联。加载成功只说明脚本被接受，`spawn`须先resume，再从status确认`java-hook-installed`和实际事件；详见[Java/JNI调用示例](docs/ENGINES.md)。

隐藏JNI专项：spawn后先`trace-jni`并确认ready再resume；匹配注册尝试与成功返回，取得类/方法/签名/模块RVA。卸载观测后，以相同模块RVA进行Native或Java联合追踪。RVA栈为候选地址，不能冒充精确调用链；完整流程、预算与边界见[动态JNI说明](docs/JNI-OBSERVATION.md)。

## CLI 与数据位置

| 参数 | 说明 |
| --- | --- |
| `--allowedRoots /path` | 允许输入的目录，可重复；默认启动时 cwd |
| `--workspace /path` | 分析工作目录，默认 `~/.local/share/android-reserve-mcp` |
| `--skillRoot /path` | 本地 Skill 根目录，可重复；默认 `~/.config/opencode/skills` |
| `--no-rea` | 禁用后端，只使用本地能力 |
| `--version` / `--help` | 查看版本/参数 |

任务写入 `workspace/jobs/<id>/`，不会自动删除。允许目录与工作目录使用 realpath 校验；产物读接口限定在对应任务目录。工作目录本身也可作为后续输入。此路径限制不能约束 Frida 脚本在目标进程中的行为，服务也不是执行不可信 APK 解析器的操作系统沙箱。

## 文档与验证

- [新增能力与调用步骤](docs/ADVANCED-ANALYSIS.md)：分包、Kotlin、自定义loader、WebView、程序集与持久证据。
- [环境与完整依赖](docs/ENVIRONMENT.md)：按能力安装、动态设备条件、版本、故障排查。
- [架构](docs/ARCHITECTURE.md)：按需后端、队列、进程与产物边界。
- [能力与限制](docs/CAPABILITIES.md)：Java/Kotlin、C/C++、React Native/WebView 的实际覆盖。
- [全技术栈缺口清单](docs/ROADMAP-GAPS.md)：原生、跨平台、Web混合、游戏及Harmony的待补能力与候选引擎。
- [实施进展](docs/PROGRESS.md)、[引擎说明](docs/ENGINES.md)：本批实际交付、可选环境和调用示例。
- [维护手册](docs/MAINTENANCE.md)：OpenCode 模式、自定义、升级、发布准备。
- [验证记录](docs/VALIDATION.md)：实测项目及未验证边界。
- [GitHub样本验收](docs/SAMPLE-VALIDATION.md)：公开样本的固定commit、产物哈希、真机范围与失败边界。
- [参考与许可](docs/REFERENCES.md)、[第三方说明](THIRD_PARTY_NOTICES.md)。

```zsh
npm run check
npm test
node scripts/smoke.mjs
npm run check:pack
npm run smoke:release
```

`npm test` 使用自有样本和模拟后端，不连接设备；`smoke:release`会在临时目录安装实际npm tarball并验证stdio工具清单。完整静态 smoke 需要静态工具链、Android SDK platform 和headless JAR，生成自有APK/临时签名，不安装或启动APK。

MIT © long。
