# Validation report — 2026-09-14

The project was built and exercised on Windows with Node.js 22.14.0. This report distinguishes executed checks from device-dependent behavior.

| Check                                      | Result                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| TypeScript compilation                     | PASS — `npm run build`                                                                        |
| Type checking and formatting lint          | PASS — `npm run lint`                                                                         |
| Node unit/integration suite                | PASS — 17 tests, 0 failures, 0 skipped                                                        |
| Native Android APK                         | PASS — `assembleDebug`, 3,204,752 bytes at validation                                         |
| Android JVM tests                          | PASS — 3 tests, 0 failures                                                                    |
| Android lint                               | PASS — `lintDebug`; Gradle reports deprecation notices for future Gradle 9 compatibility      |
| Windows startup script                     | PASS — starts core/agent and verifies authenticated registration                              |
| Live MCP smoke check                       | PASS — 85 tools, windows-main online with 62 capabilities                                     |
| SQLite persistence                         | PASS — unit reopen check and live audit record                                                |
| Real Playwright Chromium                   | PASS — launch, navigation, snapshot, typing/click, download, tabs, screenshot                 |
| Native process/app discovery               | PASS — actual Windows API commands                                                            |
| Git                                        | PASS — disposable repository, commit/diff/status/log/branch/switch and local remote push/pull |
| Android device install/permission behavior | NOT RUN — `adb devices` reported no connected devices                                         |
| Real website authentication/submission     | NOT RUN — requires your accounts and authorization                                            |

The suite also verified traversal/junction rejection, credential-path denial, exact one-use approval binding, validation, ambiguous/preferred/offline routing, wrong-device result rejection, disconnect propagation, timeout cancellation, HTTP private-address/header/redirect restrictions, DNS pinning and bounded responses. Test data used temporary directories and local synthetic pages/remotes. No real account submission, destructive repository operation or clipboard write was used for testing.

## Startup and client connection

Run `start-personal-mcp.bat` from the repository root. Copy the generated `.local/mcp-client.json` entry into your MCP client's configuration and restart it. The entry uses the absolute `scripts/mcp.mjs` launcher. `node scripts/smoke.mjs` verifies the live MCP adapter, device registration, system capability and audit path.

## APK installation and pairing

Connect your phone, enable USB debugging and accept its trust prompt. From the repository root, with SDK platform-tools available:

```powershell
adb install -r apps/android-agent/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:4319 tcp:4319
node scripts/admin.mjs pair
```

Open Personal MCP, enter the code and tap Pair. Grant a SAF folder and any optional notification/image permissions. Keep the companion visible. Select its device ID through `session.prefer` or explicit `deviceId`.

## Practical limits

V1 is a PC-hosted stdio MCP core plus USB-connected foreground Android execution. Remote transport, standalone phone hosting, background Android UI automation and screen capture are not implemented. Browser evaluation exists but is denied by default. Root checks and output redaction are useful controls, not a hostile-code sandbox or an absolute guarantee against unknown secrets in arbitrary content. Read SECURITY.md before broadening permissions. A timeout does not roll back completed side effects.
