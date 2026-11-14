# 分包、Kotlin、WebView与持久证据（0.5.0）

核验日期：2026-11-14。本文所有示例是MCP工具参数，不是shell命令；长任务须查询jobs并读取result.json，不能只看任务已创建。共20个分组入口，不会把REA全部工具加载给模型。

## 分包/APKS/AAB

`packages.inspect/validate`支持单APK、APK目录、明确members的APKS。包名、longVersionCode（major+low）、全部signer SHA256集合必须一致，恰有一个base，split名称唯一，uses-split/configForSplit完整且无环；失败不聚合分析。目录应只放同一个安装集合，不能混装不同设备变体。

```json
{"tool":"packages","arguments":{"action":"inspect","path":"/absolute/path/app.apks"}}
{"tool":"packages","arguments":{"action":"validate","path":"/absolute/path/app.apks","members":["splits/base-master.apk","splits/base-arm64_v8a.apk"]}}
{"tool":"packages","arguments":{"action":"decode","path":"/absolute/path/selected-apks","engine":"both"}}
```

第一次inspect返回requiresSelection时，从报告复制精确成员名。APKS不能把全部APK都选进来；同一bundle内可能包含互斥变体。另一种方式是提供已知设备spec：

```json
{"tool":"packages","arguments":{"action":"select","path":"/absolute/path/app.apks","deviceSpecPath":"/absolute/path/device-spec.json"}}
{"tool":"packages","arguments":{"action":"aab-manifests","path":"/absolute/path/app.aab"}}
{"tool":"packages","arguments":{"action":"decode","path":"/absolute/path/app.aab","engine":"both"}}
```

select由bundletool按显式spec提取，再做一致性验证；不会自动连接设备。validate的valid只证明所选集合内部一致，`deviceCompleteness=not-evaluated`仍不证明按需模块或设备配置全覆盖。select后validation.valid=false也不能当可安装集合使用。

AAB decode先bundletool validate，再把各模块proto资源经aapt2转换，JADX聚合DEX、apktool分模块输出资源。派生APK标记`unsigned-analysis-derivative`，不带原作者签名，不是可安装集合。不会通过合并同名res文件伪造资源完整性。

预算：128 APK、单APK512MiB、总量1GiB、12000目录项；外部bundletool前固定容器快照并记录原容器SHA256，成员快照另有各自SHA256，压缩容器512MiB、累计声明展开1GiB、压缩比200，目录不接受链接。前置检查覆盖整个APKS，较大的多设备归档可能需要先在可信工具中分离。外部解析器仍是独立进程，目录护栏不是OS沙箱。

依赖：Python、JDK、apkanalyzer、apksigner；decode按engine需要JADX/apktool。AAB转换另需aapt2；AAB与select另需bundletool1.18.3。

## Kotlin与静态JS桥接声明

```json
{"tool":"dex","arguments":{"action":"kotlin","path":"/absolute/path/app.apk","query":"com.example"}}
```

query是原始类名前缀，建议限定包名。读取原始DEX的kotlin.Metadata和DebugMetadata，输出suspend/inline、JVM签名及`exactDexMatch`，协程invokeSuspend与Compose Composer参数候选；方法真实带JavascriptInterface注解时列入`javascriptInterfaces`。class/method等原DEX操作不变。

这不是完整Compose UI树/状态/事件分析，metadata声明也不等于异步运行调用链。KMP的Android目标可复用；APK不包含其他target或完整commonMain。readLenient不能承诺所有未来metadata版本都兼容，未知/畸形结果会带partial/metadataStatus。

依赖：完整JDK17+、固定SHA的headless JADX0.7.1、kotlin-metadata-jvm2.3.21与kotlin-stdlib2.3.21。该action本地运行，不要求REA进程或设备。预算：输入512MiB、JVM2GiB、180秒、5000类；扫描截断保留partial。

## 自定义ClassLoader

