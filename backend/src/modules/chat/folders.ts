// Sistema "Carpetas de Chats" (nuevo): organizar decenas de chats en
// carpetas propias (tipo "Trabajo", "Familia", "Clientes") — como las
// carpetas de Telegram. Es 100% personal: cada usuario arma las suyas sin
// afectar a nadie más del chat (no es lo mismo que los canales o los
// sub-canales de un grupo, que sí son compartidos).
//
// Se guarda en `User.settings` (columna Json que YA existe) bajo la clave
// `chatFolders` — cero migraciones de Postgres nuevas, mismo patrón que ya
// usa el proyecto para "Canales de Difusión" en `groupConfig`.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const folderRouter = Router();
folderRouter.use(authMiddleware);

const MAX_FOLDERS = 20;
const MAX_CHATS_PER_FOLDER = 200;
const MAX_FOLDER_NAME_LENGTH = 30;

type FolderMap = Record<string, string[]>; // folderName -> chatId[]

async function getFolders(userId: string): Promise<FolderMap> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const settings = (user?.settings as any) || {};
  return settings.chatFolders || {};
}

async function saveFolders(userId: string, folders: FolderMap) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const settings = (user?.settings as any) || {};
  await prisma.user.update({
    where: { id: userId },
    data: { settings: { ...settings, chatFolders: folders } }
  });
}

function validFolderName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= MAX_FOLDER_NAME_LENGTH;
}

// Lista todas tus carpetas con sus chats.
folderRouter.get('/', async (req: AuthRequest, res) => {
  const folders = await getFolders(req.userId!);
  return res.json({ folders });
});

// Crea (o renombra el contenido de, si ya existía) una carpeta vacía.
folderRouter.post('/:folderName', async (req: AuthRequest, res) => {
  const { folderName } = req.params;
  if (!validFolderName(folderName)) {
    return res.status(400).json({ error: `El nombre de la carpeta debe tener entre 1 y ${MAX_FOLDER_NAME_LENGTH} caracteres` });
  }

  const folders = await getFolders(req.userId!);
  if (!(folderName in folders) && Object.keys(folders).length >= MAX_FOLDERS) {
    return res.status(400).json({ error: `Máximo ${MAX_FOLDERS} carpetas` });
  }
  if (!(folderName in folders)) folders[folderName] = [];
  await saveFolders(req.userId!, folders);
  return res.json({ folders });
});

folderRouter.delete('/:folderName', async (req: AuthRequest, res) => {
  const { folderName } = req.params;
  const folders = await getFolders(req.userId!);
  delete folders[folderName];
  await saveFolders(req.userId!, folders);
  return res.json({ folders });
});

// Sumar un chat a una carpeta. Verificación real: no podés meter en una
// carpeta un chat del que ni siquiera sos miembro (evita usar esto como
// forma indirecta de "espiar" IDs de chats ajenos guardándolos igual).
folderRouter.post('/:folderName/chats/:chatId', async (req: AuthRequest, res) => {
  const { folderName, chatId } = req.params;
  if (!validFolderName(folderName)) {
    return res.status(400).json({ error: `El nombre de la carpeta debe tener entre 1 y ${MAX_FOLDER_NAME_LENGTH} caracteres` });
  }

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a ese chat' });

  const folders = await getFolders(req.userId!);
  if (!(folderName in folders)) {
    if (Object.keys(folders).length >= MAX_FOLDERS) return res.status(400).json({ error: `Máximo ${MAX_FOLDERS} carpetas` });
    folders[folderName] = [];
  }
  if (!folders[folderName].includes(chatId)) {
    if (folders[folderName].length >= MAX_CHATS_PER_FOLDER) {
      return res.status(400).json({ error: `Máximo ${MAX_CHATS_PER_FOLDER} chats por carpeta` });
    }
    folders[folderName].push(chatId);
  }
  await saveFolders(req.userId!, folders);
  return res.json({ folders });
});

folderRouter.delete('/:folderName/chats/:chatId', async (req: AuthRequest, res) => {
  const { folderName, chatId } = req.params;
  const folders = await getFolders(req.userId!);
  if (folders[folderName]) {
    folders[folderName] = folders[folderName].filter((id) => id !== chatId);
  }
  await saveFolders(req.userId!, folders);
  return res.json({ folders });
});
