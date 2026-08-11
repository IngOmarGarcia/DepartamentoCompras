import type { FastifyInstance } from 'fastify';
import { inventarioService } from '../../core/inventario.service.js';
import { requiereRol } from '../auth.js';
import { parse, ok, indiceDeModulo } from '../helpers.js';
import {
  ConsultarStockInput, MovimientoInput, TransferenciaInput, EstablecerStockInput, ListarInput,
} from '../../schemas/index.js';

export async function inventarioRoutes(app: FastifyInstance): Promise<void> {
  indiceDeModulo(app, 'inventario');

  /** POST /api/inventario/stock — consulta de disponibilidad (total/reservado/disponible). */
  app.post('/stock', async (req) => ok(await inventarioService.consultarStock(req.ctx, parse(ConsultarStockInput, req.body))));

  app.get('/stock', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const input = parse(ConsultarStockInput, {
      skus: q.skus ? q.skus.split(',') : undefined,
      producto_ids: q.producto_ids ? q.producto_ids.split(',') : undefined,
      almacen_id: q.almacen_id,
      solo_bajo_minimo: q.solo_bajo_minimo === 'true',
    });
    return ok(await inventarioService.consultarStock(req.ctx, input));
  });

  /** POST /api/inventario/movimientos — entradas, salidas, mermas, ajustes. */
  app.post('/movimientos', { preHandler: requiereRol('almacen') }, async (req) =>
    ok(await inventarioService.registrarMovimiento(req.ctx, parse(MovimientoInput, req.body))),
  );

  /** POST /api/inventario/existencias — fija la existencia a un valor absoluto (conteo/carga inicial). */
  app.post('/existencias', { preHandler: requiereRol('almacen') }, async (req) =>
    ok(await inventarioService.establecerStock(req.ctx, parse(EstablecerStockInput, req.body))),
  );

  app.post('/transferencias', { preHandler: requiereRol('almacen') }, async (req) =>
    ok(await inventarioService.transferir(req.ctx, parse(TransferenciaInput, req.body))),
  );

  /** GET /api/inventario/kardex — trazabilidad completa. */
  app.get('/kardex', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const f = parse(ListarInput, q);
    return ok(await inventarioService.kardex(req.ctx, { ...f, producto_id: q.producto_id, almacen_id: q.almacen_id }));
  });

  app.get('/alertas', async (req) => ok(await inventarioService.alertasReorden(req.ctx)));

  /** POST /api/inventario/reabastecer — genera requisiciones por punto de reorden. */
  app.post('/reabastecer', { preHandler: requiereRol('almacen', 'compras') }, async (req) =>
    ok(await inventarioService.generarReabastecimiento(req.ctx)),
  );
}
