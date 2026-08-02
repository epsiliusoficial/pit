// Sistema "Logger": reemplaza console.log sueltos por un logger consistente,
// que en producción no imprime stack traces completos (evita fuga de info interna).
const isProd = process.env.NODE_ENV === 'production';

function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info(message: string) {
    console.log(`[${timestamp()}] INFO: ${message}`);
  },
  warn(message: string) {
    console.warn(`[${timestamp()}] WARN: ${message}`);
  },
  error(message: string, err?: unknown) {
    if (isProd) {
      // En producción no se filtra el stack trace completo, solo el mensaje.
      const safeMsg = err instanceof Error ? err.message : String(err ?? '');
      console.error(`[${timestamp()}] ERROR: ${message} ${safeMsg}`);
    } else {
      console.error(`[${timestamp()}] ERROR: ${message}`, err);
    }
  }
};
