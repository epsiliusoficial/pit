// Sistema "Lista de chats con no-leídos": el endpoint que arma la pantalla principal
// de cualquier app de mensajería — chats ordenados, con conteo real de no leídos.
//
// Optimización real (antes tenía un bug N+1): con 50 chats esto hacía 51 queries
// (1 para las membresías + 1 por cada chat para contar no-leídos). Ahora son 2
// queries totales sin importar cuántos chats tenga el usuario.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { decryptContent } from '../../core/crypto/messageEncryption';

export const chatListRouter = Router();
chatListRouter.use(authMiddleware);

chatListRouter.get('/', async (req: AuthRequest, res) => {
  const userId = req.userId!;

  const memberships = await prisma.chatUser.findMany({
    where: { userId },
    include: {
      chat: {
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: 1 }
        }
      }
    }
  });

  const chatIds = memberships.map((m: any) => m.chatId);

  // Una sola consulta trae los mensajes no propios de TODOS los chats a la vez,
  // en vez de una consulta separada por cada chat.
  const allCandidates = chatIds.length
    ? await prisma.message.findMany({
        where: { chatId: { in: chatIds }, isDeleted: false, senderId: { not: userId } },
        select: { chatId: true, readBy: true }
      })
    : [];

  const unreadByChatId = new Map<string, number>();
  for (const msg of allCandidates as any[]) {
    const alreadyRead = Array.isArray(msg.readBy) && msg.readBy.includes(userId);
    if (!alreadyRead) {
      unreadByChatId.set(msg.chatId, (unreadByChatId.get(msg.chatId) || 0) + 1);
    }
  }

  const result = memberships.map((m: any) => {
    const lastMessageRaw = m.chat.messages[0] || null;
    return {
      chatId: m.chatId,
      name: m.chat.name,
      isGroup: m.chat.isGroup,
      isMuted: m.isMuted,
      isArchived: m.isArchived,
      isPinned: m.isPinned,
      // Bug real corregido: la vista previa del último mensaje se pasó por
      // alto en la pasada grande de cifrado — antes de este fix, la lista de
      // chats mostraba literalmente el ciphertext (`enc1:...`) como si fuera
      // el texto del mensaje, en vez de la vista previa real.
      lastMessage: lastMessageRaw ? { ...lastMessageRaw, content: decryptContent(lastMessageRaw.content) } : null,
      unreadCount: unreadByChatId.get(m.chatId) || 0
    };
  });

  // Ordena: fijados primero, después por último mensaje más reciente
  result.sort((a: any, b: any) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  return res.json(result);
});
