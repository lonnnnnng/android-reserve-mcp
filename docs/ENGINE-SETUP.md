# 0.3.0可选引擎安装与验收

2026-11-13实测环境为macOS arm64。以下记录本轮实际采用的固定版本与布局，不是自动安装器；其他OS/ABI须选择对应发行包。已有目录先检查内容与版本，不覆盖已有手工引擎。所有可选工具不随npm包分发。

本MCP默认发现`~/.local/share/android-reserve-mcp/engines`中的下列布局；环境变量可覆盖默认值。更改客户端environment后重启MCP。基础Node/Java/SDK、Ghidra、Hermes和设备条件见[ENVIRONMENT.md](ENVIRONMENT.md)、[ENGINES.md](ENGINES.md)。

## Blutter / Flutter AOT

依赖：Python独立venv及pyelftools/requests，C++20编译器、CMake、Ninja、pkg-config、ICU、Capstone，足够的磁盘/内存及GitHub/Google下载网络。本机使用Apple Clang16、CMake4.4.5、Ninja1.13.2、ICU79.1、Capstone5.0.9。仅新增缺失Capstone，未升级原有工具。

在确认缺项后安装；Homebrew命令会改变宿主工具环境：

```zsh
brew install cmake ninja pkg-config icu4c capstone
```

以下目录应为本次独立安装目录；clone目标不能已存在：

```zsh
engine_root="$HOME/.local/share/android-reserve-mcp/engines"
mkdir -p "$engine_root"
git clone https://github.com/worawit/blutter.git "$engine_root/blutter"
git -C "$engine_root/blutter" checkout --detach 4a60ac648bf448c5a7596437243bcd0b9376fdf0
python3 -m venv "$engine_root/blutter-env"
"$engine_root/blutter-env/bin/python" -m pip install pyelftools==0.33 requests==2.34.2
```

本机引擎适配为此默认目录选择专用Python、Apple clang和ICU的pkg-config路径，不修改全局PATH/JAVA_HOME。自定义目录须自行准备编译环境，传入绝对路径`ANDROID_RESERVE_BLUTTER`、`ANDROID_RESERVE_ENGINE_PYTHON`；可通过客户端environment传CC/CXX/PKG_CONFIG_PATH。

Blutter会直接调用Ninja，单设`CMAKE_BUILD_PARALLEL_LEVEL`不足以限制其并发。本机额外准备私有包装器，适配器只在默认Blutter目录下将它加入子进程PATH；先确认实际Ninja位置，不在PATH最前已是包装器时反复套用：

```zsh
command -v ninja
mkdir -p "$engine_root/build-tools/bin"
cat > "$engine_root/build-tools/bin/ninja" <<'SH'
#!/bin/sh
# long: 限制Dart VM和Blutter编译并行，防止默认Ninja并发占满宿主内存。
exec /opt/homebrew/bin/ninja -j4 "$@"
SH
chmod 755 "$engine_root/build-tools/bin/ninja"
```

这里`/opt/homebrew/bin/ninja`是本机Apple Silicon Homebrew路径，其他环境替换为真实二进制。

分析输入需从**同一个构建、同一个ARM64 ABI**提取`libapp.so`和`libflutter.so`到一个目录；适配器检查ELF/ABI并记录各自SHA256，不独立证明配对关系。调用`framework.analyze`时显式`allowEngineBuild=true`。Blutter可能下载Dart源码并编译，首次预算600秒；完整独立缓存保存在其checkout内，不复用用户工程。

本轮自有样本：Flutter3.41.9/Dart3.11.5，`output/flutter-owned-sample`中的release ARM64 APK。该目录是开发验收产物，不随包提供；已存在时运行`npm run smoke:flutter`提取配对库并验证对象池标记和reserveAdd汇编。重建该样本使用其自身Flutter/Gradle配置，不自动升级全局Flutter。样本APK未安装手机。

示例源码保存在`examples/fixtures/flutter-main.dart`。从仓库根目录复现时，使用所需Flutter版本和**尚不存在的新样本目录**，不要在其他Flutter工程上执行create或覆盖main.dart：

