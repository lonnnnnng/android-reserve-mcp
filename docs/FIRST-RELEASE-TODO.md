# 首发与后续待办

核对日期：2026-11-14。仓库已有候选tag`v0.5.0`；当前源码为未打tag的`0.5.1`候选。GitHub/npm发布仍未发生。此表区分发行门槛与缺少目标样本/设备的能力专项。

## 首发门槛

| 状态 | 事项 | 所需动作与验收 |
| --- | --- | --- |
| 已完成 | 0.5.1本机质量门 | 39项自动测试、语法/静态/Compose/分包/store smoke、tarball实装、包清单、生产依赖审计通过 |
| 已完成 | 0.5.1通用增量 | View onClick、source map/container evidence、真实Compose调用候选、CDP/loader拒绝路径已纳入当前候选工作树 |
| 已完成 | npm包名预检 | 当前registry查询返回404，表示此刻未发现公开同名包；发布前仍需用已认证账号再次查询，避免竞态 |
| 需用户定项 | GitHub仓库目标 | 当前账号`lonnnnnng`已登录，名为`android-reserve-mcp`的仓库不存在；确认新建此名称及公开/私有可见性 |
| 需用户/凭据操作 | npm发布身份 | `npm whoami`返回401；在本机完成`npm login`或配置受支持的发布token，再用`npm whoami`确认，不把凭据写进项目/命令历史 |
| 已完成待推送 | 新版本提交/tag | 0.5.1中文候选提交和本地tag已建；确认仓库可见性后添加remote、推送并等待macOS/Linux CI成功 |
| 发布动作 | 首个版本 | 创建新的`v0.5.1` tag/GitHub Release并附发布说明；npm发布`0.5.1`后从registry全新安装，复验CLI版本、stdio tools/list与doctor |
| 发布后 | 客户端验证 | 重启OpenCode并检查`android-reserve`可见20个工具；现有配置保留，不改provider/API Key |

首发不必等待每个Android框架专项全部完成。README、能力矩阵、第三方说明与限制需随0.5.1明确呈现；发布前已加入包清单检查和真实tarball安装验收。

## 可在当前环境继续完成

| 优先级 | 工作 | 验收结果 |
| --- | --- | --- |
| P0 | 完成release tarball全新安装与协议测试 | `npm run smoke:release`通过；覆盖README/维护说明所示的实际安装形态 |
| 已完成 | 为README加入已发布后的npm安装命令，并标明发布前的本地安装命令 | npm版与GitHub源码版的安装路径、Node和外部引擎要求清楚 |
| P0 | 运行全量`check`、`test`、`check:pack`、静态smoke、audit；刷新VALIDATION | 结果来自最终源码/最终tarball，CI矩阵与本地结果分开标注 |
| 已完成 | 检查resources扩展action Schema及工具清单 | resources view-events参数明确，MCP仍是20个工具入口 |
| P1 | 收敛历史文档中仍写“0.4未支持”但已在0.5实现的陈述 | 历史记录保留版本，当前用法统一指向0.5文档 |
| P1 | 检查首发包第三方NOTICE、npm元数据与许可证 | 包名/作者/MIT/依赖范围正确；无项目私有路径、样本、缓存或凭据 |
| P2 | 核对macOS arm64完整安装、frida install-script路径 | npm clean install后Java compiler host binding可构建；不覆盖REA设备server版本 |
| 已完成 | 实测npm 11下tarball依赖安装脚本审批与Frida binding导入 | 普通安装先阻止未审查脚本；临时项目逐包审批、rebuild后binding可import，已把边界和命令写入README/环境/维护说明 |

这些事项不需要Unity/Unreal等外部样本；若在发行窗口内完成，直接纳入0.5.1最终候选。

## 需要新样本或设备

