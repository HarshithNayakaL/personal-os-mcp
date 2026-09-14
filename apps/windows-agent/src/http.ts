import { lookup } from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { Fault } from '../../../packages/protocol/src/index.js';
import type { Config } from '../../../packages/shared/src/config.js';
import { redact } from '../../../packages/security/src/index.js';
export function privateAddress(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224 ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  return !/^[23]/.test(v) || v.startsWith('2001:db8:') || v.startsWith('2002:') || !net.isIP(v);
}
export async function requestHttp(method: string, a: any, c: Config, signal?: AbortSignal) {
  const url = new URL(a.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Fault('URL_DENIED', 'Only HTTP(S) without URL credentials is allowed');
  for (const [k, v] of Object.entries(a.query ?? {})) url.searchParams.set(k, String(v));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true });
  if (!c.allowedLocalHosts.includes(host) && addresses.some((x) => privateAddress(x.address)))
    throw new Fault(
      'SSRF_DENIED',
      'Private/local destination requires explicit allowedLocalHosts configuration',
    );
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.headers ?? {})) {
    if (/authorization|cookie|proxy|host|connection|transfer-encoding|content-length/i.test(k))
      throw new Fault('HEADER_DENIED', 'Credential and transport headers cannot be supplied');
    headers[k] = String(v);
  }
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: method.toUpperCase(),
        headers,
        signal,
        timeout: c.timeoutMs,
        lookup: ((_h: any, options: any, cb: any) =>
          options.all
            ? cb(null, [addresses[0]])
            : cb(null, addresses[0].address, addresses[0].family)) as any,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > c.maxBytes) {
            reject(new Fault('OUTPUT_LIMIT', 'HTTP response exceeds limit'));
            res.destroy();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('aborted', () =>
          reject(new Fault('NETWORK_ERROR', 'HTTP response was interrupted')),
        );
        res.on('end', () => {
          let body: any = Buffer.concat(chunks).toString('utf8');
          if (String(res.headers['content-type']).includes('json')) {
            try {
              body = JSON.parse(body);
            } catch {}
          }
          resolve(
            redact({
              status: res.statusCode,
              contentType: res.headers['content-type'],
              body,
              redirectFollowed: false,
            }),
          );
        });
      },
    );
    req.on('timeout', () => req.destroy(new Fault('TIMEOUT', 'HTTP request timed out')));
    req.on('error', reject);
    if (a.body) req.write(a.body);
    req.end();
  });
}
