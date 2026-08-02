// Sistema "API Documentada": especificación OpenAPI 3.0 real, servida en
// /api/docs con Swagger UI interactivo. Cubre los endpoints principales;
// se amplía agregando más entradas a "paths".
export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Pit API',
    version: '1.0.0',
    description: 'API real de Pit: mensajería, llamadas, IA, pagos internos, y más.'
  },
  servers: [{ url: '/api', description: 'Servidor actual' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    }
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/otp/request': {
      post: {
        summary: 'Solicitar código OTP para login/registro',
        security: [],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] } } }
        },
        responses: { '200': { description: 'OTP enviado' } }
      }
    },
    '/auth/otp/verify': {
      post: {
        summary: 'Verificar OTP y obtener token JWT',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  phone: { type: 'string' }, otp: { type: 'string' },
                  name: { type: 'string' }, password: { type: 'string' }
                },
                required: ['phone', 'otp', 'password']
              }
            }
          }
        },
        responses: { '200': { description: 'Token JWT y datos del usuario' } }
      }
    },
    '/chat/send': {
      post: {
        summary: 'Enviar un mensaje (sistema Tornado: reintenta si falla)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { chatId: { type: 'string' }, content: { type: 'string' } },
                required: ['chatId', 'content']
              }
            }
          }
        },
        responses: { '200': { description: 'Mensaje creado' }, '429': { description: 'Rate limit excedido' } }
      }
    },
    '/chat/{chatId}/history': {
      get: {
        summary: 'Historial de mensajes de un chat',
        parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Lista de mensajes' } }
      }
    },
    '/wallet/balance': {
      get: { summary: 'Consultar saldo de Pit Pay', responses: { '200': { description: 'Saldo actual' } } }
    },
    '/wallet/transfer': {
      post: {
        summary: 'Transferir saldo a otro usuario (transacción atómica)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { toUserId: { type: 'string' }, amount: { type: 'number' } },
                required: ['toUserId', 'amount']
              }
            }
          }
        },
        responses: { '200': { description: 'Transferencia realizada' }, '400': { description: 'Saldo insuficiente' } }
      }
    },
    '/ai/summarize/{chatId}': {
      post: {
        summary: 'Resumir un chat con IA (requiere OPENAI_API_KEY configurada)',
        parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Resumen generado' }, '502': { description: 'OpenAI no configurada o falló' } }
      }
    },
    '/biometric/register/options': {
      post: { summary: 'Iniciar registro de credencial biométrica (WebAuthn)', responses: { '200': { description: 'Opciones de registro' } } }
    },
    '/health': {
      get: { summary: 'Health check', security: [], responses: { '200': { description: 'Servidor OK' } } }
    },
    '/metrics': {
      get: { summary: 'Métricas en formato Prometheus', security: [], responses: { '200': { description: 'Texto plano estilo Prometheus' } } }
    },
    '/auth/2fa/setup': {
      post: {
        summary: '2FA: generar secret TOTP y link otpauth:// para escanear con Authenticator',
        responses: { '200': { description: 'secret y otpauthUrl' } }
      }
    },
    '/auth/2fa/confirm': {
      post: {
        summary: '2FA: confirmar el primer código y activar (devuelve códigos de recuperación de un solo uso)',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } } }
        },
        responses: { '200': { description: 'enabled + recoveryCodes' }, '401': { description: 'Código inválido' } }
      }
    },
    '/auth/2fa/disable': {
      post: {
        summary: '2FA: desactivar (exige contraseña actual Y código/recuperación válidos)',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { password: { type: 'string' }, code: { type: 'string' } }, required: ['password', 'code'] }
            }
          }
        },
        responses: { '200': { description: 'enabled: false' }, '401': { description: 'Contraseña o código inválido' } }
      }
    },
    '/auth/2fa/status': {
      get: { summary: '2FA: consultar si está activado', responses: { '200': { description: 'enabled: boolean' } } }
    },
    '/snooze/{messageId}': {
      post: {
        summary: 'Posponer un mensaje: reaparece con push notification en el momento elegido (1 min a 30 días)',
        parameters: [{ name: 'messageId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { resurfaceAt: { type: 'string', format: 'date-time' } }, required: ['resurfaceAt'] } } }
        },
        responses: { '200': { description: 'snoozed: true' }, '403': { description: 'No pertenecés a ese chat' } }
      },
      delete: {
        summary: 'Cancelar un mensaje pospuesto',
        parameters: [{ name: 'messageId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'cancelled: true' } }
      }
    },
    '/snooze': {
      get: { summary: 'Listar tus mensajes pospuestos pendientes', responses: { '200': { description: 'Lista de recordatorios' } } }
    },
    '/invite/create/{chatId}': {
      post: {
        summary: 'Crear link de invitación a un grupo (admin), con expiración y límite de usos opcional',
        parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { expiresInSeconds: { type: 'integer' }, maxUses: { type: 'integer' } } } } }
        },
        responses: { '200': { description: 'token + link' }, '403': { description: 'Solo admins' } }
      }
    },
    '/invite/{token}': {
      delete: {
        summary: 'Revocar un link de invitación antes de que expire o se agote (admin)',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'revoked: true' } }
      }
    },
    '/invite/accept/{token}': {
      post: {
        summary: 'Unirse a un grupo usando un link de invitación',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'joined: true' }, '400': { description: 'Invitación inválida, expirada o agotada' } }
      }
    },
    '/moderation/group/{chatId}/leave': {
      post: {
        summary: 'Salir de un grupo (si sos el único admin, se promueve a otro miembro automáticamente antes de irte)',
        parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'left: true' }, '404': { description: 'No pertenecés a este chat' } }
      }
    }
  }
};
