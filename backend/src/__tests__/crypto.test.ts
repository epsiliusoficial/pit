import { generateKeyPair, encrypt, decrypt } from '../core/crypto/kyber';

describe('Sistema de Cifrado E2E (X25519 + AES-256-GCM)', () => {
  it('genera un par de claves válido', () => {
    const { publicKey, privateKey } = generateKeyPair();
    expect(publicKey).toContain('PUBLIC KEY');
    expect(privateKey).toContain('PRIVATE KEY');
  });

  it('cifra y descifra un mensaje correctamente entre dos partes', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();

    const mensaje = 'Hola Bob, este mensaje es secreto';
    const cifrado = encrypt(mensaje, alice.privateKey, bob.publicKey);
    expect(cifrado).not.toBe(mensaje);

    const descifrado = decrypt(cifrado, bob.privateKey, alice.publicKey);
    expect(descifrado).toBe(mensaje);
  });

  it('falla al descifrar con una clave incorrecta', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const eve = generateKeyPair();

    const cifrado = encrypt('mensaje secreto', alice.privateKey, bob.publicKey);
    expect(() => decrypt(cifrado, eve.privateKey, alice.publicKey)).toThrow();
  });
});
