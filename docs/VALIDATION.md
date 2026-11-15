# 验证记录

日期：2026-11-15；宿主macOS arm64。`v0.5.4`已通过 GitHub Release 发布，npm 发布由用户手动执行；以下保留历史版本验证，并以[本轮进展](CURRENT-INCREMENT.md)记录当前证据。

## `v0.5.4` Release 验证

- `npm test`：113 项通过；`npm run check`、`npm run check:pack`、`git diff --check`通过。
- `npm run smoke:release:full` 的完整 tarball 安装、两套 Frida binding 导入、深度 doctor 和 20 个工具协议验收通过。
- POCO F2 Pro `31936bb6` / Android 16 / ARM64：Compose 扩展 MCP matcher 连续三轮通过，每轮 70 个事件，完成清理、PID 和 ArtMethod 恢复校验；Flutter EventChannel、RN 自有 JSI/Fabric、KMP business App、MAUI long/float 证据均已归档。
- GitHub Release：https://github.com/lonnnnnng/android-reserve-mcp/releases/tag/v0.5.4；npm `0.5.4` 待用户执行本次交付命令。

当前`0.5.4`的动态关联、Flutter/Compose兼容边界和真实MAUI结果见[本轮进展](CURRENT-INCREMENT.md)。下文保留发行历史；旧版本中未通过的项不能据此推翻新证据，新证据也不扩大为全技术栈支持。

## 0.5.3 动态关联验证

- 普通Java两请求跨线程逆序回复、同对象配对与父子原调用范围真机通过；对象复用/TTL历史丢失/失败清理另有回归。
- RNTester关闭R8的独立APK在POCO上实际验证Java request→Promise resolve("result")和`rejectPromise`→同Promise `PromiseImpl.reject(...)`→原返回；隔离 fixture 主动捕获 Hermes `new Error().stack`，显示 `rejectPromise`/`onPress` bundle 行列，并与 Java Promise 身份合并；debug inspector取得`scriptId=3`。同一POCO又验证自有新架构 APK 的 Cxx TurboModule/JSI 多类型转换和 Android Fabric/codegen 视图命令/属性重渲染，证据见 `output/rn-cxx-jsi-fabric-20261115-run7/evidence.json`。任意第三方APK自动注入、`.then()`和完整Fabric事件图仍未验证。
- Mono .NET10 ARM64 AOT：原Release仅定位；同构建NoInlining APK通过完整签名/MVID/token/JIT回核，真实按钮触发静态/实例Int32与字符串方法，当前证据为`InstanceAdd(2,7)→50`、`Normalize("maui")→"MAUI"`。只支持无byref的Mono窄ABI，不覆盖CoreCLR/NativeAOT或内联方法。
- WebView自有拦截页面通过fetch initiator/scriptId/源码SHA/AST与正文46；不是公网稳定性新结论。
- Flutter Reply仍受当前Android16兼容门保护；Compose自有整数状态样本在POCO上连续三次完成点击→状态写入→重组/渲染，派生状态 `derivedStateOf(state*2)` 也在同一已安装APK上连续三次得到 `renderedDerived(2)`，证据见 `output/jni-compat-20261115/compose-three-runs.json`、`output/jni-compat-20261115/compose-derived.json` 和 `output/jni-compat-20261115/compose-derived-three-runs.json`。
- 原Java/JNI真实设备回归与外置workspace trace-jni编译通过。配置、详细边界与关键证据见[DYNAMIC-CORRELATION.md](DYNAMIC-CORRELATION.md)及其JSON证据；

## 本地 `v0.5.1` tag 快照验证

- 从tag单独导出的干净快照中，`npm run check`、39组自动测试、`check:pack`与`smoke:release`通过；实际0.5.1 tarball安装后stdio列20工具、doctor成功。tag包清单51个源码/文档文件。
- `npm run smoke:kotlin`使用真实Kotlin2.0.21 Compose plugin与runtime编译Compose函数到DEX；断言Composer签名、mutableStateOf、remember、MutableState读写和lambda invoke候选，并从持久evidence查询signal。仅证明编译调用引用，不代表运行态事件/重组。
- `npm run smoke:static`、`smoke:packages`与`smoke:store`通过，含真实AAB/APKS分包和托管结构样本。source map、View/XML报告关系、Compose编译候选不会越过各自证据强度。
- CDP重定向/失败/脚本和消息预算、ClassLoader唯一性拒绝测试通过。生产依赖审计0漏洞，actionlint通过；Linux远端CI尚未运行。
- tag版本包不含GitHub样本验收记录及tag之后的Native延迟模块改动；tarball不含样本/引擎/签名材料。

