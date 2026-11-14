# 环境与完整能力依赖

适用版本：android-reserve-mcp 0.5.0。核验日期：2026-11-14。本文同时列出“启动服务”“使用某项能力”和“动态分析”的不同条件。

## 1. 宿主环境

| 项目 | 条件与说明 |
| --- | --- |
| 操作系统 | 面向 macOS / Linux；当前实际验收是 macOS arm64。Linux 的 CI 已编写，远端 CI 尚未运行；Windows 不作为当前支持目标 |
| Node.js | ≥26.12.1，安装项目 npm 依赖；后端调用还需 `npx` |
| Python | `python3` ≥3.11；基础helper仅标准库；托管压缩提取另需独立Python的lz4/zstandard |
| Java | 深度 DEX 分析需要完整 JDK 17+，包括 `jdk.compiler`；仅有 JRE 不够。apktool/JADX CLI/Android SDK 还需满足各自所选版本的 Java 要求，本机采用 JDK 21 |
| 文件权限 | 允许目录可读，workspace 与临时目录可写；分析产物可能包含业务源码和凭据，应存放在受控磁盘 |
| 网络 | 初次 `npm ci`、`npx rea-agents@6.9.0`、引擎下载需要 npm/GitHub 网络；本服务不将 APK 上传到云分析 API。离线前需预装并实际测试缓存启动 |
| 内存与磁盘 | 建议从 16GB RAM 和 10GB 可用空间起步，再按 APK 大小增加；这是建议，不是已证明的最低值。DEX JVM 默认最大堆 8192MiB，解包和并发任务还需额外空间 |
| MCP 客户端 | 支持 stdio、tools/list 和工具调用。OpenCode 已验证配置发现；其他客户端需要按各自 schema 配置 |

macOS GUI 应用不一定继承 Ghostty 中临时 export 的环境。必须在实际启动 MCP 的客户端环境中检查 PATH/JAVA_HOME，而非只在一个终端中验证。

## 2. 按能力划分依赖

下表除特别说明外，都需要 Node 和项目 npm 依赖。

| 能力 / 操作 | 必需依赖 | 可选项 / 缺失影响 |
| --- | --- | --- |
| 启动、任务、分页 | Node、可写 workspace | 不要求 Android Studio、设备或 REA |
| `apk.inspect` | Python 标准库 | 不解码二进制 Manifest，不验证签名 |
| `apk.manifest` 读取 APK | Python、SDK `apkanalyzer`、其 Java 环境 | 输入已解码 XML 时只需 Python |
| `apk.signature` | SDK build-tools `apksigner`、Java | 复验已有签名，不需要自己的 keystore |
| `decode` / JADX | `jadx` CLI、Java | 单独安装 CLI；headless JAR 不替代此命令 |
| `decode` / apktool | `apktool`、Java | `engine=both` 要求两者均存在，否则在创建任务前报错 |
| `dex` 原REA操作（kotlin除外） | REA 6.9.0、完整 JDK 17+、headless JADX MCP JAR 0.7.1 | 不需要 CLI `jadx`、GUI JADX、模拟器；`--no-rea` 时不可用 |
| `search` | `rg`（ripgrep）、已导出的源码目录 | 只是文本检索，不是调用图或 DEX xref |
| `resources` | REA 6.9.0、apktool ≥2.7.0、Java | 不要求 headless JAR；REA 使用 `REA_APKTOOL_COMMAND` 或 PATH |
| `native.elf` | Python | 完整头/依赖/动态符号输出还需 GNU readelf 或 LLVM `llvm-readelf`；缺少时仅返回基本 ELF 头 |
| `native.open/functions/function/references/callers/callees` | REA、一个可用Native provider；Ghidra12.2使用JDK25和本机原生decompiler | 每target独立连接最多2个，样本仅验证ARM64；见ENGINES.md |
| `artifact` | Python标准库 | 有预算的文件/目录/嵌套ZIP索引与定向提取，不等于包一致性验证 |
| `script` | 随npm安装的Babel8.1.2与trace-mapping0.3.31 | 离线解析不执行代码；显式map；12MiB/512MiB堆预算 |
| `framework` | 所选外部CLI及对应runtime | Hermes HBC84、Blutter/Dart3.11.5、ILSpy/.NET10、GDRE/Godot4.3已用自有样本验证；IL2CPP/Ark仍未实测，见ENGINES.md |
| `native.jni` | REA 6.9.0、目标 APK | 读取 DEX/ELF 字节，不要求 headless JAR；静态候选不证明运行时 RegisterNatives 或真实加载 |
| `device` | SDK platform-tools `adb`、USB 调试/网络 ADB 已配对的设备 | 非 list 操作必须明确 serial；不启动模拟器、不安装 APK |
| `frida` | REA 6.9.0、可加载的 npm `frida` 原生模块、目标设备的 Frida server/Gadget 与连接条件 | Python `frida-tools` 是可选手工诊断工具，不能替代 Node binding，详见第 5 节 |
| `frida.java-loaders/java-methods/trace-java/trace-jni` | 上行设备链，加npm依赖frida-java-bridge7.0.13、frida-compile19.1.0及其Frida17.26.3原生binding | 编译器不作为设备binding；512MiB堆/90秒/4MiB bundle预算。Java方法支持默认app loader或唯一selector；JNI独立观测标准入口未来注册，见JNI-OBSERVATION.md |
| `rebuild.build` | apktool、Java、已解码工程、工程所需 framework/resources | 厂商定制 APK 可能需要安装对应 apktool framework；通用安装不保证所有 APK 能重建 |
| `rebuild.sign` | SDK `zipalign`、`apksigner`、Java、自有 keystore/alias、密码环境变量 | 不自动安装；输入/keystore 必须在允许目录内 |
| `guidance` | 指定根目录下的本地 Skill 文档 | 完全可选；没有 Skill 不影响 APK/DEX 等工具运行 |
| `scripts/smoke.mjs` | 上述静态依赖，加 `javac`、`keytool`、`d8`、`aapt2` 和至少一个 SDK platform 的 android.jar | 仅开发验收使用，不是普通启动条件 |

