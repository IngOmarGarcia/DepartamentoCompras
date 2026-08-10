'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FalloApi } from '@/lib/api';
import type { OrdenCompra, ResultadoValidacion } from '@/lib/tipos';
import { Panel, Tabla, Aviso, Vacio, Insignia } from '@/components/ui';
import { Boton, Campo, claseInput } from '@/components/boton';
import { n, dinero } from '@/lib/formato';

interface Resultado {
  folio: string;
  estatus_oc: string;
  pendiente: number;
  pedidos_reprocesados: ResultadoValidacion[];
}

/**
 * Registra la entrada física. El backend, en la misma transacción:
 * inventario ↑, costo promedio recalculado, requisición cerrada y
 * re-validación de los pedidos que esperaban el material.
 */
export function FormularioRecepcion({ orden }: { orden: OrdenCompra }) {
  const router = useRouter();

  const pendientes = useMemo(
    () => orden.items.filter((i) => Number(i.cantidad) - Number(i.cantidad_recibida) > 0),
    [orden.items],
  );

  const [cantidades, setCantidades] = useState<Record<string, string>>(
    () => Object.fromEntries(pendientes.map((i) => [i.id, String(Number(i.cantidad) - Number(i.cantidad_recibida))])),
  );
  const [lotes, setLotes] = useState<Record<string, string>>({});
  const [factura, setFactura] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function recibir() {
    setCargando(true);
    setError(null);
    setResultado(null);
    try {
      const items = pendientes
        .map((i) => ({
          orden_compra_item_id: i.id,
          cantidad: Number(cantidades[i.id]) || 0,
          costo_unitario: Number(i.precio_unitario),
          lote: lotes[i.id] || undefined,
        }))
        .filter((i) => i.cantidad > 0);

      if (items.length === 0) throw new Error('Indica al menos una cantidad recibida');

      const r = await api<Resultado>(`compras/ordenes/${orden.id}/recepcion`, {
        method: 'POST',
        body: { items, factura_ref: factura || undefined },
      });
      setResultado(r);
      router.refresh();
    } catch (e) {
      setError(e instanceof FalloApi ? `${e.error.codigo}: ${e.error.mensaje}` : (e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  if (pendientes.length === 0) {
    return (
      <Panel titulo="Recepción">
        <Vacio mensaje="Esta orden ya fue recibida en su totalidad." icono="✓" />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel titulo="Mercancía por recibir">
        <Tabla cabeceras={['SKU', 'Producto', '#Ordenado', '#Recibido', '#A recibir', 'Lote', '#Costo']}>
          {pendientes.map((i) => (
            <tr key={i.id}>
              <td className="px-4 py-2.5 font-mono text-xs">{i.producto.sku}</td>
              <td className="px-4 py-2.5">{i.producto.nombre}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{n(i.cantidad)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{n(i.cantidad_recibida)}</td>
              <td className="px-2 py-2 w-28">
                <input
                  type="number"
                  min={0}
                  max={Number(i.cantidad) - Number(i.cantidad_recibida)}
                  step="any"
                  className={`${claseInput} text-right tabular-nums`}
                  value={cantidades[i.id] ?? ''}
                  onChange={(e) => setCantidades((v) => ({ ...v, [i.id]: e.target.value }))}
                />
              </td>
              <td className="px-2 py-2 w-32">
                <input
                  className={claseInput}
                  placeholder="opcional"
                  value={lotes[i.id] ?? ''}
                  onChange={(e) => setLotes((v) => ({ ...v, [i.id]: e.target.value }))}
                />
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{dinero(i.precio_unitario)}</td>
            </tr>
          ))}
        </Tabla>

        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-borde px-4 py-3">
          <div className="w-56">
            <Campo etiqueta="Referencia de factura" hint="opcional">
              <input className={claseInput} value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="FAC-A-1001" />
            </Campo>
          </div>
          <Boton onClick={recibir} cargando={cargando}>
            Registrar recepción
          </Boton>
        </div>

        {error && (
          <div className="border-t border-borde px-4 py-3">
            <Aviso tono="riesgo">{error}</Aviso>
          </div>
        )}
      </Panel>

      {resultado && (
        <Panel titulo="Resultado de la recepción">
          <div className="space-y-3 p-4">
            <Aviso tono="ok">
              {resultado.folio} registrada · orden {resultado.estatus_oc} · pendiente {n(resultado.pendiente)}
            </Aviso>

            {resultado.pedidos_reprocesados.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-tenue uppercase tracking-wide">
                  Pedidos re-validados automáticamente
                </p>
                {resultado.pedidos_reprocesados.map((p) => (
                  <div key={p.pedido_id} className="rounded-lg border border-borde p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">{p.folio}</span>
                      <Insignia tono="acento">{p.accion}</Insignia>
                      {p.notificar.map((d) => (
                        <Insignia key={d} tono="alerta">
                          notificar {d}
                        </Insignia>
                      ))}
                    </div>
                    {p.reservas.length > 0 && (
                      <p className="mt-1.5 text-xs text-tenue">
                        Apartadas {n(p.reservas.reduce((a, r) => a + Number(r.cantidad), 0))} unidades con el material
                        recién recibido.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-tenue">Ningún pedido estaba esperando este material.</p>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
