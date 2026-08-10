import Link from 'next/link';
import { apiServidor } from '@/lib/api-servidor';
import type { Kpis, RequisicionResumen } from '@/lib/tipos';
import { Panel, Kpi, Tabla, Insignia, Vacio } from '@/components/ui';
import { n, dinero, fecha, etiqueta, tonoEstatus, haceRato } from '@/lib/formato';

export const dynamic = 'force-dynamic';

/** DASHBOARD 2 · COMPRAS — bandeja de requisiciones generadas por el flujo de faltantes. */
export default async function DashboardCompras() {
  const [kpis, requisiciones] = await Promise.all([
    apiServidor<Kpis>('dashboard/kpis?rol=compras'),
    apiServidor<RequisicionResumen[]>('compras/requisiciones?limite=50'),
  ]);

  const c = kpis.compras;
  const urgentes = requisiciones.filter((r) => r.prioridad === 'alta' || r.prioridad === 'urgente');

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Compras</h1>
          <p className="text-sm text-tenue">Requisiciones, cotización y seguimiento a proveedores</p>
        </div>
        <Link
          href="/compras/ordenes"
          className="rounded-lg border border-borde bg-lienzo px-3 py-1.5 text-sm font-medium hover:bg-acento-suave transition"
        >
          Ver órdenes de compra
        </Link>
      </header>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi
          etiqueta="Requisiciones abiertas"
          valor={n(c?.requisiciones_abiertas)}
          tono={c?.requisiciones_abiertas ? 'alerta' : 'neutro'}
          pie={urgentes.length ? `${urgentes.length} de prioridad alta` : undefined}
        />
        <Kpi etiqueta="Órdenes en tránsito" valor={n(c?.ordenes_en_transito)} />
        <Kpi etiqueta="Monto comprometido" valor={dinero(c?.monto_comprometido)} pie="OC no recibidas" />
        <Kpi etiqueta="Gasto 30 días" valor={dinero(c?.gasto_30d)} pie={`${n(c?.proveedores_activos)} proveedores activos`} />
      </div>

      <Panel
        titulo="Bandeja de requisiciones"
        accion={<span className="text-xs text-tenue">Generadas automáticamente al detectar faltante de stock</span>}
      >
        {requisiciones.length === 0 ? (
          <Vacio mensaje="No hay requisiciones pendientes. Todo el material solicitado tenía existencia." icono="✓" />
        ) : (
          <Tabla cabeceras={['Folio', 'Origen', 'Pedido', 'Estatus', 'Requerido', '#Líneas', '#Estimado', '']}>
            {requisiciones.map((r) => {
              const monto = r.items.reduce((a, i) => a + Number(i.cantidad) * Number(i.precio_estimado), 0);
              return (
                <tr key={r.id} className="hover:bg-lienzo transition">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{r.folio}</span>
                    <span className="block text-xs text-tenue">{haceRato(r.creado_en)}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Insignia tono={r.origen === 'faltante_stock' ? 'alerta' : 'neutro'}>
                      {r.origen === 'faltante_stock' ? 'Faltante de stock' : r.origen.replace(/_/g, ' ')}
                    </Insignia>
                  </td>
                  <td className="px-4 py-2.5 text-tenue text-xs">{r.pedido?.folio ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Insignia tono={tonoEstatus(r.estatus)}>{etiqueta(r.estatus)}</Insignia>
                  </td>
                  <td className="px-4 py-2.5 text-tenue">{fecha(r.fecha_requerida)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.items.length}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{dinero(monto)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/compras/requisiciones/${r.id}`} className="text-sm font-medium text-acento hover:underline">
                      Cotizar →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Tabla>
        )}
      </Panel>
    </div>
  );
}
