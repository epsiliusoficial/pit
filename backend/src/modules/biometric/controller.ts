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

// Sistema "Origen WebAuthn Confiable" (bug real corregido): antes, sin
// FRONTEND_URL/WEBAUTHN_RP_ID configuradas, el sistema derivaba el origen y
// el RP ID del header Host / req.protocol — ambos controlables por el
// cliente (más aún detrás de un proxy sin "trust proxy" bien configurado).
// Esto debilita la garantía central de WebAuthn: que la credencial está
// atada criptográficamente a un origen específico y verificable. Si un
// atacante puede influir en qué origen "cree" el servidor que es legítimo,
// se abre la puerta a ataques de relay entre orígenes.
//
// Corrección: en producción, EXIGIMOS que FRONTEND_URL o WEBAUTHN_RP_ID estén
// configuradas explícitamente — nunca se deriva del request. En desarrollo
// se mantiene el fallback por comodidad (localhost es un caso especial que
// WebAuthn permite igual).
export function getRpID(req: any): string {
  const configured = process.env.WEBAUTHN_RP_ID || process.env.FRONTEND_URL;
  if (configured) {
    return process.env.WEBAUTHN_RP_ID || new URL(process.env.FRONTEND_URL!).hostname;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WEBAUTHN_RP_ID o FRONTEND_URL deben estar configuradas en producción para usar biometría de forma segura');
  }
  return req.hostname; // solo en desarrollo, para no exigir configuración local
}

export function getOrigin(req: any): string {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FRONTEND_URL debe estar configurada en producción para usar biometría de forma segura');
  }
  return `${req.protocol}://${req.get('host')}`; // solo en desarrollo
}

// Paso 1: el servidor genera un desafío único para registrar una nueva credencial.
biometricRouter.post('/register/options', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.webAuthnCredential.findMany({ where: { userId: req.userId! } });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpID(req),
      userID: req.userId!,
      userName: req.userId!,
      attestationType: 'none',
      excludeCredentials: existing.map((c: any) => ({ id: c.credentialId })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required' // obliga a pedir Face ID/huella/PIN, no solo "estar presente"
      }
    });

    await redis.set(`webauthn:challenge:${req.userId}`, options.challenge, 'EX', 300);
    return res.json(options);
  } catch (err: any) {
    // Bug real corregido: antes, si getRpID()/getOrigin() lanzaban por falta de
    // configuración en producción, esto quedaba como una promesa rechazada sin
    // capturar — la request se colgaba hasta el timeout en vez de dar un error
    // claro. Ahora responde 500 con el motivo exacto.
    return res.status(500).json({ error: err.message });
  }
});

// Paso 2: el navegador devuelve la respuesta firmada por el autenticador biométrico real.
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

// Paso 3: para desbloquear la app, el servidor genera un desafío de autenticación.
biometricRouter.post('/auth/options', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const credentials = await prisma.webAuthnCredential.findMany({ where: { userId: req.userId! } });
    if (credentials.length === 0) return res.status(400).json({ error: 'No tenés biometría configurada' });

    const options = await generateAuthenticationOptions({
      rpID: getRpID(req),
      allowCredentials: credentials.map((c: any) => ({ id: c.credentialId })),
      userVerification: 'required'
    });

    await redis.set(`webauthn:challenge:${req.userId}`, options.challenge, 'EX', 300);
    return res.json(options);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Paso 4: se verifica la firma real del autenticador (huella/Face ID/Windows Hello).
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
