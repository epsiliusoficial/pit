export {}; // scope de módulo

const mockMessageFindUnique = jest.fn();
const mockMessageUpdate = jest.fn();
const mockChatUserFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    message: {
      findUnique: (...args: any[]) => mockMessageFindUnique(...args),
      update: (...args: any[]) => mockMessageUpdate(...args)
    },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) }
  }
}));

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema "Ver una vez" — sistema nuevo (fotos que se autodestruyen)', () => {
  let fileRouter: any;
  const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
  let fileId: string;
  let fileKey: Buffer;

  beforeAll(async () => {
    ({ fileRouter } = await import('../modules/files/controller'));
  });

  beforeEach(() => {
    mockMessageFindUnique.mockReset();
    mockMessageUpdate.mockReset();
    mockChatUserFindUnique.mockReset();

    // Crea un "archivo cifrado" real en disco, igual que lo dejaría /upload,
    // para probar el ciclo completo de descifrado + quemado.
    fileKey = crypto.randomBytes(32);
    fileId = crypto.randomBytes(16).toString('hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', fileKey, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from('contenido secreto')), cipher.final()]);
    const authTag = cipher.getAuthTag();
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, fileId), Buffer.concat([iv, authTag, encrypted]));
  });

  afterEach(() => {
    const p = path.join(UPLOAD_DIR, fileId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('rechaza si el mensaje no está marcado como viewOnce', async () => {
    const handler = getHandler(fileRouter, '/view-once/:fileId');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'c1', senderId: 'other', metadata: { fileId, viewOnce: false } });

    const req: any = { params: { fileId }, query: { key: fileKey.toString('hex'), messageId: 'm1' }, userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis(), setHeader: jest.fn(), send: jest.fn() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza si el usuario no pertenece al chat del mensaje', async () => {
    const handler = getHandler(fileRouter, '/view-once/:fileId');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'c1', senderId: 'other', metadata: { fileId, viewOnce: true } });
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { params: { fileId }, query: { key: fileKey.toString('hex'), messageId: 'm1' }, userId: 'atacante' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis(), setHeader: jest.fn(), send: jest.fn() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('el destinatario lo ve una vez, y en el segundo intento ya se autodestruyó', async () => {
    const handler = getHandler(fileRouter, '/view-once/:fileId');
    const message = { id: 'm1', chatId: 'c1', senderId: 'remitente', metadata: { fileId, viewOnce: true } };
    mockMessageFindUnique.mockResolvedValue(message);
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { params: { fileId }, query: { key: fileKey.toString('hex'), messageId: 'm1' }, userId: 'destinatario' };
    const res1: any = { json: jest.fn(), status: jest.fn().mockReturnThis(), setHeader: jest.fn(), send: jest.fn() };
    await handler(req, res1);

    expect(res1.send).toHaveBeenCalledWith(Buffer.from('contenido secreto'));
    expect(mockMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ viewedBy: 'destinatario' }) }) })
    );
    expect(fs.existsSync(path.join(UPLOAD_DIR, fileId))).toBe(false);

    // Segundo intento: el archivo ya no existe en disco -> 410, y el metadata ya trae viewedAt.
    mockMessageFindUnique.mockResolvedValue({ ...message, metadata: { ...message.metadata, viewedAt: new Date().toISOString() } });
    const res2: any = { json: jest.fn(), status: jest.fn().mockReturnThis(), setHeader: jest.fn(), send: jest.fn() };
    await handler(req, res2);
    expect(res2.status).toHaveBeenCalledWith(410);
  });

  it('el remitente puede volver a verlo sin que se queme para el destinatario', async () => {
    const handler = getHandler(fileRouter, '/view-once/:fileId');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'c1', senderId: 'remitente', metadata: { fileId, viewOnce: true } });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { params: { fileId }, query: { key: fileKey.toString('hex'), messageId: 'm1' }, userId: 'remitente' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis(), setHeader: jest.fn(), send: jest.fn() };
    await handler(req, res);

    expect(res.send).toHaveBeenCalledWith(Buffer.from('contenido secreto'));
    expect(mockMessageUpdate).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(UPLOAD_DIR, fileId))).toBe(true);
  });
});
