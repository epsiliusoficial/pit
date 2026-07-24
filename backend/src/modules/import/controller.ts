// Sistema "Importar Chat de WhatsApp": recibe el .txt exportado, lo parsea con
// la lógica real de parser.ts, y guarda los mensajes marcados como IMPORTED
// (no se inventan usuarios nuevos, se guarda el nombre original como metadata).
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { parseWhatsAppExport, ParsedLine } from './parser';
import { encryptContent } from '../../core/crypto/messageEncryption';

export const importRouter = Router();
importRouter.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

importRouter.post('/whatsapp', upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo .txt requerido' });
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: 'chatId requerido' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const text = req.file.buffer.toString('utf-8');
  const parsed = parseWhatsAppExport(text);

  if (parsed.length === 0) {
    return res.status(400).json({ error: 'No se pudo reconocer el formato del archivo exportado' });
  }

  const created = await prisma.$transaction(
    parsed.slice(0, 5000).map((line: ParsedLine) =>
      prisma.message.create({
        data: {
          chatId,
          senderId: req.userId!,
          content: encryptContent(line.content),
          contentType: 'IMPORTED',
          metadata: { originalSender: line.sender, originalTimestamp: line.timestamp.toISOString() },
          createdAt: line.timestamp
        }
      })
    )
  );

  return res.json({ imported: created.length, skipped: Math.max(0, parsed.length - 5000) });
});
