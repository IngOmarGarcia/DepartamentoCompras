import Link from 'next/link';
import { apiServidor } from '@/lib/api-servidor';
import type { AlertaStock, Kpis, PedidoResumen } from '@/lib/tipos';
import { Panel, Kpi, Tabla, Insignia, Vacio, Avance } from '@/components/ui';
import { n, dinero, fecha, etiqueta, tonoEstatus } from '@/lib/formato';
import { BotonReabastecer } from './acciones';

export const dynamic = 'force-dynamic';

/** DASHBOARD 1 · ALMACÉN — control físico, cola de surtido y alertas de reorden. */
export default async function DashboardAlmacen() {
  const [kpis, cola, alertas] = await Promise.all([
    apiServidor<Kpis>('dashboard/kpis?rol=almacen'),
    apiServidor<PedidoResumen[]>('pedidos/cola/surtido'),
    apiServidor<AlertaStock[]>('inventario/alertas'),
  ]);

  const a = kpis.almacen;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Almacén</h1>
          <p className="text-sm text-tenue">Existencias, surtido y control de movimientos</p>
        </div>
        <div className="flex gap-2">
          <BotonReabastecer />
          <Link
            href="/almacen/movimientos"
            className="rounded-lg bg-acento px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition"
          >
            Registrar movimiento
          </Link>
        </div>
      </header>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi etiqueta="Pedidos por surtir" valor={n(a?.pedidos_por_surtir)} tono={a?.pedidos_por_surtir ? 'alerta' : 'neutro'} />
        <Kpi etiqueta="Bajo punto de reorden" valor={n(a?.bajo_minimo)} tono={a?.bajo_minimo ? 'riesgo' : 'ok'} pie="SKUs" />
        <Kpi etiqueta="Valor del inventario" valor={dinero(a?.valor_inventario)} pie="costo promedio" />
        <Kpi etiqueta="Unidades apartadas" valor={n(a?.unidades_reservadas)} pie={`${n(a?.movimientos_hoy)} movimientos hoy`} />
      </div>

      <Panel titulo="Cola de surtido" accion={<span className="text-xs text-tenue">{cola.length} pedidos con material apartado</span>}>
        {cola.length === 0 ? (
          <Vacio mensaje="No hay pedidos con material apartado pendiente de surtir." icono="✓" />
        ) : (
          <Tabla cabeceras={['Folio', 'Estatus', 'Requerido', 'Avance', '#Apartado', '']}>
            {cola.map((p) => (
              <tr key={p.id} className="hover:bg-lienzo transition">
                <td className="px-4 py-2.5 font-medium">{p.folio}</td>
                <td className="px-4 py-2.5">
                  <Insignia tono={tonoEstatus(p.estatus)}>{etiqueta(p.estatus)}</Insignia>
                </td>
                <td className="px-4 py-2.5 text-tenue">{fecha(p.fecha_requerida)}</td>
                <td className="px-4 py-2.5">
                  <Avance
                    solicitado={Number(p.total_solicitado)}
                    reservado={Number(p.total_reservado)}
                    surtido={Number(p.total_surtido)}
                  />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{n(p.total_reservado)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/almacen/surtir/${p.id}`} className="text-sm font-medium text-acento hover:underline">
                    Surtir →
                  </Link>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Panel>

      <Panel titulo="Alertas de reabastecimiento">
        {alertas.length === 0 ? (
          <Vacio mensaje="Todo el catálogo está por encima de su punto de reorden." icono="✓" />
        ) : (
          <Tabla cabeceras={['SKU', 'Producto', '#Disponible', '#Apartado', '#Punto reorden', 'Estado']}>
            {alertas.map((s) => (
              <tr key={s.producto_id} className="hover:bg-lienzo transition">
                <td className="px-4 py-2.5 font-mono text-xs">{s.sku}</td>
                <td className="px-4 py-2.5">{s.nombre}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                  {n(s.disponible_total)} <span className="text-tenue text-xs">{s.unidad}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{n(s.reservado_total)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{n(s.punto_reorden)}</td>
                <td className="px-4 py-2.5">
                  <Insignia tono={Number(s.disponible_total) <= 0 ? 'riesgo' : 'alerta'}>
                    {Number(s.disponible_total) <= 0 ? 'Agotado' : 'Bajo mínimo'}
                  </Insignia>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Panel>
    </div>
  );
}
