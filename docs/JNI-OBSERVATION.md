# 动态JNI注册与隐藏函数观测

适用0.5.0、0.5.1及0.5.2本地候选，核验日期2026-11-14。新增能力保留在`frida`分组中，服务当前20个工具入口，JNI动作仍在frida内；不需要安装新的外部引擎。依赖沿用Java bridge、编译器、REA设备binding和匹配server，见[完整环境](ENVIRONMENT.md)。

## 1. 能得到什么

`trace-jni`从当前`JNIEnv`标准函数表215/216槽获取`RegisterNatives`和`UnregisterNatives`地址并观测未来调用，不枚举Android私有ART符号。每次操作包含：

| 字段 / 事件 | 含义 |
| --- | --- |
| `jni-observer-ready` | 两个入口已装观测；记录表地址、函数地址和覆盖边界 |
| `jni-register-enter` | 注册尝试，含Java类、方法名、JNI签名、函数地址、所属模块/路径/基址/RVA |
| `jni-register-result` | 同registrationId的实际返回码；0为success，其他为failure |
| `jni-unregister-enter/result` | 整个类的撤销尝试和实际结果，不等于只撤销某个方法 |
| `classId` | 本observer内按真实类对象身份分配，同名但不同loader的类不合并；不是跨进程/跨脚本持久ID |
| `partial` / `reportedMethodCount` / `emittedMethodCount` | 方法表是否只读出部分；不能把剩余未读方法当成不存在 |
| `mappingEffect` | 成功注册registered；成功撤销class-unregistered；失败unknown-on-failure |

入口事件只说明尝试。必须用`registrationId`找到成功返回，再把对应方法当作本次成功注册的映射；失败可能有部分副作用，不宣称旧映射完全不变。没有出口事件时结果未知。

不会回溯已发生的注册，也不提供完整当前绑定快照。`attach`通常会错过JNI_OnLoad；要看启动注册应spawn，在resume之前安装并确认ready。不同JNI表、后续表切换或绕过该入口的ART内部路径不在保证范围。

## 2. 从发现到跟踪的完整流程

先明确设备，创建本服务会话。以下类/库为自有样本，实际调用须替换：

```json
{"tool":"frida","arguments":{"action":"spawn","deviceId":"<明确设备ID>","packageName":"dev.androidreserve.fixture"}}
{"tool":"frida","arguments":{"action":"trace-jni","sessionId":"<会话UUID>","className":"dev.androidreserve.fixture.MainActivity$DynamicTarget","maxEvents":24,"maxMethods":64}}
{"tool":"frida","arguments":{"action":"status","sessionId":"<会话UUID>"}}
{"tool":"frida","arguments":{"action":"resume","sessionId":"<会话UUID>"}}
{"tool":"frida","arguments":{"action":"status","sessionId":"<会话UUID>"}}
```

每个长任务查jobs终态后分页读result.json。`trace-jni`返回的script_id可能位于REA Evidence的normalized_result。暂停期间先确认当前脚本`jni-observer-ready`；resume后再读取注册事件。className可省略以观察所有类，提供时精确匹配运行时点分类名，不支持正则。

找到`dynamicAdd`、签名`(II)I`，并确认同registrationId的返回码为0。复制该条记录的模块名和RVA，卸载**观测脚本**，这不会替目标调用UnregisterNatives：

```json
{"tool":"frida","arguments":{"action":"unload","sessionId":"<会话UUID>","scriptId":"<trace-jni脚本UUID>"}}
{"tool":"frida","arguments":{"action":"trace-java","sessionId":"<会话UUID>","className":"dev.androidreserve.fixture.MainActivity","methodName":"computeDynamic","argumentTypes":["int","int"],"nativeHooks":[{"moduleName":"libfixture.so","rva":"<从当前事件复制的0x十六进制RVA>","argumentOffset":2,"argumentCount":2}],"captureStack":true,"maxEvents":20}}
{"tool":"frida","arguments":{"action":"status","sessionId":"<会话UUID>"}}
{"tool":"frida","arguments":{"action":"unload","sessionId":"<会话UUID>","scriptId":"<trace-java脚本UUID>"}}
{"tool":"frida","arguments":{"action":"close","sessionId":"<会话UUID>"}}
```

也可单独调用`trace-native`，提供moduleName+rva及参数预算。`symbolName`与`rva`必须二选一，不能都填；nativeHooks中的每一项同样处理。RVA必须落在当前同名模块范围及可执行内存，巨大或溢出偏移直接拒绝。

RVA是运行地址相对于模块基址的偏移，**不是文件偏移**。ASLR变化不能靠复用绝对地址解决；不同构建的同名SO也不能直接复用RVA。静态分析时先确认同一二进制及其映射/载入基址，再换算provider地址。模块重载、进程重启或版本变更后重新确认，工具不证明宿主SO与设备文件具有相同哈希。