## `v0.5.2` Release 验证（相对 `v0.5.1` tag）

- `npm test`：39项通过；`npm run check`、`npm run check:pack`、`npm run smoke:release`和`git diff --check`通过，包清单52个文件。
- 此前在POCO F2 Pro Android 16/ARM64真机验收自有延迟加载`libdelayed.so`：spawn暂停时观察到等待模块，resume后hook安装并观测调用参数2/7、返回110；归档报告为`output/device-smoke/jni-report-prior-success-20261114.json`。本次发行前重跑在spawn阶段被REA以`capability_unavailable`拒绝，详情要求 jailed Android 配置 Gadget；见`output/device-smoke/jni-report.json`。本次没有进入Native hook步骤，不能记作复验通过。
- GitHub样本构建及设备验收见[SAMPLE-VALIDATION.md](SAMPLE-VALIDATION.md)。Flutter Driver验证样本MethodChannel，不能单独证明MCP能恢复该桥接；WebView公网请求没有成功响应；RN HBC 99被当前分析器拒绝。
- GitHub Release：https://github.com/lonnnnnng/android-reserve-mcp/releases/tag/v0.5.2；主分支和tag均回读到提交`1e99009a72cd0c23a823b9c12ae8d20091fa0f22`，两条CI均成功。Release tarball下载回验SHA-256为`556492d66d3f5c42d295d82d0c9242b30e9d9d2b083c43ca96268d2065df09f7`，Release标记为Latest、非草稿、非预发布。
- npm初次发布失败；用户随后手工发布0.5.2，本轮registry回验version与SHA1一致。

## v0.5.0首发tag历史验证

