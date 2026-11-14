# 首发与后续待办

核对日期：2026-11-14。`v0.5.2`已发布到公开GitHub仓库，`v0.5.0`与`v0.5.1`旧tag保留。npm publish因`npm whoami` E401和registry publish E404未完成；GitHub Release与npm发布状态分别跟踪。

## 首发门槛

| 状态 | 事项 | 所需动作与验收 |
| --- | --- | --- |
| 已完成（tag快照） | 0.5.1本机质量门 | 从tag导出快照后，39项自动测试、语法检查、51文件包清单、tarball实装通过；静态/Compose/分包/store smoke有本地报告记录 |
| 已完成（tag快照） | 0.5.1通用增量 | View onClick、source map/container evidence、真实Compose调用候选、CDP/loader拒绝路径已在tag中；能力边界见CAPABILITIES和VALIDATION |
| 待处理 | npm包名/发布身份 | `npm whoami`返回401、`npm publish`返回404；需登录目标npm账号并确认包名权限后再发布及验证安装 |
| 已完成 | GitHub仓库/remote | 公开仓库`https://github.com/lonnnnnng/android-reserve-mcp`已创建并配置为origin |
| 已完成 | 0.5.2提交/tag | 主分支与annotated tag `v0.5.2`已推送；保留`v0.5.1`旧tag |
| 已完成（GitHub） | 首次公开发行 | GitHub Release已发布并为Latest；Ubuntu/macOS CI均成功，tarball与SHA-256资产下载回验通过 |
| 发布后 | 客户端验证 | 重启OpenCode并检查`android-reserve`可见20个工具；现有配置保留，不改provider/API Key |

首发不必等待每个Android框架专项全部完成。GitHub版`v0.5.2`已发布；待恢复npm账号认证后再完成registry发行。

## 可在当前环境继续完成

| 优先级 | 工作 | 验收结果 |
| --- | --- | --- |
| 已完成（0.5.2候选） | 完成release tarball全新安装与协议测试 | `npm run smoke:release`通过；当前包检查52个文件，`v0.5.1`快照包检查51个文件 |
| 已完成 | 为README加入已发布后的npm安装命令，并标明发布前的本地安装命令 | npm版与GitHub源码版的安装路径、Node和外部引擎要求清楚 |
| 部分完成，待最终快照重跑 | 本机`check`、`test`、`check:pack`、静态smoke、audit并刷新VALIDATION | `0.5.2`候选的`check`、39项`test`、`check:pack`、`smoke:release`、static/Kotlin/packages/store smoke及依赖审计通过；设备重跑被Gadget能力条件阻塞。GitHub Actions未运行 |
| 已完成 | 检查resources扩展action Schema及工具清单 | resources view-events参数明确，MCP仍是20个工具入口 |
| P1 | 收敛历史文档中仍写“0.4未支持”但已在0.5实现的陈述 | 历史记录保留版本，当前用法统一指向0.5文档 |
| P1 | 检查首发包第三方NOTICE、npm元数据与许可证 | 包名/作者/MIT/依赖范围正确；无项目私有路径、样本、缓存或凭据 |
| P2 | 核对macOS arm64完整安装、frida install-script路径 | npm clean install后Java compiler host binding可构建；不覆盖REA设备server版本 |
| 已完成 | 实测npm 11下tarball依赖安装脚本审批与Frida binding导入 | 普通安装先阻止未审查脚本；临时项目逐包审批、rebuild后binding可import，已把边界和命令写入README/环境/维护说明 |

这些事项不需要Unity/Unreal等外部样本；纳入公开发行前应更新版本说明并对最终快照重新验收。

## 需要新样本或设备

