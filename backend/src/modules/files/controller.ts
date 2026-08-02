// Sistema "Archivos cifrados": subida real con multer, guardado en disco, y
// cifrado real chunk-por-chunk con AES-256-GCM antes de guardar — así ni con
// acceso al disco del servidor se puede leer el contenido sin la clave.
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { prisma } from '../../core/database/client';

export const fileRouter = Router();
fileRouter.use(authMiddleware);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Sistema "Bloqueo de archivos peligrosos": extensiones ejecutables rechazadas
// desde el nombre original (defensa en profundidad — el archivo igual se
// guarda cifrado con nombre aleatorio, nunca se ejecuta, pero esto evita que
// alguien intente distribuir malware disfrazado de archivo normal en el chat).
const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.scr', '.vbs', '.jar'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`Tipo de archivo no permitido: ${ext}`));
    }
    cb(null, true);
  }
});

// Sistema "Sin path traversal": el fileId SIEMPRE se genera acá mismo como
// 32 caracteres hexadecimales (crypto.randomBytes(16).toString('hex')).
// Este validador rechaza cualquier otra cosa antes de tocar el filesystem —
// bug real encontrado: antes el fileId de la URL se pasaba directo a
// path.join() sin validar, permitiendo intentar leer archivos arbitrarios
// del servidor con algo como fileId=../../../../etc/passwd.
export function isValidFileId(fileId: string): boolean {
  return /^[a-f0-9]{32}$/.test(fileId);
}

function encryptBuffer(buffer: Buffer, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptBuffer(data: Buffer, key: Buffer) {
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

fileRouter.post('/upload', upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido o tipo no permitido' });

  const fileKey = crypto.randomBytes(32); // clave simétrica única para este archivo
  const encrypted = encryptBuffer(req.file.buffer, fileKey);

  const fileId = crypto.randomBytes(16).toString('hex');
  const filePath = path.join(UPLOAD_DIR, fileId);
  fs.writeFileSync(filePath, encrypted);

  return res.json({
    fileId,
    fileKey: fileKey.toString('hex'), // se comparte por el canal cifrado del chat, no queda en el server
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype
  });
});

fileRouter.get('/download/:fileId', async (req: AuthRequest, res) => {
  const { fileId } = req.params;
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'key requerida para descifrar' });

  if (!isValidFileId(fileId)) {
    return res.status(400).json({ error: 'Identificador de archivo inválido' });
  }

  const filePath = path.join(UPLOAD_DIR, fileId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });

  try {
    const encrypted = fs.readFileSync(filePath);
    const decrypted = decryptBuffer(encrypted, Buffer.from(String(key), 'hex'));
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.send(decrypted);
  } catch {
    return res.status(400).json({ error: 'Clave incorrecta o archivo corrupto' });
  }
});

// Sistema "Ver una vez" (nuevo): fotos/videos que se autodestruyen después de
// la primera vez que alguien que NO es el remitente los abre — igual que las
// fotos "ver una vez" de WhatsApp. Se apoya 100% en la infraestructura de
// archivos cifrados que ya existe (mismo cifrado AES-256-GCM, mismo
// isValidFileId contra path traversal); lo único nuevo es la lógica de
// "quemar" el archivo del disco tras la primera vista real.
//
// El estado de "ya se vio" vive en message.metadata (columna Json ya
// existente) — no hace falta ninguna migración de Postgres para esto.
fileRouter.get('/view-once/:fileId', async (req: AuthRequest, res) => {
  const { fileId } = req.params;
  const { key, messageId } = req.query;
  if (!key || !messageId) return res.status(400).json({ error: 'key y messageId requeridos' });
  if (!isValidFileId(fileId)) return res.status(400).json({ error: 'Identificador de archivo inválido' });

  const message = await prisma.message.findUnique({ where: { id: String(messageId) } });
  if (!message) return res.status(404).json({ error: 'Mensaje no encontrado' });

  const meta = (message.metadata as any) || {};
  if (meta.fileId !== fileId || !meta.viewOnce) {
    return res.status(400).json({ error: 'Este mensaje no es contenido de ver una vez' });
  }

  // Autorización real: solo un miembro efectivo del chat puede siquiera
  // intentar abrirlo — mismo control que el resto del proyecto usa en
  // history/search/reactions.
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  // El remitente puede volver a ver su propio envío sin quemarlo — el
  // "quemado" es sobre la experiencia del destinatario, no un candado que te
  // deja afuera de lo que vos mismo mandaste.
  const isSender = message.senderId === req.userId;

  if (meta.viewedAt && !isSender) {
    return res.status(410).json({ error: 'Este contenido ya se vio y se autodestruyó' });
  }

  const filePath = path.join(UPLOAD_DIR, fileId);
  if (!fs.existsSync(filePath)) {
    return res.status(410).json({ error: 'Este contenido ya se vio y se autodestruyó' });
  }

  let decrypted: Buffer;
  try {
    const encrypted = fs.readFileSync(filePath);
    decrypted = decryptBuffer(encrypted, Buffer.from(String(key), 'hex'));
  } catch {
    return res.status(400).json({ error: 'Clave incorrecta o archivo corrupto' });
  }

  // Recién acá, con el archivo YA leído y descifrado con éxito, lo quemamos —
  // así un intento con la key equivocada no gasta la única vista real.
  if (!isSender && !meta.viewedAt) {
    fs.unlinkSync(filePath);
    await prisma.message.update({
      where: { id: message.id },
      data: { metadata: { ...meta, viewedAt: new Date().toISOString(), viewedBy: req.userId } }
    });
  }

  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
  return res.send(decrypted);
});
