import fs from 'node:fs';
import { allCapabilities } from '../dist/packages/capabilities/src/catalog.js';
function describe(schema) {
  const d = schema._def;
  if (d.typeName === 'ZodDefault')
    return `${describe(d.innerType)}; default ${JSON.stringify(d.defaultValue())}`;
  if (d.typeName === 'ZodOptional') return `${describe(d.innerType)}; optional`;
  if (d.typeName === 'ZodEnum') return d.values.map((v) => JSON.stringify(v)).join(' or ');
  if (d.typeName === 'ZodArray') return `array of ${describe(d.type)}`;
  if (d.typeName === 'ZodRecord') return `object mapping strings to ${describe(d.valueType)}`;
  return (
    d.typeName.replace('Zod', '').toLowerCase() +
    (d.checks?.length ? ` (${d.checks.map((c) => `${c.kind} ${c.value ?? ''}`).join(', ')})` : '')
  );
}
const command =
  '`{stdout, stderr, exitCode, duration, workingDirectory}`; nonzero exitCode is a completed command failure, not a transport failure';
function response(name) {
  if (
    name.startsWith('git.') ||
    [
      'shell.execute',
      'powershell.execute',
      'clipboard.write',
      'process.kill',
      'app.launch',
    ].includes(name)
  )
    return command;
  const map = {
    'filesystem.list': 'Array of `{name, directory, symlink}` (up to 1000)',
    'filesystem.stat': '`{path, size, directory, modified}`',
    'filesystem.read': '`{path, encoding, content}`; binary content uses base64',
    'filesystem.search': '`{paths, truncated}`; case-insensitive filename substring search',
    'filesystem.write': '`{path, bytes}`',
    'filesystem.append': '`{path, bytes}`',
    'filesystem.copy': '`{source, destination}`',
    'filesystem.move':
      '`{source, destination}`; file copy then unlink, not an atomic cross-volume move',
    'filesystem.mkdir': '`{path}`',
    'filesystem.delete': '`{deleted}`',
    'system.info': '`{platform, hostname, release, arch, cpus, totalMemory, uptime}`',
    'system.cwd': '`{cwd}`: default execution root',
    'system.environment': 'Environment name/value object; unapproved values redacted',
    'process.list': 'PowerShell process objects with `Id, ProcessName`',
    'process.start': '`{pid}`',
    'app.list': 'Start menu objects with `Name, AppID`',
    'clipboard.read': '`{text}`',
    'browser.launch': '`{running, tabs}`',
    'browser.close': '`{closed}`',
    'browser.status': '`{running, tabs}`',
    'browser.snapshot':
      '`{url, title, elements:[{ref, role, name, text}], truncated}`; max 150 visible interactive elements',
    'browser.get_text': '`{text}`; max 20000 characters',
    'browser.get_links': 'Array of `{text, url}`; max 200',
    'browser.screenshot': '`{path}` to saved PNG; no pixels embedded in response',
    'browser.evaluate': 'JSON-serializable result, redacted and bounded; disabled by default',
    'device.info': '`{manufacturer, model, sdk}`',
    'device.battery': '`{percent}`',
    'device.network': '`{connected}`',
    'apps.list': 'Array of `{name, packageName}` launcher apps',
    'apps.launch': '`{launched}`',
    'intent.open': '`{opened}`',
    'browser.open': '`{opened}`',
    'intent.share': '`{chooserOpened}`; user completes the chooser',
    'files.list': 'Array of `{name, directory, size}`',
    'files.read': '`{content, encoding:"utf8"}`',
    'files.write': '`{bytes}`',
    'files.copy': '`{copied}`',
    'files.move': '`{copied}` after successful source deletion',
    'files.share': '`{chooserOpened}`',
    'notifications.list': 'Array of `{package, id, postedAt}`; no message bodies',
    'media.list': 'Array of `{id, name}` for visible images',
  };
  if (map[name]) return map[name];
  if (['browser.tabs', 'browser.new_tab', 'browser.close_tab', 'browser.switch_tab'].includes(name))
    return 'Array of `{tabId, url, title, active}`';
  if (['browser.navigate', 'browser.back', 'browser.forward', 'browser.reload'].includes(name))
    return '`{url}`';
  if (name === 'browser.download') return '`{path}` to saved download';
  if (name.startsWith('http.'))
    return '`{status, contentType, body, redirectFollowed:false}`; JSON parsed by content type; other bodies returned as text';
  return '`{done:true}`';
}
let text =
  '# MCP tool reference\n\nGenerated from the validated capability catalog. Run `node scripts/generate-docs.mjs` after a build to regenerate.\n\nAll tool calls return an MCP text content block containing JSON: `{ok:true,data,durationMs}` or `{ok:false,error:{code,message},durationMs}`. Core discovery calls omit durationMs. Errors set MCP `isError`. Device capabilities accept optional `deviceId` and `approvalId` in addition to the arguments below. Unknown arguments are rejected. Defaults and bounds are enforced by Zod. Arguments refer to Windows paths unless the tool is Android-only; Android paths are relative to the selected SAF folder.\n\nRisk metadata determines default policy but exact capability overrides take precedence. See SECURITY.md.\n\n';
