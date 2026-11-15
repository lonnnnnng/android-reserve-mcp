# android-reserve-mcp

[中文版](README.md)

## What It Is

`android-reserve-mcp` is a local MCP server for Android reverse engineering and artifact analysis. It connects to Codex, Claude Code, OpenCode, Pi, or another MCP client over stdio and analyzes APKs, DEX, resources, Java/JNI, Native, WebView, Hermes/Flutter, Kotlin/Compose, KMP, MAUI, and Godot artifacts on the local machine.

The server does not upload APKs to a cloud service. It does not select devices, install applications, silently inject scripts into third-party APKs, or promote static candidates to runtime facts. Long-running work is stored in a bounded workspace with jobs, logs, reports, and evidence graphs.

Current release: `0.5.4`.

- GitHub: [v0.5.4](https://github.com/lonnnnnng/android-reserve-mcp/releases/tag/v0.5.4)
- npm: `android-reserve-mcp@0.5.4`
- Node.js: `>=26.12.1`
- Top-level MCP tools: 20

## Capabilities

### Android artifacts and static analysis

- Read APKs, manifests, signatures, ABIs, DEX, resources, smali, and SHA-256 identities.
- Validate APKS, AAB, and split packages, including package name, version code, certificates, module dependencies, and device-spec selection.
- Query DEX classes, methods, references, exact JVM/DEX signatures, and original locations.
- Read Kotlin metadata, suspend/inline information, Compose compilation candidates, and `JavascriptInterface` declarations.
- Run JADX, apktool, aapt2, bundletool, and other fixed-parameter engines with input snapshots and bounded diagnostics.

### Java, JNI, Native, and runtime observation

- Observe exact Java overloads, Java request/reply object identity, same-thread parent/child calls, and cross-thread boundaries.
- Inspect JNI registration, ELF files, exported functions, RVA locations, references, callers, callees, and pseudocode.
- Run Frida Java/JNI/Native observation only with an explicit device, package, PID, and ownership scope.
- Observe Mono narrow ABI methods for `int32`, `bool`, `long`, `float`, and `string`, with MVID, MethodDef, and JIT identity checks.

### WebView, JavaScript, and framework analysis

- Capture DOM, scripts, Network, bodies, and bounded CDP initiator stacks from an explicitly debuggable WebView.
- Associate a same-session CDP `scriptId` with script SHA, AST data, and network requests.
- Run bounded analysis for Hermes, Flutter, ILSpy, Godot, IL2CPP, Ark, and other fixed engine adapters, preserving version and compatibility warnings.
- The owned Flutter R8 fixture covers primitive/object MethodChannel replies and multiple EventChannel sink replies.
- The owned Compose fixture covers click → state write → recomposition/derived state, multi-state updates, navigation, and coroutine chains through an MCP matcher.
- The owned RN fixture covers `JSI_CALL_ID → native marker → Fabric event ID → render sequence`.
- The owned KMP business app links `commonMain` code to Android UI, logcat, and JADX evidence.

### Evidence and job management

- Long tasks return job IDs. Query them with `jobs`, then page through reports with `artifacts`.
- Evidence can be joined by content hash, exact signature, call ID, JNI object identity, Mono identity, and JSON pointer.
- `verified`, `partial`, `candidate`, `unsupported`, and unconfirmed cleanup states are reported separately.

## The 20 Tools

Each top-level tool selects an operation through an `action` field. The number of actions is not the number of MCP tools.

| Tool | Main actions | What it does |
| --- | --- | --- |
| `doctor` | `deep` | Checks paths and dependencies; deep mode imports bindings, compiles a Java template, and handshakes with REA |
| `apk` | `inspect`, `signature`, `manifest` | Reads APK ZIP, DEX, ABI, signature, manifest, and hashes |
| `decode` | `jadx`, `apktool`, `both` | Exports Java, resources, and smali into an isolated task directory |
| `dex` | `classes`, `class`, `method`, `references`, `kotlin` | Queries DEX, references, Kotlin metadata, Compose candidates, and annotations |
| `packages` | `inspect`, `validate`, `decode`, `aab-manifests`, `select` | Validates APKS/AAB/split identity, dependencies, and device selection |
| `managed` | `inspect`, `extract` | Reads .NET assembly stores, ELF payloads, LZ4/Zstd containers, and bounded indexes |
| `evidence` | `merge`, `query` | Merges task evidence and queries hashes, signatures, and call IDs |
| `webview` | `discover`, `open`, `scripts`, `source`, `dom`, `network`, `body`, `close` | Captures an explicitly debuggable WebView |
| `search` | none | Searches exported source directories for text or regular expressions |
| `resources` | `strings`, `view-events` | Pages strings and extracts XML `android:onClick` candidates |
| `native` | `elf`, `jni`, `open`, `functions`, `function`, `references`, `callers`, `callees`, `providers` | Analyzes ELF/JNI, Native functions, and call relationships |
| `artifact` | `inspect`, `extract` | Identifies artifacts, nested packages, ABIs, framework candidates, and targeted extracts |
| `script` | `index`, `format`, `map` | Statically indexes JS/TS/JSX/Flow functions, call sites, and source maps |
| `framework` | `engines`, `probe`, `analyze`, `channels` | Runs fixed Hermes, Flutter, ILSpy, Godot, and related framework adapters |
| `device` | `list`, `inspect`, `packages`, `processes`, `logcat` | Reads an explicitly selected ADB device |
| `frida` | `devices`, `processes`, `attach`, `spawn`, `load`, `runtime`, `java-methods`, `trace-java`, `trace-java-group`, `trace-mono`, `trace-jni`, `trace-native`, `resume`, `status`, `unload`, `close` | Observes Java, JNI, Native, Mono, and Promise boundaries |
| `rebuild` | `build`, `sign` | Rebuilds apktool projects, zipaligns, signs, and verifies artifacts |
| `jobs` | `list`, `status`, `cancel` | Lists, monitors, cancels, and cleans up long tasks |
| `artifacts` | `list`, `read` | Pages task artifacts, logs, and reports |
| `guidance` | `list`, `read` | Reads allowed local Android reverse-engineering skills and references |

See [Tool Reference](docs/TOOL-REFERENCE.md) for complete schemas, examples, and evidence fields.

## Quick Installation

### Install from npm

```zsh
npm install -g android-reserve-mcp@0.5.4
node "$(npm root -g)/android-reserve-mcp/src/cli.js" --version
```

Always provide an allowed input root and a task workspace:

```zsh
node "$(npm root -g)/android-reserve-mcp/src/cli.js" \
  --allowedRoots /absolute/path/apk-projects \
  --workspace /absolute/path/android-reserve-workspace
```

### Run from source

```zsh
git clone --branch v0.5.4 https://github.com/lonnnnnng/android-reserve-mcp.git
cd android-reserve-mcp
npm ci --ignore-scripts
node src/cli.js --version
```

## Agent Integration

This is a local stdio MCP server, not a public HTTP service. The Agent and the MCP process should run on the same machine.

- Generic MCP clients: copy [examples/mcp.json](examples/mcp.json), then replace `command`, `allowedRoots`, and `workspace`.
- OpenCode: copy [examples/opencode.json](examples/opencode.json) or follow [Agent Integration](docs/AGENT-INTEGRATION.md); tools normally appear as `android-reserve_*`.
- Claude Code, Codex CLI, and Pi: use the client-specific `mcp add` commands in [Agent Integration](docs/AGENT-INTEGRATION.md).
- To restrict one Agent, disable `android-reserve_*` at its permission layer instead of removing the MCP connection.

Use a dedicated workspace. If a GUI Agent does not inherit the terminal PATH, use an absolute Node.js path.

## Usage

### First call

Build a minimal loop in this order:

```json
{"tool":"doctor","arguments":{}}
{"tool":"apk","arguments":{"action":"inspect","path":"/absolute/path/apk-projects/app.apk"}}
{"tool":"jobs","arguments":{"action":"status","jobId":"<job-id>"}}
{"tool":"artifacts","arguments":{"action":"read","jobId":"<job-id>","path":"result.json"}}
```

### Common static workflow

1. Run `doctor` to check dependencies and paths.
2. Run `apk.inspect` and `apk.signature` to establish input identity.
3. Use `packages.validate` or `packages.select` for APKS/AAB/split inputs.
4. Narrow the target with `decode`, `dex`, `resources`, and `search`.
5. Poll `jobs.status`, then read raw reports with `artifacts.read`.
6. Use `evidence.merge/query` for cross-task relations; never infer causality from time or PID alone.

### Common dynamic workflow

1. Confirm the device serial, package name, and PID. The server never auto-selects a device.
2. Use `device.inspect` and `device.processes` to verify target identity.
3. Read Java overloads with `frida.java-methods`; inspect custom loaders with `frida.java-loaders` first.
4. Use `attach`/`spawn`, `load`, `status`, `resume`, `unload`, and `close` as one lifecycle.
5. Check PID stability, original returns, runtime events, cleanup, and `partial` markers together.

### Common local commands

```zsh
node src/cli.js --version
npm test
npm run check
npm run check:pack
npm run smoke:release
npm run smoke:release:full
```

`smoke:release` validates the tarball, 20 tools, and basic `doctor`. `smoke:release:full` also installs both Frida bindings, runs deep diagnostics, and validates the full stdio protocol.

## Boundaries

- `allowedRoots` limits input paths; it is not an operating-system sandbox. Workspaces may contain sensitive artifacts.
- `partial`, `candidate`, and `unsupported` are not complete recovery results. Static candidates are not runtime causality.
- Dynamic analysis requires an explicit serial, package name, and PID. The server does not install apps, elevate privileges, or choose a device.
- Flutter typed bridge, EventChannel, and Compose multi-chain evidence is limited to the verified POCO F2 Pro / Android 16 / ARM64 / Frida tuple and owned fixtures.
- Third-party RN APKs are read-only when an inspector is open; otherwise they return `unsupported`. No silent JS or Frida injection is performed.
- Compose matching depends on explicit hooks and owned business markers; it is not a generic Compose semantic recovery engine.
- Mono covers loaded Mono, ARM64, non-generic narrow ABI methods only. Arrays/objects, CoreCLR, NativeAOT, byref, and complex managed types are unsupported.
- Hermes HBC99 requires an explicit experimental flag. Full Hermes version coverage, source recovery, and `.then()` causality are not guaranteed.
- WebView work requires debugging to be enabled. Public-network stability, TWA, full Service Worker semantics, and cross-session JS → Java causality are not guaranteed.
- Unity, Unreal, and HarmonyOS NEXT are paused. Godot C# and multi-version matrices are not complete.
- Cross-device and cross-ROM regression was not run in this release; single-device results must not be generalized.

See [Capabilities](docs/CAPABILITIES.md), [Dynamic Correlation](docs/DYNAMIC-CORRELATION.md), [Stability](docs/STABILITY-20261115.md), and [Roadmap](docs/ROADMAP.md) for evidence and limitations.

## Development Integration Guide

### Development setup

```zsh
git clone https://github.com/lonnnnnng/android-reserve-mcp.git
cd android-reserve-mcp
npm ci --ignore-scripts
npm test
npm run check
npm run check:pack
```

Node.js `>=26.12.1` is required. Full static analysis may also need JDK 17+, Python, JADX, apktool, the Android SDK, REA, and framework-specific engines. See [Environment](docs/ENVIRONMENT.md) and [Engine Setup](docs/ENGINE-SETUP.md).

### Adding a tool or action

1. Add the public schema and description in `src/server.js`.
2. Implement the action in `src/actions.js` or the relevant `src/core/*.js` module.
3. Add path, budget, timeout, device/PID ownership, and cleanup-failure boundaries.
4. Add offline regression tests under `test/`; dynamic features must preserve real events and failure evidence.
5. Update `docs/TOOL-REFERENCE.md`, `docs/CAPABILITIES.md`, `docs/VALIDATION.md`, and `CHANGELOG.md`.
6. Run `npm test`, `npm run check`, `npm run check:pack`, and `git diff --check`.

### Evidence and security requirements

- Do not commit APKs, DEX, SO files, keystores, device logs, personal paths, API keys, or private workspaces.
- Do not infer cross-layer causality from time, PID, RVA, or similar text; require hashes, exact signatures, call IDs, object identity, or source pointers.
- External CLIs must use fixed arguments, versions, and budgets; do not pass arbitrary commands through.
- Distinguish setup failure, unsupported, partial, real business events, and unconfirmed cleanup.
- Keep business and safety comments close to implementation code and mark generated comments with author `long`.

### Release and CI

- Keep `package.json`, `package-lock.json`, `src/version.js`, CHANGELOG, and user-facing docs aligned.
- Before release, run `npm test`, `npm run check`, `npm run check:pack`, `npm run smoke:release:full`, and `npm audit --omit=dev`.
- GitHub Actions runs the Ubuntu/macOS test and full-install matrix only for `release.published`; ordinary pushes and pull requests do not trigger CI.
- Publishing to npm requires package maintainer permissions. After publishing, verify `npm view android-reserve-mcp version dist-tags`.
- See [Maintenance](docs/MAINTENANCE.md) for release, Agent integration, and rollback procedures.

## Documentation

- [Tool Reference](docs/TOOL-REFERENCE.md)
- [Agent Integration](docs/AGENT-INTEGRATION.md)
- [Capabilities](docs/CAPABILITIES.md)
- [Dynamic Correlation](docs/DYNAMIC-CORRELATION.md)
- [Validation](docs/VALIDATION.md)
- [Environment and Engines](docs/ENVIRONMENT.md)
- [Roadmap](docs/ROADMAP.md)

## Security and License

Do not commit API keys, private keys, device credentials, or personal paths. Frida, JADX, apktool, the Android SDK, and REA follow their own licenses; this project is MIT-licensed.

MIT © long
