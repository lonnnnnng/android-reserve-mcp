# 使用、自定义与维护

## OpenCode 专用模式

将 [opencode.json](../examples/opencode.json) 的 `mcp.android-reserve` 合并进用户配置，修改为实际项目和 APK 根目录。将 [android-reserve.md](../examples/agents/android-reserve.md) 放入 `~/.config/opencode/agents/`。

```zsh
opencode --agent android-reserve
```

已在界面中时按默认 Tab 切换主 agent；自定义键位以自己的 TUI 配置为准。重新打开 OpenCode 让新增配置生效。只允许 android-reserve_*，保留内置工具，禁用独立 rea/ida/js/browser 工具定义，因此不会把完整 REA 列表再次带入这个模式。

推荐旧模式 daily/browser/web-reverse/native-reverse 加 `"android-reserve_*": deny`；full-tools 加 `"android-reserve_*": allow`。native-reverse 继续保留原来的 REA/IDA，Android 专项使用新模式。未来另加 MCP 时也需检查所有模式规则。权限过滤不等于停止服务器进程；Build/Plan 等未自定义模式继续按自身权限处理。

## 想改什么，修改哪里

| 目标 | 文件 / 操作 |
| --- | --- |
| 更改 APK 允许目录、workspace、Skill 根目录 | 客户端 mcp.android-reserve.command 的 CLI 参数 |
| 设置 Java、SDK、内存、headless JAR | 客户端启动环境，见 ENVIRONMENT.md |
| 更改模式名、描述、提示词、允许的工具 | 用户 agents 目录中的对应 Markdown；名称来自文件名 |
| 接入其他 MCP 客户端 | 使用 examples/mcp.json 的 command/args，按客户端 schema 合并 |
| 添加新的 Android action | 先改 src/server.js schema，再改 src/actions.js；后端调用还需检查 allowlist 与固定版本合约 |
| 新增 Skill 名称 | 修改 actions.js 的 skillNames 和 server.js schema；保持只读范围，勿把私人文档发布进包 |
| 修改并发/任务状态 | src/core/jobs.js；同步验证取消、重启 interrupted 与产物持久化 |
| 升级依赖 | 修改 package.json / npm lock；REA 版本在 backend.js；JAR版本和SHA也在 backend.js |

关键逻辑注释使用中文、作者标记 long，解释原因和限制。代码、schema、示例和环境矩阵必须同步。

## 升级与回退

1. 保留旧源码版本及客户端配置备份；不要直接覆盖整个 provider 配置。
2. 查目标官方包的 engines、许可、工具名、参数/返回格式；REA 升级不代表 headless JAR 可任意升级。
3. 通过 npm 更新依赖并保留唯一 package-lock。独立 REA MCP 和本项目 sidecar 的版本互不自动同步。
4. 执行 check/test；具备静态环境时执行 smoke；再核对客户端 tools/list 的 20个入口和模式过滤。
5. 重启客户端验证 doctor 与一个自有 APK 任务。动态能力另用明确授权的测试设备验证。
6. 失败时恢复本项目旧版本及对应启动项。配置已有其他变更时，只回退本次字段，不整体覆盖备份。

## 开发验收命令

```zsh
npm ci --ignore-scripts
npm run check
npm test
node scripts/smoke.mjs
npm audit --omit=dev
npm run check:pack
```

smoke 需要完整静态环境并生成自有 APK/临时签名；不会接触设备。生成报告在 output/smoke.json，产物在报告记录的临时目录，均不作为 npm/GitHub 公共文件发布。CI 只运行基础测试和 pack 检查，不承诺完整 Android 工具链或设备验收。

## GitHub / npm 发布准备

GitHub公开仓库和`v0.5.4`Release已发布；npm `0.5.4`由用户按本次交付命令手动发布。后续版本准备时：

- 确认代码、README、包名、bin、展示名均为 android-reserve-mcp。
- 取得要发布版本的测试证据，更新版本和变更说明；Git 提交说明使用中文。
- 检查 npm pack 实际清单，只包含公开源码、helper、docs、examples 与许可。
- 不提交个人路径、服务器、密钥、node_modules、output、workspace、APK/DEX/SO、keystore、个人 Skill。
- 添加实际 GitHub repository URL 后再配置 repository/bugs/homepage；不要填写未创建的远端。
- 再确认引擎/第三方许可，GitHub 推送、Release、npm publish 根据当次明确发布安排执行。

本项目 MIT 许可不覆盖外部 JADX、apktool、Frida、SDK 等工具，使用和再分发各自遵循其许可。


