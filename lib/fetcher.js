import { lookup } from 'node:dns/promises';

const UA = 'unrsschiquito/1.0 (+https://github.com/unrsschiquito)';
const TIMEOUT_MS = 12000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const ALLOW_PRIVATE = /^(1|true|yes)$/i.test(process.env.ALLOW_PRIVATE_HOSTS || '');

function ipIsPrivate(ip, family) {
  if (family === 6) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(v);
    if (m) return ipIsPrivate(m[1], 4);
    return false;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function assertPublic(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Solo se admiten URLs http/https');
  }
  if (ALLOW_PRIVATE) return;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) {
    throw new Error('Host no permitido');
  }
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error('No se pudo resolver el dominio');
  }
  if (!addrs.length || addrs.some((a) => ipIsPrivate(a.address, a.family))) {
    throw new Error('Host no permitido');
  }
}

async function readCapped(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error('El recurso es demasiado grande');
  }
  if (!response.body) return '';

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('El recurso es demasiado grande');
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);

  const ct = response.headers.get('content-type') || '';
  const declaredCharset = /charset=["']?([\w-]+)/i.exec(ct)?.[1];
  const sniffed = /encoding=["']([\w-]+)["']/i.exec(buf.subarray(0, 200).toString('latin1'))?.[1];
  const charset = (declaredCharset || sniffed || 'utf-8').toLowerCase();

  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

export async function safeFetch(rawUrl, accept = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5') {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('URL inválida');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);

    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': UA, accept, 'accept-language': 'es,en;q=0.8' },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`Redirección sin destino (${res.status})`);
      res.body?.cancel?.();
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return {
      url: url.toString(),
      contentType: res.headers.get('content-type') || '',
      body: await readCapped(res),
    };
  }
  throw new Error('Demasiadas redirecciones');
}
