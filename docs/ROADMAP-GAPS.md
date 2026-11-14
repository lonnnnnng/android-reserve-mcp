# 全技术栈产物分析：缺口清单与实施建议

日期：2026-11-13。基线：android-reserve-mcp 0.1.0、13个分组工具入口。

本文记录已批准实施的0.1.0基线缺口，不是当前功能表。当前实际进展和剩余项以[PROGRESS.md](PROGRESS.md)为准（截至2026-11-14，本地0.5.1 tag及其后工作树分别说明），调用与环境见[ENGINES.md](ENGINES.md)。Java同调用、标准入口未来JNI注册/撤销与RVA，以及Blutter/ILSpy/GDRE所列样本现已完成；0.5.x另已完成所选分包一致性/聚合、AAB派生、Kotlin声明、自定义loader、WebView/CDP、store提取和有界证据索引；边界见ADVANCED-ANALYSIS.md。下文保留原评估基线，不要把当时的“未实现”或候选当成当前状态。

## 1. 目标如何验收

“支持某类产物”应分级记录，不能只看能否解包：

| 层级 | 应交付的结果 |
| --- | --- |
| 识别 | 实际容器、框架/运行时、ABI、构建模式与版本证据；允许一个App包含多个技术栈 |
| 提取 | 提取代码、元数据、资源和关联文件；标明来源/哈希/偏移、缺失模块和未知格式 |
| 分析 | 类型、函数、调用/引用、配置、资源关联；明确输出是IL反编译、机器码伪代码还是元数据声明 |
| 关联 | DEX↔JNI↔SO、JS↔原生、Dart↔平台通道、游戏脚本↔资源的证据关联 |
| 动态验证 | 在明确设备和可用运行时下记录加载、参数、返回、堆栈等，并关联静态结果 |

这不等于恢复原始源码工程、注释、全部变量名、原始设计画布或服务端实现。编译优化、裁剪、混淆、缺失映射和版本差异需要体现在结果中。

## 2. 共用基础：当前缺少什么

| 编号 | 待补能力 | 具体清单 | 当前基础 |
| --- | --- | --- | --- |
| B01 | 产物识别和容器分流 | APK/AAB/.apks/split APK集、AAR/JAR/class、DEX/ELF、JS/HBC、托管程序集/assembly store、游戏容器；Harmony另分支。不能只凭文件名识别 | 目前是单APK ZIP摘要和独立路径输入 |
| B02 | 跨包完整性与来源链 | base/feature/配置split聚合；版本/签名/依赖一致性；外置资源与懒加载缺失报告；多ABI对应；嵌套容器输出边界、解压预算、每项来源和哈希 | 已有allowedRoots、任务目录和分页，尚无完整模块模型 |
| B03 | 深度DEX/Kotlin | mapping导入、去混淆符号关联、Kotlin metadata、协程状态机/lambda/inline、View/Compose事件与资源关联；动态加载/反射另采运行证据 | 已有JADX类/方法/静态引用，仍有可复用能力和未开放参数 |
| B04 | 函数级Native分析 | 函数发现、ARM/ARM64反汇编、伪代码、CFG、call graph/xref、类型和数据流、demangle、Build ID/文件偏移/RVA/运行时地址换算 | 目前只有ELF头/依赖/符号、JNI静态候选；优先评估复用REA已有native工具，再选择Ghidra/IDA等provider |
| B05 | JS/Web/Wasm分析 | JS格式化、AST/作用域/模块/引用、字符串/URL/API索引、source map匹配、HTML/CSS/资源/路由；必要时Wasm指令/IR分析 | 只有解包和rg文本搜索；JS AST不等于完整去混淆 |
| B06 | 设备与运行时观测 | 模块加载、RegisterNatives、桥接参数/返回/栈、bundle加载、WebView/CDP可附加性探测、网络和实际资源采集；Frida版本与目标检查 | 已有会话封装，缺少框架级适配与设备实测 |
| B07 | 跨层证据索引 | 文件→类型→函数→资源→运行事件，统一符号/地址/时间关联，区分静态候选和运行观察 | 当前主要输出各任务独立JSON，没有跨框架索引 |
| B08 | 引擎管理和兼容矩阵 | 版本/ABI/格式能力报告、按需启动、可重复安装、缓存、超时/内存/取消、诊断、未知版本明确拒绝、许可和分发边界 | 已有CLI与REA懒启动、任务预算；新增引擎需补完整契约 |
| B09 | 专项样本与回归 | 每框架debug/release、混淆/裁剪、关键ABI、split/外置资源；函数/调用/桥接预期断言；输出可追溯报告 | 现有14项静态冒烟是自有Java/APK样本，不能代表所有框架通过 |