## 模块维护补充（0.4.0）

新增解析器在helpers/artifact.py、helpers/script.mjs，操作封装在src/analysis.js；Native隔离在src/core/native.js，固定CLI在src/core/engines.js，运行观测模板在src/core/frida-scripts.js。版本统一修改src/version.js、package.json和lock根版本。新增引擎要先核实版本化契约，再添加固定参数与输出检查，不允许用户透传任意命令。当前验收/未完成清单见PROGRESS.md。

Java bundle编译在src/core/java-agent.js，方法/Native同调用观测在helpers/java-observer.js；schema在server.js，设备/PID所有权及生命周期在actions.js，排队取消清理在jobs.js。不能只增加一个接口枚举而漏掉cancel/unload/close/异步失败。修改Java观测须先跑java-observer/java-lifecycle自动测试，再用明确授权设备与自有App做专项smoke；不得在CI自动选择手机。

专项命令：`npm run smoke:java -- <serial>`（需已启动匹配server，会安装/启停自有fixture）、`npm run smoke:flutter`（需已构建本地Flutter样本）、`npm run smoke:managed`、`npm run smoke:godot`。后三者不接触设备；引擎/SDK仍须预先安装。Flutter源码样本在output中，不随npm分发；smoke脚本为仓库开发验收文件，也不随当前npm files清单分发。固定引擎安装与回退见ENGINE-SETUP.md。

`npm ci --ignore-scripts`用于静态/CI；Java bundle真实编译还需核对`npm install-scripts ls`并执行`npm rebuild frida --ignore-scripts=false`安装原生binding。仓库根锁定批准frida@17.26.3；作为其他项目的依赖时该批准不继承，须在宿主项目确认lock版本后逐包审批，不能全量approve。升级frida-compile带来的宿主Frida版本不能直接代替REA设备binding；升级REA、server、bridge必须分别核对并实测。当前minimatch覆盖版本和原依赖范围不同，已用实际编译验证；后续升级需重新确认覆盖是否仍必要。

更改agent提示词同步examples/agents/android-reserve.md与实际客户端agents/android-reserve.md，先备份后修改。服务当前为20个入口，不因增加action就改称更多工具；启动客户端后用tools/list和本地模拟请求检查真实工具数量。模型、API Key和其他MCP启动项不需要随本项目版本变更。

动态注册模板在helpers/jni-observer.js，JNI索引须同时核对官方规范和对应NDK的jni.h；不要用私有ART符号名替代标准入口契约，也不要把一次注册入口当成成功。JNI异常检查、class global refs、modified UTF-8/消息预算、返回后不执行JNI和unload清理必须一起维护。RVA解析在helpers/native-location.js，被生成Native脚本和Java bundle共用；新增地址选择时同步Node参数验证和Frida运行时范围检查。

新增验收`npm run smoke:jni -- <serial>`会编译、签名并覆盖安装同一自有App、启停该App，只读其PID日志。测试必须过滤当前script_id，原异常保持必须在JNI observer仍加载时断言；不要用旧agent事件或卸载后的正常结果代替。原Java smoke与JNI smoke共享自有签名和输出根目录，必须顺序运行，不能并发重建/覆盖安装；fixture class/dex采用每次新建目录避免残留。

## 0.5.x新增模块维护

分包修改src/core/packages.js与helpers/package-set.py，先检查外部工具执行前预算，再核对包名/长版本/全部证书/依赖。Kotlin修改helpers/MetadataInspect.java和src/core/kotlin.js，保持真实DEX签名/注解与候选强度。store修改helpers/assembly-store.py和src/core/managed.js，未知版本拒绝、符号总预算、预留解压预算必须一起维护。

WebView修改src/core/webview.js及test/webview.test.js；必须覆盖身份读取取消、PID代次、CDP关闭、清理失败重试和自己的精确forward，不能引入remove-all。证据索引修改src/core/evidence.js及生产报告模块；变更字段时更新位置/调用绑定/partial传播测试，不把候选升级为运行事实。

新环境、安装、调用、预算见ADVANCED-ANALYSIS.md与ENGINE-SETUP.md。新增smoke:packages/kotlin/store/hybrid；前三项静态，hybrid需要显式授权设备并只安装/启停自有fixture。与java/jni/device smoke顺序运行，先备份配置再同步examples/agents。

tag `v0.5.0`之后新增了source map/container证据、View `view-events`、Compose compile fixture及CDP/ClassLoader边界测试；这些补强属于0.5.1候选工作树，须重跑发布门禁；不可移动或覆写v0.5.0 tag，禁止把原tag移到不同内容。
