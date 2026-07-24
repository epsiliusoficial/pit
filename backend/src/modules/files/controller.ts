// Sistema "Archivos cifrados": subida real con multer, guardado en disco, y
// cifrado real chunk-por-chunk con AES-256-GCM antes de guardar — así ni con
// acceso al disco del servidor se puede leer el contenido sin la clave.
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AuthRequest, authMiddleware } from '../auth/middleware';

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
