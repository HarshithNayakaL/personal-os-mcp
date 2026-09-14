# MCP tool reference

Generated from the validated capability catalog. Run `node scripts/generate-docs.mjs` after a build to regenerate.

All tool calls return an MCP text content block containing JSON: `{ok:true,data,durationMs}` or `{ok:false,error:{code,message},durationMs}`. Core discovery calls omit durationMs. Errors set MCP `isError`. Device capabilities accept optional `deviceId` and `approvalId` in addition to the arguments below. Unknown arguments are rejected. Defaults and bounds are enforced by Zod. Arguments refer to Windows paths unless the tool is Android-only; Android paths are relative to the selected SAF folder.

Risk metadata determines default policy but exact capability overrides take precedence. See SECURITY.md.

## filesystem.list

list files inside configured roots.

Risk: **READ**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `path`   | string (min 1, max 8192) |

Response data: Array of `{name, directory, symlink}` (up to 1000).

## filesystem.stat

stat files inside configured roots.

Risk: **READ**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `path`   | string (min 1, max 8192) |

Response data: `{path, size, directory, modified}`.

## filesystem.read

read files inside configured roots.

Risk: **READ**.

| Argument   | Type / constraints                 |
| ---------- | ---------------------------------- |
| `path`     | string (min 1, max 8192)           |
| `encoding` | "utf8" or "base64"; default "utf8" |

Response data: `{path, encoding, content}`; binary content uses base64.

## filesystem.search

search files inside configured roots.

Risk: **READ**.

| Argument  | Type / constraints                          |
| --------- | ------------------------------------------- |
| `path`    | string (min 1, max 8192)                    |
| `pattern` | string (min 1, max 8192)                    |
| `limit`   | number (int , min 0, max 1000); default 100 |

Response data: `{paths, truncated}`; case-insensitive filename substring search.

## filesystem.write

write bounded text or binary content.

Risk: **WRITE**.

| Argument   | Type / constraints                 |
| ---------- | ---------------------------------- |
| `path`     | string (min 1, max 8192)           |
| `content`  | string (max 1048576)               |
| `encoding` | "utf8" or "base64"; default "utf8" |

Response data: `{path, bytes}`.

## filesystem.append

append bounded text or binary content.

Risk: **WRITE**.

| Argument   | Type / constraints                 |
| ---------- | ---------------------------------- |
| `path`     | string (min 1, max 8192)           |
| `content`  | string (max 1048576)               |
| `encoding` | "utf8" or "base64"; default "utf8" |

Response data: `{path, bytes}`.

## filesystem.copy

copy file without overwriting destination.

Risk: **WRITE**.

| Argument      | Type / constraints       |
| ------------- | ------------------------ |
| `source`      | string (min 1, max 8192) |
| `destination` | string (min 1, max 8192) |

Response data: `{source, destination}`.

## filesystem.move

move file without overwriting destination.

Risk: **SENSITIVE**.

| Argument      | Type / constraints       |
| ------------- | ------------------------ |
| `source`      | string (min 1, max 8192) |
| `destination` | string (min 1, max 8192) |

Response data: `{source, destination}`; file copy then unlink, not an atomic cross-volume move.

## filesystem.mkdir

Create directories.

Risk: **WRITE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `path`   | string (min 1, max 8192) |

Response data: `{path}`.

## filesystem.delete

Delete a file or directory.

Risk: **SENSITIVE**.

| Argument    | Type / constraints       |
| ----------- | ------------------------ |
| `path`      | string (min 1, max 8192) |
| `recursive` | boolean; default false   |

Response data: `{deleted}`.

## shell.execute

Execute a command under the normal user account; unrestricted OS access after approval.

Risk: **EXECUTE**.

| Argument    | Type / constraints                                  |
| ----------- | --------------------------------------------------- |
| `command`   | string (max 1048576)                                |
| `cwd`       | string (min 1, max 8192)                            |
| `timeoutMs` | number (int , min 0, min 100, max 300000); optional |
| `env`       | object mapping strings to string; default {}        |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## powershell.execute

Execute a command under the normal user account; unrestricted OS access after approval.

Risk: **EXECUTE**.

| Argument    | Type / constraints                                  |
| ----------- | --------------------------------------------------- |
| `command`   | string (max 1048576)                                |
| `cwd`       | string (min 1, max 8192)                            |
| `timeoutMs` | number (int , min 0, min 100, max 300000); optional |
| `env`       | object mapping strings to string; default {}        |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## system.info

Read system info.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: `{platform, hostname, release, arch, cpus, totalMemory, uptime}`.

## system.cwd

Read system cwd.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: `{cwd}`: default execution root.

## system.environment

Read system environment.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: Environment name/value object; unapproved values redacted.

## process.list

List running process identifiers and names.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: PowerShell process objects with `Id, ProcessName`.

## process.start

