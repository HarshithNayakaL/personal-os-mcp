import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
export function vault(file: string, value?: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (process.platform !== 'win32') {
    if (value !== undefined) {
      fs.writeFileSync(file, value, { mode: 0o600 });
      return value;
    }
    return fs.readFileSync(file, 'utf8');
  }
  const encrypt = value !== undefined;
  const prefix =
    "[void][Reflection.Assembly]::LoadWithPartialName('System.Security'); $v=[Console]::In.ReadToEnd(); ";
  const script =
    prefix +
    (encrypt
      ? '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'
      : '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))');
  const r = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      input: encrypt ? value : fs.readFileSync(file, 'utf8'),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    },
  );
  if (r.status !== 0)
    throw new Error(
      'OS credential vault failed; run under the Windows account that performed setup',
    );
  if (encrypt) {
    fs.writeFileSync(file, r.stdout.trim());
    return value!;
  }
  return r.stdout.trim();
}
