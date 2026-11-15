# 实施进展

截至2026-11-15，GitHub Release为`v0.5.4`，npm `0.5.4`按本次交付命令发布。动态关联、Mono方法观测、RN新架构 fixture、KMP publication、Godot双脚本和 Compose 扩展增量已通过对应证据；确切证据与仍未完成项以[本轮进展](CURRENT-INCREMENT.md)为准。下文保留历史发行快照，不能替代最新增量状态。

## 本批已落地

- 分组入口从0.4的16增为20：新增packages、managed、webview、evidence，dex/frida扩展action。
- 分包校验包名、longVersionCode、全部signer证书、唯一base/split及依赖环；通过才聚合DEX，资源按模块独立导出。APKS显式members或bundletool设备spec选择；AAB只读Manifest与代码/资源分析派生，不冒充原作者签名APK。
- Kotlin原始DEX注解→metadata函数suspend/inline、JVM签名精确匹配；协程DebugMetadata/invokeSuspend候选与真实Compose编译DEX的Composer/状态/lambda方法内调用候选。静态读取JavascriptInterface真实注解，不把方法名当桥接证明。
- Java自定义ClassLoader枚举与type+有序dexPaths唯一selector；独立ClassFactory并核对定义loader，父委派不冒充；未知/歧义/超预算拒绝。同设备/PID的编译Java/JNI动作共用占位。
- 显式serial/packageName/pid的已开放WebView/CDP：DOM、源码、启用后网络、文本/二进制正文、敏感头遮蔽；包名/boot id/starttime校验、精确forward账本与清理失败重试。取消单项读取保留会话，代次失配关闭。
- store v1/v2（32/64位hash）/v3、ELF32/64符号定位、XALZ/LZ4与XAZS/Zstd有界提取；声明/区间/版本/累计符号/解压预算，重复区间哈希复用。
- Jobs旁写持久证据索引，merge/query保留来源文件/JSON pointer与强度；内容哈希、Kotlin签名、source map坐标、inventory容器结构、View/Compose候选、直接函数词法绑定、同脚本调用ID、CDP采集来源分别标识。传播上游partial，不按时间/PID猜跨任务调用。
- 真实自有Kotlin编译→DEX、真正bundletool AAB/分包与设备spec、自有DLL→store/ELF结构容器→提取SHA→ILSpy全部通过。
- 授权POCO F2 Pro：独立附加DEX方法返回80、JS→Java桥接返回90、DOM/源码/JSON/二进制正文采集、鉴权头遮蔽及采集→静态同哈希关联通过。WebView响应由自有拦截器提供；TCP socket创建失败的环境记录保留，不称外网验证。
- 0.5.1候选39组自动测试通过；20个工具入口保持不变。旧tag`v0.5.0`不包含这些补强。

## 本地 `v0.5.1` tag 已包含的增量

- `resources.view-events`扫描APK解码资源或已解码XML中的android:onClick，保留layout/view/id/context/来源，输出待验证签名候选；XML实体拒绝测试通过。
- evidence自动索引显式source map generated→original坐标及map SHA，标签`caller-supplied-build-match-unverified`；inventory容器树映射为容器/成员节点，按报告结构连接，内容另以SHA连接。
- Kotlin smoke用缓存的Kotlin2.0.21+Compose compiler plugin2.0.21+runtime1.8.0编译真实Compose函数→DEX，校验Composer及MutableState/remember/lambda编译调用候选；不等于运行状态、重组或事件实际发生。
- WebView/CDP新增重定向/失败/200 scripts和单条CDP消息超预算测试；ClassLoader新增超预算/同类型不可读时fail-closed及wrapper释放测试。

## `0.5.2` 候选增量（相对 `v0.5.1`）

- `src/core/frida-scripts.js`增加有限时长等待指定Native模块加载后再解析符号并安装hook；`src/server.js`暴露对应参数。单测覆盖等待、超时和参数边界。
- 自有fixture增加延迟加载SO；此前在POCO F2 Pro Android 16/ARM64、Frida server 17.23.2上观察到等待模块→hook安装→调用事件，参数2/7、返回110，成功报告留在`output/device-smoke/jni-report-prior-success-20261114.json`。本次发行前重跑在spawn阶段被REA拒绝，提示 jailed Android 目标需要Gadget；失败记录在`output/device-smoke/jni-report.json`，没有到Native hook验收。该改动不在`v0.5.1` tag内。
- 发行候选另更新能力矩阵、样本验收、验证记录与首发待办；本节样本结果和功能边界以[SAMPLE-VALIDATION.md](SAMPLE-VALIDATION.md)为准。

## GitHub 开源样本验收（2026-11-14）