- 全部JS/Python语法检查、34组自动测试和真实stdio0.5.0握手通过；tools/list为20组。新增分包一致性/前置容器预算、证据scope/词法绑定/partial、loader唯一性、真实本地HTTP+WebSocket协议、身份取消/代次/清理失败重试；测试不接手机。
- `npm run smoke:release`通过：将生成的`android-reserve-mcp@0.5.0` tarball安装到隔离临时目录，从打包CLI完成stdio握手，确认20工具和doctor成功；测试后临时目录清理。`npm run check:pack`对50个源码/文档文件通过。
- 另在隔离npm项目验证默认tarball安装会阻止未审查的`frida@17.26.3`脚本；明确审批该依赖后rebuild与Node binding/local-device构造通过。npm提示本地tarball lock无registry `resolved` 时按包名审批所有版本；这是一次性临时目录，公开registry安装按其lock URL约束版本。文档要求在目标项目先核对版本/lock再逐包审批，禁止全量批准。
- npm生产依赖审计为0漏洞。当前`npm whoami`为401，npm发布身份尚未登录；registry未发现已发布的同名包。GitHub CLI已登录`lonnnnnng`，但仓库不存在、当前Git仓库还没有commit/remote；这些是外部发行条件，不是功能测试缺陷。
- `.github/workflows/ci.yml`由actionlint检查通过；本机Docker daemon未运行，因此Linux矩阵只能等GitHub Actions远端首跑。
- 真正自建AAB：bundletool生成/验证、Manifest读取、aapt2派生资源、JADX聚合；同签名base/config、APKS显式members、设备spec选择后再验签/依赖均通过。日志output/v050-research/packages-final.log，报告指针output/packages-latest-report.json。container快照及所选APK分别留SHA，不把AAB派生当原签名APK。
- 真正Kotlin2.0.21编译→DEX，以metadata2.3.21读取flow suspend、inlinePlus inline、精确JVM/DEX签名、invokeSuspend状态机；另编译JavascriptInterface真实注解并断言仅ping(I)I，普通hidden方法不误列。merge/query可检索flow。日志kotlin-final.log，指针output/kotlin-latest-report.json。
- 自有.NET10 DLL封装store v1/v2(32/64 hash布局)/v3、XALZ/LZ4、XAZS/Zstd及NDK编译ARM64 ELF的_assembly_store符号；提取逐字SHA一致，再经ILSpy核对标记。未知版本和超大解压声明明确拒绝。日志store-hardened.log，指针output/store-latest-report.json。容器为synthetic结构夹具，v2索引hash为布局占位，不声明完整MAUI/runtime加载验收。
- 授权POCO F2 Pro、Android16、WebView156.0.8078.47、Frida17.23.2、自有dev.androidreserve.fixture：java-loaders→独立DexClassLoader→java-methods→trace-java返回80；选子loader读父定义主类被拒绝，并确认失败后占位释放，之后重新追踪正常；JS→Java的OwnedBridge.ping(7)实际返回90。
- 同真机WebView：discover/open、DOM含唯一标记与bridge=90、源码与本次nonce逐字一致、启用后Network的JSON/二进制正文逐字一致、Authorization遮蔽；采集源码→script.index→evidence.merge按SHA合并唯一artifact，存在独立webview-capture来源节点；close无残留forward。日志hybrid-final.log，报告指针output/hybrid-latest-report.json。
- 初次通过ADB reverse的TCP页面和后续App本地ServerSocket样本均失败：App已获INTERNET但socket创建返回ECONNREFUSED。保留失败任务/自有PID日志。最终WebView样本由自有shouldInterceptRequest供应HTTPS响应，证明真实WebView/CDP事件及桥接，不证明手机外网/TCP可用；未改VPN/代理或其他App。
- 原15项真实静态smoke回归通过（Manifest/解码/DEX/引用/资源/JNI候选/重建签名等）；原动态JNI smoke再验注册成功/失败/撤销/重注册、原异常保持、隐藏RVA、Java57/Native20、attach/spawn全部通过。日志static-regression.log、jni-regression.log；当前自有App已停止。
- 本轮专用Frida server在读pidfile并核对/proc/PID/cmdline为预期专用binary后TERM；文件保留。ADB forward/reverse列表无本轮映射残留。未操作其他手机或App。
- npm audit --omit=dev报告0漏洞。npm run check:pack通过；公开打包清单50个文件，仅源码/helper/docs/examples与许可，不含引擎、JAR/APK/DEX/SO、keystore、output或私有配置；曾发现helpers目录规则把Python .pyc缓存带进包，现改为明确源码扩展名并在CI加入check:pack防回归。GitHub Actions尚未运行，远端发布待完成。
- OpenCode本地模拟API实际请求：android-reserve 33工具=本MCP20+辅助13，REA/IDA/JS/Playwright各0；daily仍13，Android0。未调用真实模型。配置已先备份，只同步Android提示词与维护说明。

截至本次核对仍没有Unity/Unreal/完整MAUI/Harmony真实产物；Compose完整状态/事件语义、RN↔Native因果、MCP对Flutter channel的桥接恢复、专用codec/snapshot与更多ABI/格式仍未验收。Flutter官方样本的MethodChannel运行已通过，但不等于MCP恢复桥接。分项缺口见PROGRESS.md；参数/预算/依赖见ADVANCED-ANALYSIS.md。下文记录历史版本当时状态，不代表当前仍缺少已完成项。

## 0.4.0历史验证

- check、24组自动测试和stdio0.4.0握手通过，分组入口仍16项。新增modified UTF-8/NUL/截断/不可读、类对象身份、注册返回与pending exception、RVA数值/模块/可执行范围、JNI/Java共用所有权和晚到错误清理测试。
- `npm run smoke:jni -- 31936bb6`通过：授权POCO F2 Pro、Android16/root、Frida17.23.2，自有App在spawn恢复前确认标准JNI表观测ready，捕获JNI_OnLoad及后续注册成功/NoSuchMethodError失败/整类撤销/重注册；attach另外验证未来周期注册。
- 自有SO的dynamicAdd为未导出的静态函数，dynsym无相应导出；按本次注册事件的模块RVA，先卸载JNI观测，再用Java联合agent捕获Java57/Native20同调用ID与参数2/7，用独立Native agent再次确认RVA调用。所有阶段按当前script_id过滤历史事件，避免旧事件造成假通过。
- 原异常保持使用JNI observer仍加载时的**自有PID**周期日志123断言，未清空logcat；该值检查失败RegisterNatives后的ExceptionCheck及撤销/重注册结果。报告`output/device-smoke/jni-report.json`含passed=true和fixtureEvidence，日志`output/v040-research/jni-final.log`。
- 初次隐藏叶函数ACCURATE栈在Frida agent内部SIGSEGV；关闭栈对照通过，改RVA使用FUZZY候选后开启栈的严格流程通过。Java栈仍为Thread API。保留失败任务/自有tombstone和无栈对照，不把候选返回地址称精确栈。
- `npm run smoke:java -- 31936bb6`回归原导出JNI流程：Java46/JNI9、Java栈、异常、unload、attach/spawn均通过，日志`output/v040-research/java-regression.log`。

