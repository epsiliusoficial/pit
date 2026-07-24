import { generateOtp, storeOtp, verifyOtp } from '../modules/auth/otp.service';

describe('Sistema OTP — límite de intentos real (bug de seguridad corregido)', () => {
  it('genera códigos de 6 dígitos dentro del rango correcto', () => {
    for (let i = 0; i < 20; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      expect(Number(otp)).toBeGreaterThanOrEqual(100000);
      expect(Number(otp)).toBeLessThanOrEqual(999999);
    }
  });

  it('verifica correctamente un OTP válido', async () => {
    const phone = '+5491100000001';
    await storeOtp(phone, '123456');
    const valid = await verifyOtp(phone, '123456');
    expect(valid).toBe(true);
  });

  it('rechaza un OTP incorrecto', async () => {
    const phone = '+5491100000002';
    await storeOtp(phone, '123456');
    const valid = await verifyOtp(phone, '000000');
    expect(valid).toBe(false);
  });

  it('bloquea después de 5 intentos fallidos, incluso si el intento 6 tiene el código correcto (fix real)', async () => {
    const phone = '+5491100000003';
    await storeOtp(phone, '123456');

    for (let i = 0; i < 5; i++) {
      await verifyOtp(phone, '000000');
    }

    // La prueba real del fix: aunque el intento 6 use el código CORRECTO,
    // ya se agotaron los intentos permitidos y debe rechazarse igual.
    const sixthAttempt = await verifyOtp(phone, '123456');
    expect(sixthAttempt).toBe(false);
  });

  it('un código nuevo (storeOtp) resetea el contador de intentos', async () => {
    const phone = '+5491100000004';
    await storeOtp(phone, '111111');
    for (let i = 0; i < 5; i++) await verifyOtp(phone, '000000'); // agota los intentos

    await storeOtp(phone, '222222'); // se pide un código nuevo
    const valid = await verifyOtp(phone, '222222');
    expect(valid).toBe(true);
  });
});