```zsh
flutter create --platforms=android --org dev.androidreserve \
  --project-name reserve_flutter_fixture --offline output/flutter-owned-sample
cp examples/fixtures/flutter-main.dart output/flutter-owned-sample/lib/main.dart
(
  cd output/flutter-owned-sample
  flutter pub get --offline
  flutter build apk --release --target-platform android-arm64 --no-pub
)
npm run smoke:flutter
```

`--offline`仅针对模板/pub缓存；Gradle首次仍可能下载匹配Flutter engine的AAR、AGP或构建依赖。没有Flutter/pub/SDK缓存时先按Flutter官方流程准备，不把下载失败记为MCP分析失败。当前目录已存在时，保留其工程和签名，只按既有配置重建。

## ILSpy / 独立.NET10

ILSpy11.2.0.10050的macOS包需要.NET10，安装pointer包还需要SDK≥10.0.100。本机全局.NET6保留，使用独立SDK10.0.403/runtime10.0.14。安装前准备空的`dotnet10`目录；校验不符停止，不解压：

```zsh
engine_root="$HOME/.local/share/android-reserve-mcp/engines"
mkdir -p "$engine_root/dotnet10"
curl --fail --location --retry 3 \
  'https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.403/dotnet-sdk-10.0.403-osx-arm64.tar.gz' \
  -o "$engine_root/dotnet-sdk-10.0.403-osx-arm64.tar.gz"
shasum -a 512 "$engine_root/dotnet-sdk-10.0.403-osx-arm64.tar.gz"
```

预期SHA512（本轮已计算一致）：

```text
5893c66b48ea3674c7da18501059d606e96f3672fabe4d5e41762e692c7c83df3ee0b2b9dc5a0786191da2dc413d7335158101c14c935ab217f31ac2529770f3
```

校验一致后解压，在子shell内安装，环境仅作用于本次命令：

```zsh
tar -xzf "$engine_root/dotnet-sdk-10.0.403-osx-arm64.tar.gz" -C "$engine_root/dotnet10"
(
  export DOTNET_ROOT="$engine_root/dotnet10"
  export DOTNET_ROOT_ARM64="$DOTNET_ROOT"
  export DOTNET_CLI_HOME="$engine_root/dotnet-state/cli-home"
  export NUGET_PACKAGES="$engine_root/dotnet-state/packages"
  export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=true
  export DOTNET_GENERATE_ASPNET_CERTIFICATE=false
  export DOTNET_ADD_GLOBAL_TOOLS_TO_PATH=false
  "$DOTNET_ROOT/dotnet" tool install ilspycmd \
    --tool-path "$engine_root/ilspy-tools" --version 11.2.0.10050 \
    --arch arm64 --source https://api.nuget.org/v3/index.json
  "$engine_root/ilspy-tools/ilspycmd" --version
)
```

默认目录的ILSpy apphost由适配器使用私有DOTNET_ROOT与DOTNET_ROOT_ARM64启动；自定义安装设置`ANDROID_RESERVE_ILSPY`和`ANDROID_RESERVE_DOTNET_ROOT`为绝对路径。IL2CPP DLL适配仍走其自身runtime，不自动复用这套.NET10。

`npm run smoke:managed`生成自有net10 classlib，使用无源NuGet配置离线restore/build，再通过MCP反编译并核对类型/标记/表达式。正常目标应先提取托管PE/CLI：MAUI assembly store、Mono AOT、NativeAOT不作为普通DLL输入。

## GDRE / Godot

本机固定GDRE2.7.4。下列为macOS发行包，Linux需换对应制品；已存在的安装先确认版本：

```zsh
engine_root="$HOME/.local/share/android-reserve-mcp/engines"
curl --fail --location --retry 3 \
  'https://github.com/GDRETools/gdsdecomp/releases/download/v2.7.4/GDRE_tools-v2.7.4-macos.zip' \
  -o "$engine_root/GDRE_tools-v2.7.4-macos.zip"
shasum -a 256 "$engine_root/GDRE_tools-v2.7.4-macos.zip"
```

预期SHA256（本轮已计算一致）：

```text
a148b9509c2826fcc238e81c21005bf3128bdcee1a87c3f79ad943a205aa2170
```

校验一致后：

```zsh
unzip "$engine_root/GDRE_tools-v2.7.4-macos.zip" -d "$engine_root/gdre-2.7.4"
"$engine_root/gdre-2.7.4/Godot RE Tools.app/Contents/MacOS/Godot RE Tools" --headless --gdre-version
```

