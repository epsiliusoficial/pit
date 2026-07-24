// Sistema "Comparación Segura de Secrets": usa timingSafeEqual en vez de ===
// para comparar el ADMIN_SECRET. Con === el tiempo de comparación varía según
// cuántos caracteres coinciden antes de la primera diferencia, lo que en
// teoría permite deducir el secret carácter por carácter midiendo tiempos de
// respuesta (timing attack). Difícil de explotar en la práctica sobre HTTP,
// pero la corrección es gratis y estándar.
import crypto from 'crypto';

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // mantiene el tiempo constante igual
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
