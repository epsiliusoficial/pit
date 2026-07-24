// Sistema "Detector de Enlaces Maliciosos": análisis real de heurísticas de
// phishing conocidas — no es una lista negra externa (eso requeriría una
// API paga tipo Google Safe Browsing), es detección basada en patrones
// reales que usan los ataques de phishing más comunes.
export interface LinkSafetyReport {
  url: string;
  isSuspicious: boolean;
  reasons: string[];
}

const KNOWN_SHORTENERS = [
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd',
  'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at'
];

const COMMONLY_IMPERSONATED = [
  'paypal', 'google', 'microsoft', 'apple', 'amazon', 'facebook',
  'instagram', 'whatsapp', 'netflix', 'bancosantander', 'bbva'
];

function hasPunycodeHomograph(hostname: string): boolean {
  // Los ataques de homógrafos usan Punycode (xn--) para mostrar caracteres
  // que se ven idénticos a letras latinas pero son de otro alfabeto (ej: una
  // "a" cirílica en vez de la "a" latina) — el navegador muestra "аpple.com"
  // pero es un dominio completamente distinto.
  return hostname.includes('xn--');
}

function looksLikeIpAddress(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function hasSuspiciousSubdomainImpersonation(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length < 3) return false;
  const subdomains = parts.slice(0, -2).join('.').toLowerCase();
  const realDomain = parts.slice(-2).join('.').toLowerCase();
  return COMMONLY_IMPERSONATED.some((brand) => subdomains.includes(brand) && !realDomain.includes(brand));
}

function isKnownShortener(hostname: string): boolean {
  return KNOWN_SHORTENERS.some((s) => hostname === s || hostname.endsWith(`.${s}`));
}

function hasExcessiveSubdomains(hostname: string): boolean {
  return hostname.split('.').length > 5;
}

export function analyzeLinkSafety(url: string): LinkSafetyReport {
  const reasons: string[] = [];

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { url, isSuspicious: true, reasons: ['URL malformada o inválida'] };
  }

  if (hasPunycodeHomograph(hostname)) {
    reasons.push('El dominio usa codificación Punycode, común en ataques de homógrafos');
  }
  if (looksLikeIpAddress(hostname)) {
    reasons.push('El link apunta directo a una dirección IP en vez de un dominio');
  }
  if (hasSuspiciousSubdomainImpersonation(hostname)) {
    reasons.push('El nombre de una marca conocida aparece como subdominio, no como el dominio real');
  }
  if (isKnownShortener(hostname)) {
    reasons.push('Es un acortador de links conocido — el destino real está oculto');
  }
  if (hasExcessiveSubdomains(hostname)) {
    reasons.push('El dominio tiene una cantidad inusual de subniveles');
  }

  return { url, isSuspicious: reasons.length > 0, reasons };
}