2.7.4的版本命令打印正确版本但exit1，这是本轮实测；适配器仅在该探测有版本标识且无超时/取消时接受，不把分析exit1当成功。自定义入口使用`ANDROID_RESERVE_GDRE`。

`npm run smoke:godot`每次新建样本目录，用GDRE自身编译Godot4.3 GDScript字节码、打PCK并恢复，不额外安装Godot editor或export templates。PCK清单严格为编译脚本、remap、场景和project配置四项，排除明文脚本假阳性；恢复后检查实际代码语义。

## 升级与失败处理

保留当前可用引擎和缓存，用新目录安装候选版本、记录源码commit/制品哈希，配置变量指向新版本后重启MCP并重跑相应自有样本。失败则恢复原变量/目录，不删除用户目标或其他引擎。默认发现路径包含部分固定版本，改版本时要同步代码、安装文档和验收矩阵。

`framework.probe`只验证启动；`framework.engines`只检查配置，二者都不能替代真实分析。本轮只完成所列样本和版本；更多Dart/Godot、MAUI store、Unity/Unreal与Harmony仍在[缺口清单](ROADMAP-GAPS.md)。

## 0.5.0：bundletool / Kotlin / assembly store

这些是独立可选依赖；普通启动不自动下载或改全局环境。默认根仍为`~/.local/share/android-reserve-mcp/engines`。自定义绝对路径变量：ANDROID_RESERVE_BUNDLETOOL（JAR）、ANDROID_RESERVE_KOTLIN_HOME（目录）、ANDROID_RESERVE_MANAGED_PYTHON（解释器）。改变后重启客户端。

bundletool默认文件`bundletool-all-1.18.3.jar`，来自[官方v1.18.3发行](https://github.com/google/bundletool/releases/tag/1.18.3)，SHA256必须为：

```text
a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29
```

下载到尚不存在的目标文件，校验后使用；已有文件先比较版本和哈希，不覆盖手工引擎。默认JAR每次调用前校验哈希，自定义路径为显式信任，依然需要自行验证来源。JDK启动堆1GiB/180秒；AAB转换还需SDK aapt2。

Kotlin目录包含以下两个独立JAR；本机从已存在Gradle缓存复制，未升级全局Kotlin/Gradle。其他环境可从Maven Central按相同坐标获取，不能混用编译器/metadata/stdlib近似版本：

| 文件 / Maven坐标 | 本轮SHA256 |
| --- | --- |
| kotlin-metadata-jvm-2.3.21.jar / org.jetbrains.kotlin:kotlin-metadata-jvm:2.3.21 | 00590f26a5a768777f04252c6cf93c016a3361a6bc93636df67375ad4d19557d |
| kotlin-stdlib-2.3.21.jar / org.jetbrains.kotlin:kotlin-stdlib:2.3.21 | 6f64eac736db9434dd6925b4a518b9d1d17177652320c37916cf9ba3ce7d7d7a |

还需固定SHA的headless JADX0.7.1和完整JDK17+。代码核实headless哈希，Kotlin这两份库由安装者按表校验。每任务编译MetadataInspect.java并运行，无需REA；自有编译验收额外使用固定Kotlin2.0.21编译器及其缓存依赖，详见scripts/kotlin-smoke.mjs，不是目标分析依赖。

托管store的压缩提取使用私有venv，不向系统Python安装包。下面目录应是自己新建的专用环境，已存在时先核对，不能覆盖其他venv：

```zsh
engine_root="$HOME/.local/share/android-reserve-mcp/engines"
python3 -m venv "$engine_root/managed-env"
"$engine_root/managed-env/bin/python" -m pip install lz4==4.4.5 zstandard==0.25.0
"$engine_root/managed-env/bin/python" -m pip check
```

没有私有解释器时会回退PATH的python3，标准库inspect/无压缩提取仍可用；遇到压缩但缺模块时任务失败并保留日志，不悄悄跳过程序集。提取后IL反编译仍需原ILSpy/.NET10；ELF封装的开发夹具编译还需NDK，普通提取不需要NDK。

WebView使用Node26自带WebSocket和ADB，不安装桌面浏览器或额外npm WS库。设备必须已开放调试，rootRead只是显式固定/proc读取。详细预算/参数/清理与证据含义见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)。