本轮仅验证该设备/ABI和所列样本；完整JNI绑定快照、更多表/CheckJNI变体、任意loader选择仍未提供。工具用法、读取预算、证据含义见[JNI-OBSERVATION.md](JNI-OBSERVATION.md)。

## 0.3.0历史验证

- `npm run check`、18组自动测试通过。新增Java原返回/原Throwable、观测失败不改行为、同线程关联/跨线程不关联、占位取消/注入不确定/卸载失败/晚到超时和历史消息隔离。真实stdio握手版本0.3.0，工具入口仍16项。
- 授权POCO F2 Pro `31936bb6`、Android16/root、自有App `dev.androidreserve.fixture`、REA Frida17.23.2：`npm run smoke:java -- 31936bb6`通过。覆盖java-methods、精确重载、Java参数2/7返回46、JNI参数2/7返回9、共享invocationId、Java栈包含compute、原异常、unload后重新观测、close，以及spawn→trace-java→resume→事件→close。报告`output/device-smoke/java-report.json`，最终日志`java-final.log`。
- 首次Java采样使用`Java.backtrace`时出现ART StackVisitor原生崩溃；关闭栈采样对照通过。改为`java.lang.Thread.currentThread().getStackTrace()`后，开启Java/Native栈的完整流程通过；未通过try/catch掩盖Native崩溃，也未改REA/设备Frida版本。失败任务与无栈对照报告保留。
- `npm run smoke:flutter`通过：Flutter3.41.9/Dart3.11.5、Android ARM64 release自有APK，Blutter commit`4a60ac648bf448c5a7596437243bcd0b9376fdf0`。对象池唯一标记`RESERVE_FLUTTER_V03`、`reserveAdd(int,int)`汇编和两份SO的SHA256均有断言。报告`output/flutter-owned-sample/analysis-report.json`；APK未安装设备。首次VM/Blutter编译约68秒，后续使用独立缓存。
- `npm run smoke:managed`通过：独立.NET SDK10.0.403/runtime10.0.14、ILSpy11.2.0.10050，无PackageReference的自有net10程序集离线restore/build，反编译出类型、标记、ReserveAdd和`a+b+37`。报告`output/managed-smoke/report.json`；不证明MAUI store或NativeAOT可恢复。
- `npm run smoke:godot`通过：GDRE2.7.4将两个自有脚本编成Godot4.3字节码，打包新建目录，精确验证PCK七个成员且无原始.gd，再恢复并核对两个脚本的标记、函数与表达式。报告`output/godot-smoke/report.json`；不证明Godot所有字节码/C#或任意加密容器兼容。
- 本轮专用Frida server PID经路径核对后已停止；自有App已force-stop，文件保留，未操作其他App或另一台手机。
- `npm audit --omit=dev`当前0漏洞。编译器传递Frida依赖的minimatch固定11.0.1并已真实编译；这是当前锁文件快照，不是永久安全保证。

OpenCode本地模拟API复验：android-reserve为29工具，其中16个本MCP入口，其他大型MCP为0；daily仍13工具，Android为0。未发真实模型推理。npm pack清单排除了引擎、APK/SO/DEX、keystore、任务输出和私人配置。

加载任务成功仍须检查运行事件，尤其spawn的Java安装需resume后才可能发生。未知ClassLoader、动态注册、异步跨线程、更多Dart/HBC/游戏/MAUI/Harmony格式仍未验收；不把可用CLI或一份样本提升为全技术栈支持。

