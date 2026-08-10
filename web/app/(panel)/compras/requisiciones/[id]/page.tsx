import Link from 'next/link';
import { apiServidor } from '@/lib/api-servidor';
import type { RequisicionResumen, Sugerencia, Almacen } from '@/lib/tipos';
import { Panel, Insignia } from '@/components/ui';
import { etiqueta, fecha, tonoEstatus } from '@/lib/formato';
import { GeneradorOrden } from './generador';

export const dynamic = 'force-dynamic';

/** Cotización: requisición → sugerencia de proveedor → emisión de OC. */
export default async function DetalleRequisicion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [req, sugerencias, almacenes] = await Promise.all([
    apiServidor<RequisicionResumen>(`compras/requisiciones/${id}`),
    apiServidor<Sugerencia[]>(`compras/requisiciones/${id}/sugerencias`),
    apiServidor<Almacen[]>('catalogos/almacenes'),
  ]);

  return (
    <div className="space-y-5 max-w-5xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/compras" className="text-xs text-tenue hover:text-acento">
            ← Bandeja de requisiciones
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{req.folio}</h1>
          <p className="text-sm text-tenue">
            {req.origen === 'faltante_stock' ? 'Generada por faltante de stock' : req.origen.replace(/_/g, ' ')} · requerido{' '}
            {fecha(req.fecha_requerida)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Insignia tono={req.prioridad === 'urgente' || req.prioridad === 'alta' ? 'riesgo' : 'neutro'}>
            Prioridad {req.prioridad}
          </Insignia>
          <Insignia tono={tonoEstatus(req.estatus)}>{etiqueta(req.estatus)}</Insignia>
        </div>
      </header>

      <GeneradorOrden requisicion={req} sugerencias={sugerencias} almacenes={almacenes} />
    </div>
  );
}
