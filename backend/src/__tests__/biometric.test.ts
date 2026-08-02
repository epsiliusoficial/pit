import { generateRegistrationOptions } from '@simplewebauthn/server';

describe('Sistema de Bloqueo Biométrico (WebAuthn) — lógica del protocolo estándar', () => {
  it('genera opciones de registro con verificación de usuario obligatoria', async () => {
    const options = await generateRegistrationOptions({
      rpName: 'Pit',
      rpID: 'localhost',
      userID: 'user123',
      userName: 'user123',
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
    });

    expect(options.challenge).toBeDefined();
    expect(options.rp.name).toBe('Pit');
    // userVerification: 'required' es lo que fuerza al navegador a pedir
    // Face ID/huella/PIN real, no solo detectar que el dispositivo está presente.
    expect(options.authenticatorSelection?.userVerification).toBe('required');
  });

  it('el challenge generado es único en cada llamada (no reutilizable, previene replay attacks)', async () => {
    const options1 = await generateRegistrationOptions({
      rpName: 'Pit', rpID: 'localhost', userID: 'user123', userName: 'user123', attestationType: 'none'
    });
    const options2 = await generateRegistrationOptions({
      rpName: 'Pit', rpID: 'localhost', userID: 'user123', userName: 'user123', attestationType: 'none'
    });
    expect(options1.challenge).not.toBe(options2.challenge);
  });
});