## 0.2.0历史验证

- 11组自动测试通过：增加嵌套APKS/magic/提取/路径与重复成员、JS词法binding/格式化不执行/内联indexed map/外部section拒绝、Native目标隔离与串行、模拟CLI固定参数与无产物拒绝。协议tools/list为16项。
- 原静态冒烟新增mappingPath方法名映射，15项全部通过；证据output/smoke.json。
- 自有真实Android ARM64 SO：Ghidra12.2+本机编译decompiler+独立JDK25，打开/函数清单/伪代码/精确地址引用/callers/关闭通过；output/p0-smoke/report.json。
- 自有JS编译为HBC84，内容识别、hermes-dec0.1.8启动/真实反汇编并断言fixture_add通过；output/framework-smoke/report.json。其他HBC版本未逐一测。
- 授权POCO F2 Pro、自有App dev.androidreserve.fixture、Frida17.23.2：attach、runtime、trace-native、status、close，以及spawn/load/resume/status/close通过；确认JNI参数2/7与返回9；output/device-smoke/report.json。未分析或hook用户其他应用。
- 初次spawn在加载器回调内装hook时出现native crash；改为有30秒上限的模块轮询后复测通过。初次Native缺macOS decompiler/JDK25、同名链接跳板的歧义也已定位并按精确地址验证，未将失败记录算成功。
- 本轮独立Frida server和测试App已停止；自有测试App/文件保留，未删除用户文件或卸载其他应用。

尚未验收：Kotlin/Compose与完整RN/Flutter/WebView样本、其他CLI真实引擎、Go/Rust目标元数据、游戏/MAUI store/Harmony、其他ABI/Linux以及公开发布。后文为0.1.0历史记录，其中旧工具数和当时未实机状态不代表当前版本。

## 0.1.0历史：已验证

- 真实 stdio initialize/tools/list：13 个 Android 入口。
- 6 组自动测试：realpath 越界/符号链接、argv 无 shell/输出上限/取消/超时、任务持久化与终态、后端映射/显式 Frida 会话、ADB 缺省 serial 拒绝/Skill 读取、stdio/产物分页/协议错误。
- 14 项真实静态冒烟：APK ZIP 摘要、二进制 Manifest、JADX+apktool 解包、源码搜索、ELF 头/工具调用、DEX 类检索、类成员、方法体、静态引用、资源字符串、JNI 声明、apktool 重建、临时签名与签名复验、独立签名复验。
- 方法体包含样本 hello，引用结果定位到 Caller，JNI 声明结果包含 nativeGreet，作为语义断言。
- REA 6.9.0 的 Frida 17.23.2 Node binding 可成功 import；未发起设备发现或注入。
- OpenCode 六模式实际向本地模拟 API 发出的工具清单已核对：Android 专项包含 13 个 android 工具和 13 个内置/辅助工具，REA/IDA/JS/浏览器工具为零；旧四个专项模式排除 android，完整模式包含 android。测试未向真实模型发推理请求。

样本 Java/XML 由 scripts/fixture.mjs 生成，APK 为自有构建；ELF 是合法的空节表 AArch64 头，不是实际 JNI 实现库。JNI 验证覆盖 native 声明识别，不证明动态注册或导出实现匹配。签名为测试临时生成，不读取用户私钥。完整运行记录位于开发机 output/smoke.json，未发布私人临时目录信息。

## 0.1.0历史：当时未验证

- 真机/模拟器上的 ADB、Frida server/Gadget、attach/spawn/脚本/resume/close 真实工作流。
- Kotlin/Compose、React Native/Hermes、WebView混合应用的专项样本；常规DEX接口可用不代表这些技术栈已经完整验收。
- 复杂加固/畸形 APK、厂商私有资源 framework、全量混淆和 JNI 动态注册。
- Linux 完整工具链、远端 GitHub CI、Windows。
- npm/GitHub 公共发布、其他 MCP 客户端，以及所有依赖版本的兼容组合。

测试成功只覆盖上述样本和边界，不保证任意 APK 反编译/重建成功。doctor 报告文件存在不能替代整条能力的功能验收。
