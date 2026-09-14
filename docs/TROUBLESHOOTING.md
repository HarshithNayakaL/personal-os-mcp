# Troubleshooting

| Symptom                            | Action                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `fetch failed` / no MCP tools work | Start `start-personal-mcp.bat`; run `node scripts/admin.mjs health`                                                      |
| `APPROVAL_REQUIRED`                | Inspect `node scripts/admin.mjs pending`, approve the exact ID locally, retry with identical arguments plus `approvalId` |
| `DENIED` for evaluation            | `browser.evaluate` is disabled by default; read SECURITY.md before changing policy                                       |
| `DEVICE_AMBIGUOUS`                 | Set `session.prefer` or supply `deviceId`                                                                                |
| `DEVICE_OFFLINE`                   | Reconnect the selected device; preferred devices do not silently fall back                                               |
| `PATH_DENIED`                      | Put files under an allowed root or explicitly edit roots and restart                                                     |
| `STALE_REF`                        | Take another browser snapshot after navigation or page changes                                                           |
| Chromium executable missing        | Run `npx playwright install chromium` under the same Windows account                                                     |
| Browser profile in use             | Close the other agent/browser using that profile                                                                         |
| DPAPI credential error             | Run under the account that initialized the project; do not copy encrypted credentials between accounts                   |
| Android pairing rejected           | Generate a fresh one-time code and check port/USB reverse                                                                |
| Android device disappears          | Return to the foreground companion; the app intentionally disconnects when backgrounded                                  |
| Android permission error           | Use the companion's folder, notification-access or image-access controls                                                 |
| Gradle cannot find SDK             | Open in Android Studio or set `ANDROID_HOME`; install SDK 35                                                             |
| `EADDRINUSE`                       | A daemon is already listening; verify health before starting another                                                     |
| Timeout on mutation                | Inspect target state before retrying; timeout is not rollback                                                            |

Logs are `.local/core.log` and `.local/agent.log`; startup captures process output there. Audit is `.local/audit.sqlite`. Do not post raw logs, profile files or databases publicly without checking their contents.

The stop script checks the recorded PID's command line before terminating a service, avoiding unrelated recycled process IDs. It terminates these processes directly; close the browser with `browser.close` before stopping if you want orderly profile shutdown. Ctrl-C on manually started daemon/agent processes invokes their cleanup handlers.

Tests use disposable temporary directories and Git repositories. If an antivirus briefly locks a Chromium log, cleanup retries. No test deletes a user repository or changes the user's real clipboard. Browser tests serve a local synthetic form and never submit a real website form.