**B01/B02/B04/B05/B07/B08/B09是共用底座。** 无需给每个框架重复造队列、分页、进程和符号系统，也不应直接把所有后端工具清单转发给模型。

## 3. 按用户列出的开发方式逐项补齐

以下“产物”是需识别的典型形态，不是所有版本固定文件布局；构建后端、ABI和发布配置必须从实际目标确认。

| 开发方式 | 分析对象 | 主要缺口 / 待实现清单 | 可复用方向与边界 |
| --- | --- | --- | --- |
| Java / Kotlin | DEX、资源、Manifest | 深化DEX分析、mapping、Kotlin metadata、协程/lambda/inline、组件/资源/方法关联 | 保留JADX/apktool；metadata库可恢复声明信息，需要适配DEX注解，不能保证恢复原.kt工程 [S02] |
| View / Jetpack Compose | 布局资源或编译后的UI/状态/事件代码 | View布局→事件→处理方法；Compose编译结构、状态读写/导航/事件关联；动态UI证据 | 共用DEX/资源/动态层；Compose不是一个可直接当XML读取的布局格式，专项规则与样本待验证 |
| C/C++ / NDK | 多ABI ELF SO、JNI、符号文件 | B04全部；静态/动态JNI注册、Java参数→Native函数→返回值关联、崩溃符号化 | REA native/Ghidra/IDA候选；ndk-stack需要对应unstripped符号，不能凭发行SO补回丢失源码 [S03,S04] |
| Flutter / Dart | engine、Dart AOT/快照、Flutter资源、平台通道 | 引擎/Dart/快照版本识别、类/函数/对象池/字符串与地址、机器码分析、platform channel；debug可用时再接VM service | Blutter为候选，维护者明确Android ARM64 libapp.so及近期Dart范围，输出汇编/对象而非原Dart工程；按版本实测 [S05,S06] |
| React Native | 明文JS或Hermes HBC、Native Modules/JSI及原生库 | 按magic识别JS/HBC、HBC版本分派/常量/函数/指令/伪码、JS AST/source map、桥接和动态bundle关联 | 复用B05/B06；Hermes工具/hermes-dec候选，不能按.bundle扩展名判断；伪码不等于可运行JS [S07,S08] |
| KMP / Compose Multiplatform | Android目标DEX/ELF、库AAR/JAR、元数据发布件/klib | 识别Android target与库输入、publication/variant关联、metadata；共用Kotlin/UI和Native层 | Android APK只含相应目标的发布内容，不能据此恢复commonMain或其他平台实现；klib深度语义单独评估 [S09] |
| .NET MAUI | 托管IL/程序集容器、Mono AOT、CoreCLR/R2R或NativeAOT | store版本识别/提取解压、PE/CLI元数据、IL→C#、类型/调用图；AOT地址与元数据关联 | 官方store格式+ILSpy候选；必须按实际runtime分流，不能把所有.so当JNI或所有MAUI当裸DLL [S10,S11,S12] |
| Lynx | 结构化Lynx bundle、样式/元素树、主线程/后台脚本及native module | bundle版本/分段解包、样式/树/脚本索引、PrimJS等运行时适配、lazy bundle/跨线程/Native Module追踪 | 官方codec/PrimJS源码是研究依据，尚未核实一个可直接接入的通用完整反编译器；不能整体当普通JS解析 [S13] |
| NativeScript | JS/模块/资源、JS↔Java映射，可能的snapshot/code cache | JS/source map、XML/CSS关联、Java桥接与runtime识别；遇到snapshot单独分派 | 复用JS/DEX/Native层；不同构建器和运行时布局需核验，snapshot默认行为未在本轮确认 [S14] |
| Ionic / Capacitor / Cordova / WebView | Web资产、native壳、插件/桥接 | HTML/JS入口与模块/路由图、插件注册→JS API→Java实现、CDP和真实脚本/网络采集 | 复用B05/B06；Ionic也可为PWA，WebView不可附加时必须报告限制，不能承诺总能调试 [S15,S16,S17] |
| PWA / TWA | 网站、浏览器运行上下文、TWA壳/入口 | URL/资源溯源、动态chunk、SW/cache、网络/调用栈、可复现采集 | TWA呈现浏览器中的Web内容；仅APK无法取得完整远端客户端，更不包含服务端源码，不保证离线复原 [S18] |
| uni-app | app-vue、nvue、H5等不同后端 | 先区分页面/渲染/逻辑运行时；WebView与原生渲染分别关联；桥接和资源提取；uni-app x/UTS另核验 | 不能全部当WebView；本轮官方正文确认app-vue/nvue差异，未核实uni-app x/UTS的实际产物与工具 [S19] |
| Taro | H5、RN、小程序等目标产物 | target识别后分别路由到Web/RN；小程序专用容器另建适配 | 同一品牌不等于一种字节码；H5成功不证明RN/小程序/Harmony已支持 [S20] |
| FlutterFlow / Mendix等低代码 | 生成的Flutter、RN、Web/PWA等实际产物 | 按导出目标复用分析；增加低代码运行模型/客户端配置的识别与关联 | 不承诺恢复可编辑画布、完整建模工程或后台逻辑；FlutterFlow/Mendix不能各按一个固定产物解析 [S21,S22] |
| Unity | Mono程序集或IL2CPP native+metadata，序列化资源/AssetBundle | Mono/IL2CPP分流、元数据/类型/方法地址、原生函数分析、资源解码/引用、脚本资源关联 | ILSpy、Il2CppDumper/Cpp2IL、AssetRipper候选；dummy DLL可能只有声明没有方法体，支持版本需逐样本验收 [S23,S24,S25] |
| Unreal | native代码、cooked资源/Blueprint、Pak/IoStore | 版本/容器/压缩、资源/UObject属性、Blueprint语义、SO函数分析、代码↔对象/资源关联 | CUE4Parse+Native引擎候选；资源解析不等于原始C++或Blueprint编辑图恢复；加密容器需要对应已知密钥和格式支持 [S26] |
| Godot | PCK/APK、GDScript字节码/场景/资源；C#和native扩展另分支 | PCK提取、脚本版本/反编译、场景资源转换、引用图；C#走托管层，扩展走Native层 | GDRETools/gdsdecomp候选；自定义字节码/加密/版本差异须明确；不把C#误当GDScript [S27,S28] |
| Rust / Go底层库 | SO、AAR包装、部分目标的静态库/对象与嵌入元数据 | 语言指纹、Go buildinfo/函数类型、Rust符号/元数据、函数级Native分析、Java/JNI/FFI关联 | 共用B04；REA现有Go/Rust接口只覆盖部分元数据，不能据此宣称有完整函数/源码恢复；gomobile AAR须分层 [S29] |
| HarmonyOS NEXT / ArkTS | .app/HAP/HSP、ABC、资源与Native SO | 独立包/模块/签名/资源适配、ABC版本/反汇编/控制流、ArkUI/Native关联及鸿蒙设备调试 | OpenHarmony正文提供包结构依据；NEXT具体SDK和ABC兼容仍需目标样本。ADB/JADX/Android Frida能力不自动适用 [S30] |

