// Sistema "Validación de entrada": esquemas reales con Zod. Nunca confiar en
// datos del frontend — cada campo se valida en tipo, formato y longitud antes
// de tocar la base de datos.
import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export const otpRequestSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Formato de teléfono inválido')
});

export const otpVerifySchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  otp: z.string().length(6, 'El OTP debe tener 6 dígitos'),
  name: z.string().min(1).max(80).optional(),
  password: z.string().min(4, 'La contraseña debe tener al menos 4 caracteres').max(200),
  // Sistema 2FA: código TOTP opcional — solo se exige en el controller si el
  // usuario tiene el segundo factor activado. Va acá para que Zod no lo
  // descarte silenciosamente (por default tira las claves no declaradas).
  totpCode: z.string().length(6).optional(),
  deviceName: z.string().max(100).optional()
});

export const sendMessageSchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1, 'El mensaje no puede estar vacío').max(5000, 'Mensaje demasiado largo'),
  contentType: z.string().max(30).optional(),
  metadata: z.record(z.any()).optional(),
  replyToId: z.string().optional()
});

export const createChatSchema = z.object({
  userIds: z.array(z.string()).min(1),
  isGroup: z.boolean().optional(),
  name: z.string().max(100).optional()
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
  newPassword: z.string().min(4, 'La nueva contraseña debe tener al menos 4 caracteres').max(200)
});

// Middleware genérico: valida req.body contra cualquier schema de Zod.
// Si falla, responde 400 con el detalle exacto de qué campo está mal
// (útil para depurar desde el frontend sin adivinar).
export function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Datos de entrada inválidos',
        details: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      });
    }
    req.body = result.data;
    next();
  };
}