Java↔Native关联仍只证明同OS线程原Java调用范围，不推断直接调用或异步跨线程关系。Java方法可用默认app loader或java-loaders返回的唯一selector；注册观测的类身份不等于完整当前绑定快照。未知loader仍可能无法唯一选择，见ADVANCED-ANALYSIS.md。

## 3. 栈、预算与生命周期

RVA入口可能是没有帧链的隐藏叶函数。本机对此使用Frida ACCURATE曾发生原生崩溃；改为FUZZY后真机通过。`captureStack=true`时，RVA Native事件带`stackKind=frida-fuzzy-candidates`，只能当候选返回地址，可能有误报，不能称精确调用链。导出符号沿用原ACCURATE策略；Java栈仍来自Android Thread API。默认不采样栈。

预算：maxEvents默认50、最高500，表示匹配的注册/撤销操作次数，每次最多两条事件；maxMethods默认64、最高256，但单次实际受剩余总预算和消息预算限制。每文本最多1024字节、方法总读取1024项、类身份最多128个、回调最多4096次。方法表按UTF-8保守上界留20KiB输出预算，避免超过后端单消息32KiB；触顶显示partial/tableOutputTruncated。还须检查REA的messages_truncated等捕获标记，未捕获部分不能算不存在。

JNI方法文本按modified UTF-8解码，记录NUL终止、不可读和截断状态；类名最多2048个UTF-16单元。观测前已有业务pending exception则跳过类名解析；只清本次观测新增的异常。Class.getName、字符串和global ref操作逐步检查异常，onLeave只读返回码并发消息，不执行JNI，不吞目标NoSuchMethodError。

同设备/PID仅允许一个本MCP的编译Java/JNI脚本（java-loaders/java-methods/trace-java/trace-jni）。先unload再切换；排队任务cancel释放预留，注入/卸载不确定时先close。脚本卸载只撤销自身Interceptor与类引用，不执行目标注册/撤销，不修改返回值，也不加载绕过逻辑。任意用户脚本和其他客户端不在冲突保护范围。

## 4. 本轮真实验收

`npm run smoke:jni -- <明确serial>`使用匹配Frida17.23.2 server，在指定POCO F2 Pro上只安装/启停自有`dev.androidreserve.fixture`。验收包括：

- spawn暂停时确认ready，捕获JNI_OnLoad中的隐藏函数注册；attach另外捕获未来周期注册。
- 成功、NoSuchMethodError失败、整类撤销与重新注册，方法名/签名/类身份一致。
- observer仍加载时读取**自有PID**周期日志的123，确认原异常未被吞；不清空全局logcat。
- 隐藏函数不在dynsym中；卸载注册观测后，按返回RVA在独立Native agent和Java联合agent分别捕获参数2/7、Native返回20、Java返回57和共享调用ID。
- 全部等待按当前script_id过滤历史消息，避免上一份脚本事件造成假通过；退出关闭会话并停自有App。

报告在开发机`output/device-smoke/jni-report.json`，失败与无栈对照在`output/v040-research`。不包含在公开包中；更多Android/ABI/Gadget/CheckJNI变体仍须独立样本验收。

## 5. 尚未加载的Native模块

`trace-native`遇到目标模块尚未出现时先发`waiting-module`，随后每100毫秒检查一次；`moduleWaitMs`可设100–30000毫秒，默认30000毫秒。模块出现后才解析导出符号或RVA并安装hook；到期发`module-wait-timeout`。该等待不调用目标加载器，也不保证模块一定会加载。

0.5.2候选在自有fixture中增加独立`libdelayed.so`：App启动后经`System.load`延迟加载，Native方法由该库的`JNI_OnLoad`注册。spawn保持暂停时先装`trace-native`，resume后必须依次看到`waiting-module`、`hook-installed`、`native-call`；设备验收捕获参数2/7、返回110。此验收覆盖POCO F2 Pro Android 16、Frida server 17.23.2和自有ARM64样本，不代表其他Android版本、ABI、加载器或目标应用均通过。结果与JNI回归共存于`output/device-smoke/jni-report.json`。

依据：[JNI标准接口与索引](https://docs.oracle.com/en/java/javase/25/docs/specs/jni/functions.html#registering-native-methods)、[JNI线程/多函数表](https://docs.oracle.com/en/java/javase/25/docs/specs/jni/design.html#jni-interface-functions-and-pointers)、[Frida API](https://frida.re/docs/javascript-api/)，并以本机NDK28.2的jni.h和固定bridge7.0.13源码交叉核对。标准规范不是所有Android实现变体已通过的证据。