- 官方 JetNews、WebView、Flutter `platform_channel`、React Native RNTester、Android Platform Samples 已固定上游commit并在隔离目录构建；JetNews详情导航、Flutter样本App的MethodChannel电量返回、RNTester启动、Platform Samples目录页启动均在指定POCO真机观察到。除WebView的CDP请求采集外，这些App级验收不等于MCP分析/还原对应框架语义。
- Flutter Driver测试和配对Release库Blutter分析通过。WebView/CDP捕获到真实目标URL的HTTPS GET，但页面 fetch 失败，没有取得成功响应。RN Release HBC为99，MCP明确按未支持版本拒绝；外部工具的带警告反汇编不视为通过。
- Platform Samples 的可调试APK在Android16触发依赖ELF 16 KB对齐提示；构建和打开样例目录通过，依赖兼容性仍待上游修正或换更合适小样本。
- 样本commit、APK/AAR/HBC/source map哈希、日志和边界见[GitHub样本验收记录](SAMPLE-VALIDATION.md)。APK及源码均保存在 `/tmp` 临时目录，不进入发行包。

## 原有能力沿用

Java/APK/资源/重建签名、mapping、JS AST/source map、独占Native target/Ghidra函数分析、Hermes HBC84、Flutter3.41.9/Dart3.11.5 Blutter、ILSpy/.NET10、Godot4.3/GDRE，以及动态JNI未来注册/撤销、RVA Native与Java同调用关联。历史真实验收范围见VALIDATION.md，不能据此扩大到全部版本。

## 当前仍未完成（含工作树增量）

| 范围 | 剩余工作 | 本轮可复用内容 |
| --- | --- | --- |
| View/Compose/KMP | 自有 Compose 导航/多状态/coroutine 已通过 MCP 多链 matcher；XML onClick 的 DEX 落点、KMP 更复杂业务结构/混淆回链仍待补 | JetNews导航、真实Compose编译候选、DEX/metadata/资源/运行观测、自有KMP业务App sharedNormalize回链、publication/klib fixture、Compose扩展MCP动态证据 |
| RN/Hermes | HBC99已有显式实验反汇编；第三方开放 inspector 探测已加入，但生产 APK 静默注入、异步跨层关系和完整 Fabric 事件图仍不支持 | HBC84、RNTester HBC99与source map样本、POCO Cxx TurboModule/JSI/Fabric fixture、第三方探测器、JS/Native/Java通用层 |
| Flutter | 完整Dart↔Android数据流与动态因果、更多Dart/ABI、EventChannel运行态和debug VM service专项 | ARM64 AOT与同APK静态协议候选；Driver只证明样本App交互，非MCP动态关联 |
| Lynx/NativeScript | 专用codec/snapshot格式、版本路由、完整桥接 | 容器/JS/DEX/Native |
| Web混合/PWA/TWA | 框架插件注册与完整路由、公网网络稳定性、SW/cache、系统浏览器独立上下文 | 已开放WebView/CDP、静态注解、已知Java桥接重载；官方样本单次公网200/正文通过，复验有pending超时 |
| JNI/loader | 全部JNI表/ABI/CheckJNI、完整当前绑定快照、未知loader、异步传播 | 标准入口未来事件、RVA、BaseDex唯一selector |
| MAUI | 更多真实MAUI APK、多runtime索引/布局、long/float/array/object ABI、AOT地址/元数据关联 | 真实MAUI10 APK→122程序集→88引用ILSpy，同包真机按钮返回46；自有NoInlining Int32/string/bool动态样本 |
| Godot | 更多Godot版本/C#资源图 | 已验收Godot4.3双GDScript/双场景fixture；不在本次暂缓范围 |
| 工程完整性 | 更全面格式/版本矩阵、深度doctor、更多Linux真实引擎验收 | 当前路径级doctor、固定依赖和自有样本 |

实际使用、依赖与预算见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)、[ENVIRONMENT.md](ENVIRONMENT.md)。原始全路线评估保留在ROADMAP-GAPS.md；未完成项不通过改名或增加工具定义算完成。

## 暂缓方向（2026-11-14）

Unity、Unreal、HarmonyOS NEXT按用户决定短期不再推进，移出当前迭代及发版门槛。历史缺口、已有通用能力与IL2CPP/Ark适配保留，不标为已完成；恢复需用户明确安排，条件见[本轮进展](CURRENT-INCREMENT.md)。Godot与其他Android方向不受此调整影响。

本地`v0.5.1` tag快照通过39项自动测试、语法检查、51文件包清单和tarball安装smoke；`v0.5.2`通过39项自动测试、语法检查、52文件包清单、release smoke及静态/Kotlin/分包/store smoke。GitHub Actions的Ubuntu/macOS任务均成功。真机重跑被Gadget能力条件阻塞，保留此前成功报告和本次失败记录。动态关联增量已进入 GitHub Release `v0.5.4`；npm 发布由用户执行。首发门槛和完整后续待办见[FIRST-RELEASE-TODO.md](FIRST-RELEASE-TODO.md)。
