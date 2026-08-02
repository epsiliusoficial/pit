// Cifrado E2E real basado en ECDH (curva X25519) + AES-256-GCM.
// Nota honesta: Kyber (post-cuántico) requiere una librería nativa (liboqs / pqclean bindings)
// que no compila de forma confiable en todos los entornos. Esta implementación usa criptografía
// asimétrica real y estándar (no un mock): las claves son reales, el cifrado es real,
// y es sustituible por Kyber más adelante sin cambiar la interfaz pública.
import crypto from 'crypto';

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  };
}

function deriveSharedSecret(privateKeyPem: string, publicKeyPem: string): Buffer {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const secret = crypto.diffieHellman({ privateKey, publicKey });
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(plainText: string, myPrivateKeyPem: string, theirPublicKeyPem: string) {
  const key = deriveSharedSecret(myPrivateKeyPem, theirPublicKeyPem);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(payloadB64: string, myPrivateKeyPem: string, theirPublicKeyPem: string) {
  const key = deriveSharedSecret(myPrivateKeyPem, theirPublicKeyPem);
  const buf = Buffer.from(payloadB64, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
