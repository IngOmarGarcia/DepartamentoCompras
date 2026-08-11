import type { FastifyInstance } from 'fastify';
import { catalogosService } from '../../core/catalogos.service.js';
import { dashboardService } from '../../core/dashboard.service.js';
import { requiereRol } from '../auth.js';
import { parse, ok, idRuta } from '../helpers.js';
import {
  CrearProductoInput, CrearCategoriaInput, CrearUnidadInput, ListarInput,
} from '../../schemas/index.js';
import type { Rol } from '../../types/domain.js';

export async function catalogosRoutes(app: FastifyInstance): Promise<void> {
  app.get('/productos', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const f = parse(ListarInput, q);
    return ok(await catalogosService.listarProductos(req.ctx, { ...f, categoria_id: q.categoria_id }), {
      limite: f.limite, offset: f.offset,
    });
  });

  /**
   * Alta y mantenimiento del catálogo. `requiereRol('almacen')` deja pasar
   * también a `admin` (ver la guardia): quien administra las existencias es
   * quien da de alta el producto, así que la pantalla de catálogos funciona
   * con cualquiera de los dos roles.
   */
  app.post('/productos', { preHandler: requiereRol('almacen') }, async (req) =>
    ok(await catalogosService.crearProducto(req.ctx, parse(CrearProductoInput, req.body))),
  );

  app.patch<{ Params: { id: string } }>('/productos/:id', { preHandler: requiereRol('almacen') }, async (req) =>
    ok(await catalogosService.actualizarProducto(req.ctx, idRuta(req.params.id), parse(CrearProductoInput.partial(), req.body))),
  );

  app.get('/almacenes', async (req) => ok(await catalogosService.listarAlmacenes(req.ctx)));

  app.get('/categorias', async (req) => ok(await catalogosService.listarCategorias(req.ctx)));

  app.post('/categorias', { preHandler: requiereRol('almacen') }, async (req) =>
    ok(await catalogosService.crearCategoria(req.ctx, parse(CrearCategoriaInput, req.body))),
  );

  app.get('/unidades', async (req) => ok(await catalogosService.listarUnidades(req.ctx)));

  app.post('/unidades', { preHandler: requiereRol('almacen') }, async (req) =>
    ok(await catalogosService.crearUnidad(req.ctx, parse(CrearUnidadInput, req.body))),
  );

  /** Esquema de atributos dinámicos → formularios generados en runtime. */
  app.get('/atributos', async (req) => {
    const q = req.query as { categoria_id?: string };
    return ok(await catalogosService.esquemaAtributos(req.ctx, q.categoria_id));
  });

  app.get('/reglas', { preHandler: requiereRol('admin') }, async (req) => ok(await catalogosService.reglas(req.ctx)));

  app.put<{ Params: { clave: string }; Body: { valor: unknown; descripcion?: string } }>(
    '/reglas/:clave',
    { preHandler: requiereRol('admin') },
    async (req) => ok(await catalogosService.actualizarRegla(req.ctx, req.params.clave, req.body.valor, req.body.descripcion)),
  );
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/dashboard?rol=almacen|compras|admin */
  app.get('/', async (req) => {
    const { rol } = req.query as { rol?: Rol };
    return ok(await dashboardService.resumen(req.ctx, rol));
  });

  app.get('/kpis', async (req) => {
    const { rol } = req.query as { rol?: Rol };
    return ok(await dashboardService.kpis(req.ctx, rol));
  });

  app.get('/actividad', async (req) => ok(await dashboardService.actividad(req.ctx)));

  app.get('/auditoria', { preHandler: requiereRol('admin') }, async (req) =>
    ok(await dashboardService.auditoria(req.ctx)),
  );
}
