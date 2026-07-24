import { otpVerifySchema } from '../core/validation/schemas';

describe('Bug corregido: deviceName se descartaba silenciosamente en el login', () => {
  it('conserva deviceName después de validar (antes Zod lo tiraba por no estar declarado)', () => {
    const result = otpVerifySchema.safeParse({
      phone: '+5491100000000',
      otp: '123456',
      password: 'abcd1234',
      deviceName: 'iPhone de Mateo'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deviceName).toBe('iPhone de Mateo');
    }
  });

  it('conserva totpCode cuando se manda para el segundo factor', () => {
    const result = otpVerifySchema.safeParse({
      phone: '+5491100000000',
      otp: '123456',
      password: 'abcd1234',
      totpCode: '654321'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totpCode).toBe('654321');
    }
  });
});
