import { otpRequestSchema, otpVerifySchema, sendMessageSchema } from '../core/validation/schemas';

describe('Sistema de Validación de Entrada (Zod)', () => {
  it('acepta un teléfono válido', () => {
    const result = otpRequestSchema.safeParse({ phone: '+5491122334455' });
    expect(result.success).toBe(true);
  });

  it('rechaza un teléfono con letras', () => {
    const result = otpRequestSchema.safeParse({ phone: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('rechaza un OTP que no tiene 6 dígitos', () => {
    const result = otpVerifySchema.safeParse({
      phone: '+5491122334455', otp: '123', password: '1234'
    });
    expect(result.success).toBe(false);
  });

  it('rechaza un mensaje vacío', () => {
    const result = sendMessageSchema.safeParse({ chatId: 'abc', content: '' });
    expect(result.success).toBe(false);
  });

  it('rechaza un mensaje demasiado largo', () => {
    const result = sendMessageSchema.safeParse({ chatId: 'abc', content: 'a'.repeat(6000) });
    expect(result.success).toBe(false);
  });

  it('acepta un mensaje válido', () => {
    const result = sendMessageSchema.safeParse({ chatId: 'abc', content: 'Hola!' });
    expect(result.success).toBe(true);
  });
});