## 4. 需要新增或扩展的引擎适配层

“适配层”可以有多个可选provider，不代表必须同时安装表内全部工具。

| 适配层 | 候选组件 | 环境/维护工作与未验证点 |
| --- | --- | --- |
| Android输入与Kotlin | bundletool、现有JADX、kotlin-metadata-jvm、映射/符号工具 | JDK/SDK；补AAB/split输入、mapping身份匹配；Kotlin版本兼容单独验证 |
| Native | 优先复用REA函数级接口；Ghidra/已有IDA作为provider候选 | 选择一个实际可用provider、验证ARM/ARM64、控制大型分析缓存；IDA不设为必需依赖 |
| JS/Web | Babel/Acorn/tree-sitter、source-map解析库、CDP/Playwright候选；必要时WABT/Binaryen | 解析库、浏览器或调试目标、可取得的source map；这些库本轮未逐项核实版本/许可/兼容，不作为最终选型 |
| Hermes | 对应版本官方工具、hermes-dec候选 | HBC版本矩阵；输出指令和伪码边界；候选许可与分发方案另审 |
| Dart AOT | Blutter候选+Native层 | Python隔离环境、较新C++工具链、CMake/Ninja/ICU/Capstone和按Dart版本构建缓存；维护者有macOS/Linux等安装说明，但未本机安装/实测 |
| .NET / C# | dotnet/android store解析、ILSpy/ICSharpCode.Decompiler候选 | .NET runtime、store格式版本、保留IL与AOT/R2R分流；未实测当前MAUI组合 |
| Lynx/NativeScript专用runtime | 官方codec/runtime、snapshot解析候选 | 先做格式/版本识别，不承诺通用字节码恢复；是否需编译官方工具待源码核验 |
| Unity | Il2CppDumper/Cpp2IL、AssetRipper候选+托管/Native层 | metadata/binary匹配、Unity版本、资源解析输出和工具各自runtime；不得把旧工具声明范围推广到所有新版 |
| Unreal / Godot | CUE4Parse、GDRETools候选 | 容器/压缩/版本/自定义格式；已知key输入与敏感参数处理；批量产物和大文件预算 |
| Harmony | 对应SDK包/资源工具、ABC反汇编工具候选+Native层 | 独立SDK、字节码版本和设备链；建议独立可选后端，避免成为普通Android分析的启动依赖 |

