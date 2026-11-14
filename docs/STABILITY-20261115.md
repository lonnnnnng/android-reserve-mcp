# 稳定性与分析闭环推进

日期：2026-11-15。当前开发版0.5.4，公开发行仍为0.5.3。本轮按稳定性、诊断验收、静态与动态闭环、回归后扩展的顺序推进。完整目标仍在执行，不能以本页已完成的底座替代框架动态闭环。

## 已落地的稳定性修复

| 问题 | 当前实现 | 验证方式 |
| --- | --- | --- |
| 已知JNI崩溃入口仍被注入 | 固定兼容规则在actions、编译器与helper启动时检查；返回unsupported/partial及java_compatibility_blocked；拒绝发生在编译和进程占位之前 | 三个精确入口的单方法/分组拒绝、零load调用、零编译、无占位；helper直接调用同样拒绝 |
| 多实例把活跃任务写成interrupted | 任务记录instance UUID/PID/ps进程代次；外部读取不写回，不取消其他实例任务；只在拥有者已结束时派生interrupted，旧身份未知则保留原状态并注明未确认 | 活跃双实例、实际进程退出、旧格式、磁盘原件不变 |
| 逆序证据合并丢失请求终态 | 保留每个请求的有界来源快照；旧pending不覆盖终态，矛盾终态明确partial；正文哈希接到同CDP请求 | 真实Jobs生成两份报告后正反序合并；成功/失败冲突；来源和正文边 |
| 启动/取消/退出无完整期限 | 启动握手45秒、单次REA任务总期限600秒、任务退出10秒、各会话/资源清理默认5秒；不响应取消的操作仍返回未确认诊断 | 连接中取消、共享握手、晚到连接、不响应信号的握手/请求/退出、父CLI退出后的进程组 |

任务状态中的interrupted只说明任务拥有者不再活动，不证明其子进程或设备hook已经清理。退出开始和最终结果以原子替换方式写在workspace的shutdown-INSTANCE.json；state=closing或closed=false均表示清理未确认。WebView继续保留独立forward账本。服务不根据遗留账本自动接管或重新注入。

## 深度诊断与完整安装

默认doctor保留路径检查行为。deep=true返回任务，实际执行以下三项：

1. 独立子进程导入宿主Frida binding，不枚举或附加设备。
2. 实际编译Math.abs(int)固定Java观测模板，记录编译器、bridge实现与bundle SHA256。
3. 握手固定REA并核实所需Android/Frida工具，不打开目标APK或设备。

```json
{"tool":"doctor","arguments":{"deep":true,"timeoutSeconds":90}}
{"tool":"jobs","arguments":{"action":"status","jobId":"<doctor返回的id>"}}
```

单项failed或skipped使报告partial。REA显式禁用时深度检查不会绕过该设置。版本字符串之外保留实现哈希，因为不同bridge提交可能沿用同一个版本号。

smoke:release继续承担基础协议门；smoke:release:full在隔离目录安装实际tarball和REA6.9.0，核实lock路径、版本与integrity后只批准并rebuild宿主Frida17.26.3和REA Frida17.23.2，随后执行真实深度检查，并在客户端关闭后核对shutdown终态。临时路径先realpath归一，避免macOS /var和/private/var别名影响npm lock。报告和原件保留在输出目录；Ubuntu/macOS完整安装CI已配置，远端执行结果另行核验。

## 当前验证与边界

- 最终0.5.4源码通过75项自动测试、JS/Python语法检查、包内容检查与git diff检查；新增18项稳定性回归包括真实进程退出、孙进程、登记/退出并发、失败清理重试、旧sidecar未清理时阻止新连接和CLI重复退出信号。
- 最终0.5.4 tarball完成实际完整安装，三个深度检查均verified，REA6.9.0实际列出255个后端工具；本MCP仍为20个分组入口。客户端关闭后shutdown账本为finished/closed=true。
- 当前36个运行源码文件与已通过完整安装的tarball逐文件SHA一致；聚合哈希与检查摘要见[本轮验证证据](evidence/stability-20261115.json)。发行安装快照包含68文件，两套Frida原生binding均在独立子进程实际导入成功。首次深度检查遇到frida-compile默认入口缺失，已改用实际dist/cli.js入口；失败原件保留。
- 独立核验补修了退出与任务登记并发、握手失败清理丢失、Native失败打开的清理所有权、累计产物来源以及专用索引截断标记；回归覆盖同一清理的明确重试。
- 真机调试只使用用户指定POCO_F2_Pro，序列号31936bb6，当前Android16/ARM64。未对另一台手机进行写操作。

## 继续推进的完整范围

| 顺序 | 待完成内容 | 不能替代的验收 |
| --- | --- | --- |
| 静态闭环 | mapping贯通classes/references/Kotlin；完整raw方法ID/prototype选择；所选分包查询与原始DEX来源身份 | 不靠overloadIndex碰巧选中，不把同名重复定义合并成唯一方法 |
| 动态兼容 | 固定上游bridge补丁候选及目标环境对照；分离JNI引用操作和原方法调用 | 安全拒绝不等于兼容修复；仅把apply改call没有绕过JNI的机制 |
| 主要动态链 | Compose点击→状态→重组；Flutter参数→回复；RN reject与JS调用点关联 | 原始事件、精确身份、失败样本；UI变化或静态候选不足以证明因果 |
| 回归与扩展 | 每条动态链连续三次通过，失败时目标存活、卸载无残留；随后MAUI/KMP/Godot | 依次通过对应门槛后扩展；Unity/Unreal/HarmonyOS NEXT仍暂缓 |

固定REA6.9.0的Android provider只接受单APK，其schema不接收descriptor或APK数组；新增选择和mapping投影必须由本适配器负责。分包应复用已验证快照并保留APK SHA、成员、DEX entry与原始method index，重复定义明确歧义。

兼容候选来自维护者合并的[bridge PR398](https://github.com/frida/frida-java-bridge/pull/398)，固定commit302a588881b40cba300bcf3acfd35deeb3888ee5。其公开验收针对Android17，不能直接宣称修复本机Android16；本轮尚待POCO实测。实际JNI transition失败位置仍须按对应原件区分NewGlobalRef、IsInstanceOf与原方法回调。
