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

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Transcripción de Notas de Voz (nuevo)', () => {
  beforeEach(() => {
    mockMessageFindUnique.mockReset();
    mockMessageUpdate.mockReset();
    mockChatUserFindUnique.mockReset();
  });

  it('rechaza transcribir mensajes que no son notas de voz', async () => {
    const { voiceTranscriptionRouter } = await import('../modules/chat/voiceTranscription');
    const handler = getHandler(voiceTranscriptionRouter, '/:messageId');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', isDeleted: false, contentType: 'TEXT', chatId: 'chatA' });

    const req: any = { userId: 'user1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza si no sos miembro del chat del mensaje', async () => {
    const { voiceTranscriptionRouter } = await import('../modules/chat/voiceTranscription');
    const handler = getHandler(voiceTranscriptionRouter, '/:messageId');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', isDeleted: false, contentType: 'VOICE', chatId: 'chatA', metadata: {} });
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('devuelve la transcripción cacheada sin llamar a la API de nuevo', async () => {
    const { voiceTranscriptionRouter } = await import('../modules/chat/voiceTranscription');
    const handler = getHandler(voiceTranscriptionRouter, '/:messageId');
    mockMessageFindUnique.mockResolvedValue({
      id: 'm1', isDeleted: false, contentType: 'VOICE', chatId: 'chatA',
      metadata: { fileId: 'a'.repeat(32), fileKey: 'k', transcript: 'ya transcripto antes' }
    });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ transcript: 'ya transcripto antes', cached: true });
    expect(mockMessageUpdate).not.toHaveBeenCalled();
  });

  it('rechaza si la referencia de archivo (fileId) es inválida', async () => {
    const { voiceTranscriptionRouter } = await import('../modules/chat/voiceTranscription');
    const handler = getHandler(voiceTranscriptionRouter, '/:messageId');
    mockMessageFindUnique.mockResolvedValue({
      id: 'm1', isDeleted: false, contentType: 'VOICE', chatId: 'chatA',
      metadata: { fileId: '../../etc/passwd', fileKey: 'k' }
    });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 404 si el mensaje no existe', async () => {
    const { voiceTranscriptionRouter } = await import('../modules/chat/voiceTranscription');
    const handler = getHandler(voiceTranscriptionRouter, '/:messageId');
    mockMessageFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { messageId: 'nope' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
