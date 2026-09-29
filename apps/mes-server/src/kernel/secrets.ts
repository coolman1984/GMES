import { execFileSync } from 'node:child_process';

/**
 * Secrets at rest (a peer's machine key). On Windows they are sealed with DPAPI for the account that runs the server
 * (through PowerShell's ProtectedData, no new dependency); elsewhere, or with GMES_SECRETS=plain (tests), they are only
 * encoded — the file system is then the protection. Sealed values carry their method so both can be read back.
 */
const useDpapi = () => process.platform === 'win32' && process.env.GMES_SECRETS !== 'plain';

function ps(script: string, input: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true }).trim();
}

export function seal(secret: string): string {
  const b64 = Buffer.from(secret, 'utf8').toString('base64');
  if (!useDpapi()) return 'plain:' + b64;
  const out = ps("Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($i), $null, 'CurrentUser'))", b64);
  return 'dpapi:' + out;
}

const opened = new Map<string, string>();
export function open(sealed: string): string {
  const hit = opened.get(sealed);
  if (hit !== undefined) return hit;
  let value: string;
  if (sealed.startsWith('plain:')) value = Buffer.from(sealed.slice(6), 'base64').toString('utf8');
  else if (sealed.startsWith('dpapi:')) {
    const b64 = ps("Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($i), $null, 'CurrentUser'))", sealed.slice(6));
    value = Buffer.from(b64, 'base64').toString('utf8');
  } else throw new Error('secrets: unknown sealing');
  opened.set(sealed, value);
  return value;
}
