'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FalloApi } from '@/lib/api';
import type { Almacen, RequisicionResumen, Sugerencia } from '@/lib/tipos';
import { Panel, Tabla, Aviso, Insignia } from '@/components/ui';
import { Boton, Campo, claseInput } from '@/components/boton';
import { n, dinero } from '@/lib/formato';

const IVA = 0.16;

/**
 * Aprueba la requisición y emite la orden de compra.
 * Las cantidades se acotan al pendiente por ordenar; el backend rechaza
 * cualquier exceso con CANTIDAD_EXCEDE_REQUISICION.
 */
export function GeneradorOrden({
  requisicion,
  sugerencias,
  almacenes,
}: {
  requisicion: RequisicionResumen;
  sugerencias: Sugerencia[];
  almacenes: Almacen[];
}) {
  const router = useRouter();

  const pendientes = useMemo(
    () => requisicion.items.filter((i) => Number(i.cantidad) - Number(i.cantidad_ordenada) > 0),
    [requisicion.items],
  );

  const sugPorItem = useMemo(() => new Map(sugerencias.map((s) => [s.requisicion_item_id, s])), [sugerencias]);

  const proveedoresDisponibles = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sugerencias) {
      for (const o of s.opciones) {
        if (o.proveedor) m.set(o.proveedor_id, `${o.proveedor.codigo} — ${o.proveedor.razon_social}`);
      }
    }
    return [...m.entries()];
  }, [sugerencias]);

  const [proveedor, setProveedor] = useState(proveedoresDisponibles[0]?.[0] ?? '');
  const [almacen, setAlmacen] = useState(requisicion.items[0]?.almacen_destino ?? almacenes[0]?.id ?? '');
  const [promesa, setPromesa] = useState('');
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>(
    () => Object.fromEntries(pendientes.map((i) => [i.id, true])),
  );
  const [cantidades, setCantidades] = useState<Record<string, string>>(
    () => Object.fromEntries(pendientes.map((i) => [i.id, String(Number(i.cantidad) - Number(i.cantidad_ordenada))])),
  );
  const [precios, setPrecios] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        pendientes.map((i) => {
          const s = sugPorItem.get(i.id);
          return [i.id, String(s?.mejor_opcion?.precio ?? Number(i.precio_estimado))];
        }),
      ),
  );

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const subtotal = pendientes.reduce(
    (acc, i) => (seleccion[i.id] ? acc + (Number(cantidades[i.id]) || 0) * (Number(precios[i.id]) || 0) : acc),
    0,
  );

  async function aprobar(aprobar: boolean) {
    setCargando(true);
    setError(null);
    try {
      await api(`compras/requisiciones/${requisicion.id}/aprobar`, {
        method: 'POST',
        body: { aprobar, motivo: aprobar ? undefined : 'Rechazada desde el panel de compras' },
      });
      setExito(aprobar ? 'Requisición aprobada' : 'Requisición rechazada — el pedido libera su cantidad en compra');
      router.refresh();
    } catch (e) {
      setError(e instanceof FalloApi ? `${e.error.codigo}: ${e.error.mensaje}` : (e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function emitir(enviar: boolean) {
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      const items = pendientes
        .filter((i) => seleccion[i.id] && Number(cantidades[i.id]) > 0)
        .map((i) => ({
          requisicion_item_id: i.id,
          cantidad: Number(cantidades[i.id]),
          precio_unitario: Number(precios[i.id]) || 0,
          tasa_impuesto: IVA,
        }));

      if (items.length === 0) throw new Error('Selecciona al menos una línea');
      if (!proveedor) throw new Error('Selecciona un proveedor');

      const r = await api<{ folio: string; total: number }>('compras/ordenes', {
        method: 'POST',
        body: {
          proveedor_id: proveedor,
          requisicion_id: requisicion.id,
          almacen_destino: almacen,
          fecha_promesa: promesa || undefined,
          estatus: enviar ? 'enviada' : 'borrador',
          items,
        },
      });

      setExito(`Orden ${r.folio} creada por ${dinero(r.total)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof FalloApi ? `${e.error.codigo}: ${e.error.mensaje}` : (e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  if (pendientes.length === 0) {
    return (
      <Panel titulo="Líneas">
        <div className="px-4 py-8 text-center text-sm text-tenue">
          Todas las líneas de esta requisición ya fueron ordenadas.
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {requisicion.estatus === 'abierta' && (
        <Panel titulo="Aprobación">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-tenue">
              La regla <code className="text-xs">requiere_aprobacion_requisicion</code> exige aprobar antes de emitir la orden.
            </p>
            <div className="flex gap-2">
              <Boton variante="peligro" onClick={() => aprobar(false)} cargando={cargando}>
                Rechazar
              </Boton>
              <Boton onClick={() => aprobar(true)} cargando={cargando}>
                Aprobar
              </Boton>
            </div>
          </div>
        </Panel>
      )}

      <Panel titulo="Líneas por comprar" accion={<span className="text-xs text-tenue">Precio sugerido = proveedor más barato vigente</span>}>
        <Tabla cabeceras={['', 'SKU', 'Producto', '#Pendiente', '#Cantidad', '#Precio', '#Importe', 'Mejor opción']}>
          {pendientes.map((i) => {
            const s = sugPorItem.get(i.id);
            const pend = Number(i.cantidad) - Number(i.cantidad_ordenada);
            const importe = (Number(cantidades[i.id]) || 0) * (Number(precios[i.id]) || 0);
            return (
              <tr key={i.id} className={seleccion[i.id] ? '' : 'opacity-45'}>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={seleccion[i.id] ?? false}
                    onChange={(e) => setSeleccion((v) => ({ ...v, [i.id]: e.target.checked }))}
                    className="accent-acento"
                  />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{i.producto.sku}</td>
                <td className="px-4 py-2.5">{i.producto.nombre}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-tenue">{n(pend)}</td>
                <td className="px-2 py-2 w-28">
                  <input
                    type="number"
                    min={0}
                    max={pend}
                    step="any"
                    className={`${claseInput} text-right tabular-nums`}
                    value={cantidades[i.id] ?? ''}
                    onChange={(e) => setCantidades((v) => ({ ...v, [i.id]: e.target.value }))}
                  />
                </td>
                <td className="px-2 py-2 w-28">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className={`${claseInput} text-right tabular-nums`}
                    value={precios[i.id] ?? ''}
                    onChange={(e) => setPrecios((v) => ({ ...v, [i.id]: e.target.value }))}
                  />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{dinero(importe)}</td>
                <td className="px-4 py-2.5">
                  {s?.mejor_opcion?.proveedor ? (
                    <span className="text-xs">
                      {s.mejor_opcion.proveedor.codigo}
                      <span className="block text-tenue">
                        {dinero(s.mejor_opcion.precio)} · {s.mejor_opcion.lead_time_dias} d
                      </span>
                    </span>
                  ) : (
                    <Insignia tono="alerta">Sin precio vigente</Insignia>
                  )}
                </td>
              </tr>
            );
          })}
        </Tabla>
      </Panel>

      <Panel titulo="Emitir orden de compra">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Campo etiqueta="Proveedor">
            <select className={claseInput} value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
              {proveedoresDisponibles.length === 0 && <option value="">Sin proveedores con precio</option>}
              {proveedoresDisponibles.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Almacén destino">
            <select className={claseInput} value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo} — {a.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Fecha promesa">
            <input type="date" className={claseInput} value={promesa} onChange={(e) => setPromesa(e.target.value)} />
          </Campo>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde px-4 py-3">
          <div className="text-sm">
            <span className="text-tenue">Subtotal </span>
            <span className="font-medium tabular-nums">{dinero(subtotal)}</span>
            <span className="text-tenue"> · IVA </span>
            <span className="tabular-nums">{dinero(subtotal * IVA)}</span>
            <span className="text-tenue"> · Total </span>
            <span className="font-semibold tabular-nums">{dinero(subtotal * (1 + IVA))}</span>
          </div>
          <div className="flex gap-2">
            <Boton variante="suave" onClick={() => emitir(false)} cargando={cargando}>
              Guardar borrador
            </Boton>
            <Boton onClick={() => emitir(true)} cargando={cargando}>
              Emitir y enviar
            </Boton>
          </div>
        </div>

        {(error || exito) && (
          <div className="border-t border-borde px-4 py-3 space-y-2">
            {error && <Aviso tono="riesgo">{error}</Aviso>}
            {exito && <Aviso tono="ok">{exito}</Aviso>}
          </div>
        )}
      </Panel>
    </div>
  );
}
