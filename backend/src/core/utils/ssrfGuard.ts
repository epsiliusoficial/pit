// Sistema "Protección SSRF": el validador viejo de link-preview.ts solo
// rechazaba 4 hostnames hardcodeados ('localhost', '127.0.0.1', '0.0.0.0',
// '::1') comparando el string tal cual vino en la URL. Eso NO cubre:
//
//   1. Otras representaciones de loopback: 127.0.0.2, 127.1, 0x7f.0.0.1,
//      017700000001 (octal), 2130706433 (decimal) — todas resuelven a
//      127.0.0.1 pero no matchean el string "127.0.0.1".
//   2. Rangos privados/reservados enteros: 10.0.0.0/8, 172.16.0.0/12,
//      192.168.0.0/16, link-local 169.254.0.0/16 (donde vive el endpoint de
//      metadata de AWS/GCP/Azure en 169.254.169.254 — con esto un atacante
//      podía robar credenciales del cloud pegándole a esa IP disfrazada de
//      "link para preview"), y sus equivalentes IPv6 (fc00::/7, fe80::/10,
//      ::1, IPv4-mapped ::ffff:x.x.x.x).
//   3. DNS rebinding: el chequeo viejo miraba el hostname de la URL, no la IP
//      real a la que se conecta — un dominio público puede resolver a una IP
//      interna. Acá se resuelve DNS ANTES de conectar y se valida la IP.
//   4. Redirects: fetch() sigue redirects por default; una URL externa
//      "limpia" puede responder con un 302 hacia una IP interna y el chequeo
//      inicial nunca se vuelve a aplicar. Acá se sigue manualmente, validando
//      cada salto, con un límite de saltos.
import dns from 'dns/promises';
import net from 'net';

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1']);
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 5000;

function ipToLong(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + parseInt(part, 10), 0) >>> 0;
}

function isPrivateOrReservedIPv4(ip: string): boolean {
  const long = ipToLong(ip);
  const inRange = (base: string, bits: number) => {
    const baseLong = ipToLong(base);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (long & mask) === (baseLong & mask);
  };
  return (
    inRange('0.0.0.0', 8) ||       // "esta" red
    inRange('10.0.0.0', 8) ||      // privado
    inRange('100.64.0.0', 10) ||   // CGNAT
    inRange('127.0.0.0', 8) ||     // loopback (cubre 127.*, no solo 127.0.0.1)
    inRange('169.254.0.0', 16) ||  // link-local — acá vive el metadata endpoint cloud
    inRange('172.16.0.0', 12) ||   // privado
    inRange('192.0.0.0', 24) ||    // reservado IETF
    inRange('192.168.0.0', 16) ||  // privado
    inRange('198.18.0.0', 15) ||   // benchmarking
    inRange('224.0.0.0', 4) ||     // multicast
    inRange('240.0.0.0', 4)        // reservado/futuro
  );
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fec0:')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 (unique local)
  // IPv4-mapped (::ffff:a.b.c.d) — validar la parte IPv4 embebida
  const mapped = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);
  return false;
}

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateOrReservedIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateOrReservedIPv6(ip);
  return true; // formato irreconocible: por las dudas, se bloquea
}

export class SsrfBlockedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SsrfBlockedError';
  }
}

async function assertHostnameIsSafe(hostname: string): Promise<void> {
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new SsrfBlockedError(`Host bloqueado: ${hostname}`);
  }
  // Si ya es una IP literal, se valida directo sin resolver DNS.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new SsrfBlockedError(`IP privada/reservada bloqueada: ${hostname}`);
    return;
  }
  // Resuelve TODAS las direcciones (A y AAAA) y rechaza si CUALQUIERA cae en
  // rango privado — evita que un registro DNS "bueno" esconda uno "malo".
  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new SsrfBlockedError(`No se pudo resolver el host: ${hostname}`);
  }
  if (addresses.length === 0) throw new SsrfBlockedError(`El host no resolvió a ninguna dirección: ${hostname}`);
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new SsrfBlockedError(`El host ${hostname} resuelve a una IP privada/reservada (${addr})`);
    }
  }
}

/**
 * fetch() con protección SSRF real: valida el hostname/IP antes de conectar,
 * y vuelve a validar en cada redirect manualmente en vez de dejar que fetch
 * los siga solo (que es donde el chequeo inicial se podía saltear).
 */
export async function safeFetch(inputUrl: string, init?: RequestInit): Promise<Response> {
  let currentUrl = inputUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new SsrfBlockedError(`Protocolo no permitido: ${parsed.protocol}`);
    }
    await assertHostnameIsSafe(parsed.hostname);

    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
      signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location');
    if (isRedirect && location) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new SsrfBlockedError('Demasiados redirects');
}
