import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env, esProduccion, corsOrigins } from '../config/env.js';
import { verificarSupabase } from '../config/verificar-supabase.js';
import { AppError } from '../lib/errors.js';
import { autenticar } from './auth.js';
import { pedidosRoutes } from '../api/routes/pedidos.routes.js';
import { inventarioRoutes } from '../api/routes/inventario.routes.js';
import { comprasRoutes } from '../api/routes/compras.routes.js';
import { catalogosRoutes, dashboardRoutes } from '../api/routes/catalogos.routes.js';

export function construirApp() {
  const app = Fastify({
    logger: esProduccion
      ? { level: env.LOG_LEVEL }
      : { level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(cors, { origin: corsOrigins, credentials: true, allowedHeaders: ['content-type', 'authorization', 'x-api-key'] });

  // Manejador de errores unificado.
  app.setErrorHandler((error: unknown, req, reply) => {
    const err = error as Error & { validation?: unknown };
    if (err instanceof AppError) {
      // 5xx = falla nuestra (configuración, esquema, infraestructura). El
      // operador necesita el mensaje completo en el log; el cliente sólo el
      // código, que ya dice qué pasó sin exponer detalles del despliegue.
      if (err.status >= 500) {
        req.log.error({ codigo: err.codigo, detalle: err.detalle }, err.message);
        return reply.status(err.status).send({
          ok: false,
          error: {
            codigo: err.codigo,
            mensaje: esProduccion ? 'Error del servidor: revisa los logs' : err.message,
            detalle: null,
          },
        });
      }
      req.log.warn({ codigo: err.codigo, detalle: err.detalle }, err.message);
      return reply.status(err.status).send(err.toJSON());
    }
    if (err.validation) {
      return reply.status(422).send({ ok: false, error: { codigo: 'VALIDACION', mensaje: err.message } });
    }
    req.log.error({ err }, 'Error no controlado');
    return reply.status(500).send({
      ok: false,
      error: { codigo: 'ERROR_INTERNO', mensaje: esProduccion ? 'Error interno' : err.message },
    });
  });

  // Ruta raíz de bienvenida (para que no salga 404 al entrar al link principal)
  app.get('/', async () => ({ status: 'online', service: 'ERP Compras API' }));

  app.get('/health', async () => ({ ok: true, servicio: 'erp-compras-almacen', ts: new Date().toISOString() }));

  // Todo /api requiere credencial (API Key o JWT).
  app.register(
    async (api) => {
      api.addHook('preHandler', autenticar);
      api.get('/me', async (req) => ({ ok: true, data: req.ctx }));
      api.register(pedidosRoutes, { prefix: '/pedidos' });
      api.register(inventarioRoutes, { prefix: '/inventario' });
      api.register(comprasRoutes, { prefix: '/compras' });
      api.register(catalogosRoutes, { prefix: '/catalogos' });
      api.register(dashboardRoutes, { prefix: '/dashboard' });
    },
    { prefix: '/api' },
  );

  return app;
}

// ¿Se está ejecutando este archivo directamente, o sólo lo importan para usar
// `construirApp`? Comparar la URL del módulo con el argumento de entrada es
// exacto e independiente del layout: antes se comparaban sufijos de ruta y
// dejó de reconocerse el binario compilado al cambiar de sitio.
const esEntrada = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esEntrada) {
  const app = construirApp();

  void (async () => {
    try {
      // Antes de aceptar tráfico: si las credenciales no sirven, es mejor no
      // arrancar que responder CONFIG_SUPABASE en cada petición.
      await verificarSupabase(app.log);
      await app.listen({ port: env.PORT, host: env.HOST });
      app.log.info(`API lista en http://${env.HOST}:${env.PORT}`);
    } catch (e) {
      app.log.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
  })();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      app.close().then(() => process.exit(0));
    });
  }
}