| 专项 | 待办 | 缺少的验证条件 |
| --- | --- | --- |
| View / Compose / KMP | XML onClick声明候选与Compose Composer/状态/lambda方法内调用候选已实现；仍需DEX存在/可见性核验、Compose状态/重组/导航/事件关系、KMP klib与commonMain/其他target | View组件类归属用自有APK固定；Compose编译候选不证明事件实际发生；KMP需多target发布AAR/klib与已知符号 |
| React Native / Hermes | 完整RN APK、多HBC版本、JSI/TurboModules/Fabric及JS↔Native真实关联 | 对应RN版本的debug/release自有APK、HBC与源码/map、可调试设备 |
| Flutter | platform channel、Dart多版本与ABI、debug VM service | 配对libapp/libflutter多版本/ABI；含method/event channel的自有App；匹配设备 |
| Web混合 / PWA / TWA | Capacitor/Cordova插件注册到原生实现；SW/cache；真实TCP WebView；TWA浏览器上下文 | 含插件的自有App、可控网络/本机服务权限、可调试Chrome/TWA目标；当前真机TCP socket被系统拒绝，拦截器样本不能替代网络测试 |
| Lynx / NativeScript / uni-app / Taro | 专用bundle/codec/snapshot、跨runtime及target分流 | 各框架版本的自有发布产物、未压缩source map、可确认的插件/业务预期 |
| JNI / 自定义loader | JNI其他表/ABI/CheckJNI、当前绑定快照、异步跨线程因果关系、InMemory/非BaseDex loader | 不同Android版本/ABI/root策略设备；覆盖目标机制的自有fixture；可对照原始调用关系 |
| .NET MAUI | 真实完整MAUI APK、多store/runtime版本、Mono AOT/NativeAOT地址映射 | 对应.NET/Android版本自有MAUI debug/release APK、未裁剪符号/metadata；NativeAOT样本 |
| Unity | Mono与IL2CPP分流、metadata匹配、AssetBundle/资源引用、Unity版本矩阵 | 自有Unity Mono/IL2CPP APK及同构建global-metadata、libil2cpp、资源包和预期脚本/资源 |
| Unreal | Pak/IoStore版本、压缩/加密、UObject/Blueprint与资源关系 | 自有Cooked APK/Pak/IoStore、对应版本工程、已知key（若加密）、Blueprint预期结果 |
| Godot | 多版本PCK、C#、加密/自定义字节码及资源图 | 自有Godot C#/GDScript多版本APK/PCK、导出模板与预期节点/资源引用 |
| HarmonyOS NEXT | HAP/HSP/.app、ABC/ArkUI、签名/资源及设备调试链 | 合法可用的HarmonyOS NEXT SDK与开发设备、多个版本自有样本；Android/ADB/frida结果不能代替 |

## 需要跨平台CI环境

- Linux：实际npm install/stdio、Python/JDK工具选择、原生依赖和tarball边界；当前CI工作流含Ubuntu job，但尚无远端运行结果。本机有Docker CLI但daemon未运行，不能在当前会话启动Linux容器验收。
- 其他macOS架构/Node小版本：Node最低版本约束与Frida预编译/构建兼容。
- Windows：目前不是支持目标；若要纳入需先解决POSIX进程组取消、路径/工具发现、Android/REA/Frida依赖，再建立Windows CI。
- 多Android API/厂商：WebView DevTools socket、`/proc`/root读取、PID代次和Frida server兼容组合。

### 本机后续补强记录

source map/evidence容器、View `android:onClick`声明与真实Compose编译smoke已在0.5.1候选工作树推进；完成最终tarball门禁后，创建新tag。不要把这些改动写成旧v0.5.0 tag的内容。

## 后续推荐顺序

1. 完成0.5.1首发门槛；首发不等于全技术栈完成。
2. 优先取得View/Compose、真实网络WebView、RN/Hermes、Flutter platform channel样本，补主流Android应用链路。
3. 再取得MAUI/Unity/Unreal/Godot样本，分别做容器与引擎语义验收。
4. Harmony NEXT独立安排SDK、设备与工具链，不并入普通Android验收。

每个专项按README所定义的识别、提取、分析、关联、动态验证分别记录；仅能解包或工具启动不能标成该框架已支持。
