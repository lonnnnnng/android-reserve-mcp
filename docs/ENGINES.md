# 引擎配置与新增能力使用

适用0.5.3及历史版本快照。最新增量、调用与边界见CURRENT-INCREMENT.md。所有引擎按需使用，不自动安装、升级或清理外部工具。完整依赖见ENVIRONMENT.md，私有安装见ENGINE-SETUP.md。

Unity、Unreal、HarmonyOS NEXT自2026-11-14起暂缓。下表IL2CPP/Ark仅保留现有固定CLI适配，不列为近期安装或验收任务，不代表对应框架已通过；恢复需用户明确安排。

## 1. 产物索引和提取

```json
{"tool":"artifact","arguments":{"action":"inspect","path":"/absolute/path/app.apks"}}
```

读任务result.json取得inventory.json的位置，再分页读inventory.json。支持单文件、目录和嵌套ZIP；区分APK/AAB/APKS/AAR/JAR、HBC/ELF/DEX等，并提供模块容器、ABI与文件布局候选。artifact本身不验证包名/版本/签名；使用新增packages作所选集合一致性与聚合分析，见ADVANCED-ANALYSIS.md。

从entries复制chain，定向提取：

```json
{"tool":"artifact","arguments":{"action":"extract","path":"/absolute/path/app.apks","chain":["splits/base.apk","assets/index.android.bundle"]}}
```

提取文件写入本次任务的extracted-<basename>；不会按归档路径写宿主目录。禁止路径穿越、重复成员、符号链接和加密条目。预算：12000条、累计读取512MiB、单成员128MiB、嵌套ZIP64MiB、最多3层嵌套、压缩比上限200；不足时返回partial/warnings，不宣称完整扫描。输出文件也是后续工具允许的输入。

## 2. JS静态分析

```json
{"tool":"script","arguments":{"action":"index","path":"/absolute/path/bundle.js"}}
{"tool":"script","arguments":{"action":"format","path":"/absolute/path/module.tsx","syntax":"typescript"}}
{"tool":"script","arguments":{"action":"map","path":"/absolute/path/bundle.js","mapPath":"/absolute/path/bundle.map","line":1,"column":120}}
```

报告script.json含函数/参数、imports、静态调用点、词法binding位置、字符串/URL与原输入位置。format额外产出formatted.js及其map。line从1、column从0，offset为UTF-16；静态调用点不是完整动态调用图。TS/Flow须显式选择，不能同时启用。格式化不会运行或转译目标代码。

仅读取显式mapPath，支持内联indexed map；不自动访问sourceMappingURL/sourceRoot/sources或外部sections URL，不证明提供的map属于相同构建。单文件/map12MiB、Node最大堆512MiB、AST70万节点、各结果集合12000项；超出明确失败或partial。

## 3. Native函数分析

1. `native.providers`检查真实provider状态，结果在任务中。
2. `native.open`打开允许目录中的ELF；读取result.json取得targetId。
3. `native.functions`列函数；优先使用精确address，而非可能重复的名称。
4. `native.function/references/callers/callees/status`查询。
5. `native.close`释放目标。最多2个target，各自独立REA连接，同target操作串行。

```json
{"tool":"native","arguments":{"action":"open","path":"/absolute/path/libapp.so","provider":"ghidra"}}
{"tool":"native","arguments":{"action":"functions","targetId":"<返回的UUID>"}}
{"tool":"native","arguments":{"action":"function","targetId":"<UUID>","procedure":"0x104344"}}
{"tool":"native","arguments":{"action":"references","targetId":"<UUID>","procedure":"0x104324","direction":"incoming"}}
{"tool":"native","arguments":{"action":"close","targetId":"<UUID>"}}
```

地址必须从当前目标结果复制，示例地址不可套用其他SO。REA完整Evidence保留在result.json。分析失败时job.error为可读原因，error.json保留完整后端诊断。取消Ghidra分析可能丢弃临时数据库，后续查询可能重新导入；关闭目标不删除本服务任务报告。重启后旧targetId不可复用。

### 本机已验证的Ghidra环境

- Ghidra12.2官方发行包，SHA256：`2c2cd776db3c1f6a097ba418922378ac3649cadd5e844a6f5f088ae628a7be67`。
- macOS ARM64发行包需另外构建原生decompiler：本机使用包内C++源码、Apple Clang16，执行`make -j4 ghidra_opt ARCH_TYPE='-arch arm64' ADDITIONAL_FLAGS='-mmacosx-version-min=13.0' OSDIR=mac_arm_64`，将ghidra_opt安装到该发行目录的`Ghidra/Features/Decompiler/os/mac_arm_64/decompile`并赋予执行权限。此步骤只适用于所述源码/平台，不照搬到Linux。
- Ghidra12.2需要完整JDK25；本机独立Temurin25.0.5+8，其下载包SHA256为`36dc14d797aaff6d89aab302cd053fdba6207dfdcf772052fa7b023a94b0e857`。未改全局Java/JADX的JDK21。
- 默认发现`~/.local/share/android-reserve-mcp/engines/ghidra_12.2_PUBLIC`及`engines/jdk-25`（指向JDK Home的目录/链接）。自定义设置`GHIDRA_INSTALL_DIR`、`ANDROID_RESERVE_GHIDRA_JAVA_HOME`；后者仅应用于本服务Native侧车。
- 其他版本/平台以其自身要求和`native.providers`为准。IDA provider需另配置REA的上游MCP，安装IDA App本身不等于可用。

