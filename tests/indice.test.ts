import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { indiceDeModulo, ok } from '../src/api/helpers.js';

/**
 * La raíz de un módulo devolvía 404 porque solo existían sus subrutas. El
 * índice la llena, y deriva la lista de las rutas realmente registradas para
 * que no pueda quedar desfasada respecto al código.
 */
async function appDePrueba() {
  const app = Fastify();
  await app.register(
    async (api) => {
      indiceDeModulo(api, 'compras');
      api.get('/requisiciones', async () => ok([]));
      api.get('/requisiciones/:id', async () => ok({}));
      api.post('/ordenes', async () => ok({}));
      api.get('/ordenes', async () => ok([]));
    },
    { prefix: '/api/compras' },
  );
  await app.ready();
  return app;
}

describe('indiceDeModulo', () => {
  it('la raíz del módulo deja de ser 404', async () => {
    const app = await appDePrueba();
    const r = await app.inject({ method: 'GET', url: '/api/compras' });
    assert.equal(r.statusCode, 200);
    await app.close();
  });

  it('lista las rutas del módulo con su método y ruta completa', async () => {
    const app = await appDePrueba();
    const { data } = JSON.parse((await app.inject({ method: 'GET', url: '/api/compras' })).body);
    assert.equal(data.modulo, 'compras');
    assert.deepEqual(data.endpoints, [
      'GET /api/compras/ordenes',
      'GET /api/compras/requisiciones',
      'GET /api/compras/requisiciones/:id',
      'POST /api/compras/ordenes',
    ]);
    await app.close();
  });

  it('no se lista a sí mismo ni expone los HEAD automáticos', async () => {
    const app = await appDePrueba();
    const { data } = JSON.parse((await app.inject({ method: 'GET', url: '/api/compras' })).body);
    assert.ok(!data.endpoints.some((e: string) => e.endsWith('/api/compras')));
    assert.ok(!data.endpoints.some((e: string) => e.startsWith('HEAD')));
    await app.close();
  });

  it('no afecta a las subrutas existentes', async () => {
    const app = await appDePrueba();
    assert.equal((await app.inject({ method: 'GET', url: '/api/compras/requisiciones' })).statusCode, 200);
    await app.close();
  });
});
