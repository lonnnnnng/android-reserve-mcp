# 工具与用法参考

`android-reserve-mcp` 当前向 MCP 客户端暴露 20 个顶层工具。每个顶层工具内部再通过 `action` 选择具体操作；不要把内部 action 数量误认为 MCP 工具数量。

## 统一调用规则

### 路径和任务

- 输入路径必须位于启动参数 `--allowedRoots` 的真实路径范围内。
- 长任务立即返回任务 ID；继续调用 `jobs` 的 `status`，直到状态是 `succeeded`、`partial`、`failed`、`canceled` 或 `interrupted`。
- 对成功任务使用 `artifacts` 的 `list`/`read` 读取 `result.json`、日志和报告；读取接口按字节分页。
- `partial` 表示结果有预算、输入或后端边界，不能当作完整恢复。

### 设备和动态分析

- `device`、`webview`、`frida` 都要求明确设备序列号、包名或 PID；服务不会自动挑选手机。
- 动态分析只使用调用方明确授权的设备；`spawn` 进程需要 `resume`，`attach` 不需要。
- `frida` 的 Java/JNI/Mono 观测在同一设备/PID上共用观测所有权，先 `unload` 或 `close` 再切换脚本。
- 服务不提供任意 shell，不自动开启 WebView 调试，不自动安装或提权。

## 工具总览

| 工具 | 主要 action | 用途 | 结果重点 |
| --- | --- | --- | --- |
| `doctor` | 无 | 检查 Node、Python、JDK、Android SDK、JADX、apktool、REA 和允许目录 | 依赖状态与修复建议 |
| `apk` | `inspect`、`signature`、`manifest` | APK ZIP、DEX、ABI、SHA-256、签名和 Manifest 摘要 | 任务报告，不修改输入 |
| `decode` | `jadx`、`apktool`、`both` | 导出 Java、资源和 smali | 独立任务目录，可部分成功 |
| `dex` | `classes`、`class`、`method`、`references`、`kotlin` | DEX 类、方法、引用、Kotlin metadata、Compose 候选、JavascriptInterface 声明 | 精确签名、候选位置和 partial |
| `packages` | `inspect`、`validate`、`decode`、`aab-manifests`、`select` | APK/APKS/AAB 集合一致性、split 依赖、设备 spec 选择和聚合分析 | 包名、长版本、证书和依赖错误 |
| `managed` | `inspect`、`extract` | .NET assembly store、ELF payload、XALZ/XAZS、LZ4/Zstd 有界提取 | 程序集 SHA 和索引来源 |
| `evidence` | `merge`、`query` | 合并任务证据，按内容哈希、签名、调用 ID 查询 | 节点、边、来源文件和 JSON pointer |
| `webview` | `discover`、`open`、`scripts`、`source`、`dom`、`network`、`body`、`close` | 已开放调试 WebView 的 DOM、脚本、网络和正文 | 同会话、进程代次和敏感头遮蔽 |
| `search` | 无 | 在已导出的源码中搜索文本或正则 | `file:line` 结果 |
| `resources` | `strings`、`view-events` | 字符串分页和 XML `android:onClick` 候选 | 声明候选，不证明运行绑定 |
| `native` | `elf`、`jni`、`open`、`functions`、`function`、`references`、`callers`、`callees`、`providers`、`go`、`rust` | ELF/JNI、Native 函数、调用关系和 provider | 独占 target、伪代码和引用 |
| `artifact` | `inspect`、`extract` | 产物识别、嵌套包、ABI、框架候选和定向提取 | 内容哈希、容器链和预算 |
| `script` | `index`、`format`、`map` | JS/TS/JSX/Flow 函数、依赖、调用点和 source map | 静态索引，不执行脚本 |
| `framework` | `engines`、`probe`、`analyze`、`channels` | Hermes、Flutter、ILSpy、Godot、IL2CPP、Ark 固定 CLI | 引擎身份、输出和兼容警告 |
| `device` | `list`、`inspect`、`packages`、`processes`、`logcat` | ADB 只读设备、包、进程和日志 | 必须显式 serial |
| `frida` | `devices`、`processes`、`attach`、`spawn`、`load`、`runtime`、`java-methods`、`trace-java`、`trace-java-group`、`trace-mono`、`trace-jni`、`trace-native`、`resume`、`status`、`unload`、`close` | Java、JNI、Native、RN Promise、Mono 窄 ABI 和调用范围观测 | script ID、运行事件、调用 ID、partial |
| `rebuild` | `build`、`sign` | apktool 工程重建、zipalign、签名和复验 | unsigned/signed 制品和证书报告 |
| `jobs` | `list`、`status`、`cancel` | 任务生命周期 | 状态、错误、完成时间和证据摘要 |
| `artifacts` | `list`、`read` | 任务产物分页读取 | 不越出任务目录 |
| `guidance` | `list`、`read` | 读取允许的本地 Android 逆向 Skill 和参考资料 | 只读指导文本，不自动执行 |

## 常用工作流

### 1. APK 静态分析

