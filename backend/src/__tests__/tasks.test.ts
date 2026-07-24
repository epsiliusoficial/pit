export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockTaskCreate = jest.fn();
const mockTaskFindMany = jest.fn();
const mockTaskFindUnique = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskDelete = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    task: {
      create: (...args: any[]) => mockTaskCreate(...args),
      findMany: (...args: any[]) => mockTaskFindMany(...args),
      findUnique: (...args: any[]) => mockTaskFindUnique(...args),
      update: (...args: any[]) => mockTaskUpdate(...args),
      delete: (...args: any[]) => mockTaskDelete(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Tareas Compartidas', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockTaskCreate.mockReset();
    mockTaskFindMany.mockReset();
    mockTaskFindUnique.mockReset();
    mockTaskUpdate.mockReset();
    mockTaskDelete.mockReset();
  });

  it('rechaza crear una tarea en un chat al que no pertenece', async () => {
    const { taskRouter } = await import('../modules/chat/tasks');
    const handler = getHandler(taskRouter, 'post', '/');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', body: { chatId: 'chat-ajeno', title: 'comprar pan' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza asignar la tarea a alguien que no pertenece al chat', async () => {
    const { taskRouter } = await import('../modules/chat/tasks');
    const handler = getHandler(taskRouter, 'post', '/');

    mockChatUserFindUnique
      .mockResolvedValueOnce({ role: 'MEMBER' })
      .mockResolvedValueOnce(null);

    const req: any = { userId: 'user1', body: { chatId: 'chat1', title: 'tarea', assignedTo: 'ajeno' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it('crea la tarea correctamente cuando todo es válido', async () => {
    const { taskRouter } = await import('../modules/chat/tasks');
    const handler = getHandler(taskRouter, 'post', '/');

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockTaskCreate.mockResolvedValue({ id: 'task1', title: 'comprar pan' });

    const req: any = { userId: 'user1', body: { chatId: 'chat1', title: '  comprar pan  ' } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: 'comprar pan' })
    }));
  });

  it('rechaza borrar una tarea si no fue quien la creó', async () => {
    const { taskRouter } = await import('../modules/chat/tasks');
    const handler = getHandler(taskRouter, 'delete', '/:id');

    mockTaskFindUnique.mockResolvedValue({ id: 'task1', chatId: 'chat1', createdBy: 'otro-user' });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { id: 'task1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockTaskDelete).not.toHaveBeenCalled();
  });

  it('permite alternar isDone (completar/descompletar)', async () => {
    const { taskRouter } = await import('../modules/chat/tasks');
    const handler = getHandler(taskRouter, 'post', '/:id/toggle');

    mockTaskFindUnique.mockResolvedValue({ id: 'task1', chatId: 'chat1', isDone: false });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockTaskUpdate.mockResolvedValue({ id: 'task1', isDone: true });

    const req: any = { userId: 'user1', params: { id: 'task1' } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 'task1' }, data: { isDone: true } });
  });
});