1. attach或spawn取得session_id，执行`frida.java-loaders`。
2. status中按本次script_id查java-loaders事件，复制所选记录的selector（type+有序dexPaths）。
3. unload枚举脚本，再用相同selector调用java-methods；确认重载，unload后trace-java。

```json
{"tool":"frida","arguments":{"action":"java-loaders","sessionId":"<session UUID>"}}
{"tool":"frida","arguments":{"action":"java-methods","sessionId":"<session UUID>","className":"com.example.Dynamic","methodName":"run","loaderSelector":{"type":"dalvik.system.DexClassLoader","dexPaths":["/data/user/0/com.example/code_cache/feature.dex"]}}}
{"tool":"frida","arguments":{"action":"trace-java","sessionId":"<session UUID>","className":"com.example.Dynamic","methodName":"run","argumentTypes":["int"],"loaderSelector":{"type":"dalvik.system.DexClassLoader","dexPaths":["/data/user/0/com.example/code_cache/feature.dex"]}}}
```

不传selector仍使用默认app loader。selector在每次脚本里重新唯一匹配，loaderId只在单次枚举内有效；0匹配/多匹配/超预算/同类型读取失败明确拒绝。核对类的实际定义loader，父委派得到的其他loader不能冒充所选loader。主要覆盖BaseDexClassLoader系统字段可读的loader，不承诺所有自定义/InMemory loader均可区分。

同设备/PID最多一个本服务编译Java/JNI脚本，包括枚举、方法读取和trace；先unload再换动作。Java/Native关联仍限定同线程原Java调用范围，不按时间关联JS与Java异步事件。观察JS桥接可使用trace-java指定已知的桥接类与精确重载；静态注解不能证明接口注册名或本次调用。

## WebView/CDP

```json
{"tool":"webview","arguments":{"action":"discover","serial":"<明确serial>","packageName":"com.example.app"}}
{"tool":"webview","arguments":{"action":"open","serial":"<明确serial>","packageName":"com.example.app","pid":12345,"targetId":"<发现返回的页面id>"}}
{"tool":"webview","arguments":{"action":"scripts","sessionId":"<返回的sessionId>"}}
{"tool":"webview","arguments":{"action":"source","sessionId":"<sessionId>","scriptId":"<scripts返回的id>"}}
{"tool":"webview","arguments":{"action":"dom","sessionId":"<sessionId>"}}
{"tool":"webview","arguments":{"action":"network","sessionId":"<sessionId>"}}
{"tool":"webview","arguments":{"action":"body","sessionId":"<sessionId>","requestId":"<本次已完成请求id>"}}
{"tool":"webview","arguments":{"action":"close","sessionId":"<sessionId>"}}
```

open存在多个页面时会拒绝并在error.json列出targets；据此重试targetId。root设备因/proc读取权限不足时，可显式`rootRead:true`，仅用于固定/proc文件的su读取，不安装、不强制开启调试、不提供任意shell。WebView本身必须开放调试socket；TWA/系统浏览器上下文不因此自动可访问。

依赖：Node26原生WebSocket、ADB、目标已开启WebView debugging；不需要Chrome/Playwright或Frida。校验包名、PID、boot id和进程starttime；每次读取前核验身份。使用临时adb forward tcp:0，结束只撤销自己的精确映射，禁止remove-all。workspace/webview-forwards.jsonl记录创建和释放；清理失败保留sessionId供close重试。异常强杀后按账本和adb forward --list人工核对，不能假定OS会清掉映射。

Network只捕获启用之后事件，默认遮蔽Authorization/Cookie/API-Key/Token等头，不保存请求postData。正文仍可能包含业务敏感内容；响应正文是调用方显式请求的内容。未记录到事件不等于没有请求；跳转链、HTTP状态、loadingFailed和partial/captureClosed一起判断。只有已在本会话完成的requestId才可读正文，资源被WebView淘汰时会明确报错。

