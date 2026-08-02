// Sistema "Transcripción de Notas de Voz" (nuevo): convierte cualquier nota
// de voz real en texto leíble con un tap — para cuando no podés escuchar el
// audio (reunión, lugar ruidoso, sin auriculares) o simplemente querés
// buscarlo después como texto.
//
// Diseño, reusando TODO lo que ya existía, sin inventar infraestructura:
// - El audio en sí sigue viviendo donde siempre vivió: cifrado en disco por
//   el sistema de Archivos (POST /api/files/upload), referenciado desde
//   message.metadata.{fileId,fileKey} — igual que ya usan las Notas de Voz.
// - Para transcribir, este módulo descifra el buffer con la MISMA función
//   que ya usa /api/files/download (decryptBuffer, AES-256-GCM), y se lo
//   manda a la API de Whisper (OpenAI) como multipart — sin guardar el
//   audio descifrado en ningún lado ni loguearlo.
// - La transcripción resultante se cachea en message.metadata.transcript —
//   así la segunda vez que alguien la pide, NO se vuelve a gastar una
//   llamada a la API (mismo criterio de costo real que ya se aplicó en
//   otros sistemas de IA de este proyecto).
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { isValidFileId } from '../files/controller';

export const voiceTranscriptionRouter = Router();
voiceTranscriptionRouter.use(authMiddleware);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

function decryptBuffer(data: Buffer, key: Buffer) {
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

async function callWhisper(audioBuffer: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada en el servidor');

  const form = new FormData();
  form.append('file', new Blob([audioBuffer]), 'audio.ogg');
  form.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form as any
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de Whisper: ${response.status} ${errText}`);
  }
  const data: any = await response.json();
  return data.text || '';
}

voiceTranscriptionRouter.get('/:messageId', async (req: AuthRequest, res) => {
  const { messageId } = req.params;

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.isDeleted) return res.status(404).json({ error: 'Mensaje no encontrado' });
  if (message.contentType !== 'VOICE') {
    return res.status(400).json({ error: 'Solo se pueden transcribir notas de voz' });
  }

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const metadata: any = message.metadata || {};

  // Cache real: si ya se transcribió antes, no se vuelve a llamar a la API.
  if (metadata.transcript) {
    return res.json({ transcript: metadata.transcript, cached: true });
  }

  const { fileId, fileKey } = metadata;
  if (!fileId || !fileKey || !isValidFileId(fileId)) {
    return res.status(400).json({ error: 'Referencia de archivo de voz inválida' });
  }

  const filePath = path.join(UPLOAD_DIR, fileId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo de audio no encontrado' });

  try {
    const encrypted = fs.readFileSync(filePath);
    const audioBuffer = decryptBuffer(encrypted, Buffer.from(String(fileKey), 'hex'));
    const transcript = await callWhisper(audioBuffer);

    await prisma.message.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, transcript } }
    });

    return res.json({ transcript, cached: false });
  } catch (err: any) {
    return res.status(502).json({ error: err.message || 'No se pudo transcribir el audio' });
  }
});