本机验证覆盖自有ARM64函数/引用，不代表所有架构、加固SO和引擎版本均通过。

## 4. 可选框架引擎

`framework.engines`不启动引擎，返回配置状态与未实现适配器；`framework.probe`检查版本/帮助并记录入口文件哈希；`framework.analyze`执行固定参数并检查非空产物。探测成功不等于样本分析成功。

`readiness=configured-not-sample-validated`表示本次查询只检查配置/文件，不读取历史验收报告；即使本机样本已通过，该字段仍保留这一语义。实际样本矩阵以VALIDATION.md为准。

| engine | 环境变量 | 输入与关键限制 | 当前验收 |
| --- | --- | --- | --- |
| hermes | ANDROID_RESERVE_HBC_DISASSEMBLER | 普通HBC72–96；工作树97–99须allowExperimental=true并强制partial，100/未知拒绝 | HBC84回归与真实RNTester HBC99实验反汇编通过；debug元数据未验证 |
| flutter | ANDROID_RESERVE_BLUTTER | blutter.py绝对路径；调用方提供同构建ARM64 libapp.so/libflutter.so目录；显式allowEngineBuild=true | 固定Blutter commit、Flutter3.41.9/Dart3.11.5自有release样本通过 |
| ilspy | ANDROID_RESERVE_ILSPY | ilspycmd绝对路径；已提取有CLI目录的PE；不是MAUI store或NativeAOT | ILSpy11.2.0.10050、独立.NET10，自有程序集通过 |
| godot | ANDROID_RESERVE_GDRE | GDRETools可执行文件；APK/PCK等恢复；不自动强制版本或解密 | GDRE2.7.4、自有Godot4.3 GDScript字节码PCK通过 |
| il2cpp | ANDROID_RESERVE_IL2CPP_DUMPER | apphost或.dll；binary+metadataPath；引擎config.json RequireAnyKey=false | 适配已实现；未安装/样本实测；DummyDll非完整方法体 |
| ark | ANDROID_RESERVE_ARK_DISASM | 匹配目标SDK的ark_disasm；ABC输入；输出.pa | 适配已实现；未安装/样本实测，不声明NEXT全版本支持 |

可执行文件由维护者在启动环境中配置，工具参数不能指定任意shell/argv。默认依次使用显式变量、适用的PATH命令、用户级托管目录。Flutter可另设`ANDROID_RESERVE_ENGINE_PYTHON`为独立venv解释器；ILSpy可设`ANDROID_RESERVE_DOTNET_ROOT`选择私有runtime，仅影响该子进程。IL2CPP DLL仍需要PATH上的dotnet及对应runtime。所有目标路径受allowedRoots限制。

Flutter输入报告对两份SO分别记录SHA256，但不独立证明它们属于同一构建；调用方从同一个APK/ABI提取，并在分析过程中保持文件不变。输出检查要求Blutter对象池和汇编、ILSpy C#和项目文件、GDRE有效项目配置与恢复资源/脚本，不能只有日志/配置文件。

Hermes默认尝试`~/.local/share/android-reserve-mcp/engines/hermes-env/bin/hbc-disassembler`。本机独立venv安装hermes-dec0.1.8，源码revision`2e796663e1fedb93dca51060797ebf3327b3fedb`；不复制到本npm包。验收用的旧版Hermes compiler0.11.0仅用于生成HBC84，不作为“支持当前所有RN版本”的依据。

```json
{"tool":"framework","arguments":{"action":"engines"}}
{"tool":"framework","arguments":{"action":"probe","engine":"hermes"}}
{"tool":"framework","arguments":{"action":"analyze","engine":"hermes","path":"/absolute/path/index.android.bundle"}}
{"tool":"framework","arguments":{"action":"analyze","engine":"flutter","path":"/absolute/path/arm64-v8a","allowEngineBuild":true}}
```

Blutter可能自行下载并构建对应Dart，必须准备Python pyelftools/requests、C++20编译器、CMake/Ninja、ICU/Capstone等可写独立环境。ILSpy11.2的安装/运行使用独立.NET10，未改全局.NET6；GDRE使用对应OS/ABI发行。上述三者已在本机安装并有样本通过，确切步骤见ENGINE-SETUP.md。IL2CPP仍需匹配runtime和元数据版本；Ark仍需匹配SDK，二者真实引擎尚未验收。

## 5. Frida运行观测

