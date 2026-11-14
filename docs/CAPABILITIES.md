# 当前能力与适用范围

核对日期2026-11-14。GitHub/npm已发布版本为`0.5.2`；本表包含尚未发行的工作树增量，其证据与限制见[本轮进展](CURRENT-INCREMENT.md)。历史验证见[VALIDATION.md](VALIDATION.md)，调用见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)、[ENGINES.md](ENGINES.md)。

项目/npm/协议服务名均为android-reserve-mcp；OpenCode连接/主模式为android-reserve，工具前缀android-reserve_。共有20个分组入口：doctor、apk、decode、dex、packages、managed、evidence、webview、search、resources、native、artifact、script、framework、device、frida、rebuild、jobs、artifacts、guidance。入口内多种action不单独计工具；后端全部工具数不代表本服务工具数。

| 类型 | 当前实现与验证证据 | 未完成或不能据此保证 |
| --- | --- | --- |
| Java/APK/split/AAB/View | Manifest/签名/DEX/资源/重建，所选分包一致性/聚合，AAB模块派生/APKS设备spec；XML `onClick` 声明候选。Platform Samples 的 Views/Compose 模块与主 App 已构建，主 App 仅验到目录页启动 | `onClick`候选不证明DEX方法存在或运行；样例构建/启动不证明 View 事件还原；所有设备/按需模块完整性、加固/动态生成内容、原始工程恢复 |
| Kotlin/Compose/KMP Android目标 | 原始metadata、suspend/inline及精确DEX签名；自有Compose编译候选；工作树保留DEX偏移/被调签名，JetNews输出195类、242调用候选（partial）；样本真机详情导航 | JetNews导航不证明 MCP 已关联该UI事件；完整Compose状态/重组/事件流、异步调用图、KMP其他target/commonMain/klib |
| C/C++/NDK | ARM64函数/伪码/引用、导出或RVA观测、标准JNI未来注册/撤销、Java同调用范围；自有延迟加载SO此前完成等待与Native hook验收 | 本次候选重跑被REA拒绝spawn（jailbroken/Gadget能力条件），未能复验；全ABI/全JNI表、完整绑定快照/数据流/精确RVA栈 |
| 自定义loader | 自有DexClassLoader枚举、唯一selector、精确类与方法观测 | 所有未知loader或InMemory loader均能唯一选择、任意父委派结果 |
| WebView/JS混合 | JavascriptInterface声明/已知重载观测；CDP DOM/源码/Network/正文；官方样本取得公网200、454字节正文，复验又有pending超时 | 网络稳定性、强制开启调试、完整插件注册/路由、JS异步→Java因果、TWA浏览器上下文 |
| RN/JS/TS/Hermes | AST/词法绑定/source map、HBC84；工作树对真实RNTester HBC99显式实验反汇编，输出20,033,939字节hasm并强制partial | HBC99正式兼容、debug元数据、JS源码恢复、JSI/TurboModules/Fabric与运行桥接关联、全部版本 |
| Flutter | ARM64 AOT；工作树channels核对同APK配对库后关联battery/getBatteryLevel的Dart模板→Android注册/handler候选；样本Driver运行通过 | 静态候选不是完整数据流或MCP运行因果；R8合并类分支、其他Dart/ABI、EventChannel运行态和VM service |
| 托管/.NET MAUI | store v1/v2/v3、ELF符号/payload、LZ4/Zstd；真实MAUI10 APK→122程序集→88引用ILSpy，自有页面/函数恢复；同一最终APK真机按钮返回46 | 托管运行调用关联、其他runtime/AOT映射、NativeAOT按IL恢复；最初启动失败及修复条件单列 |
| Godot | GDRE/Godot4.3编译GDScript PCK恢复 | 更多版本/C#、复杂场景资源图、未知加密格式 |
| Unity/Unreal/HarmonyOS NEXT（暂缓） | 保留通用容器/Native/托管层与IL2CPP/Ark固定CLI适配；2026-11-14起短期不推进专项 | 专用引擎/真实产物、资源/Blueprint和NEXT完整链仍未验收；移出当前迭代及发版门槛，恢复需用户明确安排 |
| Lynx/NativeScript/uni-app/Taro/低代码 | 按实际JS/DEX/Native/Web资产分流复用 | 专用codec/snapshot/UTS、多target及完整框架专项 |
| 跨任务证据 | 内容哈希、显式source map坐标、inventory容器成员结构、Kotlin精确签名、View声明候选、Compose编译调用候选、JS词法绑定、同脚本运行调用ID、CDP采集来源 | source map与bundle构建身份、全程序图、按相同PID/时间/RVA猜调用关系、无来源的自动跨层关联 |

运行观测要求明确设备与目标。POCO F2 Pro Android16上，公开样本验到JetNews详情导航、Flutter MethodChannel返回、RNTester启动、Platform Samples目录页和WebView单次公网响应。WebView复验有超时；MAUI初次启动失败，最终自有APK运行返回46。应用交互与MCP分析分别记录，详情见CURRENT-INCREMENT。不会自动安装目标、开启调试、提权或生成绕过脚本；raw load由调用者负责。

静态候选、声明、机器码伪代码、运行事件和内容同一性分别标记；能解包或CLI能启动不等于完整框架恢复。已有源码可交给客户端内置文件工具阅读，不属于MCP已恢复原工程的证据。
