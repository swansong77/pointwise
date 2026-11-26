import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** True for loopback, private, link-local, unique-local, CGNAT and unspecified addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 6) {
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = p;
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * A mailbox host must resolve to public addresses only, so a user cannot make the server probe its own
 * network (SSRF). Local development and tests may set MAILBOX_ALLOW_PRIVATE_HOSTS=true.
 */
export async function assertPublicHost(host: string, env = process.env, resolve: (h: string) => Promise<string[]> = defaultResolve): Promise<void> {
  if (!/^[a-z0-9.-]{3,253}$/i.test(host) && isIP(host) === 0) throw new Error('Enter a valid mail server host name');
  if (env.MAILBOX_ALLOW_PRIVATE_HOSTS === 'true') return;
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!addrs.length) throw new Error('The mail server host name could not be resolved');
  if (addrs.some(isPrivateAddress)) throw new Error('That mail server is on a private network and cannot be used');
}

async function defaultResolve(h: string): Promise<string[]> {
  return (await lookup(h, { all: true })).map((r) => r.address);
}
