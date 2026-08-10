'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FalloApi } from '@/lib/api';
import type { PedidoDetalle } from '@/lib/tipos';
import { Panel, Tabla, Aviso, Vacio } from '@/components/ui';
import { Boton, claseInput } from '@/components/boton';
import { n } from '@/lib/formato';

/**
 * Surtido parcial o total. El backend valida que nunca se surta más de lo
 * apartado (SURTIDO_EXCEDE_RESERVA) y descuenta el stock físico.
 */
export function FormularioSurtido({ pedido }: { pedido: PedidoDetalle }) {
  const router = useRouter();

  const surtibles = useMemo(() => pedido.items.filter((i) => Number(i.cantidad_reservada) > 0), [pedido.items]);

  const [cantidades, setCantidades] = useState<Record<string, string>>(
    () => Object.fromEntries(surtibles.map((i) => [i.id, String(Number(i.cantidad_reservada))])),
  );
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const total = surtibles.reduce((acc, i) => acc + (Number(cantidades[i.id]) || 0), 0);

  async function enviar(todo: boolean) {
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      const items = todo
        ? undefined
        : surtibles
            .map((i) => ({ pedido_item_id: i.id, cantidad: Number(cantidades[i.id]) || 0 }))
            .filter((i) => i.cantidad > 0);

      if (!todo && (!items || items.length === 0)) throw new Error('Indica al menos una cantidad a surtir');

      const r = await api<{ surtido: number; pendiente: number; estatus: string }>(
        `pedidos/${pedido.id}/surtir`,
        { method: 'POST', body: items ? { items } : {} },
      );

      setExito(`Surtidas ${n(r.surtido)} unidades · pendiente ${n(r.pendiente)} · pedido ${r.estatus}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof FalloApi ? `${e.error.codigo}: ${e.error.mensaje}` : (e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  if (surtibles.length === 0) {
    return (
      <Panel titulo="Líneas del pedido">
        <Vacio mensaje="Este pedido no tiene material apartado. Está esperando la compra del faltante." icono="◷" />
      </Panel>
    );
  }

  return (
    <Panel
      titulo="Material apartado"
      accion={<span className="text-xs text-tenue">Total a surtir: {n(total)}</span>}
    >
      <Tabla cabeceras={['SKU', 'Producto', '#Solicitado', '#Apartado', '#En compra', 'A surtir']}>
        {surtibles.map((i) => (
          <tr key={i.id}>
            <td className="px-4 py-2.5 font-mono text-xs">{i.producto.sku}</td>
            <td className="px-4 py-2.5">{i.producto.nombre}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{n(i.cantidad_solicitada)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums font-medium">{n(i.cantidad_reservada)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{n(i.cantidad_en_compra)}</td>
            <td className="px-4 py-2 w-32">
              <input
                type="number"
                min={0}
                max={Number(i.cantidad_reservada)}
                step="any"
                className={`${claseInput} text-right tabular-nums`}
                value={cantidades[i.id] ?? ''}
                onChange={(e) => setCantidades((c) => ({ ...c, [i.id]: e.target.value }))}
              />
            </td>
          </tr>
        ))}
      </Tabla>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde px-4 py-3">
        <div className="flex-1 min-w-64 space-y-2">
          {error && <Aviso tono="riesgo">{error}</Aviso>}
          {exito && <Aviso tono="ok">{exito}</Aviso>}
        </div>
        <div className="flex gap-2">
          <Boton variante="suave" onClick={() => enviar(true)} cargando={cargando}>
            Surtir todo lo apartado
          </Boton>
          <Boton onClick={() => enviar(false)} cargando={cargando}>
            Surtir cantidades indicadas
          </Boton>
        </div>
      </div>
    </Panel>
  );
}
