# 参考项目与依据

核验日期：2026-11-13。版本和能力按当时实际源码/README/包清单确认；外部项目后续可能更新。

0.4.0新增核验日期2026-11-14：[JNI函数与索引](https://docs.oracle.com/en/java/javase/25/docs/specs/jni/functions.html#registering-native-methods)、[JNI线程/多表约束](https://docs.oracle.com/en/java/javase/25/docs/specs/jni/design.html#jni-interface-functions-and-pointers)、Frida NativePointer有界读取及Interceptor返回契约；并读本机NDK28.2 jni.h和固定bridge7.0.13的Env/VM/类引用实现。完整用法与真实设备边界见JNI-OBSERVATION.md。

| 来源 | 用途与选择 |
| --- | --- |
| [js-reverse-mcp](https://github.com/zhizhuodemao/js-reverse-mcp) | 参考按领域组织工具、stdio、allowedRoots、有界结果/产物分页；未复制代码。Apache-2.0 |
| [REA](https://github.com/morluto/rea) / npm rea-agents 6.9.0 | 可选独立后端，复用固定 Android/Frida 允许列表；不转发完整工具集。MIT |
| [jadx-headless-mcp](https://github.com/1013503897/jadx-headless-mcp/releases/tag/v0.7.1) | REA 固定 headless 引擎0.7.1；下载身份/SHA来自 REA JadxRelease 源码 |
| [JADX](https://github.com/skylot/jadx) | CLI Java 反编译；与 headless 引擎单独安装 |
| [apktool](https://apktool.org/) | 资源/smali 解包、重建 |
| [Frida](https://frida.re/docs/android/) | Android 动态环境与 server/Gadget 概念；实际 backend 依赖以 REA 固定包为准 |
| [Frida Java API](https://frida.re/docs/javascript-api/#java) / [Java bridge](https://github.com/frida/frida-java-bridge) / [frida-compile](https://github.com/frida/frida-compile) | 显式bridge打包、精确overload、原调用/Throwable、线程与卸载；包/CLI契约与实际LICENSE已核对。本机Java栈改用Thread API并真机验证 |
| [Blutter固定commit](https://github.com/worawit/blutter/tree/4a60ac648bf448c5a7596437243bcd0b9376fdf0) | Python入口、配对ARM64库、Dart下载构建与汇编/对象输出；自有Dart3.11.5样本通过 |
| [ILSpy11.2.0.10050](https://www.nuget.org/packages/ilspycmd/11.2.0.10050) / [.NET10元数据](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json) | SDK10.0.403下载身份、ILSpy runtime/CLI要求与私有安装；裸托管程序集验收 |
| [GDRE2.7.4](https://github.com/GDRETools/gdsdecomp/releases/tag/v2.7.4) | 制品SHA256、compile/PCK/recover契约；自有Godot4.3字节码样本验收 |
| [Android command-line tools](https://developer.android.com/tools) | SDK、apkanalyzer、adb、签名/构建工具 |
| [jadx-mcp-server](https://github.com/zinja-coder/jadx-mcp-server) | 对照 GUI 插件方案；未作为依赖。Apache-2.0 |
| [apktool-mcp-server](https://github.com/zinja-coder/apktool-mcp-server) | 对照单 CLI 包装方案；未作为依赖。Apache-2.0 |
| [mobsf-mcp](https://github.com/plur1bu5/mobsf-mcp) | 对照 MobSF API/Docker 服务方案；未引入。MIT |
| [ultimate-mobile-mcp](https://github.com/Wael-Rd/ultimate-mobile-mcp) | 对照集成大量移动逆向工具的设计；只核对文档/许可，未逐项运行。MIT |
| [OpenCode Agents](https://opencode.ai/v1/docs/agents/) / [MCP](https://opencode.ai/v1/docs/mcp-servers/) | primary agent、permission glob、MCP 前缀与上下文过滤 |

本地 Skill 作为可选用户资料使用，不复制个人文件。外部 README 中宣称的工具数或覆盖范围不等于本项目已实测；实际交付范围以 src/server.js 和 VALIDATION.md 为准。

0.5.0专项（2026-11-14）：

- [bundletool v1.18.3](https://github.com/google/bundletool/releases/tag/1.18.3)：官方制品SHA、validate/dump/extract-apks；本机CLI help及真正自建AAB/APKS验收。
- [Kotlin metadata JVM](https://kotlinlang.org/docs/metadata-jvm.html)：readLenient/JVM signatures；固定2.3.21 JAR与headless0.7.1的实际API、真实Kotlin编译DEX核对。
- [AssemblyStores](https://github.com/dotnet/android/blob/main/Documentation/project-docs/AssemblyStores.md)：当前v3；[35.0.7布局](https://github.com/dotnet/android/blob/35.0.7/src/native/xamarin-app-stub/xamarin-app.hh)：v2的32/64 hash/descriptor/names。
- [XALZ→XAZS提交](https://github.com/dotnet/android/commit/2e306140c4ef623476b0a2d6dad0a2d263d542a6)：LZ4→Zstandard布局依据；结构样本不替代所有runtime实测。
- [CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/)与本机协议正文：request/response/loadingFinished/loadingFailed/getResponseBody；固定本项目支持动作，真实WebSocket协议夹具及POCO自有WebView验收。tot不保证任意设备版本全部支持。
- Frida bridge7.0.13实际ClassFactory与BaseDexClassLoader字段；唯一定义loader由真机样本验证。Android/设备私有字段跨版本仍须重新验收。