**按使用能力准备依赖：** Node/Python/JDK/JADX/apktool/SDK/rg/readelf/REA/headless JAR为原有静态链；Native函数分析另需一个实际可用provider（本机Ghidra12.2+macOS ARM64 decompiler+独立JDK25）；JS所需Babel/trace-mapping随npm安装；Hermes和其他框架另配可选引擎。Frida需明确设备及匹配server/Gadget，签名需keystore。详见[ENGINES.md](ENGINES.md)，不要求启动时同时安装所有可选引擎。

## 3. 安装与检查顺序

### 3.1 基础 CLI

macOS 使用 Homebrew 时，可按缺失项安装，不必重复安装已有工具：

```zsh
brew install python openjdk@21 jadx apktool ripgrep llvm
```

Node 按所用版本管理器安装 ≥26.12.1。JDK 安装后按包管理器提示配置 JAVA_HOME；不要把只有 `java` 的 JRE 当成完整 JDK。

```zsh
node --version
npm --version
python3 --version
java -version
javac -version
java --list-modules
jadx --version
apktool --version
rg --version
```

`java --list-modules` 必须含 `jdk.compiler`。macOS 可用 `/usr/libexec/java_home -v 21` 查询已注册的 JDK；若所选包未注册，使用它实际的 JDK Home。Linux 使用相应发行版/供应商的安装说明，不照搬 Homebrew 命令。

### 3.2 Android SDK

通过 Android Studio 的 SDK Manager 或官方 command-line tools 安装：

- `platform-tools`：adb。
- `cmdline-tools;latest`：apkanalyzer。
- 一个适配当前工程的 `build-tools;<version>`：apksigner、zipalign、aapt2、d8。
- 开发 smoke 额外需要 `platforms;android-<api>`；分析已有 APK 不要求某个固定 platform。

SDK 的实际安装目录传给启动环境：

```zsh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

上面是 macOS 常见路径；Linux 常见为 `$HOME/Android/Sdk`，以实际目录为准。代码优先 PATH，其次 ANDROID_HOME/ANDROID_SDK_ROOT，最后尝试平台默认目录；build-tools 从已安装版本中按版本排序选择，不自动下载 SDK。宿主与目标 ABI 需要兼容，Frida server/Gadget 另按目标 CPU 选取。

### 3.3 REA 与独立 headless JAR

服务第一次调用 DEX、JNI、资源或 Frida 时才运行：

```zsh
npx -y rea-agents@6.9.0 mcp
```

手工执行此命令会等待 MCP 消息，不代表卡死。本项目固定版本，不会修改你另一套 REA MCP 或 Skill；该 sidecar 自身仍会加载 REA 程序，但前端模型只接收本项目的 20个入口。

DEX 所需 JAR 从 [headless JADX 0.7.1 Release](https://github.com/1013503897/jadx-headless-mcp/releases/tag/v0.7.1) 下载：

```zsh
mkdir -p "$HOME/.local/share/android-reserve-mcp/engines"
curl --fail --location --retry 3 \
  'https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar' \
  -o "$HOME/.local/share/android-reserve-mcp/engines/jadx-headless-mcp-0.7.1-all.jar"
