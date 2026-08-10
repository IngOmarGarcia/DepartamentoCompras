import type { FastifyInstance } from 'fastify';
import { comprasService } from '../../core/compras.service.js';
import { requiereRol } from '../auth.js';
import { parse, ok } from '../helpers.js';
import {
  AprobarRequisicionInput, CrearOrdenCompraInput, RecibirOrdenCompraInput, ListarInput,
} from '../../schemas/index.js';

export async function comprasRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requiereRol('compras'));

  /** GET /api/compras/requisiciones — bandeja generada por el flujo de faltantes. */
  app.get('/requisiciones', async (req) => {
    const f = parse(ListarInput, req.query);
    return ok(await comprasService.listarRequisiciones(req.ctx, f), { limite: f.limite, offset: f.offset });
  });

  app.get<{ Params: { id: string } }>('/requisiciones/:id', async (req) =>
    ok(await comprasService.obtenerRequisicion(req.ctx, req.params.id)),
  );

  /** GET /api/compras/requisiciones/:id/sugerencias — mejor proveedor por línea. */
  app.get<{ Params: { id: string } }>('/requisiciones/:id/sugerencias', async (req) =>
    ok(await comprasService.sugerirProveedores(req.ctx, req.params.id)),
  );

  app.post<{ Params: { id: string } }>('/requisiciones/:id/aprobar', async (req) => {
    const input = parse(AprobarRequisicionInput, {
      requisicion_id: req.params.id,
      aprobador_id: req.ctx.usuarioId ?? undefined,
      ...(req.body as object),
    });
    return ok(await comprasService.aprobarRequisicion(req.ctx, input));
  });

  /** POST /api/compras/ordenes — emite OC contra una requisición. */
  app.post('/ordenes', async (req) => ok(await comprasService.crearOrdenCompra(req.ctx, parse(CrearOrdenCompraInput, req.body))));

  app.get('/ordenes', async (req) => {
    const f = parse(ListarInput, req.query);
    return ok(await comprasService.listarOrdenes(req.ctx, f), { limite: f.limite, offset: f.offset });
  });

  app.get<{ Params: { id: string } }>('/ordenes/:id', async (req) =>
    ok(await comprasService.obtenerOrden(req.ctx, req.params.id)),
  );

  app.patch<{ Params: { id: string }; Body: { estatus: 'enviada' | 'confirmada' | 'cancelada' } }>(
    '/ordenes/:id/estatus',
    async (req) => ok(await comprasService.cambiarEstatusOrden(req.ctx, req.params.id, req.body.estatus)),
  );

  /**
   * POST /api/compras/ordenes/:id/recepcion
   * Entrada a almacén + costo promedio + cierre de requisición
   * + RE-VALIDACIÓN automática de los pedidos que esperaban ese material.
   */
  app.post<{ Params: { id: string } }>('/ordenes/:id/recepcion', async (req) => {
    const input = parse(RecibirOrdenCompraInput, { orden_compra_id: req.params.id, ...(req.body as object) });
    return ok(await comprasService.recibirOrdenCompra(req.ctx, input));
  });

  app.get('/proveedores', async (req) => {
    const f = parse(ListarInput, req.query);
    return ok(await comprasService.listarProveedores(req.ctx, f), { limite: f.limite, offset: f.offset });
  });
}
