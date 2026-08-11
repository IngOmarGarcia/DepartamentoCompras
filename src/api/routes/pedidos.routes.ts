import type { FastifyInstance } from 'fastify';
import { pedidosService } from '../../core/pedidos.service.js';
import { requiereRol } from '../auth.js';
import { parse, ok, idRuta } from '../helpers.js';
import {
  CrearPedidoInput, ProcesarPedidoInput, SurtirPedidoInput, CancelarPedidoInput, ListarInput,
} from '../../schemas/index.js';

export async function pedidosRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/pedidos
   * FLUJO COMPLETO: recibe el requerimiento → valida stock → aparta o requisita.
   * Respuesta incluye `accion`: NOTIFICAR_ALMACEN_SURTIR | NOTIFICAR_COMPRAS_COTIZAR | ...
   */
  app.post('/', async (req) => {
    const input = parse(CrearPedidoInput, req.body);
    const r = await pedidosService.recibir(req.ctx, input);
    return ok(r);
  });

  /** POST /api/pedidos/:id/validar — re-ejecuta la validación de stock. */
  app.post<{ Params: { id: string } }>('/:id/validar', async (req) => {
    const input = parse(ProcesarPedidoInput, { pedido_id: req.params.id, ...(req.body as object) });
    return ok(await pedidosService.validar(req.ctx, input.pedido_id, input.usuario_id));
  });

  /** POST /api/pedidos/:id/surtir — solo Almacén. Convierte reserva en salida real. */
  app.post<{ Params: { id: string } }>(
    '/:id/surtir',
    { preHandler: requiereRol('almacen') },
    async (req) => {
      const input = parse(SurtirPedidoInput, { pedido_id: req.params.id, ...(req.body as object) });
      return ok(await pedidosService.surtir(req.ctx, input));
    },
  );

  app.post<{ Params: { id: string } }>('/:id/cancelar', async (req) => {
    const input = parse(CancelarPedidoInput, { pedido_id: req.params.id, ...(req.body as object) });
    return ok(await pedidosService.cancelar(req.ctx, input));
  });

  app.get('/', async (req) => {
    const f = parse(ListarInput, req.query);
    return ok(await pedidosService.listar(req.ctx, f), { limite: f.limite, offset: f.offset });
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => ok(await pedidosService.obtener(req.ctx, idRuta(req.params.id))));

  /** GET /api/pedidos/cola/surtido — bandeja del dashboard de Almacén. */
  app.get('/cola/surtido', async (req) => ok(await pedidosService.colaSurtido(req.ctx)));

  /** POST /api/pedidos/reservas/liberar-expiradas — job de mantenimiento. */
  app.post('/reservas/liberar-expiradas', { preHandler: requiereRol('almacen') }, async () =>
    ok(await pedidosService.liberarExpiradas()),
  );
}