| 专项 | 待办 | 缺少的验证条件 |
| --- | --- | --- |
| View / Compose / KMP | JetNews已构建并真机打开文章详情；Platform Samples Views/Compose drag-and-drop AAR及主App已构建、目录页已启动。仍需XML onClick类/方法落点实样、Compose状态/重组/导航/事件关系、KMP klib与commonMain/其他target | Compose界面导航只证明样例运行；APK框架标签为文件布局候选；完整语义和KMP多target仍缺 |
| React Native / Hermes | RNTester arm64 Release APK、HBC 99及同次构建source map已生成，真机启动通过；当前MCP适配器因HBC 99超出72–96范围而安全拒绝。仍需覆盖支持范围内多HBC版本、JSI/TurboModules/Fabric及JS↔Native真实关联 | 未支持HBC 99的反汇编输出不计验收；RNTester启动不等于交互/桥接链路已验证 |
| Flutter | 官方 platform_channel Debug/Release APK已构建；真机Driver测试验证样本App按钮通过MethodChannel取得Android电量值，Release配对库Blutter分析通过 | MCP尚未验收Dart↔Android桥接还原；仍需更多Dart版本/ABI、EventChannel运行态、其他插件及debug VM service样本 |
| Web混合 / PWA / TWA | 官方WebView APK构建、真机启动和CDP请求采集通过；已捕获天气JSON HTTPS GET，但设备端fetch失败，没有成功响应 | 不能记作真实公网响应链已验收；还需可控网络/本机服务权限、成功的TCP WebView、插件注册链与TWA浏览器上下文；当前真机TCP socket曾被系统拒绝 |
| Lynx / NativeScript / uni-app / Taro | 专用bundle/codec/snapshot、跨runtime及target分流 | 各框架版本的自有发布产物、未压缩source map、可确认的插件/业务预期 |
| JNI / 自定义loader | JNI其他表/ABI/CheckJNI、当前绑定快照、异步跨线程因果关系、InMemory/非BaseDex loader | 不同Android版本/ABI/root策略设备；覆盖目标机制的自有fixture；可对照原始调用关系 |
| .NET MAUI | 真实完整MAUI APK、多store/runtime版本、Mono AOT/NativeAOT地址映射 | 对应.NET/Android版本自有MAUI debug/release APK、未裁剪符号/metadata；NativeAOT样本 |
| Unity | Mono与IL2CPP分流、metadata匹配、AssetBundle/资源引用、Unity版本矩阵 | 自有Unity Mono/IL2CPP APK及同构建global-metadata、libil2cpp、资源包和预期脚本/资源 |
| Unreal | Pak/IoStore版本、压缩/加密、UObject/Blueprint与资源关系 | 自有Cooked APK/Pak/IoStore、对应版本工程、已知key（若加密）、Blueprint预期结果 |
| Godot | 多版本PCK、C#、加密/自定义字节码及资源图 | 自有Godot C#/GDScript多版本APK/PCK、导出模板与预期节点/资源引用 |
| HarmonyOS NEXT | HAP/HSP/.app、ABC/ArkUI、签名/资源及设备调试链 | 合法可用的HarmonyOS NEXT SDK与开发设备、多个版本自有样本；Android/ADB/frida结果不能代替 |

### 可复用的开源样本来源（检索于2026-11-14）

GitHub上能找到可构建的源码工程，但仓库不一定附带已构建APK。本轮已将下表中的 Compose、Views/Compose、WebView、RN/Hermes 与 Flutter 候选固定到具体上游commit，在隔离目录完成构建并对部分样本进行真机验收。逐项结论、SHA-256、失败边界和环境副作用见[样本验收记录](SAMPLE-VALIDATION.md)；未通过的真实网络请求和不支持的HBC版本仍按未完成处理。

