import Link from 'next/link';
import { apiServidor } from '@/lib/api-servidor';
import type { OrdenCompra } from '@/lib/tipos';
import { Panel, Insignia } from '@/components/ui';
import { dinero, fecha, etiqueta, tonoEstatus } from '@/lib/formato';
import { FormularioRecepcion } from './formulario';

export const dynamic = 'force-dynamic';

interface OrdenDetalle extends OrdenCompra {
  almacen: { id: string; codigo: string; nombre: string } | null;
  recepciones: Array<{ id: string; folio: string; factura_ref: string | null; creado_en: string }>;
}

/** Recepción de mercancía: entrada a inventario + re-validación de pedidos en espera. */
export default async function DetalleOrden({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oc = await apiServidor<OrdenDetalle>(`compras/ordenes/${id}`);

  return (
    <div className="space-y-5 max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/compras/ordenes" className="text-xs text-tenue hover:text-acento">
            ← Órdenes de compra
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{oc.folio}</h1>
          <p className="text-sm text-tenue">
            {oc.proveedor?.razon_social} · destino {oc.almacen?.codigo ?? '—'} · promesa {fecha(oc.fecha_promesa)}
          </p>
        </div>
        <div className="text-right">
          <Insignia tono={tonoEstatus(oc.estatus)}>{etiqueta(oc.estatus)}</Insignia>
          <p className="mt-1 text-lg font-semibold tabular-nums">{dinero(oc.total)}</p>
        </div>
      </header>

      <FormularioRecepcion orden={oc} />

      {oc.recepciones.length > 0 && (
        <Panel titulo="Recepciones previas">
          <ul className="divide-y divide-borde">
            {oc.recepciones.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-medium">{r.folio}</span>
                <span className="text-tenue text-xs">
                  {r.factura_ref ? `Factura ${r.factura_ref} · ` : ''}
                  {fecha(r.creado_en)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
