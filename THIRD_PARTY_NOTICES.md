# 第三方说明

android-reserve-mcp 的原创代码采用 MIT 许可。运行时 npm 依赖包括 MCP TypeScript SDK（@modelcontextprotocol/sdk）和 Zod，随其依赖树适用各自许可；具体版本以 package-lock.json 为准。

0.2.0新增Babel parser/traverse/generator及@jridgewell/trace-mapping，均采用其各自MIT许可。hermes-dec为独立可选外部引擎（AGPL-3.0-or-later），本项目不复制或打包其源码/二进制；使用与分发仍须遵循其许可。Ghidra/JDK/其他框架引擎也不包含在npm包中。

REA（MIT）作为可选独立进程通过 stdio 调用，未将 REA 源码复制或打包进本项目。CLI 引擎 JADX、apktool，headless JADX JAR，Frida，以及 Android SDK/JDK/LLVM 等均由使用者单独安装并遵循各自许可。本项目 MIT 许可不向这些外部制品重新授予许可，也不包含它们的二进制文件。

0.3.0新增npm依赖[frida-java-bridge7.0.13](https://github.com/frida/frida-java-bridge)（包声明`LGPL-2.0 WITH WxWindows-exception-3.1`）和[frida-compile19.1.0](https://github.com/frida/frida-compile)（实际LICENSE.md为wxWindows Library Licence3.1，并含GNU Library GPL2或更新版及例外文本）。不将二者标为MIT。编译器传递依赖Frida17.26.3；许可与原生安装脚本按其各自包处理，package-lock固定依赖树。Java bundle在本地任务目录按需生成，包含bridge代码，分享生成物时仍须保留/遵循相关许可。

本轮安装的Blutter（其固定源码为MIT）、ILSpy/.NET和GDRE属于独立外部引擎及其依赖；引擎源码、SDK、二进制和Dart编译缓存都不在npm包中。Blutter依赖的Capstone/ICU、GDRE依赖的Godot以及各自第三方组件不由本项目MIT许可重新授权。外部引擎的分发应按对应发行包和LICENSE/第三方说明检查，不能将本机安装记录视为再分发授权。

js-reverse-mcp 等开源项目用于设计比较，未复制其源码。个人 Skill 文档通过本地只读接口使用，不包含在 npm 包或公开仓库中。参考地址与核验范围见 docs/REFERENCES.md。

0.5.0新增可选外部依赖bundletool1.18.3、kotlin-metadata-jvm/kotlin-stdlib2.3.21、Python lz4/zstandard均由使用者独立安装，未复制进npm包；安装和再分发应遵循各制品及其依赖的LICENSE/NOTICE。自有MetadataInspect.java通过固定版本JADX/Kotlin公开API读取声明，store布局依据dotnet/android官方文档/源码独立实现，未打包其runtime。WebView/CDP使用Node内置WebSocket，无额外WS npm依赖；协议/设备实现由其各自项目维护。
