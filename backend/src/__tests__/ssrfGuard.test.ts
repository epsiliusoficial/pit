import { isBlockedIp } from '../core/utils/ssrfGuard';

describe('SSRF guard - rangos de IP bloqueados', () => {
  it('bloquea el endpoint de metadata de la nube (169.254.169.254)', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true);
  });

  it('bloquea todo el rango loopback, no solo 127.0.0.1', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('127.0.0.2')).toBe(true);
    expect(isBlockedIp('127.255.255.255')).toBe(true);
  });

  it('bloquea rangos privados RFC1918 completos', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('172.16.5.1')).toBe(true);
    expect(isBlockedIp('172.31.255.254')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
  });

  it('bloquea loopback y link-local en IPv6', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
  });

  it('bloquea direcciones IPv4-mapped que esconden una IP privada', () => {
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedIp('::ffff:10.0.0.5')).toBe(true);
  });

  it('permite IPs públicas normales', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('1.1.1.1')).toBe(false);
  });
});