新增`runtime`记录Frida版本、PID、架构、模块和Java bridge是否存在；`trace-native`按模块+导出符号观测寄存器参数、返回值、可选Native调用栈，不修改它们。参数的int32只是解释视图，不推断真实C类型，不解引用未知指针。按maxEvents限制事件数；默认50，最多500。

```json
{"tool":"frida","arguments":{"action":"trace-native","sessionId":"<本服务会话>","moduleName":"libfixture.so","symbolName":"Java_dev_androidreserve_fixture_MainActivity_nativeAdd","argumentOffset":2,"argumentCount":2,"maxEvents":20,"captureStack":true}}
```

JNI普通方法前两个参数为JNI环境与对象/类，该示例明确跳过它们；其他函数须按其实际ABI配置。模块尚未加载时默认等待30秒，可通过`moduleWaitMs`设为100–30000毫秒；到期产生`module-wait-timeout`，不会无限轮询。加载任务成功仅说明脚本被接受，须在status中看到hook-installed和native-call才能确定实际观测成功；立即脚本错误会判任务失败。Native栈不等于完整Java/Kotlin调用栈。

本机Frida17.23.2 raw script环境的`Java`为undefined；0.3.0新增的Java专项会显式打包bridge，普通`load`仍不自动提供Java。server/Gadget须与REA设备binding兼容。自有App的attach与spawn/load/resume及下述Java流程已在授权真机验证；测试server与App已停止，不在MCP启动时自动运行。

## 6. Java方法与同调用JNI观测

依赖frida-java-bridge7.0.13、frida-compile19.1.0及编译器Frida原生binding，详见ENVIRONMENT.md。枚举与观测使用默认app ClassLoader，不自动搜索自定义loader。先attach，或spawn后按暂停流程加载：

```json
{"tool":"frida","arguments":{"action":"java-methods","sessionId":"<会话UUID>","className":"dev.androidreserve.fixture.MainActivity","methodName":"compute"}}
{"tool":"frida","arguments":{"action":"unload","sessionId":"<会话UUID>","scriptId":"<枚举任务返回的script_id>"}}
{"tool":"frida","arguments":{"action":"trace-java","sessionId":"<会话UUID>","className":"dev.androidreserve.fixture.MainActivity","methodName":"compute","argumentTypes":["int","int"],"returnType":"int","captureStack":true,"maxEvents":20,"nativeHooks":[{"moduleName":"libfixture.so","symbolName":"Java_dev_androidreserve_fixture_MainActivity_nativeAdd","argumentOffset":2,"argumentCount":2}]}}
{"tool":"frida","arguments":{"action":"status","sessionId":"<会话UUID>"}}
{"tool":"frida","arguments":{"action":"unload","sessionId":"<会话UUID>","scriptId":"<trace任务返回的script_id>"}}
{"tool":"frida","arguments":{"action":"close","sessionId":"<会话UUID>"}}
```

示例类/符号属于自有样本，不能套用未知App。`java-methods`异步输出的overloads给出实际`argumentTypes`和`returnType`；数组类型照抄返回值，例如`[B`。空参数必须显式`[]`。`script_id`从加载任务的result.json取得，可能位于REA Evidence的normalized_result中。枚举任务本身无需原始方法执行；spawn若枚举仍等待loader，先resume或使用已知重载直接trace后resume。

加载成功仅说明脚本已接受；spawn的Java安装会等到resume后。必须在status产物中看到`java-hook-installed`和`java-enter/java-exit`；setup最多30秒，Native模块最多30秒。晚到失败在status判失败并尝试卸载，完整诊断保留error.json。发生注入状态不明、卸载失败或清理未确认时，先close会话；排队任务先cancel，正在编译任务cancel后等待终态，再close。

关联字段为`native-call.javaInvocationId`和Java事件的`invocationId`。它证明Native事件位于同OS线程的原Java调用范围，不证明直接调用/符号静态绑定，也不跨异步线程继承。不要把栈指纹或时间接近当调用ID。Java栈来自`Thread.getStackTrace`，最多16帧；Native栈仍为Native地址。参数/返回仅展开基本类型，对象只标类型，异常原样抛回目标。

同设备/PID在本MCP只允许一份编译Java/JNI脚本，包括java-loaders/java-methods/trace-java/trace-jni，即使创建多个会话；先unload原scriptId再重挂。任意`load`脚本和其他客户端不受此保护，不应同时替换相同Java方法。0.4.0新增未来RegisterNatives/UnregisterNatives入口观测与模块RVA追踪，详见[动态JNI说明](JNI-OBSERVATION.md)；0.5.0可通过java-loaders返回的唯一selector选择BaseDexClassLoader；未知/歧义loader和全局ART去优化仍未提供，见ADVANCED-ANALYSIS.md。


分包/AAB、Kotlin、ClassLoader、WebView、assembly stores、持久证据的完整步骤统一见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)。doctor.analysisDependencies提供新增依赖路径级检查，不启动引擎/连接设备，也不证明压缩Python模块已可导入。