```json
{"tool":"doctor","arguments":{}}
{"tool":"apk","arguments":{"action":"inspect","path":"/absolute/path/apk-projects/app.apk"}}
{"tool":"decode","arguments":{"path":"/absolute/path/apk-projects/app.apk","engine":"both"}}
{"tool":"dex","arguments":{"action":"kotlin","path":"/absolute/path/apk-projects/app.apk","query":"com.example"}}
```

解码和 DEX 任务完成后，再用 `jobs.status` 和 `artifacts.read` 读取结果；不要把工具返回的任务 ID 当成 Java 源码路径。

### 2. WebView / JS 请求关联

```json
{"tool":"webview","arguments":{"action":"discover","serial":"SERIAL","packageName":"com.example.app"}}
{"tool":"webview","arguments":{"action":"open","serial":"SERIAL","packageName":"com.example.app","pid":12345}}
{"tool":"webview","arguments":{"action":"scripts","sessionId":"SESSION_ID"}}
{"tool":"webview","arguments":{"action":"network","sessionId":"SESSION_ID"}}
{"tool":"webview","arguments":{"action":"body","sessionId":"SESSION_ID","requestId":"REQUEST_ID"}}
{"tool":"webview","arguments":{"action":"close","sessionId":"SESSION_ID"}}
```

Network 只捕获启用后的事件；`initiator` 栈按同一 CDP session、进程代次和 `scriptId` 关联，不能按 URL 或时间猜测 JavaScript 业务因果。

### 3. Java / RN Promise 观测

先 `frida.attach` 或 `frida.spawn`，再执行 `frida.java-methods` 读取真实重载。需要请求和回复配对时使用 `trace-java-group`，其 `javaHooks` 必须明确类、方法、参数类型和 correlation 对象索引：

```json
{
  "tool":"frida",
  "arguments":{
    "action":"trace-java-group",
    "sessionId":"SESSION_ID",
    "maxEvents":80,
    "javaHooks":[
      {
        "id":"request",
        "className":"com.facebook.fbreact.specs.SampleTurboModule",
        "methodName":"getValueWithPromise",
        "argumentTypes":["boolean","com.facebook.react.bridge.Promise"],
        "correlation":{"group":"promise","role":"request","argumentIndex":1}
      },
      {
        "id":"resolve",
        "className":"com.facebook.react.bridge.PromiseImpl",
        "methodName":"resolve",
        "argumentTypes":["java.lang.Object"],
        "correlation":{"group":"promise","role":"reply"}
      }
    ]
  }
}
```

该能力只证明 Java 方法边界、对象身份和原方法终态；它不自动证明 Hermes `.then()`、JSI、Fabric 或完整业务因果。

### 4. MAUI / Mono 窄 ABI 观测

`trace-mono` 是实验性适配器，只接受 ARM64、已加载 Mono、静态非泛型 `int32` 方法，拒绝 byref、CoreCLR、NativeAOT、复杂结构体和对象参数：

```json
{
  "tool":"frida",
  "arguments":{
    "action":"trace-mono",
    "sessionId":"SESSION_ID",
    "monoTarget":{
      "assemblyName":"ReserveMaui",
      "namespace":"ReserveMaui",
      "className":"App",
      "methodName":"ReserveAdd",
      "argumentTypes":["int32","int32"],
      "returnType":"int32",
      "allowRuntimeCompile":true
    }
  }
}
```

运行时会回核 image GUID、MethodDef token、完整签名和 JIT 信息；`allowRuntimeCompile` 表示可能准备 JIT/AOT 入口，不代表调用方业务方法被执行。

### 5. Native / JNI

```json
{"tool":"native","arguments":{"action":"elf","path":"/absolute/path/libfoo.so"}}
{"tool":"native","arguments":{"action":"jni","path":"/absolute/path/libfoo.so"}}
{"tool":"frida","arguments":{"action":"trace-native","sessionId":"SESSION_ID","moduleName":"libfoo.so","symbolName":"exported_symbol","maxEvents":20}}
```

Native 独占 target 要按 `open → functions/function/references/callers/callees → close` 顺序使用。Native 观测只在明确导出名或合法模块 RVA 下工作；RVA 栈可能是候选，不自动升级为精确调用链。

## 能力边界

- Flutter channel 当前主要是 ARM64 AOT 与 Android 注册/handler 的静态候选；当前 Android 16/Frida 组合的 Reply 动态注入仍有 JNI transition 崩溃。
- Compose 当前有 Kotlin metadata、Composer、状态读写和调用点候选；状态入口动态注入同样保留兼容阻塞。
- RN 已验证 Java Promise 边界；Hermes JS 栈、`.then()`、JSI/Fabric 完整因果仍未覆盖。
- MAUI Mono 只验证窄 ABI；原 Release 方法内联、CoreCLR、NativeAOT 和复杂托管签名不能据此推断。
- Unity、Unreal、HarmonyOS NEXT 当前暂缓。

详细边界和动态证据见 [动态关联指南](DYNAMIC-CORRELATION.md)、[能力矩阵](CAPABILITIES.md) 和 [验证记录](VALIDATION.md)。
