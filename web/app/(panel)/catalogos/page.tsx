import { apiServidor } from '@/lib/api-servidor';
import type { Almacen, Categoria, Producto, StockProducto, Unidad } from '@/lib/tipos';
import { Panel, Kpi, Insignia, Vacio } from '@/components/ui';
import { n } from '@/lib/formato';
import { AltaProducto } from './alta-producto';
import { TablaProductos } from './tabla-productos';

export const dynamic = 'force-dynamic';

/**
 * Configuración de productos y catálogos. Es el punto donde el sistema se
 * adapta al giro: categorías, unidades y productos se definen aquí en
 * runtime, sin tocar el esquema ni recompilar. Lo que se da de alta queda
 * disponible de inmediato para el formulario de pedidos.
 */
export default async function Catalogos() {
  const [productos, categorias, unidades, almacenes, stock] = await Promise.all([
    apiServidor<Producto[]>('catalogos/productos?limite=200'),
    apiServidor<Categoria[]>('catalogos/categorias'),
    apiServidor<Unidad[]>('catalogos/unidades'),
    apiServidor<Almacen[]>('catalogos/almacenes'),
    apiServidor<StockProducto[]>('inventario/stock'),
  ]);

  const inventariables = productos.filter((p) => p.es_inventariable).length;
  const bajoReorden = stock.filter((s) => s.requiere_reorden).length;
  const valor = productos.reduce((acc, p) => {
    const s = stock.find((x) => x.producto_id === p.id);
    return acc + Number(p.costo_promedio ?? 0) * Number(s?.total ?? 0);
  }, 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Productos y catálogos</h1>
        <p className="text-sm text-tenue">
          Todo lo específico de tu giro se define aquí — categorías, unidades y productos — sin tocar el código.
          Lo que des de alta aparece de inmediato en Pedidos.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi etiqueta="Productos" valor={productos.length} pie={`${inventariables} inventariables`} />
        <Kpi etiqueta="Categorías" valor={categorias.length} pie={`${unidades.length} unidades de medida`} />
        <Kpi
          etiqueta="Bajo punto de reorden"
          valor={bajoReorden}
          tono={bajoReorden > 0 ? 'alerta' : 'neutro'}
          pie={`${almacenes.length} almacén${almacenes.length === 1 ? '' : 'es'}`}
        />
        <Kpi etiqueta="Valor del inventario" valor={n(valor)} pie="costo promedio × existencia" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr] items-start">
        <div className="space-y-5">
          <AltaProducto categorias={categorias} unidades={unidades} almacenes={almacenes} />

          <Panel titulo="Categorías">
            {categorias.length === 0 ? (
              <Vacio mensaje="Sin categorías. Créalas desde el formulario de alta." />
            ) : (
              <ul className="divide-y divide-borde">
                {categorias.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span>
                      <span className="font-mono text-xs text-tenue">{c.ruta ?? c.codigo}</span> {c.nombre}
                    </span>
                    <span className="text-xs text-tenue tabular-nums">
                      {productos.filter((p) => p.categoria?.id === c.id).length}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel titulo="Unidades de medida">
            {unidades.length === 0 ? (
              <Vacio mensaje="Sin unidades. Crea al menos una para poder dar de alta productos." />
            ) : (
              <div className="flex flex-wrap gap-1.5 p-4">
                {unidades.map((u) => (
                  <Insignia key={u.id} tono="neutro">
                    {u.codigo} · {u.nombre}
                  </Insignia>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <TablaProductos productos={productos} stock={stock} almacenes={almacenes} />
      </div>
    </div>
  );
}