Start an executable with arguments.

Risk: **EXECUTE**.

| Argument     | Type / constraints                            |
| ------------ | --------------------------------------------- |
| `executable` | string (min 1, max 8192)                      |
| `args`       | array of string (min 1, max 8192); default [] |
| `cwd`        | string (min 1, max 8192)                      |

Response data: `{pid}`.

## process.kill

Terminate a process.

Risk: **SENSITIVE**.

| Argument | Type / constraints          |
| -------- | --------------------------- |
| `pid`    | number (int , min 0, min 0) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## app.list

List launchable Start menu applications.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: Start menu objects with `Name, AppID`.

## app.launch

Launch an installed application.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `appId`  | string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## clipboard.read

Read text from the user clipboard.

Risk: **SENSITIVE**.

Arguments: none beyond optional routing/approval fields.

Response data: `{text}`.

## clipboard.write

Replace user clipboard text.

Risk: **WRITE**.

| Argument | Type / constraints   |
| -------- | -------------------- |
| `text`   | string (max 1048576) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.status

Run git status in an allowed repository.

Risk: **READ**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `cwd`    | string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.diff

Run git diff in an allowed repository.

Risk: **READ**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `cwd`    | string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.log

Run git log in an allowed repository.

Risk: **READ**.

| Argument | Type / constraints                               |
| -------- | ------------------------------------------------ |
| `cwd`    | string (min 1, max 8192)                         |
| `limit`  | number (int , min 0, min 1, max 100); default 20 |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.add

Run git add in an allowed repository.

Risk: **EXECUTE**.

| Argument | Type / constraints                |
| -------- | --------------------------------- |
| `cwd`    | string (min 1, max 8192)          |
| `paths`  | array of string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.commit

Run git commit in an allowed repository.

Risk: **EXECUTE**.

| Argument  | Type / constraints       |
| --------- | ------------------------ |
| `cwd`     | string (min 1, max 8192) |
| `message` | string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.branch

Run git branch in an allowed repository.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `cwd`    | string (min 1, max 8192) |
| `name`   | string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.checkout

Run git checkout in an allowed repository.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `cwd`    | string (min 1, max 8192) |
| `name`   | string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.pull

Run git pull in an allowed repository.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `cwd`    | string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## git.push

Run git push in an allowed repository.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `cwd`    | string (min 1, max 8192) |