shasum -a 256 "$HOME/.local/share/android-reserve-mcp/engines/jadx-headless-mcp-0.7.1-all.jar"
```

期望 SHA256 必须逐字一致：

```text
6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75
```

默认目录的文件只有校验通过才会自动传给 REA。也可显式设置 `REA_JADX_MCP_JAR=/absolute/path/jadx-headless-mcp-0.7.1-all.jar`；显式值优先，必须为绝对路径，其身份仍由 REA 验证。`--workspace` 改变任务目录，不改变默认引擎目录。项目不会自动下载 JAR。

### 3.4 MCP 客户端环境变量

| 变量 | 用途 |
| --- | --- |
| `PATH` | 找 Node/npx/Python/Java/JADX/apktool/rg 等命令 |
| `JAVA_HOME` | 为后端和遵循它的 CLI 选择完整 JDK |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | SDK 根目录，优先前者 |
| `REA_JADX_MCP_JAR` | 显式选择 headless JAR 的绝对路径 |
| `REA_JADX_HEAP_MIB` | DEX JVM 最大堆 MiB，正整数；例如 4096，结合 APK 大小调整 |
| `REA_JADX_ACTIVE_PROCESSOR_COUNT` | JVM CPU 数量预算，正整数；后端 DEX worker 仍由后端控制 |
| `REA_JADX_OPERATION_TIMEOUT_MS` | DEX 后端每次操作预算，默认 120000ms；外层调用上限当前为 600000ms，应留启动/清理余量 |
| `REA_APKTOOL_COMMAND` | REA 资源分析使用的 apktool 可执行包装器绝对路径，不是 `java -jar ...` 命令字符串；本地 decode/rebuild 仍从 PATH 找 apktool |
| `ANDROID_RESERVE_BLUTTER` / `ANDROID_RESERVE_ENGINE_PYTHON` | Blutter入口与独立venv解释器绝对路径；支持默认用户级安装目录，首次分析可能下载/编译Dart |
| `ANDROID_RESERVE_ILSPY` / `ANDROID_RESERVE_DOTNET_ROOT` | ILSpy apphost与私有.NET根目录绝对路径；默认安装用独立.NET10，非全局配置 |
| `ANDROID_RESERVE_GDRE` | GDRE可执行文件绝对路径；本机默认发现用户级2.7.4目录，其他平台显式设置 |
| 自定义签名密码变量 | `rebuild.sign.passwordEnv` 传变量名，实际密码只存启动进程环境 |

OpenCode 使用 `mcp.android-reserve.environment` 传入这些值；其他客户端常用 `env`，遵循客户端 schema。更改环境后重启该 MCP，已运行进程不会继承之后的 shell export。

## 4. 签名与本地 Skill

重建不等于获得可用的原签名。重新签名会改变签名身份，可能影响覆盖安装、签名校验和服务端校验。自己提供 keystore、alias 和同一启动环境中的密码变量；当前接口只提供一个密码变量，应使用可以共享该密码的 keystore/私钥条目。密码不要写到提示词、JSON 参数或 Git 文件中。

Skill 只读开放 `apk-reverse`、`mobile-reverse`、`ida-reverse`、`protocol-reverse` 的 `SKILL.md` 与 `references/`。默认读取 `~/.config/opencode/skills`，可用 `--skillRoot` 覆盖/增加根目录。Skill 中建议的其他程序不等于本 MCP 已提供对应工具；Skill 也不会被自动执行或打包发布。

## 5. Frida 动态能力的额外条件

1. REA 6.9.0 使用 npm `frida@17.23.2`，这是宿主机 Node 原生 binding。必须能在 **REA 所在包环境**成功 import；本项目不直接调用 Python frida CLI。缺少预编译 binding 时，安装该包可能需要它自己的原生构建工具链，按 Frida 官方安装文档处理。
2. Android 侧需要可连接的 `frida-server` 或嵌入应用的 Frida Gadget。宿主 binding 与 server/Gadget 使用匹配版本，当前基线为 17.23.2，且设备端构建必须匹配 Android ABI。
3. `frida-server` 通常用于已有 root 权限的测试设备；非 root 设备可使用已嵌入/授权的 Gadget 等环境。普通 USB 调试并不自动提供任意进程注入权限。本服务不自动 root、不安装 server、不重打包注入 Gadget。
4. 连接必须已建立，USB 已授权，或目标端已有受控连接；`deviceId` 从明确的 Frida 设备清单选择，不能填宿主 `local`。当前接口没有单独暴露 remote 地址/认证参数。
5. `attach` 提供 deviceId+pid；`spawn` 提供 deviceId+packageName。spawn 会暂停进程，先加载自己的脚本，再调用 `resume`；最终 `close`。本服务仅管理自己创建的会话。
6. Python `frida-tools` / `frida-ps` 可用于手工排障，但它有自己使用的 Python Frida 版本。CLI 存在或版本不同，不证明 REA binding 与设备端兼容。

7. Java自动观测由本MCP将bridge显式打包。仓库根package.json在npm 11中将`frida@17.26.3`列入`allowScripts`；用`npm install-scripts ls`核对当前项目授权后执行`npm rebuild frida --ignore-scripts=false`。`npm ci --ignore-scripts`会跳过安装脚本；显式rebuild只能执行npm已批准的包脚本。若android-reserve作为另一个项目的依赖，package级allowScripts不会向上游继承；先确认该项目lock中Frida精确版本与integrity，再在该项目批准脚本并核对`npm install-scripts ls`，勿运行全量approve。经本机隔离安装复核，npm11安装tarball会先警告frida@17.26.3未审批，显式按包审批后rebuild成功，Node binding可import且能创建local device对象。该版本只用于宿主bundle编译，REA6.9.0的设备binding/server仍是17.23.2。升级编译器不等于升级server。
8. 每设备/PID在本服务只允许一个trace-java或trace-jni observer，加载/卸载不确定时close后重建。`spawn`的trace-jni先确认ready再resume；Java方法安装则可能需要resume后loader才就绪。Java.setup最多等30秒，超时事件在status判失败并尝试卸载。任意用户脚本或其他客户端的hook不在冲突检测范围。

**验证边界：** Frida17.23.2在授权POCO自有App上已验证原导出JNI与隐藏动态JNI、标准入口注册/失败/撤销、模块RVA、Java↔Native同调用及卸载关闭。Java栈使用Thread API；隐藏RVA栈仅为FUZZY候选，不使用已在本样本崩溃的ACCURATE路径。更多目标/ABI/Gadget/CheckJNI表、未知loader与异步跨线程未完整验收。raw load不自动提供Java。具体记录见VALIDATION.md。

## 6. 当前本机版本与验证范围

这些是 2026-11-13 的实测记录，不是要求用户安装所有工具的最新版：

| 组件 | 实测版本 / 状态 |
| --- | --- |
| Node / Python | 26.12.1 / 3.14.10 |
| JDK | JADX/原静态链21.0.13.0.3；Native Ghidra独立Temurin25.0.5+8 |
| MCP SDK / Zod | 1.32.2 / 4.6.7，package-lock 固定 |
| JADX CLI / apktool | 1.5.6 / 3.0.3 |
| SDK build-tools / ADB | 36.0.0 / 37.0.0 |
| REA / headless JAR | 6.9.0 / 0.7.1，SHA256 已核实 |
| Frida Node binding | REA的17.23.2，已完成授权真机自有App的attach/spawn与JNI观测 |
| Java bridge / compile / 编译binding | 7.0.13 / 19.1.0 / 17.26.3；编译及设备Java联合观测通过，npm lock固定 |
| Flutter / Dart / Blutter | 3.41.9 / 3.11.5 / commit4a60ac648bf448c5a7596437243bcd0b9376fdf0；ARM64 release真实分析通过 |
| Blutter构建依赖 | 专用Python venv，pyelftools0.33/requests2.34.2，Apple Clang16、CMake4.4.5/Ninja1.13.2、ICU79.1/Capstone5.0.9；限制Ninja4并行 |
| .NET SDK / runtime / ILSpy | 独立10.0.403 / 10.0.14 / 11.2.0.10050；自有net10托管DLL通过 |
| GDRE | 2.7.4；自有Godot4.3编译GDScript PCK恢复通过 |
| Python Frida CLI | 17.26.1，仅记录独立版本，不用于本服务动态调用 |

15项原静态冒烟、Native/Hermes及本轮Flutter/ILSpy/GDRE/Java联合观测通过，详见[验证记录](VALIDATION.md)。`doctor`检查命令/可选引擎路径和JAR校验，不import Frida、不启动REA、不连接设备；`native.providers`则按需启动独立REA做Native provider检查。`available=true`不能替代逐项样本验收。

## 7. 常见问题定位

| 现象 | 排查方法 |
| --- | --- |
| 工具在 Ghostty 可用，MCP 报缺失 | 核对客户端启动环境 PATH，必要时在客户端中明确 environment 和 node 可执行路径 |
| 已装 jadx，DEX 仍不可用 | 检查独立 headless JAR、SHA256、REA_JADX_MCP_JAR 和完整 JDK |
| REA 资源查询失败，本地 apktool 可用 | 检查 sidecar PATH / REA_APKTOOL_COMMAND；文件需要可执行权限 |
| Frida CLI 正常但 MCP 动态失败 | 区分 Node/Python binding、server/Gadget 版本、ABI、权限与实际 deviceId |
| 超时或内存不足 | 查 jobs.error 和任务日志；先缩小目标，降低并发负载，合理配置 JVM 内存/超时 |
| 目录被拒绝 | 输入和 keystore 需位于 allowedRoots 或 workspace，符号链接按真实路径验证 |
| 解包 partial | 分别读 jadx.log、apktool.log；部分 Java 方法失败不应被解释为整个 APK 没有对应逻辑 |
| 输出截断 | 遵循 nextOffset 分页；日志捕获本身也有预算，必要时针对更小范围重查 |

依据包括固定 REA 6.9.0 的 Android/Frida 合约、JadxRelease 和 ApktoolConfiguration，以及本项目实际执行结果；参见 [参考来源](REFERENCES.md)。


## 8. 0.2.0新增环境与调用

新增引擎变量、Ghidra原生构建/JDK25、Hermesvenv、各框架CLI、运行观测和限制统一维护在[ENGINES.md](ENGINES.md)。`--no-rea`仍可运行artifact、JS、本地解包和已配置外部framework CLI，但无法使用REA提供的DEX/Native/Frida能力。

0.3.0新增引擎的固定版本、下载校验与私有目录安装记录见[ENGINE-SETUP.md](ENGINE-SETUP.md)。要使用完整已实现能力，需准备上述静态链、Ghidra provider、四种已验证外部引擎、Java bundle编译依赖与授权设备；IL2CPP/Ark等尚未验收能力不能通过“安装所有依赖”直接变成已支持。

0.4.0的动态JNI注册与RVA复用原设备/编译依赖，无需新引擎。完整步骤与预算见[JNI-OBSERVATION.md](JNI-OBSERVATION.md)。`smoke:jni`还需SDK NDK编译自有SO、Java/SDK生成APK、readelf验证非导出，并只读取指定测试PID的fixture日志；普通MCP观测不需要本地NDK或样本签名材料。

## 9. 0.5.0新增依赖

| 能力 | 依赖与已验证范围 |
| --- | --- |
| 分包inspect/validate | Python、apkanalyzer、apksigner、完整JDK；同签名base/config自有样本 |
| APKS select / AAB | bundletool1.18.3；AAB代码/资源派生另需aapt2/JADX/apktool；真实自建AAB及设备spec选择通过 |
| dex.kotlin | 完整JDK17+、固定headless0.7.1、kotlin-metadata-jvm与stdlib2.3.21；无需REA进程；自有Kotlin2.0.21→DEX的suspend/inline/签名/状态机及真实JavascriptInterface注解通过 |
| managed | Python；压缩提取需私有venv的lz4==4.4.5与zstandard==0.25.0；自有DLL的store/ELF结构夹具→提取SHA→ILSpy通过，完整MAUI未测 |
| webview | Node26原生WebSocket、ADB、已开放WebView debugging的明确包/PID；/proc不可读时显式rootRead并需su；不依赖Frida/桌面Chrome |
| 自定义loader | 原Frida/Java编译链；POCO真实DexClassLoader→方法80通过，未知loader不保证唯一可识别 |
| evidence | Node、当前workspace已完成任务的固定报告；无需数据库或服务 |

固定引擎路径、环境变量和下载校验见[ENGINE-SETUP.md](ENGINE-SETUP.md)新增章节，详细操作与预算见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)。开发smoke还需样本构建工具，不能混成普通分析的启动条件。未安装引擎不阻止其他独立功能启动。