候选引擎不是“装上就完成”：还缺参数schema、能力探测、输出归一、失败诊断、证据索引、版本路由、取消/超时，以及固定样本回归。本地Skill可补充操作方法，不能替代缺失的解析/反编译引擎。

## 5. 建议顺序

这是按复用与依赖排序的工程建议，不是已承诺排期。

1. **P0：共用底座。** B01/B02/B04/B05/B07/B08/B09先建立，补Frida设备验收与动态事件模型；Native优先核验REA现有能力复用，避免重复实现。
2. **P1：主要Android业务App。** 深化Java/Kotlin/Compose，接入Hermes、Flutter AOT、WebView/Capacitor，完成JS/JNI/platform channel等桥接；KMP Android目标及低代码相同后端随之受益。
3. **P2：扩展专项。** MAUI/.NET、Unity、Godot、Unreal、Lynx、NativeScript专用格式，以及Go/Rust更深的语言恢复；按实际目标使用频率调整先后。
4. **独立范围：Harmony。** 和Android共用任务/证据/provider抽象，但单列输入、字节码、SDK和设备适配，不能仅靠更名算支持。

不以工具入口数作为验收指标。保留少量分组入口、按需启动引擎、按需读取Skill；具体新增哪些action/入口在实施设计时确定。

## 6. 每个适配器交付前的验收清单

- [ ] 识别依据来自文件内容/元数据，给出框架和版本置信度；不凭单一扩展名分类。
- [ ] 至少有自有debug/release样本；涉及JS/IL/AOT多后端时分别验证。
- [ ] 明确支持的产物版本和ABI；未知版本、缺失模块/metadata、加密等返回明确状态。
- [ ] 用已知函数/类型/资源和调用链断言结果，不能只检查进程退出码。
- [ ] 解包、文本/IL反编译、机器码伪码、元数据声明、资源转换分别标识。
- [ ] 运行时/桥接功能有明确设备上的真实证据，记录原始输入和环境。
- [ ] 大文件/多任务的缓存、内存、超时、取消与失败产物可检查。
- [ ] doctor/环境文档明确依赖、版本、安装/更新/回退方法。
- [ ] npm包不包含用户目标、私钥、私人Skill或各引擎未授权分发的二进制。

## 7. 核验来源与范围

以下为本轮实际取得正文的框架/工具维护者资料；浮动main/stable页面不代表任何特定目标版本已经实测。研究留档在开发目录output/gap-audit-20261113，未纳入发布包。详细笔记列明失效URL、导航页和未核验专项。

