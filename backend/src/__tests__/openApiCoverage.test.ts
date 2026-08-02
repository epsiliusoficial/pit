import { openApiSpec } from '../modules/docs/openapi';

describe('Documentación OpenAPI — cobertura de los sistemas nuevos (antes solo 10 endpoints documentados)', () => {
  it('serializa como JSON válido', () => {
    expect(() => JSON.stringify(openApiSpec)).not.toThrow();
  });

  it('documenta 2FA, snooze, invitaciones y salir del grupo', () => {
    const paths = Object.keys(openApiSpec.paths);
    expect(paths).toEqual(expect.arrayContaining([
      '/auth/2fa/setup',
      '/auth/2fa/confirm',
      '/auth/2fa/disable',
      '/snooze/{messageId}',
      '/invite/create/{chatId}',
      '/invite/{token}',
      '/moderation/group/{chatId}/leave'
    ]));
  });

  it('cada path documentado tiene al menos un método con summary y responses', () => {
    for (const [path, methods] of Object.entries(openApiSpec.paths as Record<string, any>)) {
      for (const [, def] of Object.entries(methods)) {
        expect((def as any).summary).toBeTruthy();
        expect((def as any).responses).toBeTruthy();
      }
    }
  });
});