预算：最多2会话、200脚本/200请求、8并发CDP调用、单消息4MiB/累计20MiB、单产物2MiB。超预算标partial；会话连接关闭不假装采集完整。DOM为当前快照，不恢复原始框架工程；不执行任意evaluate。

本机真机样本使用自有WebView shouldInterceptRequest提供固定HTTPS响应，证明CDP协议、实际WebView事件/正文和JS桥接，不证明该手机的外网/TCP连通。此前TCP样本因socket创建ECONNREFUSED失败，失败证据保留，未改手机VPN/代理/网络安全设置。

## .NET assembly stores

```json
{"tool":"managed","arguments":{"action":"inspect","path":"/absolute/path/libassemblies.arm64-v8a.blob.so"}}
{"tool":"managed","arguments":{"action":"extract","path":"/absolute/path/assemblies.blob"}}
```

支持固定布局store v1、v2（32/64位hash）、v3，raw store与有唯一_assembly_store节符号的ELF32/64封装；XALZ按LZ4 raw block、XAZS按Zstd解压。未核验版本、未知flags、越界、非相同重叠和路径异常明确拒绝，不执行ELF，不扫描magic猜载荷位置。

输出assemblies/assembly-NNNN.dll或.bin，记录原name/index/offset/codec/哈希。MZ只是PE候选，提取后用framework.ilspy作严格PE/CLI分析；native AOT不能按IL反编译。预算：输入512MiB、4096 descriptor、ELF累计200000符号、单程序集128MiB、累计解压512MiB（先预留再解压）。相同区间哈希复用，不能用重复引用放大inspect工作量。

依赖：Python标准库支持inspect/无压缩提取；LZ4/Zstd提取另需独立环境的lz4==4.4.5、zstandard==0.25.0。自有DLL封装v1/v2/v3与ELF的结构样本已验证提取SHA逐字一致，并接ILSpy；不冒充真实完整MAUI APK或runtime索引兼容验收。

## 持久证据图

每个成功任务自动旁写evidence.json；索引失败保留evidenceWarning，不抹掉原任务结果。读取固定报告名，拒绝越界链接，保留上游partial和来源文件/JSON pointer。

```json
{"tool":"evidence","arguments":{"action":"merge","jobIds":["<任务A UUID>","<任务B UUID>"]}}
{"tool":"evidence","arguments":{"action":"query","graphJobId":"<merge任务UUID>","kind":"java-method","query":"flow","limit":50}}
```

可查询artifact、java-method、js-function、js-callsite、runtime-event、runtime-call、jni-registration、webview-capture、framework-candidate。关联强度保存在edge.strength：内容相同用SHA256；Kotlin匹配完整JVM签名；JS只做静态词法直接函数绑定；运行调用只按device/session/script/trace和报告调用ID。CDP正文经SHA关联到静态脚本，采集会话身份不等于跨线程业务调用链。

框架候选依然是candidate-only。不会按相同路径、时间接近、相同PID或RVA猜跨任务业务关联，也不会自动遍历引擎全部输出生成全程序图。图是已知报告的有界索引，原始证据仍须分页读取。最多20000节点/40000边；merge最多50任务、累计读取64MiB，query返回最多100节点及200关联边。

## 开发验收

```zsh
npm run smoke:packages
npm run smoke:kotlin
npm run smoke:store
npm run smoke:hybrid -- <明确授权serial>
```

前三项不连接设备。packages需要bundletool和Android构建/签名工具；kotlin开发样本依赖固定编译器缓存（2.0.21等，见脚本），普通分析不要求该编译器；store样本需要私有.NET10/ILSpy和LZ4/Zstd，ELF封装还需NDK。hybrid会编译、签名并覆盖安装自有dev.androidreserve.fixture，启动/关闭它，不操作其他App；需先准备匹配的Frida server。多个设备smoke共享fixture根和签名，必须顺序运行。

验收脚本与output不随npm files分发；仓库开发环境运行。公开调用无需具备所有样本构建依赖。
