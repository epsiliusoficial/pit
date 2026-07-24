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
    }
  }
};
