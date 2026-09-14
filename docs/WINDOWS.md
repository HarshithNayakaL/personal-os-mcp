# Windows operation

Requirements: Node.js 22.13+, npm, Git, Windows PowerShell and Playwright Chromium. Use the same normal Windows account for setup, startup and MCP clients. Administrator privileges are unnecessary.

From the project directory:

```powershell
npm ci
npm run build
npm run setup
npx playwright install chromium
.\start-personal-mcp.bat
```

Startup compiles the code, validates YAML, creates allowed workspace/download directories and encrypted credentials, starts the daemon and Windows agent in hidden processes, and polls authenticated health until a device is registered. It displays the actual capabilities reported by the agent. It does not start an MCP stdio adapter detached from a client; the client owns that process.

Copy `.local/mcp-client.json` into the appropriate MCP configuration for your client. The generated entry runs `node` with the absolute path to `scripts/mcp.mjs`. That launcher sets its own working directory, so the client needs no `cwd` support. Reload or restart the client, list tools, then call `device.list` and `device.capabilities`. Every MCP client connection gets a separate routing session.

```powershell
node scripts/admin.mjs health
node scripts/admin.mjs pending
node scripts/admin.mjs approve <request-id>
powershell.exe -NoProfile -File scripts/stop.ps1
```

Configuration is in `config/personal-mcp.yaml`. Relative paths resolve from the project directory. The default allowed root is `workspace`. Add only directories you intend to expose. Do not add your browser profile or credential stores. `PERSONAL_MCP_CONFIG` can point to another YAML file. Restart services and reconnect clients after changing configuration.

Shell commands use `cmd.exe /d /s /c`. PowerShell uses an encoded UTF-16LE command with no interactive profile. Both return stdout, stderr, exitCode, duration and workingDirectory. Arguments to Git and process launch use direct process spawning. Command timeout is capped at the configured maximum. Environment overrides require names in `allowedEnvironment`. `process.start` intentionally creates a continuing process and returns its PID; use the separately authorized `process.kill` to stop it.

`app.list` discovers Start menu application IDs. Pass an ID to `app.launch`; arbitrary executable launch is available through `process.start`. Installed app discovery varies with application packaging. The agent cannot control elevated desktop windows merely because it runs under your account.

## Authenticated browsing

`browser.launch` opens a dedicated persistent Chromium profile. Manually sign into sites in that window. Later calls reuse that profile. Existing Chrome/Edge profiles are not attached or copied. Keep only one agent using a profile at a time.

Call `browser.snapshot`, identify an element's reference, then pass that reference to click/type/select/etc. References are scoped to the current snapshot and invalidate on navigation or tab changes. Detached elements require another snapshot. The compact snapshot includes visible interactive elements with labels/roles and excludes password fields. It does not include full DOM dumps, field values or cookies. V1 snapshots cover the main page's locator-visible elements, not a complete cross-frame accessibility traversal.

`browser.download` clicks a referenced element, waits for a download, and saves it to the supplied allowed destination. `browser.upload` accepts an allowed local file. Browser close preserves the profile. No workflow is tied to a particular website or provider.
