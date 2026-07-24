jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      count: jest.fn()
        .mockResolvedValueOnce(5)   // userCount
        .mockResolvedValueOnce(2)   // activeConnectionsToday
    },
    message: { count: jest.fn().mockResolvedValue(42) },
    chat: { count: jest.fn().mockResolvedValue(3) }
  }
}));

import { metricsRouter } from '../modules/monitoring/metrics';

// Se invoca el handler directamente con un mock de Request/Response de Express,
// evitando agregar una dependencia extra (supertest) solo para este test.
function getHandler() {
  const layer = (metricsRouter as any).stack.find((l: any) => l.route?.path === '/metrics');
  return layer.route.stack[0].handle;
}

describe('Sistema de Métricas (formato Prometheus)', () => {
  it('expone /metrics con el formato de texto plano correcto', async () => {
    const handler = getHandler();
    const res: any = {
      headers: {} as Record<string, string>,
      setHeader(key: string, value: string) { this.headers[key] = value; },
      send(body: string) { this.body = body; return this; }
    };

    await handler({} as any, res);

    expect(res.headers['Content-Type']).toContain('text/plain');
    expect(res.body).toContain('pit_users_total 5');
    expect(res.body).toContain('pit_messages_total 42');
    expect(res.body).toContain('pit_chats_total 3');
    expect(res.body).toContain('pit_active_users_24h 2');
    expect(res.body).toContain('# HELP');
    expect(res.body).toContain('# TYPE');
  });
});
