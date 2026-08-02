export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockMessageCreate = jest.fn();
const mockMessageFindUnique = jest.fn();
const mockReactionDeleteMany = jest.fn();
const mockReactionFindUnique = jest.fn();
const mockReactionDelete = jest.fn();
const mockReactionCreate = jest.fn();
const mockReactionFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: {
      create: (...args: any[]) => mockMessageCreate(...args),
      findUnique: (...args: any[]) => mockMessageFindUnique(...args)
    },
    reaction: {
      deleteMany: (...args: any[]) => mockReactionDeleteMany(...args),
      findUnique: (...args: any[]) => mockReactionFindUnique(...args),
      delete: (...args: any[]) => mockReactionDelete(...args),
      create: (...args: any[]) => mockReactionCreate(...args),
      findMany: (...args: any[]) => mockReactionFindMany(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Eventos con RSVP — sistema nuevo (sin migración, reusa Reaction)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockMessageCreate.mockReset();
    mockMessageFindUnique.mockReset();
    mockReactionDeleteMany.mockReset();
    mockReactionFindUnique.mockReset();
    mockReactionDelete.mockReset();
    mockReactionCreate.mockReset();
    mockReactionFindMany.mockReset();
  });

  describe('POST /create', () => {
    it('rechaza crear un evento si no es miembro real del chat', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/create');
      mockChatUserFindUnique.mockResolvedValue(null);

      const req: any = { userId: 'atacante', body: { chatId: 'chatX', title: 'Cumple' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockMessageCreate).not.toHaveBeenCalled();
    });

    it('rechaza una fecha inválida sin llegar a crear el mensaje', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/create');
      mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

      const req: any = { userId: 'user1', body: { chatId: 'chatA', title: 'Cumple', date: 'no-es-fecha' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockMessageCreate).not.toHaveBeenCalled();
    });

    it('crea el mensaje EVENT con la metadata del evento', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/create');
      mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
      mockMessageCreate.mockResolvedValue({ id: 'm1', chatId: 'chatA', contentType: 'EVENT' });

      const req: any = { userId: 'user1', body: { chatId: 'chatA', title: 'Asado', date: '2026-08-01T20:00:00Z', location: 'Casa de Mateo' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(mockMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contentType: 'EVENT',
            metadata: expect.objectContaining({ title: 'Asado', location: 'Casa de Mateo' })
          })
        })
      );
    });
  });

  describe('POST /:messageId/rsvp', () => {
    it('rechaza un response que no sea GOING/NOT_GOING/MAYBE', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/:messageId/rsvp');

      const req: any = { userId: 'user1', params: { messageId: 'm1' }, body: { response: 'CUALQUIER_COSA' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rechaza RSVP sobre un mensaje que no es un evento', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/:messageId/rsvp');
      mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatA', contentType: 'TEXT' });

      const req: any = { userId: 'user1', params: { messageId: 'm1' }, body: { response: 'GOING' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('rechaza si el usuario no pertenece al chat del evento', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/:messageId/rsvp');
      mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatA', contentType: 'EVENT' });
      mockChatUserFindUnique.mockResolvedValue(null);

      const req: any = { userId: 'atacante', params: { messageId: 'm1' }, body: { response: 'GOING' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('borra cualquier otra respuesta RSVP previa del mismo usuario antes de aplicar la nueva (mutua exclusión real)', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/:messageId/rsvp');
      mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatA', contentType: 'EVENT' });
      mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
      mockReactionFindUnique.mockResolvedValue(null);
      mockReactionFindMany.mockResolvedValue([{ userId: 'user1', emoji: '✅' }]);

      const req: any = { userId: 'user1', params: { messageId: 'm1' }, body: { response: 'GOING' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(mockReactionDeleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ messageId: 'm1', userId: 'user1', emoji: { in: ['❌', '🤷'] } })
        })
      );
      expect(mockReactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ emoji: '✅' }) })
      );
    });

    it('tocar la misma opción de nuevo la saca (arrepentirse de haber respondido)', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/:messageId/rsvp');
      mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatA', contentType: 'EVENT' });
      mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
      mockReactionFindUnique.mockResolvedValue({ id: 'r1' });
      mockReactionFindMany.mockResolvedValue([]);

      const req: any = { userId: 'user1', params: { messageId: 'm1' }, body: { response: 'GOING' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(mockReactionDelete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ action: 'removed' }));
    });

    it('devuelve los conteos correctos por opción', async () => {
      const { eventRouter } = await import('../modules/chat/events');
      const handler = getHandler(eventRouter, 'post', '/:messageId/rsvp');
      mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatA', contentType: 'EVENT' });
      mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
      mockReactionFindUnique.mockResolvedValue(null);
      mockReactionFindMany.mockResolvedValue([
        { userId: 'user1', emoji: '✅' }, { userId: 'user2', emoji: '✅' }, { userId: 'user3', emoji: '❌' }
      ]);

      const req: any = { userId: 'user1', params: { messageId: 'm1' }, body: { response: 'GOING' } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ counts: { GOING: 2, NOT_GOING: 1, MAYBE: 0 } })
      );
    });
  });
});
