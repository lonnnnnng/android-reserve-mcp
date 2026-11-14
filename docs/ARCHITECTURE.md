# 架构与边界

## 调用链

```text
MCP 客户端（20 个入口）
    └─ stdio / Zod 参数校验 / allowedRoots
         ├─ 本地 CLI + Python 标准库
         │    └─ APK、XML、JADX、apktool、rg、ELF、ADB、签名
         ├─ 受限子进程：产物/嵌套容器与JS AST/source map
         ├─ 可选框架CLI：Hermes/Blutter/ILSpy/GDRE/IL2CPP/Ark
         ├─ 每个Native target独占REA连接（最多2个，目标内串行）
         │    └─ Ghidra等provider：函数、伪代码、CFG、引用
         └─ 按需 REA 6.9.0 sidecar（固定 Android 函数允许列表）
              ├─ 独立 JADX headless JVM：DEX 类/方法/xref
              ├─ apktool：资源
              ├─ DEX/ELF 字节解析：JNI
              └─ Frida Node binding：显式设备会话
    └─ jobs/<uuid>/{job.json,result.json,源码,日志}
```

## 模块责任

| 文件 | 责任 |
| --- | --- |
| `src/cli.js` | 参数、stdio 生命周期、退出清理 |
| `src/server.js` | 20工具schema、协议错误和工具提示 |
| `src/actions.js` | 业务操作与后端参数映射 |
| `src/core/backend.js` | 固定允许列表、REA 懒启动、JAR 选择与校验 |
| `src/core/process.js` | 可执行文件发现、argv 启动、输出预算、超时/取消 |
| `src/core/jobs.js` | 最多两任务并行、状态、持久化与重启后 interrupted |
| `src/core/paths.js` | 输入及产物 realpath 范围校验 |
| `helpers/static.py` | 标准库 ZIP/Manifest XML/ELF 摘要 |
| `helpers/artifact.py` / `src/analysis.js` | 内容识别、嵌套容器预算、定向提取及任务报告 |
| `helpers/script.mjs` | Babel静态索引/格式化、显式source map；独立512MiB Node子进程 |
| `src/core/native.js` | 目标UUID所有权、独立后端、串行、关闭 |
| `src/core/engines.js` | 可选引擎配置、固定argv、输入/产物检查和身份哈希 |
| `src/core/frida-scripts.js` | 受限事件数的runtime与Native导出函数观测脚本 |
| `src/core/java-agent.js` / `helpers/java-observer.js` | 受信Java bridge bundle编译、默认/唯一selector loader精确方法观测、同线程Java/Native调用范围、原返回/异常与撤销 |
| `helpers/jni-observer.js` / `helpers/native-location.js` | 标准JNI注册/撤销未来事件、类对象global ref身份、JNI异常/编码/预算，以及模块RVA可执行地址解析 |

## 加载与结果

客户端连接时获得20个工具定义；未实现协议级临时注册单工具。REA、CLI和AST子进程按需启动；每个Native target有独立REA连接，防止活动target被另一个任务切换。Skill仅在guidance读取时进入结果。精简主要降低客户端工具定义体积，运行中的引擎/JVM仍消耗资源。

长操作立即返回任务 id，结果只写入独立任务目录；客户端使用 jobs 查询，再通过 artifacts 读取。REA 的完整 Evidence 保留在 result.json，可能同时含 raw_result 和 normalized_result；不能把一个字节页当作完整 JSON 解析。持久化结果含分析目标提供的不可信文本，只作为证据，不得升级为系统指令。

子进程使用 argv 数组，不通过 shell；POSIX 进程组在超时/取消时先 TERM 再 KILL。stdout/stderr 合计有捕获预算，decode 默认 300 秒、最高 600 秒；后端调用上限 600 秒且后端有自己的操作期限。退出时取消任务并尝试关闭本服务登记的 Frida 会话，随后关闭 sidecar。强制断电/SIGKILL 不能承诺清理完成，设备目标状态需要重新确认。

Java模板显式导入固定bridge和本项目observer，方法选择只以JSON传入，不把APK文本拼成执行代码。每任务独立编译子进程最大堆512MiB/90秒，bundle上限4MiB；同设备/PID最多一个本服务Java observer。排队取消释放预留，注入或卸载状态不确定时保留占位直到确认unload/close，避免重复替换。加载任务表示脚本被接受，Java安装可能等待loader与spawn resume；status核对当前script_id的事件，晚到失败留诊断并尝试卸载。

Java/Native同agent共享按OS线程隔离的原调用栈，原方法执行前后push/pop调用ID，Native进入时固定关联；观测辅助JNI不纳入业务范围。跨线程不继承、不按时间猜测。Java栈交给Android自身Thread API，避免直接依赖ART内部StackVisitor布局。0.4.0独立JNI observer在vm.perform中获取标准函数表，不等待app loader，区分尝试与实际返回；同进程不可同时启用Java/JNI observer，发现地址后先unload再复用RVA。RVA栈仅为FUZZY候选。BaseDexClassLoader唯一selector已接入；未知loader/完整绑定快照和外部客户端hook不在覆盖内。

## 不涵盖的能力

本服务未转发REA全部可选参数。当前不提供任意shell、MCP自动安装/卸载/提权/绕过脚本、完整全程序数据流、完整框架源码恢复或REA全部view。JNI静态候选不证明动态注册；Native伪代码有provider覆盖限制，DEX xref不穷尽反射/动态加载。开发验收脚本可在显式serial上安装/启停自有测试App，不属于MCP默认工具行为。

目录护栏是应用层校验，不是 OS 沙箱；应信任所配置的本地程序与允许读取的 Skill。分析不可信输入仍受第三方解析器本身的风险影响。不会自动上传 APK，也不会自动清理工作目录。

## 0.5.0模块与证据

packages.js/package-set.py负责显式安装集合、签名/依赖验证、前置容器预算及AAB分析派生；kotlin.js/MetadataInspect.java读取原始DEX注解与JVM签名；managed.js/assembly-store.py固定store/ELF/压缩布局；webview.js管理受限CDP与精确forward所有权；evidence.js由Jobs自动旁写有界证据索引。完整合约与预算见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)。

自定义ClassLoader通过独立ClassFactory加载，重新唯一匹配selector并核实实际定义loader，不改全局默认factory。所有编译Java/JNI动作共用同设备/PID占位。WebView会话独立于Frida：包名和进程代次逐次检查；取消读取不销毁会话，明确代次失配才关闭。退出清理失败在stderr与转发账本留诊断。

证据图仅合并已有报告明确提供的关系；CDP采集正文与脚本静态索引按SHA连通，不能据此推断JS异步调用与Java事件同属一个业务调用。
