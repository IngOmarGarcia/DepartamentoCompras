import { apiServidor } from '@/lib/api-servidor';
import type { Almacen, Producto } from '@/lib/tipos';
import { Panel, Tabla, Insignia } from '@/components/ui';
import { n, fechaHora } from '@/lib/formato';
import { FormularioMovimiento } from './formulario';

export const dynamic = 'force-dynamic';

interface FilaKardex {
  id: string;
  folio: string;
  creado_en: string;
  tipo: string;
  cantidad_neta: number;
  saldo_posterior: number;
  almacen_codigo: string;
  sku: string;
  producto: string;
  motivo: string | null;
}

/** Entradas, salidas, mermas y ajustes + kardex en vivo. */
export default async function Movimientos() {
  const [almacenes, productos, kardex] = await Promise.all([
    apiServidor<Almacen[]>('catalogos/almacenes'),
    apiServidor<Producto[]>('catalogos/productos?limite=200'),
    apiServidor<FilaKardex[]>('inventario/kardex?limite=40'),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Movimientos de inventario</h1>
        <p className="text-sm text-tenue">
          Una salida nunca puede consumir material ya apartado por un pedido: el motor lo bloquea.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr] items-start">
        <FormularioMovimiento almacenes={almacenes} productos={productos.filter((p) => p.es_inventariable)} />

        <Panel titulo="Kardex reciente">
          <Tabla cabeceras={['Fecha', 'Folio', 'Tipo', 'Producto', 'Almacén', '#Cantidad', '#Saldo']}>
            {kardex.map((m) => (
              <tr key={m.id} className="hover:bg-lienzo transition">
                <td className="px-4 py-2.5 text-tenue text-xs whitespace-nowrap">{fechaHora(m.creado_en)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{m.folio}</td>
                <td className="px-4 py-2.5">
                  <Insignia tono={Number(m.cantidad_neta) >= 0 ? 'ok' : m.tipo === 'merma' ? 'riesgo' : 'neutro'}>
                    {m.tipo.replace(/_/g, ' ')}
                  </Insignia>
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-tenue">{m.sku}</span> {m.producto}
                </td>
                <td className="px-4 py-2.5 text-tenue text-xs">{m.almacen_codigo}</td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                    Number(m.cantidad_neta) >= 0 ? 'text-ok' : 'text-riesgo'
                  }`}
                >
                  {Number(m.cantidad_neta) >= 0 ? '+' : ''}
                  {n(m.cantidad_neta)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{n(m.saldo_posterior)}</td>
              </tr>
            ))}
          </Tabla>
        </Panel>
      </div>
    </div>
  );
}
