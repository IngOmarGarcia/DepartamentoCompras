import Link from 'next/link';
import { apiServidor } from '@/lib/api-servidor';
import type { OrdenCompra } from '@/lib/tipos';
import { Panel, Tabla, Insignia, Vacio, Avance } from '@/components/ui';
import { dinero, fecha, etiqueta, tonoEstatus } from '@/lib/formato';

export const dynamic = 'force-dynamic';

export default async function Ordenes() {
  const ordenes = await apiServidor<OrdenCompra[]>('compras/ordenes?limite=50');

  return (
    <div className="space-y-5">
      <header>
        <Link href="/compras" className="text-xs text-tenue hover:text-acento">
          ← Compras
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Órdenes de compra</h1>
        <p className="text-sm text-tenue">Al recibir mercancía se re-valida automáticamente el stock de los pedidos en espera</p>
      </header>

      <Panel>
        {ordenes.length === 0 ? (
          <Vacio mensaje="Aún no se ha emitido ninguna orden de compra." />
        ) : (
          <Tabla cabeceras={['Folio', 'Proveedor', 'Estatus', 'Emisión', 'Promesa', 'Recepción', '#Total', '']}>
            {ordenes.map((o) => {
              const pedido = o.items.reduce((a, i) => a + Number(i.cantidad), 0);
              const recibido = o.items.reduce((a, i) => a + Number(i.cantidad_recibida), 0);
              const completa = o.estatus === 'recibida' || o.estatus === 'cancelada';
              return (
                <tr key={o.id} className="hover:bg-lienzo transition">
                  <td className="px-4 py-2.5 font-medium">{o.folio}</td>
                  <td className="px-4 py-2.5">{o.proveedor?.razon_social ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Insignia tono={tonoEstatus(o.estatus)}>{etiqueta(o.estatus)}</Insignia>
                  </td>
                  <td className="px-4 py-2.5 text-tenue">{fecha(o.fecha_emision)}</td>
                  <td className="px-4 py-2.5 text-tenue">{fecha(o.fecha_promesa)}</td>
                  <td className="px-4 py-2.5">
                    <Avance solicitado={pedido} reservado={0} surtido={recibido} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{dinero(o.total)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {!completa && (
                      <Link href={`/compras/ordenes/${o.id}`} className="text-sm font-medium text-acento hover:underline">
                        Recibir →
                      </Link>
                    )}
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
