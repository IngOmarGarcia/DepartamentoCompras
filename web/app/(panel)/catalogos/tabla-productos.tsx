'use client';

import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FalloApi } from '@/lib/api';
import type { Almacen, Producto, ResultadoExistencia, StockProducto } from '@/lib/tipos';
import { Panel, Tabla, Insignia, Aviso, Vacio } from '@/components/ui';
import { Boton, Campo, claseInput } from '@/components/boton';
import { n } from '@/lib/formato';

const mensajeError = (e: unknown) =>
  e instanceof FalloApi ? `${e.error.codigo}: ${e.error.mensaje}` : (e as Error).message;

/**
 * Catálogo con su existencia real al lado. Cada renglón se abre para dos
 * cosas: fijar la existencia de un almacén (conteo físico) y ajustar los
 * umbrales que disparan el reabastecimiento.
 */
export function TablaProductos({
  productos,
  stock,
  almacenes,
}: {
  productos: Producto[];
  stock: StockProducto[];
  almacenes: Almacen[];
}) {
  const [busqueda, setBusqueda] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const porProducto = useMemo(() => new Map(stock.map((s) => [s.producto_id, s])), [stock]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) =>
      [p.sku, p.nombre, p.categoria?.nombre ?? '', p.categoria?.codigo ?? ''].some((c) =>
        c.toLowerCase().includes(q),
      ),
    );
  }, [productos, busqueda]);

  return (
    <Panel
      titulo={`Catálogo · ${productos.length} producto${productos.length === 1 ? '' : 's'}`}
      accion={
        <input
          className={`${claseInput} w-48`}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar SKU, nombre…"
        />
      }
    >
      {visibles.length === 0 ? (
        <Vacio mensaje={productos.length === 0 ? 'Aún no hay productos. Da de alta el primero.' : 'Sin coincidencias.'} />
      ) : (
        <Tabla cabeceras={['SKU', 'Producto', 'Unidad', '#Existencia', '#Disponible', '#Mín / Reorden', 'Estado', '']}>
          {visibles.map((p) => {
            const s = porProducto.get(p.id);
            const bajo = s?.requiere_reorden ?? false;
            const expandido = abierto === p.id;

            return (
              <Fragment key={p.id}>
                <tr className="hover:bg-lienzo transition">
                  <td className="px-4 py-2.5 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-2.5">
                    {p.nombre}
                    {p.categoria && <span className="ml-2 text-xs text-tenue">{p.categoria.nombre}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-tenue">{p.unidad?.codigo ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {p.es_inventariable ? n(s?.total ?? 0) : '—'}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${bajo ? 'text-alerta font-medium' : 'text-tenue'}`}
                  >
                    {p.es_inventariable ? n(s?.disponible ?? 0) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs text-tenue">
                    {n(p.stock_minimo)} / {n(p.punto_reorden)}
                  </td>
                  <td className="px-4 py-2.5">
                    {!p.activo ? (
                      <Insignia tono="neutro">Inactivo</Insignia>
                    ) : !p.es_inventariable ? (
                      <Insignia tono="acento">Servicio</Insignia>
                    ) : bajo ? (
                      <Insignia tono="alerta">Bajo reorden</Insignia>
                    ) : (
                      <Insignia tono="ok">Activo</Insignia>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setAbierto(expandido ? null : p.id)}
                      className="text-xs text-acento hover:underline"
                    >
                      {expandido ? 'Cerrar' : 'Editar'}
                    </button>
                  </td>
                </tr>

                {expandido && (
                  <tr>
                    <td colSpan={8} className="bg-lienzo px-4 py-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        {p.es_inventariable && (
                          <AjusteExistencia producto={p} stock={s} almacenes={almacenes} />
                        )}
                        <EdicionProducto producto={p} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </Tabla>
      )}
    </Panel>
  );
}

/** Fija la existencia de un almacén al número contado; el backend calcula el ajuste. */
function AjusteExistencia({
  producto,
  stock,
  almacenes,
}: {
  producto: Producto;
  stock: StockProducto | undefined;
  almacenes: Almacen[];
}) {
  const router = useRouter();
  const [almacen, setAlmacen] = useState(almacenes[0]?.id ?? '');
  const [cantidad, setCantidad] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const fila = stock?.por_almacen.find((a) => a.almacen_id === almacen);
  const actual = fila?.cantidad ?? 0;
  const reservado = fila?.reservado ?? 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      const r = await api<ResultadoExistencia>('inventario/existencias', {
        method: 'POST',
        body: {
          almacen_id: almacen,
          producto_id: producto.id,
          cantidad: Number(cantidad),
          motivo: 'Conteo desde catálogos',
        },
      });
      setExito(
        r.movimiento
          ? `${n(r.cantidad_anterior)} → ${n(r.cantidad_final)} (${r.delta > 0 ? '+' : ''}${n(r.delta)})`
          : 'La existencia ya era esa; sin movimiento',
      );
      setCantidad('');
      router.refresh();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-3 rounded-lg border border-borde bg-panel p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-tenue">Existencias</p>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Almacén">
          <select className={claseInput} value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
            {almacenes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.codigo} — {a.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Cantidad contada" hint={`hoy: ${n(actual)}${reservado > 0 ? ` · ${n(reservado)} apartado` : ''}`}>
          <input
            type="number"
            min="0"
            step="any"
            required
            className={`${claseInput} text-right tabular-nums`}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            placeholder={String(actual)}
          />
        </Campo>
      </div>

      {error && <Aviso tono="riesgo">{error}</Aviso>}
      {exito && <Aviso tono="ok">{exito}</Aviso>}

      <Boton type="submit" variante="suave" cargando={cargando} className="w-full">
        Fijar existencia
      </Boton>
    </form>
  );
}

/** Umbrales de reabastecimiento y alta/baja lógica del producto. */
function EdicionProducto({ producto }: { producto: Producto }) {
  const router = useRouter();
  const [minimo, setMinimo] = useState(String(producto.stock_minimo));
  const [reorden, setReorden] = useState(String(producto.punto_reorden));
  const [lead, setLead] = useState(String(producto.lead_time_dias));
  const [activo, setActivo] = useState(producto.activo);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      await api(`catalogos/productos/${producto.id}`, {
        method: 'PATCH',
        body: {
          stock_minimo: Number(minimo),
          punto_reorden: Number(reorden),
          lead_time_dias: Number(lead),
          activo,
        },
      });
      setExito('Guardado');
      router.refresh();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-3 rounded-lg border border-borde bg-panel p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-tenue">Reabastecimiento</p>

      <div className="grid grid-cols-3 gap-3">
        <Campo etiqueta="Mínimo">
          <input
            type="number"
            min="0"
            step="any"
            className={`${claseInput} text-right tabular-nums`}
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Reorden">
          <input
            type="number"
            min="0"
            step="any"
            className={`${claseInput} text-right tabular-nums`}
            value={reorden}
            onChange={(e) => setReorden(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Lead time">
          <input
            type="number"
            min="0"
            className={`${claseInput} text-right tabular-nums`}
            value={lead}
            onChange={(e) => setLead(e.target.value)}
          />
        </Campo>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
          className="h-4 w-4 accent-acento"
        />
        Producto activo
      </label>

      {error && <Aviso tono="riesgo">{error}</Aviso>}
      {exito && <Aviso tono="ok">{exito}</Aviso>}

      <Boton type="submit" variante="suave" cargando={cargando} className="w-full">
        Guardar cambios
      </Boton>
    </form>
  );
}
