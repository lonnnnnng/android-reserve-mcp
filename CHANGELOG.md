# 变更记录

## 0.5.3 — 2026-11-14

- trace-java-group：最多8个方法同agent线程栈与JNI同对象回复；重复复用拒绝猜配、TTL丢失身份后停止确定配对，RN Promise与普通Java逆序跨线程样本通过。Flutter/Compose在当前Android16触发JNI transition崩溃，明确未验收。
- trace-mono实验固定适配：Mono ARM64已加载静态非泛型Int32方法，完整签名/MVID/MethodDef/JIT回核，拒绝byref；真实MAUI NoInlining样本捕获2、7→46，原Release只定位未捕获调用。
- WebView保存有界CDP initiator栈与0开始坐标，同会话scriptId连接已采集SHA/AST；自有拦截页面验证真实fetch，不扩大公网稳定性结论。
- 修复外置workspace的Java/JNI bridge编译projectRoot；新增动态调用说明与失败边界回归，仍为20工具。
- 发布前质量门：57项自动测试、源码语法检查、npm包清单和隔离tarball实装验收通过；GitHub/npm均发布`0.5.3`。

- framework.channels：同APK两份ARM64库哈希核对后，关联Blutter Dart调用模板、smali channel注册和handler方法名比较；始终标partial，不声称动态因果或完整数据流。
- Hermes 97–99显式allowExperimental实验反汇编；真实RNTester HBC99产出非空汇编，保留上游警告，未知100继续拒绝。
- WebView网络结果增加pending/finished/failed计数和ServiceWorker来源；官方天气样本取得公网200及454字节正文，重复验收仍有超时。
- 修复Kotlin包过滤前无关类耗尽预算；Compose候选保留DEX偏移/目标签名并进入证据图。
- 修复真实.NET Android ELF payload节及v3的9/13字节索引；MAUI10真实APK提取122程序集、配齐88引用后ILSpy恢复自有页面/函数。ILSpy显式referencePath与源码警告partial检测。
- 整理当前能力、证据与后续待办；Unity、Unreal、HarmonyOS NEXT按用户决定短期暂缓，移出当前迭代及发版门槛，保留历史研究和已有适配。
- 这些源码增量尚未发行到npm或GitHub Release；详细证据、复现与未完成项见docs/CURRENT-INCREMENT.md。

## 0.5.2 — 2026-11-14（GitHub Release / npm 均已发布）

- `trace-native`新增有界等待尚未加载Native模块的参数；自有ARM64延迟库此前在真机通过等待、hook安装和函数调用验收。本次发行前重跑受REA Gadget能力条件阻塞，未能再次进入hook阶段。
- 固定GitHub公开样本的上游commit与构建产物哈希，记录Compose、WebView、Flutter MethodChannel、RN/Hermes和Views/Compose的实际验收范围与失败边界。
- 校准能力矩阵、发布状态和验证文档，区分本机tag、候选工作树、样本App交互与MCP桥接能力。
- 当前工作树39项自动测试、语法检查、包清单与隔离tarball实装通过；逐项样本结论见`docs/SAMPLE-VALIDATION.md`和`docs/VALIDATION.md`。

## 0.5.1 — 2026-11-14（本地tag，尚未公开发布）

- evidence索引source map generated→original坐标及map SHA，标明构建匹配未知；inventory容器树映射为container/member/content节点，区分报告结构和SHA同一性。
- 新增resources.view-events，有界扫描APK解码资源/解码目录中的XML `android:onClick`声明，输出待核验签名候选并拒绝DTD/entity。
- Kotlin2.0.21 Compose plugin2.0.21/runtime1.8.0编译真实DEX，验证Composer、mutableStateOf、remember、MutableState读写和lambda方法内调用候选；不声称完整Compose状态/事件恢复。
- 增加CDP重定向/失败/预算和ClassLoader拒绝/释放边界测试；39项测试、语法/包门、Compose/分包/静态smoke与隔离tarball实装通过。
- 保留原`v0.5.0`候选tag；`v0.5.1`只在本地提交/tag，未推送/公开发布。tag后增量转入`v0.5.2`候选。

## 0.5.0 — 2026-11-14（历史候选，已本地打tag）

