import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../core/database/client';
import { getJwtSecret } from '../../core/utils/jwtSecret';

export interface AuthRequest extends Request {
  userId?: string;
  deviceId?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token faltante' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { userId: string; deviceId?: string };

    // Sistema "Baneo real": si el admin te suspendió, el token deja de servir al instante.
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { tier: true } });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (user.tier === 'BANNED') return res.status(403).json({ error: 'Cuenta suspendida' });

    // Sistema "Revocación de sesión real": si el token lleva un deviceId (todos
    // los emitidos desde este fix en adelante), se verifica que ese Device siga
    // existiendo. Si el usuario lo borró desde "Dispositivos vinculados", el
    // token deja de servir en la SIGUIENTE request, no recién cuando expire solo.
    if (payload.deviceId) {
      const device = await prisma.device.findUnique({ where: { id: payload.deviceId } });
      if (!device) return res.status(401).json({ error: 'Sesión revocada desde otro dispositivo' });
    }

    req.userId = payload.userId;
    req.deviceId = payload.deviceId;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