Response data: `{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure.

## browser.launch

Browser launch.

Risk: **EXECUTE**.

Arguments: none beyond optional routing/approval fields.

Response data: `{running, tabs}`.

## browser.close

Browser close.

Risk: **EXECUTE**.

Arguments: none beyond optional routing/approval fields.

Response data: `{closed}`.

## browser.status

Browser status.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: `{running, tabs}`.

## browser.back

Browser back.

Risk: **EXECUTE**.

Arguments: none beyond optional routing/approval fields.

Response data: `{url}`.

## browser.forward

Browser forward.

Risk: **EXECUTE**.

Arguments: none beyond optional routing/approval fields.

Response data: `{url}`.

## browser.reload

Browser reload.

Risk: **EXECUTE**.

Arguments: none beyond optional routing/approval fields.

Response data: `{url}`.

## browser.tabs

Browser tabs.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: Array of `{tabId, url, title, active}`.

## browser.new_tab

Browser new tab.

Risk: **EXECUTE**.

Arguments: none beyond optional routing/approval fields.

Response data: Array of `{tabId, url, title, active}`.

## browser.snapshot

Browser snapshot.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: `{url, title, elements:[{ref, role, name, text}], truncated}`; max 150 visible interactive elements.

## browser.get_text

Browser get text.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: `{text}`; max 20000 characters.

## browser.get_links

Browser get links.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: Array of `{text, url}`; max 200.

## browser.navigate

Navigate the current tab to an HTTP(S) URL.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `url`    | string (min 1, max 8192) |

Response data: `{url}`.

## browser.close_tab

close tab by tab ID.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `tabId`  | string (min 1, max 8192) |

Response data: Array of `{tabId, url, title, active}`.

## browser.switch_tab

switch tab by tab ID.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `tabId`  | string (min 1, max 8192) |

Response data: Array of `{tabId, url, title, active}`.

## browser.click

click an element from the latest semantic snapshot.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |

Response data: `{done:true}`.

## browser.type

type an element from the latest semantic snapshot.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |
| `text`   | string (max 1048576)     |

Response data: `{done:true}`.

## browser.clear

clear an element from the latest semantic snapshot.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |

Response data: `{done:true}`.

## browser.select

select an element from the latest semantic snapshot.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |
| `text`   | string (max 1048576)     |

Response data: `{done:true}`.

## browser.press

press an element from the latest semantic snapshot.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |
| `text`   | string (max 1048576)     |

Response data: `{done:true}`.

## browser.hover

hover an element from the latest semantic snapshot.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |

Response data: `{done:true}`.

## browser.upload

upload an element from the latest semantic snapshot.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |
| `path`   | string (min 1, max 8192) |

Response data: `{done:true}`.

## browser.download

download an element from the latest semantic snapshot.

Risk: **SENSITIVE**.

| Argument      | Type / constraints                 |
| ------------- | ---------------------------------- |
| `ref`         | string (min 1, max 8192)           |
| `destination` | string (min 1, max 8192); optional |

Response data: `{path}` to saved download.

## browser.wait

wait an element from the latest semantic snapshot.

Risk: **READ**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |

Response data: `{done:true}`.

## browser.submit

submit an element from the latest semantic snapshot.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `ref`    | string (min 1, max 8192) |

Response data: `{done:true}`.

## browser.screenshot

Save a screenshot to an allowed path; pixels may contain private information.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `path`   | string (min 1, max 8192) |

Response data: `{path}` to saved PNG; no pixels embedded in response.

## browser.evaluate

Evaluate JavaScript in page context; arbitrary scripts can access authenticated data.

Risk: **SENSITIVE**.

| Argument     | Type / constraints   |
| ------------ | -------------------- |
| `expression` | string (max 1048576) |

Response data: JSON-serializable result, redacted and bounded; disabled by default.

## http.get

Send HTTP GET without redirects or ambient credentials.

Risk: **READ**.

| Argument  | Type / constraints                           |
| --------- | -------------------------------------------- |
| `url`     | string (min 1, max 8192)                     |
| `headers` | object mapping strings to string; default {} |
| `query`   | object mapping strings to string; default {} |
| `body`    | string (max 1048576); optional               |

Response data: `{status, contentType, body, redirectFollowed:false}`; JSON parsed by content type; other bodies returned as text.

## http.post

Send HTTP POST without redirects or ambient credentials.

Risk: **SENSITIVE**.

| Argument  | Type / constraints                           |
| --------- | -------------------------------------------- |
| `url`     | string (min 1, max 8192)                     |
| `headers` | object mapping strings to string; default {} |
| `query`   | object mapping strings to string; default {} |
| `body`    | string (max 1048576); optional               |

Response data: `{status, contentType, body, redirectFollowed:false}`; JSON parsed by content type; other bodies returned as text.

## http.put

Send HTTP PUT without redirects or ambient credentials.

Risk: **SENSITIVE**.

| Argument  | Type / constraints                           |
| --------- | -------------------------------------------- |
| `url`     | string (min 1, max 8192)                     |
| `headers` | object mapping strings to string; default {} |
| `query`   | object mapping strings to string; default {} |
| `body`    | string (max 1048576); optional               |

Response data: `{status, contentType, body, redirectFollowed:false}`; JSON parsed by content type; other bodies returned as text.

## http.patch

Send HTTP PATCH without redirects or ambient credentials.

Risk: **SENSITIVE**.

| Argument  | Type / constraints                           |
| --------- | -------------------------------------------- |
| `url`     | string (min 1, max 8192)                     |
| `headers` | object mapping strings to string; default {} |
| `query`   | object mapping strings to string; default {} |
| `body`    | string (max 1048576); optional               |

Response data: `{status, contentType, body, redirectFollowed:false}`; JSON parsed by content type; other bodies returned as text.

## http.delete

Send HTTP DELETE without redirects or ambient credentials.

Risk: **SENSITIVE**.

| Argument  | Type / constraints                           |
| --------- | -------------------------------------------- |
| `url`     | string (min 1, max 8192)                     |
| `headers` | object mapping strings to string; default {} |
| `query`   | object mapping strings to string; default {} |
| `body`    | string (max 1048576); optional               |

Response data: `{status, contentType, body, redirectFollowed:false}`; JSON parsed by content type; other bodies returned as text.

## device.info

Android device.info; requires foreground companion and applicable platform permission.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: `{manufacturer, model, sdk}`.

## device.battery

Android device.battery; requires foreground companion and applicable platform permission.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: `{percent}`.

## device.network

Android device.network; requires foreground companion and applicable platform permission.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: `{connected}`.

## apps.list

Android apps.list; requires foreground companion and applicable platform permission.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: Array of `{name, packageName}` launcher apps.

## apps.launch

Android apps.launch; requires foreground companion and applicable platform permission.

Risk: **EXECUTE**.

| Argument      | Type / constraints       |
| ------------- | ------------------------ |
| `packageName` | string (min 1, max 8192) |

Response data: `{launched}`.

## intent.open

Android intent.open; requires foreground companion and applicable platform permission.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `url`    | string (min 1, max 8192) |

Response data: `{opened}`.

## intent.share

Android intent.share; requires foreground companion and applicable platform permission.

Risk: **SENSITIVE**.

| Argument | Type / constraints   |
| -------- | -------------------- |
| `text`   | string (max 1048576) |

Response data: `{chooserOpened}`; user completes the chooser.

## files.list

Android files.list; requires foreground companion and applicable platform permission.

Risk: **READ**.

| Argument | Type / constraints |
| -------- | ------------------ |
| `path`   | string; default "" |

Response data: Array of `{name, directory, size}`.

## files.read

Android files.read; requires foreground companion and applicable platform permission.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `path`   | string (min 1, max 8192) |

Response data: `{content, encoding:"utf8"}`.

## files.write

Android files.write; requires foreground companion and applicable platform permission.

Risk: **WRITE**.

| Argument  | Type / constraints       |
| --------- | ------------------------ |
| `path`    | string (min 1, max 8192) |
| `content` | string (max 1048576)     |

Response data: `{bytes}`.

## files.copy

Android files.copy; requires foreground companion and applicable platform permission.

Risk: **WRITE**.

| Argument      | Type / constraints       |
| ------------- | ------------------------ |
| `source`      | string (min 1, max 8192) |
| `destination` | string (min 1, max 8192) |

Response data: `{copied}`.

## files.move

Android files.move; requires foreground companion and applicable platform permission.

Risk: **SENSITIVE**.

| Argument      | Type / constraints       |
| ------------- | ------------------------ |
| `source`      | string (min 1, max 8192) |
| `destination` | string (min 1, max 8192) |

Response data: `{copied}` after successful source deletion.

## files.share

Android files.share; requires foreground companion and applicable platform permission.

Risk: **SENSITIVE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `path`   | string (min 1, max 8192) |

Response data: `{chooserOpened}`.

## notifications.list

Android notifications.list; requires foreground companion and applicable platform permission.

Risk: **SENSITIVE**.

Arguments: none beyond optional routing/approval fields.

Response data: Array of `{package, id, postedAt}`; no message bodies.

## browser.open

Android browser.open; requires foreground companion and applicable platform permission.

Risk: **EXECUTE**.

| Argument | Type / constraints       |
| -------- | ------------------------ |
| `url`    | string (min 1, max 8192) |

Response data: `{opened}`.

## media.list

Android media.list; requires foreground companion and applicable platform permission.

Risk: **READ**.

Arguments: none beyond optional routing/approval fields.

Response data: Array of `{id, name}` for visible images.

## device.list

List online and remembered offline devices. Risk: **READ**.

Arguments: optional deviceId (ignored for list).

Response data: Array of `{id,type,capabilities,online,lastSeen}`.

## device.status

Read the current registry status. Risk: **READ**.

Arguments: optional deviceId (status lists all devices).

Response data: Array of device records.

## device.current

Resolve the session-selected device. Risk: **READ**.

Arguments: optional deviceId.

Response data: One device record; ambiguity/offline produces an error.

## device.capabilities

Discover the selected device’s actual advertised capabilities. Risk: **READ**.

Arguments: optional deviceId.

Response data: Array of capability names.

## session.prefer

Choose a device for this MCP connection. Risk: **READ** (session metadata update only).

Arguments: required deviceId.

Response data: `{id,client,preferredDevice}` session.

## audit.recent

Read recent sanitized records. Risk: **READ**.

Arguments: limit: integer 1–200, default 50; query: string, default empty.

Response data: Array of audit rows.

## audit.search

Search capability, status or device using a substring. Risk: **READ**.

Arguments: limit: integer 1–200, default 50; query: string, default empty.

Response data: Array of audit rows.

## Examples

```json
{"name":"filesystem.read","arguments":{"path":"<allowed-root>/notes.txt"}}
{"name":"session.prefer","arguments":{"deviceId":"windows-main"}}
{"name":"browser.type","arguments":{"ref":"e2_1","text":"Example"}}
{"name":"shell.execute","arguments":{"cwd":"<allowed-root>","command":"echo hello","approvalId":"<locally-approved-id>"}}
```

## Resources

- `personal://devices`: device registry.
- `personal://recent`: recent sanitized audit rows.
- `personal://browser`: selected device browser status.
- `personal://cwd`: selected device default execution root.

Resource responses use JSON MIME type. Device-dependent resources report structured routing errors when selection is ambiguous or unsupported.

## Notes

`browser.submit` clicks the referenced submit control and shares SENSITIVE handling with all clicks. `browser.press` takes a Playwright key name in `text` (for example `Enter`). `browser.select` takes an option value in `text`. `browser.wait` waits for the referenced element to become visible. `filesystem.copy` and `filesystem.move` operate on files, not directory trees. `git.branch` creates a branch; `git.checkout` switches to an existing branch. Git network operations use the repository’s configured remote/upstream. HTTP redirects are returned to the caller rather than followed. Clipboard is shared by Windows and Android; Android write returns `{written:true}` instead of the Windows command result.
