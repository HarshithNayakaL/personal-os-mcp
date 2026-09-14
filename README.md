# Personal MCP OS

A runnable local-first execution layer for MCP-compatible AI clients, with a separate Windows agent and a native Android companion. It exposes reusable device, filesystem, shell, PowerShell, Git, browser, HTTP, clipboard, application and audit primitives. There are no provider-specific job-application workflows or cloud dependencies.

**85 MCP tools**, **62 Windows capabilities**, **18 Android capabilities** (two clipboard tools are shared), and four MCP resources. Device routing respects each MCP session's preference and rejects ambiguous selections. Sensitive actions use configurable, one-use local approvals.

## Start on Windows

```powershell
.\start-personal-mcp.bat
```

The startup script builds, initializes encrypted local credentials, starts the core and Windows agent, and checks actual device registration. For a fresh checkout, install Node.js 22.13+, Git and dependencies, then Chromium:

```powershell
npm ci
npx playwright install chromium
.\start-personal-mcp.bat
```

Copy the generated **`.local/mcp-client.json`** entry into your MCP client's configuration and restart the client. It runs the stdio adapter using `scripts/mcp.mjs`; no credentials go into client configuration. Call `device.list`, then `device.capabilities`. The default exposed folder is `workspace`.

```powershell
node scripts/admin.mjs health
node scripts/admin.mjs pending
node scripts/admin.mjs approve <request-id>
```

Edit `config/personal-mcp.yaml` for roots, capability allowlists, risk/approval rules, browser profile, limits and intentionally allowed local HTTP hosts. Restart after changes. Read [security boundaries](docs/SECURITY.md) before permitting arbitrary commands or page JavaScript.

## Android

The APK is produced at `apps/android-agent/app/build/outputs/apk/debug/app-debug.apk`. Enable USB debugging, authorize the PC, then:

```powershell
adb install -r apps/android-agent/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:4319 tcp:4319
node scripts/admin.mjs pair
```

Open **Personal MCP** on the phone, enter the fresh code, and tap **Pair**. Keep the companion open and grant only the folder/notification/image permissions you want. Select its ID with `session.prefer`. See [Android installation and platform limits](docs/ANDROID.md).

## Repository

```text
apps/
  mcp-server/src/       MCP adapter, daemon and routing core
  windows-agent/src/    OS execution, Playwright and HTTP
  android-agent/       Native Kotlin application and Gradle wrapper
packages/
  protocol/src/        Shared types and structured errors
  capabilities/src/    Validated capability catalog
  security/src/        Policy, redaction, paths and credential vault
  shared/src/          Configuration and SQLite audit
config/                Editable personal-mcp.yaml
scripts/               Setup, start/stop, MCP launcher and admin CLI
tests/                 Unit, integration, browser and MCP tests
docs/                  Architecture, security, operations and tool reference
workspace/             Default allowed files and downloads
.local/                Generated credentials, profiles, audit, logs (ignored)
```

## Validation

```powershell
npm run build
npm run lint
npm test
cd apps/android-agent
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug
```

The automated suite exercises root/junction protection, approvals, routing, validation, SQLite persistence, temporary filesystem and Git operations, shell/PowerShell, HTTP, real Chromium, MCP discovery/execution and authenticated device pairing. Android's JVM tests cover path validation. Device permissions and manual account authentication remain human steps.

This V1 uses stdio for MCP and USB loopback for Android. It does not provide a cloud-accessible MCP endpoint, unattended Android control or a hostile-code sandbox. Redaction is best effort; arbitrary executable code, screenshots and binary file reads cannot provide an absolute secret-exclusion guarantee. `browser.evaluate` is denied by default. Native phone behavior must be validated on your device before relying on it.

See [architecture](docs/ARCHITECTURE.md), [Windows guide](docs/WINDOWS.md), [all tools](docs/MCP_TOOLS.md), [security](docs/SECURITY.md), and [troubleshooting](docs/TROUBLESHOOTING.md).
