# Security model

This program deliberately executes with the Windows user's permissions. It is a personal automation tool, not a hostile-code sandbox. Filesystem root controls apply to filesystem primitives, Git working directories and browser upload/output paths. **Approved arbitrary commands, executable launches, Git hooks and page JavaScript can exceed those controls.** Do not interpret command deny patterns as a security boundary.

## Default policy

The YAML file maps capability names or risk levels to `allow`, `required`, or `deny`. A capability override takes precedence over its risk level. Missing policy requires approval. READ and WRITE are generally allowed; EXECUTE and SENSITIVE require local approval. A few browser editing/navigation operations are allowed. `browser.evaluate` is implemented but denied by default.

All browser clicks, key presses, explicit submit actions and download-triggering clicks are SENSITIVE because a generic executor cannot reliably infer a website action's consequences. There is no claim that a button's text proves it harmless. Enabling arbitrary browser JavaScript removes browser confidentiality boundaries and can expose page credentials; only enable it for a trusted, isolated context.

Inspect and approve from a terminal you control:

```powershell
node scripts/admin.mjs pending
node scripts/admin.mjs approve <request-id>
```

Pending requests show the exact, unredacted arguments that the approval will bind, so nothing in a request can be hidden from review behind a secret-looking key. Treat `pending` output as sensitive: it can contain credentials the model put in the arguments. Approval is bound to the exact original arguments, session, device and capability, expires after five minutes, and can be consumed once. The model cannot approve through an MCP tool. The local admin credential is separate from the client credential. A user-approved unrestricted shell can access local administration under that user's account; the approval boundary cannot defend against commands you authorize to subvert it.

## Secrets and storage

Windows pairing/client/admin credentials use Windows DPAPI CurrentUser encryption. Android tokens use an Android Keystore AES-GCM key. Neither is stored as cleartext configuration. Windows encrypted state lives in `.local`, which is denied by filesystem tools. The browser profile is also denied. Android backups and device transfer exclude app data.

There are no cookie, password, storage-state or authentication-header extraction tools. Persistent browser profiles let the browser use sessions without the MCP intentionally exporting them. Environment enumeration returns values only for explicitly allowed variable names. Audit omits command bodies, script bodies, text content, HTTP bodies and headers. Errors and text responses redact recognizable credential keys, bearer strings, common key formats, private-key blocks and known secret environment values.

**Redaction is best effort, not an absolute guarantee.** Arbitrary file contents, binary/base64 responses, screenshots, website text and command output may contain unrecognized secrets or personal information. Do not expose credential directories through broader tools. No general-purpose execution layer can promise never to reveal unknown secrets while also allowing arbitrary shell commands and JavaScript. Screenshots are saved locally and treated as SENSITIVE; a separately authorized reader can still inspect them. Clipboard reads are SENSITIVE. Android notification retrieval intentionally returns metadata only, excluding message text and OTPs.

## Network

The core binds to loopback. HTTP endpoints require a client/admin token except the one-use pairing endpoint, which requires a 128-bit, five-minute pairing code. Browser-origin requests are rejected. Android uses `adb reverse` to reach loopback, with no exposed LAN listener or cloud service. Pairing tokens remain valid until local paired state is removed and the daemon restarted; V1 has no remote revocation service.

HTTP primitives resolve and validate addresses, pin the resolved address for connection, block private/local destinations unless the hostname is explicitly listed, reject embedded URL credentials and credential/transport headers, enforce response limits, and do not follow redirects. Browser navigation is separate from the HTTP primitive and can reach local services; restrict browser permissions accordingly. No ambient HTTP credentials are added. Git uses the user's normal local credential helper.

## Files and reliability

Canonical path checks detect traversal and junction/symlink escape for direct operations and creation paths. Root deletion/mutation is blocked. Copy and move do not overwrite destinations. Search skips symbolic links and has count limits. A concurrent local process could change a link between validation and use; the checks do not provide OS-level isolation against a malicious local user racing filesystem operations.

Timeout does not mean rollback. A process, network request, browser action or Android provider operation may already have caused side effects. Check state before retrying a mutation. Browser cancellation closes the browser context. Windows command cancellation requests process-tree termination. Native Android file providers may not support interruption; the core still stops waiting at its deadline.

Audit writes are mandatory even when `logging` is false; that setting controls service diagnostics only. Audit records describe executed actions but omit sensitive payloads. Secure or archive the database according to your personal retention needs.

No CAPTCHA, MFA, anti-bot or security-control bypass is implemented.
