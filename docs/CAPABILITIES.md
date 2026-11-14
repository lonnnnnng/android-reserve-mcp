# 当前能力与适用范围

适用版本`0.5.2`，核对日期2026-11-14。GitHub Release已发布，npm尚未发布；实现与验证层级见[PROGRESS.md](PROGRESS.md)和[VALIDATION.md](VALIDATION.md)，调用见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)、[ENGINES.md](ENGINES.md)。

项目/npm/协议服务名均为android-reserve-mcp；OpenCode连接/主模式为android-reserve，工具前缀android-reserve_。共有20个分组入口：doctor、apk、decode、dex、packages、managed、evidence、webview、search、resources、native、artifact、script、framework、device、frida、rebuild、jobs、artifacts、guidance。入口内多种action不单独计工具；后端全部工具数不代表本服务工具数。

| 类型 | 当前实现与验证证据 | 未完成或不能据此保证 |
| --- | --- | --- |
| Java/APK/split/AAB/View | Manifest/签名/DEX/资源/重建，所选分包一致性/聚合，AAB模块派生/APKS设备spec；XML `onClick` 声明候选。Platform Samples 的 Views/Compose 模块与主 App 已构建，主 App 仅验到目录页启动 | `onClick`候选不证明DEX方法存在或运行；样例构建/启动不证明 View 事件还原；所有设备/按需模块完整性、加固/动态生成内容、原始工程恢复 |
| Kotlin/Compose/KMP Android目标 | 原始metadata、suspend/inline及精确DEX签名；自有Compose编译DEX上的Composer、状态API、remember与lambda方法内调用候选；JetNews真机打开文章详情 | JetNews导航不证明 MCP 已关联该UI事件；完整Compose状态/重组/事件流、异步调用图、KMP其他target/commonMain/klib |
| C/C++/NDK | ARM64函数/伪码/引用、导出或RVA观测、标准JNI未来注册/撤销、Java同调用范围；自有延迟加载SO此前完成等待与Native hook验收 | 本次候选重跑被REA拒绝spawn（jailbroken/Gadget能力条件），未能复验；全ABI/全JNI表、完整绑定快照/数据流/精确RVA栈 |
| 自定义loader | 自有DexClassLoader枚举、唯一selector、精确类与方法观测 | 所有未知loader或InMemory loader均能唯一选择、任意父委派结果 |
| WebView/JS混合 | 真实JavascriptInterface声明、已知桥接重载动态观测；已开放CDP的DOM/源码/Network/正文。官方样本捕获到天气JSON HTTPS GET，但设备端`fetch`失败，没有成功响应 | 真实公网响应链、强制开启调试、完整插件注册/框架路由、JS异步→Java业务调用关联、TWA浏览器上下文 |
| RN/JS/TS/Hermes | 静态AST/直接词法绑定/source map，HBC84自有样本分析；官方RNTester Release在真机启动，生成HBC99和source map，当前解析器按不支持版本拒绝 | RNTester启动不证明 MCP 完成RN分析；HBC99反汇编、JSI/TurboModules/Fabric与运行桥接关联、所有HBC版本 |
| Flutter | Blutter对Flutter3.41.9/Dart3.11.5 ARM64 release对象池/汇编实测；官方`platform_channel`样本Debug/Release构建和Driver真机测试通过，证明该样本的MethodChannel运行返回 | 样本Driver结果不证明 MCP 已还原Dart↔Android桥接；其他版本/ABI、EventChannel专项和debug VM service |
| 托管/.NET MAUI | ILSpy真实IL→C#；store v1/v2/v3与ELF、LZ4/Zstd结构样本提取逐字哈希一致 | 完整MAUI App/runtime/AOT验收、NativeAOT按IL恢复 |
| Godot | GDRE/Godot4.3编译GDScript PCK恢复 | 更多版本/C#、复杂场景资源图、未知加密格式 |
| Unity/Unreal/Ark | 通用容器/Native/托管层；IL2CPP/Ark固定CLI适配 | 专用真实引擎/产物、资源/Blueprint、Harmony NEXT完整链；没有自有真实样本也不能标通过 |
| Lynx/NativeScript/uni-app/Taro/低代码 | 按实际JS/DEX/Native/Web资产分流复用 | 专用codec/snapshot/UTS、多target及完整框架专项 |
| 跨任务证据 | 内容哈希、显式source map坐标、inventory容器成员结构、Kotlin精确签名、View声明候选、Compose编译调用候选、JS词法绑定、同脚本运行调用ID、CDP采集来源 | source map与bundle构建身份、全程序图、按相同PID/时间/RVA猜调用关系、无来源的自动跨层关联 |

运行观测要求明确设备与目标。POCO F2 Pro Android 16上，MCP设备注入/调用证据来自自有fixture；公开样本还分别验到JetNews详情导航、Flutter MethodChannel返回、RNTester启动和Platform Samples目录页启动。WebView公网样本只捕获到请求且未取得响应；自有`shouldInterceptRequest`响应仅证明WebView/CDP采集链，不能证明外网连通。公开样本上的启动或功能测试也不自动证明MCP已完成对应框架分析。不会自动安装目标、开启调试、提权或生成绕过脚本；raw load仍由调用者负责脚本行为。

静态候选、声明、机器码伪代码、运行事件和内容同一性分别标记；能解包或CLI能启动不等于完整框架恢复。已有源码可交给客户端内置文件工具阅读，不属于MCP已恢复原工程的证据。