- S01 [Android bundletool](https://developer.android.com/tools/bundletool)：APK集合、split和universal fusing限制；B01/B02不能只把universal当所有模块。
- S02 [Kotlin metadata](https://kotlinlang.org/docs/metadata-jvm.html)：声明元数据解析，非源工程恢复。
- S03 [Ghidra](https://github.com/NationalSecurityAgency/ghidra)：通用反汇编/反编译/图和自动化能力；不证明当前provider可用。
- S04 [ndk-stack](https://developer.android.com/ndk/guides/ndk-stack)：符号化需要相应unstripped符号。
- S05 [Flutter构建模式](https://docs.flutter.dev/testing/build-modes)：debug/release能力不同。
- S06 [Blutter](https://github.com/worawit/blutter)：ARM64/近期Dart、版本构建、输出和环境条件。
- S07 [React Native Hermes](https://reactnative.dev/docs/hermes)：随RN配套、release字节码与JS路径差异。
- S08 [hermes-dec](https://github.com/P1sec/hermes-dec)：HBC解析/反汇编/伪码，明确并非有效JS完整恢复。
- S09 [KMP发布](https://kotlinlang.org/docs/multiplatform/multiplatform-publish-lib-setup.html)：目标/根publication、元数据和klib。
- S10 [.NET MAUI运行时/编译](https://learn.microsoft.com/en-us/dotnet/maui/deployment/runtimes-compilation?view=net-maui-10.0)：IL/AOT/runtime不同产物；正文含多个.NET分支，按目标版本核验。
- S11 [dotnet/android assembly stores](https://github.com/dotnet/android/blob/main/Documentation/project-docs/AssemblyStores.md)：程序集容器布局随版本变化。
- S12 [ILSpy](https://github.com/icsharpcode/ILSpy)：托管程序集反编译，不承担Android store解包。
- S13 [Lynx spec](https://lynxjs.org/guide/spec.html)：bundle、双runtime、lazy加载和Native Module。
- S14 [NativeScript webpack](https://docs.nativescript.org/configuration/webpack)：生产压缩与开发配置；不是全部构建器/版本唯一规则。
- S15 [Cordova概览](https://cordova.apache.org/docs/en/latest/guide/overview/)：WebView、本地资产和native插件。
- S16 [Capacitor工作流](https://capacitorjs.com/docs/basics/workflow)：Web资产进入原生工程。
- S17 [Ionic](https://ionicframework.com/docs/intro)：可有原生壳或纯Web目标。
- S18 [TWA](https://developer.chrome.com/docs/android/trusted-web-activity/overview)：内容由浏览器呈现，壳不拥有页面完整运行上下文。
- S19 [uni-app renderjs](https://uniapp.dcloud.net.cn/tutorial/renderjs.html)：app-vue/nvue/H5差异；不能用于推断uni-app x/UTS。
- S20 [Taro README](https://github.com/NervJS/taro)：多target；NEXT/Harmony实际兼容本轮未验证。
- S21 [FlutterFlow导出](https://docs.flutterflow.io/flutterflow-cli/exporting)：不同导出目标；不等于恢复低代码模型。
- S22 [Mendix移动方案](https://docs.mendix.com/refguide/mobile/introduction-to-mobile-technologies/)：RN native/PWA等多目标。
- S23 [Il2CppDumper](https://github.com/Perfare/Il2CppDumper) / [Cpp2IL](https://github.com/SamboyCoding/Cpp2IL)：元数据/方法地址和恢复限制。
- S24 [AssetRipper](https://github.com/AssetRipper/AssetRipper)：资源解析，维护者声明质量随版本变化。
- S25 [Unity Android构建](https://docs.unity3d.com/Manual/how-unity-builds-android-applications.html)：导出工程与实际发布binary不同。
- S26 [CUE4Parse](https://github.com/FabianFG/CUE4Parse)及其[VFS源码](https://github.com/FabianFG/CUE4Parse/blob/master/CUE4Parse/FileProvider/Vfs/AbstractVfsFileProvider.cs)：包/对象、IoStore与已知AES key接口，未验证所有新版/自定义格式。
- S27 [GDRETools](https://github.com/GDRETools/gdsdecomp)：资源和GDScript恢复；自定义字节码/加密有额外条件。
- S28 [Godot Android导出](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_android.html)：C#分支与一般导出须区分。
- S29 [gomobile](https://pkg.go.dev/golang.org/x/mobile/cmd/gomobile)：AAR含Java stubs/shared libraries/assets；不据该页面推断当前全部版本/ABI。
- S30 [OpenHarmony Stage包结构](https://github.com/openharmony/docs/blob/master/en/application-dev/quick-start/application-package-structure-stage.md)：HAP/HSP/.app、ets→abc。此为格式依据，不是HarmonyOS NEXT特定SDK验收。

当前实现对照：src/server.js、src/actions.js、helpers/static.py；REA函数级能力仅核对固定6.9.0的functionWorkflowToolContracts与相关session/official/go/rust合约，本轮未启用这些provider。Compose规则、uni-app x/UTS、NativeScript snapshot、完整Hermes/Dart版本表、Harmony NEXT SDK等仍需定向研究与样本验证。
