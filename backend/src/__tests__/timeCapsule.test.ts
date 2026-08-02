export {}; // scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));
jest.mock('../core/database/client', () => ({
  prisma: { chatUser: { findUnique: jest.fn() }, message: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() } }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Sistema "E2E real (fase 3)": Cápsulas del Tiempo se dio de baja a propósito.
// Dependía de que el SERVIDOR tuviera el texto plano para poder "guardarlo
// bloqueado" hasta unlockAt — eso es lo opuesto de E2E real. Este test
// verifica que el corte es explícito (410 con motivo), no una ruta rota en
// silencio.
describe('Cápsulas del Tiempo — deshabilitada honestamente tras el pase a E2E real', () => {
  it('responde 410 explicando el conflicto con E2E, sin tocar la base', async () => {
    const { timeCapsuleRouter } = await import('../modules/chat/timeCapsule');
    const { prisma } = await import('../core/database/client');
    const handler = getHandler(timeCapsuleRouter, 'post', '/:chatId');

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { content: 'sorpresa', unlockAt: '2099-01-01' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect((prisma.chatUser.findUnique as jest.Mock)).not.toHaveBeenCalled();
  });
});
