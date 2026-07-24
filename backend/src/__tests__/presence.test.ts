const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args)
    }
  }
}));

jest.mock('../core/database/redis', () => ({
  setTyping: jest.fn()
}));

import { registerPresenceHandlers } from '../modules/chat/presence';
import { setTyping } from '../core/database/redis';

function createFakeSocket(authenticatedUserId: string) {
  const listeners: Record<string, Function> = {};
  const socket: any = {
    userId: authenticatedUserId,
    on: (event: string, cb: Function) => { listeners[event] = cb; },
    to: () => ({ emit: jest.fn() }),
    broadcast: { emit: jest.fn() }
  };
  return { socket, listeners };
}

describe('Sistema de Presencia — bugs de seguridad y desconexión corregidos', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    (setTyping as jest.Mock).mockReset();
    mockFindUnique.mockResolvedValue({ settings: {} }); // sin ghostMode por defecto
  });

  it('usa el userId autenticado del socket, NO el que manda el cliente (fix de spoofing)', async () => {
    const { socket, listeners } = createFakeSocket('usuario-real');
    registerPresenceHandlers({} as any, socket);

    // Un cliente malicioso intenta hacerse pasar por "usuario-victima"
    await listeners['typing']({ chatId: 'chat1', userId: 'usuario-victima' });

    // La prueba real: setTyping se llama con el ID autenticado, no con el spoofeado.
    expect(setTyping).toHaveBeenCalledWith('chat1', 'usuario-real');
    expect(setTyping).not.toHaveBeenCalledWith('chat1', 'usuario-victima');
  });

  it('marca al usuario offline automáticamente al desconectarse (fix de "presencia fantasma")', async () => {
    const { socket, listeners } = createFakeSocket('usuario-real');
    registerPresenceHandlers({} as any, socket);

    await listeners['disconnect']();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usuario-real' },
      data: expect.objectContaining({ isOnline: false })
    });
  });

  it('respeta el modo fantasma también al desconectarse', async () => {
    mockFindUnique.mockResolvedValue({ settings: { ghostMode: true } });
    const { socket, listeners } = createFakeSocket('usuario-fantasma');
    registerPresenceHandlers({} as any, socket);

    await listeners['disconnect']();

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