for (const cap of allCapabilities) {
  text += `## ${cap.name}\n\n${cap.description}.\n\nRisk: **${cap.risk}**.\n\n`;
  const entries = Object.entries(cap.schema.shape);
  text += entries.length
    ? '| Argument | Type / constraints |\n| --- | --- |\n' +
      entries.map(([name, schema]) => `| \`${name}\` | ${describe(schema)} |`).join('\n') +
      '\n\n'
    : 'Arguments: none beyond optional routing/approval fields.\n\n';
  text += `Response data: ${response(cap.name)}.\n\n`;
}
for (const [name, purpose, args, result] of [
  [
    'device.list',
    'List online and remembered offline devices',
    'optional deviceId (ignored for list)',
    'Array of `{id,type,capabilities,online,lastSeen}`',
  ],
  [
    'device.status',
    'Read the current registry status',
    'optional deviceId (status lists all devices)',
    'Array of device records',
  ],
  [
    'device.current',
    'Resolve the session-selected device',
    'optional deviceId',
    'One device record; ambiguity/offline produces an error',
  ],
  [
    'device.capabilities',
    'Discover the selected device’s actual advertised capabilities',
    'optional deviceId',
    'Array of capability names',
  ],
  [
    'session.prefer',
    'Choose a device for this MCP connection',
    'required deviceId',
    '`{id,client,preferredDevice}` session',
  ],
  [
    'audit.recent',
    'Read recent sanitized records',
    'limit: integer 1–200, default 50; query: string, default empty',
    'Array of audit rows',
  ],
  [
    'audit.search',
    'Search capability, status or device using a substring',
    'limit: integer 1–200, default 50; query: string, default empty',
    'Array of audit rows',
  ],
])
  text += `## ${name}\n\n${purpose}. Risk: **READ**${name === 'session.prefer' ? ' (session metadata update only)' : ''}.\n\nArguments: ${args}.\n\nResponse data: ${result}.\n\n`;
text +=
  '## Examples\n\n```json\n{"name":"filesystem.read","arguments":{"path":"<allowed-root>/notes.txt"}}\n{"name":"session.prefer","arguments":{"deviceId":"windows-main"}}\n{"name":"browser.type","arguments":{"ref":"e2_1","text":"Example"}}\n{"name":"shell.execute","arguments":{"cwd":"<allowed-root>","command":"echo hello","approvalId":"<locally-approved-id>"}}\n```\n\n## Resources\n\n- `personal://devices`: device registry.\n- `personal://recent`: recent sanitized audit rows.\n- `personal://browser`: selected device browser status.\n- `personal://cwd`: selected device default execution root.\n\nResource responses use JSON MIME type. Device-dependent resources report structured routing errors when selection is ambiguous or unsupported.\n\n## Notes\n\n`browser.submit` clicks the referenced submit control and shares SENSITIVE handling with all clicks. `browser.press` takes a Playwright key name in `text` (for example `Enter`). `browser.select` takes an option value in `text`. `browser.wait` waits for the referenced element to become visible. `filesystem.copy` and `filesystem.move` operate on files, not directory trees. `git.branch` creates a branch; `git.checkout` switches to an existing branch. Git network operations use the repository’s configured remote/upstream. HTTP redirects are returned to the caller rather than followed. Clipboard is shared by Windows and Android; Android write returns `{written:true}` instead of the Windows command result.\n';
fs.writeFileSync('docs/MCP_TOOLS.md', text);
