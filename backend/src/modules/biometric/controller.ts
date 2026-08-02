// Sistema "Bloqueo Biométrico (WebAuthn)": usa el protocolo estándar FIDO2/WebAuthn,
// el mismo que usan bancos, Google y Windows Hello. Es real: el navegador pide
// Face ID/Touch ID/huella/PIN del sistema operativo, y el servidor verifica la
// firma criptográfica — nunca ve ni guarda el dato biométrico en sí (eso nunca
// sale del dispositivo, es una garantía del protocolo, no de nuestro código).
import { Router } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { redis } from '../../core/database/redis';

export const biometricRouter = Router();

const RP_NAME = 'Pit';

export function getRpID(req: any): string {
  const configured = process.env.WEBAUTHN_RP_ID || process.env.FRONTEND_URL;
  if (configured) {
    return process.env.WEBAUTHN_RP_ID || new URL(process.env.FRONTEND_URL!).hostname;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WEBAUTHN_RP_ID o FRONTEND_URL deben estar configuradas en producción para usar biometría de forma segura');
  }
  return req.hostname;
}

export function getOrigin(req: any): string {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FRONTEND_URL debe estar configurada en producción para usar biometría de forma segura');
  }
  return `${req.protocol}://${req.get('host')}`;
}

biometricRouter.post('/register/options', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.webAuthnCredential.findMany({ where: { userId: req.userId! } });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpID(req),
      userID: req.userId!,
      userName: req.userId!,
      attestationType: 'none',
      excludeCredentials: existing.map((c: any) => ({ id: c.credentialId, type: 'public-key' })), // ✅ FIX: añadido type
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required'
      }
    });

    await redis.set(`webauthn:challenge:${req.userId}`, options.challenge, 'EX', 300);
    return res.json(options);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

biometricRouter.post('/register/verify', authMiddleware, async (req: AuthRequest, res) => {
  const expectedChallenge = await redis.get(`webauthn:challenge:${req.userId}`);
  if (!expectedChallenge) return res.status(400).json({ error: 'Desafío expirado, reintentá' });

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpID(req)
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'No se pudo verificar la credencial biométrica' });
    }

    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    await prisma.webAuthnCredential.create({
      data: {
        userId: req.userId!,
        credentialId: Buffer.from(credentialID).toString('base64url'),
        publicKey: Buffer.from(credentialPublicKey).toString('base64url'),
        counter,
        deviceLabel: req.body.deviceLabel || 'Dispositivo'
      }
    });
    await redis.del(`webauthn:challenge:${req.userId}`);
    return res.json({ registered: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

biometricRouter.post('/auth/options', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const credentials = await prisma.webAuthnCredential.findMany({ where: { userId: req.userId! } });
    if (credentials.length === 0) return res.status(400).json({ error: 'No tenés biometría configurada' });

    const options = await generateAuthenticationOptions({
      rpID: getRpID(req),
      // ✅ FIX: añadido type: 'public-key' aquí también
      allowCredentials: credentials.map((c: any) => ({ id: c.credentialId, type: 'public-key' })),
      userVerification: 'required'
    });

    await redis.set(`webauthn:challenge:${req.userId}`, options.challenge, 'EX', 300);
    return res.json(options);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

biometricRouter.post('/auth/verify', authMiddleware, async (req: AuthRequest, res) => {
  const expectedChallenge = await redis.get(`webauthn:challenge:${req.userId}`);
  if (!expectedChallenge) return res.status(400).json({ error: 'Desafío expirado, reintentá' });

  const credentialId = req.body.id;
  const credential = await prisma.webAuthnCredential.findUnique({ where: { credentialId } });
  if (!credential || credential.userId !== req.userId) {
    return res.status(400).json({ error: 'Credencial no reconocida' });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpID(req),
      authenticator: {
        credentialID: Buffer.from(credential.credentialId, 'base64url'),
        credentialPublicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: credential.counter
      }
    });

    if (!verification.verified) return res.status(400).json({ error: 'Verificación biométrica fallida' });

    await prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: { counter: verification.authenticationInfo.newCounter }
    });
    await redis.del(`webauthn:challenge:${req.userId}`);
    return res.json({ verified: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

biometricRouter.get('/credentials', authMiddleware, async (req: AuthRequest, res) => {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: req.userId! },
    select: { id: true, deviceLabel: true, createdAt: true }
  });
  return res.json(credentials);
});

biometricRouter.delete('/credentials/:id', authMiddleware, async (req: AuthRequest, res) => {
  const credential = await prisma.webAuthnCredential.findUnique({ where: { id: req.params.id } });
  if (!credential || credential.userId !== req.userId) return res.status(403).json({ error: 'No autorizado' });
  await prisma.webAuthnCredential.delete({ where: { id: req.params.id } });
  return res.json({ removed: true });
});