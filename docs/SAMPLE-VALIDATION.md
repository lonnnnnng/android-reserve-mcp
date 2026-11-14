# GitHub 开源样本构建与验收

日期：2026-11-14。样本源码均在 `/tmp/android-reserve-open-samples-20261114/` 的隔离目录检出并固定到下表 commit；没有把第三方源码或构建产物复制进本仓库。APK/AAR 哈希用于确认本轮实际分析的文件。临时目录不是发布资产，清理或系统重启后可能不可用；本文件保存可复核的来源、结论和哈希。

动态验收目标为已授权 POCO F2 Pro，ADB serial `31936bb6`，Android 16。构建成功、MCP 静态检查、应用启动和真实功能交互分别记录，不互相代替。

| 样本 | 固定上游源码 | 构建产物与 SHA-256 | 本轮结果 |
| --- | --- | --- | --- |
| JetNews（Compose） | [`android/compose-samples`](https://github.com/android/compose-samples)，`25631e8f544a9a1e3f01e296eaf1b4c28428196c` | `view-compose/JetNews/app/build/outputs/apk/debug/app-debug.apk`，`a5d22369e1dc94f149b2b6782e0075826e02e33301cf270b969bd9e7457481d6` | 构建、MCP APK/产物检查通过；真机启动并打开文章详情页，确认目录到详情的基础导航。UI交互是样本App验收，不代表MCP已还原其状态、重组或事件因果。 |
| WebView 官方示例 | [`android/views-widgets-samples`](https://github.com/android/views-widgets-samples)，`2238cc873501f9cda63605051de11832bb736a8a` | `webview/WebView/app/build/outputs/apk/debug/app-debug.apk`，`817d887e80702e0ef48cb636f0086e2d235fcd5105c96f7c7928cf9eaa900998` | 构建、启动、CDP 页面和请求采集通过；捕获到对 `https://raw.githubusercontent.com/android/views-widgets-samples/main/WebView/sampleData/weather.json` 的 HTTPS GET。设备端页面随后报 `TypeError: Failed to fetch`，没有拿到成功响应，因此真实公网 WebView 响应链仍未验收。 |
| Flutter Platform Channel | [`flutter/flutter/examples/platform_channel`](https://github.com/flutter/flutter)，`00b0c91f06209d9e4a41f71b7a512d6eb3b9c694` | Debug APK：`platform-channel-build/build/app/outputs/flutter-apk/app-debug.apk`，`8396eccd46abbe0ddcf54ddc9348f7922df4447a44a396c8fdda4504f2ac471f`；Release APK：`.../app-release.apk`，`280c47cbfeba3d4a208e89000b513792d633fee12a6076a7c1b0eb9d71fb9513` | Debug/Release 构建通过；官方 Flutter Driver 真机测试通过，点击后通过 MethodChannel 从 Android 侧取得电量信息；Release 配对库的 Blutter 分析通过。Driver验证的是样本App运行链，MCP桥接还原能力未通过此项验收；本结果也不扩展到所有Dart版本、ABI或插件框架。 |
| React Native RNTester / Hermes | [`facebook/react-native/packages/rn-tester`](https://github.com/facebook/react-native/tree/main/packages/rn-tester)，`70f655a4c06b3dcfbc4a2d8cf55bd2deb644a6a3` | arm64 Release APK：`rn-build/packages/rn-tester/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`，`96eb47503a01e4a3a5224a07b7c3ea76057e1048f0b4aab2ada9d82376873c41`；HBC：`.../RNTesterApp.android.bundle`，`8e198ac81121e85fe9e2036407585ac4967627ef6d5b01d91d054a5e4aaa70d9`；source map：`.../RNTesterApp.android.bundle.map`，`ba96768805b87321e7a64760d60f5a1594af31e7e33e400bb5232a78b5b77ebe` | Release 构建和真机启动通过，HBC 与 source map 同次构建生成。当前 MCP Hermes 适配器明确拒绝 HBC 99（支持范围声明为 72–96）；外部反汇编器虽产出文件但提示版本未正式支持，所以不能记为 HBC 99 反汇编验收。 |
| Android Platform Samples（Views / Compose drag-and-drop） | [`android/platform-samples`](https://github.com/android/platform-samples)，`1ffa0db123200d1a2ee814173fa22c7a757b4385` | `samples/user-interface/draganddrop/build/outputs/aar/draganddrop-debug.aar`，`897ed80ca358b48db60a692faf9e438e1f56ed899c8e9388d6b685535fa3a5d8`；主 App APK：`app/build/outputs/apk/debug/app-debug.apk`，`8dc14ccb6ad94ea970e587405ac652b003c2a5ad839f4b1332a48d1abe4f97d5` | 样例 AAR 与主 App APK 均构建成功；主 App 真机启动并显示样例目录。Android 16 对该可调试 APK 弹出 16 KB ELF 对齐警告，列出多个上游依赖库未对齐；这是样例/依赖的兼容性问题，不能据此判断 MCP 的 APK 解析失败。 |

## 核验材料

- MCP 静态检查汇总：`/tmp/android-reserve-open-samples-20261114/mcp-analysis-results.json`。APK inspect 对上述 APK 成功；JetNews/WebView/RN 的框架标签仍是基于文件布局的候选，不是单凭该标签证明运行时框架语义。
- WebView CDP 请求事件：`/tmp/android-reserve-open-samples-20261114/webview-device-smoke.json`；最终页面截图：`/tmp/android-reserve-open-samples-20261114/webview-device-final.png`。
- Flutter Driver 真机结果：`/tmp/android-reserve-open-samples-20261114/flutter-device-smoke.log`；Release 构建日志：`/tmp/android-reserve-open-samples-20261114/flutter-release-build.log`。
- RN 构建日志：`/tmp/android-reserve-open-samples-20261114/rn-build.log`；HBC 99 的 MCP 拒绝结果见 `mcp-analysis-results.json` 的 `react-native-hermes-analysis` 项。
- Platform Samples 构建日志：`/tmp/android-reserve-open-samples-20261114/platform-samples-build.log`、`platform-samples-app-build.log`；提示关闭后目录页截图：`platform-samples-device-after-confirm.png`。
- JetNews Gradle 输出：`/tmp/android-reserve-open-samples-20261114/view-compose/build.log`；WebView Gradle 输出：`/tmp/android-reserve-open-samples-20261114/build.log`。样本仓库未改动，Flutter 临时构建副本只为兼容本机 Flutter 3.41.9 移除了 `pubspec.yaml` 的 workspace 声明。

## 环境与后续边界

- WebView 样例构建向共享 Android SDK 安装了 Platform 29 与 Build Tools 29.0.3。Flutter 构建期间对共享 SDK 的 NDK 自动安装曾被停止，后续 NDK/CMake 使用隔离 SDK；共享 SDK 中可能留有未完成安装标记，本轮没有清理它。
- RN 仓库的临时 checkout 被上游 `preinstall` 脚本改动了 `packages/react-native/package.json` 和 `yarn.lock`；这些改动只在 `/tmp` 构建副本，未写入本项目。
- 本轮补强了 Compose、WebView、Flutter channel、RN/Hermes 和官方 Views/Compose 样本的证据，但不代表 KMP、HBC 99、真实成功的 WebView 公网响应、完整 RN↔Native 因果、或其他设备/ABI 已验收。对应工作继续列在 [首发待办](FIRST-RELEASE-TODO.md) 与 [实施进展](PROGRESS.md)。