- 新增packages/managed/webview/evidence四组，当前20个入口。
- 所选APK集合校验包名/长版本/全部signer/依赖、聚合DEX与分模块资源；APKS显式设备spec选择、AAB只读Manifest及无原签名分析派生；外部bundletool前置容器预算。
- Kotlin原始metadata/suspend/inline与完整JVM签名匹配、协程/Compose候选、JavascriptInterface静态声明。
- ClassLoader枚举、唯一selector与实际定义loader校验；所有编译Java/JNI动作共用进程占位，避免多bridge干扰。
- WebView/CDP采集DOM/源码/网络/正文，敏感头遮蔽、代次检查、精确forward账本与清理重试；修复取消读取误关会话及跨代次身份快照。
- 固定store v1/v2/v3、ELF符号封装、LZ4/Zstd有界提取，预留解压/累计符号预算并复用区间哈希。
- Jobs持久证据索引与merge/query；修复JS变量函数绑定和位置丢失、partial传播、哈希大小写及CDP来源。
- 真正自建AAB/APKS、Kotlin编译DEX、store结构容器→SHA→ILSpy、自有POCO DCL/JS桥接/CDP样本验证。原生TCP失败单列，不把拦截响应冒充外网验收。
- 新依赖/调用/维护文档、OpenCode模式提示词与本地模拟请求验证；专有引擎不打包，不扩大未验收框架声明。
- 修复npm目录白名单混入Python字节码缓存，明确helper源码扩展名，新增check:pack并接入CI。

> `v0.5.0`创建后、`v0.5.1` tag前加入并由本地`v0.5.1`纳入的增量：source map与容器树证据节点、View XML onClick候选、真实Compose编译签名smoke、CDP/ClassLoader失败边界回归。这些内容不属于`v0.5.0` tag。

## 0.4.0 — 2026-11-14（本地，尚未发布）

- 新增trace-jni：标准JNI表入口的未来注册/撤销、真实类对象身份、方法/签名/模块/地址/RVA，区分尝试与实际返回；不回溯旧绑定。
- Native独立/Java联合观测支持模块RVA，与导出名二选一；校验数值、模块和可执行内存。
- JNI文本按modified UTF-8有界读取；保留业务pending异常，逐步检查观测JNI异常；限制类引用、方法总量、回调和单事件输出。
- 修复隐藏叶函数精确Native栈崩溃，RVA入口改为明确标注的FUZZY候选；不提升为精确调用链。
- 真机自有样本验证成功/失败/撤销/重注册、原异常保持、Java57/隐藏Native20关联与独立RVA追踪；按当前脚本过滤历史消息。
- JNI/Java共用进程所有权和失败清理，修复旧脚本加载错误干扰；新增专项smoke与24组回归，保留16个工具入口。

## 0.3.0 — 2026-11-13（本地，尚未发布）

- Frida增加java-methods、trace-java、unload：按需编译bridge，精确重载、参数/返回/原异常/Java栈与同agent Java↔JNI调用范围关联。
- 修复Java.backtrace在本次Android ART上的崩溃，改用Java Thread栈；POCO自有App的attach/spawn、关联、异常与卸载重挂通过。
- 同设备/PID防重复Java observer；补排队取消释放、注入不确定保留占位、卸载失败保护、status晚到错误处理。
- 私有安装并真实验收Blutter/Dart3.11.5、ILSpy/.NET10、GDRE/Godot4.3；不修改全局Java/.NET或REA配置。
- 引擎输出按实际代码/汇编/资源判定；Flutter配对库分别留SHA256，Godot样本精确检查无明文脚本。
- 增加四条专项smoke、18组自动测试、依赖许可/安装/使用/维护记录；保持16个分组工具入口。

## 0.2.0 — 2026-11-13（本地，尚未发布）

- 新增artifact：有预算的内容/容器识别、框架候选、嵌套ZIP和定向提取。
- 新增script：Babel静态索引、格式化和显式source map位置映射，不执行目标。
- Native新增独立目标后端与函数/伪代码/引用接口；本机Ghidra环境和ARM64样本通过。
- DEX新增mappingPath；Frida新增runtime/trace-native，自有App真机验证attach/spawn/resume与JNI参数/返回。
- 新增framework固定CLI适配与输出校验；Hermes HBC84通过，其余外部引擎仍待安装/样本验收。
- 后端错误保留简洁修复提示和完整error.json，增加专项测试和环境/进展文档。

## 0.1.0 — 2026-11-13（本地原型）

- 13个Android分组入口、静态CLI与REA按需后端、任务/分页/路径护栏、本地Skill只读入口。