| 样本方向 | GitHub来源 | 能提供的验收链 | 限制与建议 |
| --- | --- | --- | --- |
| View / XML事件 | [android/platform-samples](https://github.com/android/platform-samples)；精确`android:onClick`例子见已归档的[android/codelab-android-databinding](https://github.com/android/codelab-android-databinding) | 前者有Views与Compose平台交互示例；后者布局的`android:onClick="onLike"`对应Activity方法，可核对资源声明与方法签名 | Data Binding codelab已弃用且归档；若要维护稳定回归样本，优先在自有小fixture保留`android:onClick`，用平台样例补更真实的Views事件 |
| Compose状态/导航 | [android/compose-samples JetNews](https://github.com/android/compose-samples/tree/main/JetNews)；较完整的[android/nowinandroid](https://github.com/android/nowinandroid) | Compose列表/详情、状态控件、drawer和navigation；Now in Android的`demoDebug`使用本地静态数据，可在无业务账号时构建 | Now in Android工程较大并标注WIP；当前分支AGP/Gradle可能变化，构建前固定commit并检查Android Studio/SDK要求 |
| 真实网络WebView | 官方文档指向[android/views-widgets-samples/WebView](https://github.com/android/views-widgets-samples/tree/main/WebView) | [MainActivity](https://github.com/android/views-widgets-samples/blob/main/WebView/app/src/main/java/com/android/samples/webviewdemo/MainActivity.kt)按debuggable条件启用WebView DevTools；[main.js](https://github.com/android/views-widgets-samples/blob/main/WebView/app/src/main/assets/main.js)通过`fetch`请求GitHub上的weather JSON，适合真实CDP Network请求/响应验收 | 仓库已于2025-07-11归档。主HTML由`WebViewAssetLoader`提供，但JSON由页面另行公网fetch；这两个流量需在验收中区分。手机网络受限时请求可能失败，不能把拦截器响应记作公网访问 |
| RN / Hermes | [React Native RNTester](https://github.com/facebook/react-native/tree/main/packages/rn-tester) | 官方集成样本含legacy modules、TurboModules、JSI/C++和新式ViewManager；release链用于检查Hermes bytecode及source map | 需克隆并构建整个React Native仓库，首次构建成本较高；必须保留同一commit的APK、HBC和source map，不能用debug bundle代替release字节码验收 |
| Flutter platform channel | 推荐小型官方样本[flutter/flutter/examples/platform_channel](https://github.com/flutter/flutter/tree/master/examples/platform_channel)；Kotlin多channel样本[flutter/samples/platform_channels](https://github.com/flutter/samples/tree/main/platform_channels) | Dart `MethodChannel`调用Android原生Java/Kotlin handler；官方主样本还包含`EventChannel`，可对照Dart调用、Android注册及设备返回值 | 两者都是宿主App里的channel实现，不是独立Flutter plugin包。主仓库样本工程较小；samples仓库Kotlin版Android Gradle配置较旧，需先验证构建兼容性 |

后续实现验收优先使用轻量工程：XML `onClick`继续用自有fixture，Compose使用JetNews，WebView用官方Android样例，RN/Hermes用RNTester，Flutter使用Flutter官方`platform_channel`。样本已经构建的技术栈仍需按缺口补静态语义和动态因果；开源源码、成功构建或应用能启动本身都不代表该技术栈已完整支持。

## 需要跨平台CI环境

- Linux：实际npm install/stdio、Python/JDK工具选择、原生依赖和tarball边界；当前CI工作流含Ubuntu job，但尚无远端运行结果。本机有Docker CLI但daemon未运行，不能在当前会话启动Linux容器验收。
- 其他macOS架构/Node小版本：Node最低版本约束与Frida预编译/构建兼容。
- Windows：目前不是支持目标；若要纳入需先解决POSIX进程组取消、路径/工具发现、Android/REA/Frida依赖，再建立Windows CI。
- 多Android API/厂商：WebView DevTools socket、`/proc`/root读取、PID代次和Frida server兼容组合。

### 本机 tag 后改动

source map/evidence容器、View `android:onClick`声明与真实Compose编译smoke已经包含在本地`v0.5.1` tag；延迟Native模块等待/hook及本次状态审计文档还在tag后的工作树中。定版前核对[变更记录](../CHANGELOG.md)、PROGRESS和VALIDATION，确认新版本号并完成最终快照测试；不得覆盖或重复使用已有`v0.5.1` tag。

## 后续推荐顺序

1. 审查并定版当前tag后工作树，明确首发使用已有`v0.5.1`tag还是纳入未提交改动后发布新版本；首发不等于全技术栈完成。
2. 用本轮样本补主流应用链路：处理HBC 99的版本覆盖、取得成功的WebView公网响应，并补Compose交互和RN↔Native因果验收。
3. 再取得MAUI/Unity/Unreal/Godot样本，分别做容器与引擎语义验收。
4. Harmony NEXT独立安排SDK、设备与工具链，不并入普通Android验收。

每个专项按README所定义的识别、提取、分析、关联、动态验证分别记录；仅能解包或工具启动不能标成该框架已支持。
