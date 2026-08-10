import Link from 'next/link';
import { apiServidor } from '@/lib/api-servidor';
import type { PedidoDetalle } from '@/lib/tipos';
import { Panel, Insignia } from '@/components/ui';
import { etiqueta, fecha, tonoEstatus } from '@/lib/formato';
import { FormularioSurtido } from './formulario';

export const dynamic = 'force-dynamic';

/** Pantalla de surtido: convierte reservas en salida física. */
export default async function Surtir({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedido = await apiServidor<PedidoDetalle>(`pedidos/${id}`);

  return (
    <div className="space-y-5 max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/almacen" className="text-xs text-tenue hover:text-acento">
            ← Cola de surtido
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Surtir {pedido.folio}</h1>
          <p className="text-sm text-tenue">
            {pedido.referencia_externa ?? 'Sin referencia'} · {pedido.centro_costo ?? 'sin centro de costo'} · requerido{' '}
            {fecha(pedido.fecha_requerida)}
          </p>
        </div>
        <Insignia tono={tonoEstatus(pedido.estatus)}>{etiqueta(pedido.estatus)}</Insignia>
      </header>

      {pedido.notas && (
        <Panel titulo="Notas del solicitante">
          <p className="px-4 py-3 text-sm text-tenue">{pedido.notas}</p>
        </Panel>
      )}

      <FormularioSurtido pedido={pedido} />

      {pedido.requisiciones.length > 0 && (
        <Panel titulo="Requisiciones derivadas">
          <ul className="divide-y divide-borde">
            {pedido.requisiciones.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-medium">{r.folio}</span>
                <Insignia tono={tonoEstatus(r.estatus)}>{etiqueta(r.estatus)}</Insignia>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
