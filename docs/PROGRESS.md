# 实施进展

版本0.5.0，2026-11-14，本地尚未发布。已补齐本批共用能力，完整技术栈路线图仍未全部完成。用户暂无Unity/Unreal/MAUI/Harmony真实产物，本轮采用自有样本；不把结构夹具当完整引擎App验收。

## 本批已落地

- 分组入口由16增为20：新增packages、managed、webview、evidence，dex/frida扩展action。
- 分包校验包名、longVersionCode、全部signer证书、唯一base/split及依赖环；通过才聚合DEX，资源按模块独立导出。APKS显式members或bundletool设备spec选择；AAB只读Manifest与代码/资源分析派生，不冒充原作者签名APK。
- Kotlin原始DEX注解→metadata函数suspend/inline、JVM签名精确匹配；协程DebugMetadata/invokeSuspend和Compose Composer参数为候选。静态读取JavascriptInterface真实注解，不把方法名当桥接证明。
- Java自定义ClassLoader枚举与type+有序dexPaths唯一selector；独立ClassFactory并核对定义loader，父委派不冒充；未知/歧义/超预算拒绝。同设备/PID的编译Java/JNI动作共用占位。
- 显式serial/packageName/pid的已开放WebView/CDP：DOM、源码、启用后网络、文本/二进制正文、敏感头遮蔽；包名/boot id/starttime校验、精确forward账本与清理失败重试。取消单项读取保留会话，代次失配关闭。
- store v1/v2（32/64位hash）/v3、ELF32/64符号定位、XALZ/LZ4与XAZS/Zstd有界提取；声明/区间/版本/累计符号/解压预算，重复区间哈希复用。
- Jobs旁写持久证据索引，merge/query保留来源文件/JSON pointer与强度；内容哈希、Kotlin签名、直接函数词法绑定、同脚本调用ID、CDP采集来源分别标识。传播上游partial，不按时间/PID猜跨任务调用。
- 真实自有Kotlin编译→DEX、真正bundletool AAB/分包与设备spec、自有DLL→store/ELF结构容器→提取SHA→ILSpy全部通过。
- 授权POCO F2 Pro：独立附加DEX方法返回80、JS→Java桥接返回90、DOM/源码/JSON/二进制正文采集、鉴权头遮蔽及采集→静态同哈希关联通过。WebView响应由自有拦截器提供；TCP socket创建失败的环境记录保留，不称外网验证。
- 34组自动测试已通过；版本/stdio统一0.5.0。最终检查与客户端复验记录见VALIDATION.md。

## 原有能力沿用

Java/APK/资源/重建签名、mapping、JS AST/source map、独占Native target/Ghidra函数分析、Hermes HBC84、Flutter3.41.9/Dart3.11.5 Blutter、ILSpy/.NET10、Godot4.3/GDRE，以及动态JNI未来注册/撤销、RVA Native与Java同调用关联。历史真实验收范围见VALIDATION.md，不能据此扩大到全部版本。

## 仍未完成

| 范围 | 剩余工作 | 本轮可复用内容 |
| --- | --- | --- |
| View/Compose/KMP | 完整布局/状态/事件/导航语义、KMP klib及其他target/commonMain专项 | DEX/metadata/资源/运行观测 |
| RN/Hermes | 完整RN App、更多HBC版本、JSI/Fabric/TurboModules与异步跨层关系 | HBC84、JS、Native与Java通用层 |
| Flutter | 更多Dart/ABI、platform channel、debug VM service专项 | 已验收ARM64 AOT版本 |
| Lynx/NativeScript | 专用codec/snapshot格式、版本路由、完整桥接 | 容器/JS/DEX/Native |
| Web混合/PWA/TWA | 框架插件注册与完整路由、SW/cache、系统浏览器独立上下文 | 已开放WebView/CDP、静态注解、已知Java桥接重载 |
| JNI/loader | 全部JNI表/ABI/CheckJNI、完整当前绑定快照、未知loader、异步传播 | 标准入口未来事件、RVA、BaseDex唯一selector |
| MAUI | 真实完整MAUI APK、多runtime索引/布局、AOT地址/元数据关联 | store结构提取、ILSpy |
| Unity/Unreal/Godot | IL2CPP引擎真实安装/产物验收、Unity资源、Pak/IoStore/Blueprint、更多Godot版本/C#资源图 | Native/托管通用层、已验收Godot4.3 GDScript |
| HarmonyOS NEXT | 具体SDK/ABC/资源/签名、ArkUI和鸿蒙设备链 | 有界容器/任务/provider抽象；当前Ark仅适配未实测 |
| 工程完整性 | 更全面格式/版本矩阵、深度doctor、Linux完整验收、公开发布 | 当前路径级doctor、固定依赖和自有样本 |

实际使用、依赖与预算见[ADVANCED-ANALYSIS.md](ADVANCED-ANALYSIS.md)、[ENVIRONMENT.md](ENVIRONMENT.md)。原始全路线评估保留在ROADMAP-GAPS.md；未完成项不通过改名或增加工具定义算完成。

0.5.0 tarball已在隔离目录实装，stdio tools/list为20项且doctor成功；macOS本地34项测试、静态smoke、包清单、0漏洞生产依赖审计通过。当前Git仓库无commit/remote，npm whoami返回401。首发门槛和完整后续待办见[FIRST-RELEASE-TODO.md](FIRST-RELEASE-TODO.md)。

首个0.5.0候选发布门槛和完整后续待办见[FIRST-RELEASE-TODO.md](FIRST-RELEASE-TODO.md)。
