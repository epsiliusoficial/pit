export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

jest.mock('../core/database/client', () => ({
  prisma: { chatUser: { findMany: jest.fn() }, message: { findMany: jest.fn() } }
}));

jest.mock('../modules/chat/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../modules/social/achievements', () => ({ registerActivity: jest.fn(), BADGES: {} }));
jest.mock('../core/validation/schemas', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  sendMessageSchema: {},
  createChatSchema: {}
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Sistema "E2E real (fase 1)": la búsqueda global server-side se dio de baja
// a propósito — buscar contra contenido cifrado E2E desde el servidor es
// imposible (el server no tiene forma de leer el mensaje). Antes esto
// desciframba con la clave del server y comparaba texto; eso ya no existe.
// Este test verifica que el endpoint avisa el corte con un error claro
// (410) en vez de devolver resultados vacíos o rotos en silencio.
describe('Búsqueda global — deprecada honestamente tras el pase a E2E real', () => {
  it('responde 410 explicando que la búsqueda se movió al cliente, sin tocar la base', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const { prisma } = await import('../core/database/client');
    const handler = getHandler(chatRouter, '/search/global');

    const req: any = { userId: 'user1', query: { q: 'hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect((prisma.chatUser.findMany as jest.Mock)).not.toHaveBeenCalled();
  });
});
