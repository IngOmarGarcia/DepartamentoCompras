'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, FalloApi } from '@/lib/api';
import type { Almacen, Producto, ResultadoValidacion } from '@/lib/tipos';
import { Panel, Tabla, Aviso, Insignia, Kpi } from '@/components/ui';
import { Boton, Campo, claseInput } from '@/components/boton';
import { n } from '@/lib/formato';

interface Linea {
  clave: number;
  producto_id: string;
  cantidad: string;
  notas: string;
}

let contador = 0;
const nuevaLinea = (producto_id: string): Linea => ({ clave: ++contador, producto_id, cantidad: '', notas: '' });

export function FormularioPedido({ productos, almacenes }: { productos: Producto[]; almacenes: Almacen[] }) {
  const [origen, setOrigen] = useState('interno');
  const [referencia, setReferencia] = useState('');
  const [centroCosto, setCentroCosto] = useState('');
  const [prioridad, setPrioridad] = useState('normal');
  const [almacen, setAlmacen] = useState('');
  const [fechaReq, setFechaReq] = useState('');
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([nuevaLinea(productos[0]?.id ?? '')]);

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoValidacion | null>(null);

  function actualizar(clave: number, campo: keyof Linea, valor: string) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setResultado(null);
    try {
      const items = lineas
        .filter((l) => l.producto_id && Number(l.cantidad) > 0)
        .map((l) => ({ producto_id: l.producto_id, cantidad: Number(l.cantidad), notas: l.notas || undefined }));

      if (items.length === 0) throw new Error('Agrega al menos una línea con cantidad');

      const r = await api<ResultadoValidacion>('pedidos', {
        method: 'POST',
        body: {
          origen,
          referencia_externa: referencia || undefined,
          centro_costo: centroCosto || undefined,
          almacen_preferente: almacen || undefined,
          prioridad,
          fecha_requerida: fechaReq || undefined,
          notas: notas || undefined,
          items,
          procesar: true,
        },
      });

      setResultado(r);
      setLineas([nuevaLinea(productos[0]?.id ?? '')]);
      setReferencia('');
      setNotas('');
    } catch (err) {
      setError(err instanceof FalloApi ? `${err.error.codigo}: ${err.error.mensaje}` : (err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="space-y-4">
      {resultado && <ResumenValidacion r={resultado} />}

      <form onSubmit={enviar} className="space-y-4">
        <Panel titulo="Datos del requerimiento">
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <Campo etiqueta="Origen">
              <select className={claseInput} value={origen} onChange={(e) => setOrigen(e.target.value)}>
                <option value="interno">Interno</option>
                <option value="venta">Venta</option>
                <option value="obra">Obra</option>
                <option value="api">API</option>
              </select>
            </Campo>
            <Campo etiqueta="Referencia externa" hint="orden de venta, obra, ticket…">
              <input className={claseInput} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </Campo>
            <Campo etiqueta="Centro de costo">
              <input className={claseInput} value={centroCosto} onChange={(e) => setCentroCosto(e.target.value)} />
            </Campo>
            <Campo etiqueta="Prioridad">
              <select className={claseInput} value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
                <option value="baja">Baja</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </Campo>
            <Campo etiqueta="Almacén preferente" hint="vacío = cualquiera, por prioridad">
              <select className={claseInput} value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
                <option value="">Automático</option>
                {almacenes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.codigo} — {a.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Fecha requerida">
              <input type="date" className={claseInput} value={fechaReq} onChange={(e) => setFechaReq(e.target.value)} />
            </Campo>
          </div>
        </Panel>

        <Panel
          titulo="Líneas"
          accion={
            <Boton
              type="button"
              variante="suave"
              onClick={() => setLineas((ls) => [...ls, nuevaLinea(productos[0]?.id ?? '')])}
            >
              + Agregar Producto
            </Boton>
          }
        >
          <Tabla cabeceras={['Producto', '#Cantidad', 'Notas', '']}>
            {lineas.map((l) => {
              const p = productos.find((x) => x.id === l.producto_id);
              return (
                <tr key={l.clave}>
                  <td className="px-4 py-2">
                    <select
                      className={claseInput}
                      value={l.producto_id}
                      onChange={(e) => actualizar(l.clave, 'producto_id', e.target.value)}
                    >
                      {productos.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.sku} — {prod.nombre}
                          {prod.es_inventariable ? '' : ' (servicio)'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 w-32">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className={`${claseInput} text-right tabular-nums`}
                      value={l.cantidad}
                      onChange={(e) => actualizar(l.clave, 'cantidad', e.target.value)}
                      placeholder={p?.unidad?.codigo ?? '0'}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className={claseInput}
                      value={l.notas}
                      onChange={(e) => actualizar(l.clave, 'notas', e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {lineas.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                        className="text-tenue hover:text-riesgo transition"
                        aria-label="Quitar línea"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Tabla>

          <div className="border-t border-borde p-4">
            <Campo etiqueta="Notas del pedido">
              <textarea className={claseInput} rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
            </Campo>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-borde px-4 py-3">
            {error ? <Aviso tono="riesgo">{error}</Aviso> : <span className="text-xs text-tenue">Se valida el stock al guardar</span>}
            <Boton type="submit" cargando={cargando}>
              Registrar y validar stock
            </Boton>
          </div>
        </Panel>
      </form>
    </div>
  );
}

/** Muestra exactamente qué decidió el motor: qué se apartó y qué se mandó a compras. */
function ResumenValidacion({ r }: { r: ResultadoValidacion }) {
  const apartado = r.reservas.reduce((a, x) => a + Number(x.cantidad), 0);

  return (
    <div className="space-y-3 animar">
      <Panel
        titulo={`Pedido ${r.folio} procesado`}
        accion={
          <div className="flex gap-1.5">
            {r.notificar.map((d) => (
              <Insignia key={d} tono={d === 'almacen' ? 'ok' : 'alerta'}>
                notificar {d}
              </Insignia>
            ))}
          </div>
        }
      >
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Kpi etiqueta="Solicitado" valor={n(r.total_solicitado)} />
          <Kpi etiqueta="Apartado en almacén" valor={n(apartado)} tono={apartado > 0 ? 'ok' : 'neutro'} />
          <Kpi
            etiqueta="Enviado a compras"
            valor={n(r.total_faltante)}
            tono={r.total_faltante > 0 ? 'alerta' : 'neutro'}
            pie={r.requisicion ? `${r.requisicion.folio} · ${r.requisicion.lineas} líneas` : undefined}
          />
        </div>

        {r.faltantes.length > 0 && (
          <div className="border-t border-borde px-4 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-tenue">Faltantes detectados</p>
            <ul className="space-y-1 text-sm">
              {r.faltantes.map((f) => (
                <li key={f.sku} className="flex justify-between gap-4">
                  <span>
                    <span className="font-mono text-xs text-tenue">{f.sku}</span> {f.nombre}
                  </span>
                  <span className="tabular-nums font-medium text-alerta">{n(f.cantidad_faltante)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-3 border-t border-borde px-4 py-3 text-sm">
          {apartado > 0 && (
            <Link href={`/almacen/surtir/${r.pedido_id}`} className="font-medium text-acento hover:underline">
              Ir a surtir en Almacén →
            </Link>
          )}
          {r.requisicion && (
            <Link href={`/compras/requisiciones/${r.requisicion.id}`} className="font-medium text-acento hover:underline">
              Ir a cotizar en Compras →
            </Link>
          )}
        </div>
      </Panel>
    </div>
  );
}
