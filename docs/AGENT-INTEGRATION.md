# Agent 接入指南

`android-reserve-mcp` 是一个本地 MCP stdio 服务。Agent 启动一个 Node.js 子进程，通过标准输入输出调用它；当前项目没有把 MCP 协议暴露成公网 HTTP 服务。需要远程使用时，应在运行 Agent 的机器上部署本项目，或另外部署受控的 MCP 网关。

当前发布版：`0.5.4`。要求 Node.js `>=26.12.1`。

## 通用准备

```zsh
npm install -g android-reserve-mcp@0.5.4
node "$(npm root -g)/android-reserve-mcp/src/cli.js" --version
```

需要当前 `0.5.4` 源码时，使用 GitHub tag：

```zsh
git clone --branch v0.5.4 https://github.com/lonnnnnng/android-reserve-mcp.git
cd android-reserve-mcp
npm ci --ignore-scripts
```

如果 Agent 的图形界面没有继承终端的 PATH，使用 `node` 的绝对路径，例如：

```zsh
/absolute/path/to/node "$(npm root -g)/android-reserve-mcp/src/cli.js" \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace
```

`--allowedRoots` 是必需的安全边界建议项：只允许读取 APK、源码、导出目录和其他分析输入。`--workspace` 保存任务、日志、报告和证据图，建议使用独立目录。

也可以直接使用仓库源码：

```zsh
node /absolute/path/android-reserve-mcp/src/cli.js \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace
```

配置完成后，先让 Agent 调用 `doctor`，再调用 `apk.inspect`。长任务会返回任务 ID，必须继续用 `jobs.status` 和 `artifacts.read` 读取结果。

## OpenCode

当前 OpenCode 配置使用 `mcp.servers`。可以运行命令添加本地服务：

```zsh
opencode mcp add android-reserve -- \
  node /absolute/path/android-reserve-mcp/src/cli.js \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace
```

也可以在 `opencode.json` 或 `opencode.jsonc` 中手工配置：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "android-reserve": {
        "type": "local",
        "command": [
          "node",
          "/absolute/path/android-reserve-mcp/src/cli.js",
          "--allowedRoots",
          "/absolute/path/apk-projects",
          "--workspace",
          "/absolute/path/android-reserve-workspace"
        ],
        "timeout": 30000
      }
    }
  }
}
```

OpenCode 中工具通常会显示为 `android-reserve_*`。如果暂时不想让某个 Agent 使用它，可以通过 OpenCode 的 `tools` 或 Agent 级配置关闭 `android-reserve_*`，无需删除 MCP 连接。仓库内有可复制的 [examples/opencode.json](../examples/opencode.json)。

## Claude Code

Claude Code 推荐使用 CLI：

```zsh
claude mcp add --transport stdio android-reserve -- \
  node /absolute/path/android-reserve-mcp/src/cli.js \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace

claude mcp list
```

项目级 `.mcp.json` 使用 `mcpServers`：

```json
{
  "mcpServers": {
    "android-reserve": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/android-reserve-mcp/src/cli.js",
        "--allowedRoots",
        "/absolute/path/apk-projects",
        "--workspace",
        "/absolute/path/android-reserve-workspace"
      ]
    }
  }
}
```

Claude Desktop 的开发者 MCP 配置也使用同样的 `mcpServers` 结构；在设置中的 Developer 页面打开配置文件，不要把上面的项目路径写成相对路径。

## Codex CLI

Codex CLI 使用 `~/.codex/config.toml` 管理 MCP。推荐用命令添加，避免手写 TOML：

```zsh
codex mcp add android-reserve -- \
  node /absolute/path/android-reserve-mcp/src/cli.js \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace

codex mcp list --json
```

等价的 `config.toml` 片段是：

```toml
[mcp_servers.android-reserve]
command = "node"
args = [
  "/absolute/path/android-reserve-mcp/src/cli.js",
  "--allowedRoots",
  "/absolute/path/apk-projects",
  "--workspace",
  "/absolute/path/android-reserve-workspace"
]
startup_timeout_sec = 10
tool_timeout_sec = 3600
```

如果需要环境变量，用 `codex mcp add --env KEY=value` 或在同一段配置中增加 `env = { KEY = "value" }`。不要把 API Key 写进仓库配置；优先使用环境变量或 Codex 自己的 provider 配置。

本机测试使用临时 `CODEX_HOME` 完成了 `mcp add` 和 `mcp list --json`，没有修改你的真实 Codex 配置。

## Pi

Pi 使用全局 `~/.pi/agent/mcp.json`，项目级配置使用项目目录下的 `.pi/mcp.json`：

```zsh
# 全局
pi mcp add android-reserve -- \
  node /absolute/path/android-reserve-mcp/src/cli.js \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace

# 当前项目
pi mcp add android-reserve --local -- \
  node /absolute/path/android-reserve-mcp/src/cli.js \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace

pi mcp list --json
```

对应的项目配置结构：

```json
{
  "mcpServers": {
    "android-reserve": {
      "command": "node",
      "args": [
        "/absolute/path/android-reserve-mcp/src/cli.js",
        "--allowedRoots",
        "/absolute/path/apk-projects",
        "--workspace",
        "/absolute/path/android-reserve-workspace"
      ]
    }
  }
}
```

Pi 的项目级 MCP 只有在项目被信任后才会连接；未信任时 `pi mcp list` 会明确提示配置被忽略。

## 本机四个 Agent 的验证结果

2026-11-14 在本机用当前安装版本做了配置级检查：

| Agent | 本机版本 | 验证结果 |
| --- | --- | --- |
| Codex CLI | `0.169.0` | 临时 `CODEX_HOME` 中 `mcp add`、`mcp get --json` 成功 |
| Claude Code | `2.1.325` | 本地 scope 健康检查显示 `Connected`，测试条目已移除 |
| OpenCode | `1.19.5` | 本地 stdio 健康检查显示 `connected`，测试条目已移除 |
| Pi | `1.5.2` | 临时全局配置健康检查显示 `connected`，返回本服务 20 个工具 |

这些检查验证配置格式和客户端管理命令，不代替每个 Agent 对真实 APK 任务的完整端到端验收。

## 连接后的第一步

在任何 Agent 中按下面顺序检查：

1. 调用 `doctor`，确认 Node、Python、JADX、apktool、Android SDK 和 REA 状态。
2. 调用 `apk` 的 `inspect`，确认 APK 路径在 `allowedRoots` 内。
3. 对长任务调用 `jobs.status`，不要把首次返回的任务 ID 当成分析结果。
4. 使用 `artifacts.read` 分页读取 `result.json`、日志和报告。
5. 需要动态分析时，明确设备序列号、包名和 PID；不要让 Agent 自动选择手机。

## 来源与版本说明

配置字段会随客户端版本变化；本指南按 2026-11-14 访问的官方文档和本机 CLI 帮助整理。接入前仍应打开客户端自己的 MCP 设置页确认路径和字段：

- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Codex MCP](https://developers.openai.com/codex/mcp)
- [Pi CLI](https://github.com/badlogic/pi-mono)
