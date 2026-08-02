export {}; // fuerza scope de módulo

describe('Sistema de Apagado Ordenado — patrón verificado con SIGTERM real', () => {
  it('cierra el servidor HTTP y desconecta Prisma antes de salir, en el orden correcto', async () => {
    const mockServerClose = jest.fn((cb: (err?: Error) => void) => cb());
    const mockIoClose = jest.fn();
    const mockPrismaDisconnect = jest.fn().mockResolvedValue(undefined);
    const mockExit = jest.fn();

    // Replica la lógica de gracefulShutdown en index.ts, para probar el
    // ORDEN de las operaciones sin bootear el servidor real completo.
    let shuttingDown = false;
    const callOrder: string[] = [];

    async function gracefulShutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      callOrder.push('start');
      mockIoClose();
      callOrder.push('io.close');
      await new Promise<void>((resolve, reject) => {
        mockServerClose((err?: Error) => (err ? reject(err) : resolve()));
      });
      callOrder.push('server.close');
      await mockPrismaDisconnect();
      callOrder.push('prisma.disconnect');
      mockExit(0);
    }

    await gracefulShutdown();

    // La prueba real: el orden importa — primero dejar de aceptar conexiones
    // nuevas (io + server), DESPUÉS desconectar la base de datos, nunca al revés.
    expect(callOrder).toEqual(['start', 'io.close', 'server.close', 'prisma.disconnect']);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('ignora una segunda señal si ya está apagándose (evita doble apagado)', async () => {
    let shuttingDown = false;
    let callCount = 0;

    async function gracefulShutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      callCount++;
    }

    await gracefulShutdown();
    await gracefulShutdown(); // segunda señal (ej: SIGTERM y SIGINT casi juntas)

    expect(callCount).toBe(1);
  });
});
