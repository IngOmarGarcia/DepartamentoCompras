import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env, esProduccion, corsOrigins } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { autenticar } from './auth.js';
import { pedidosRoutes } from './routes/pedidos.routes.js';
import { inventarioRoutes } from './routes/inventario.routes.js';
import { comprasRoutes } from './routes/compras.routes.js';
import { catalogosRoutes, dashboardRoutes } from './routes/catalogos.routes.js';

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

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('src/api/server.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('dist/api/server.js');

if (esEntrada) {
  const app = construirApp();
  app
    .listen({ port: env.PORT, host: env.HOST })
    .then(() => app.log.info(`API lista en http://${env.HOST}:${env.PORT}`))
    .catch((e) => {
      app.log.error(e);
      process.exit(1);
    });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      app.close().then(() => process.exit(0));
    });
  }
}
