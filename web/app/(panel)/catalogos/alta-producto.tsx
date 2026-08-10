'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FalloApi } from '@/lib/api';
import type { Almacen, Categoria, Producto, ResultadoExistencia, Unidad } from '@/lib/tipos';
import { Panel, Aviso } from '@/components/ui';
import { Boton, Campo, claseInput } from '@/components/boton';
import { n } from '@/lib/formato';

const mensajeError = (e: unknown) =>
  e instanceof FalloApi ? `${e.error.codigo}: ${e.error.mensaje}` : (e as Error).message;

const vacio = {
  sku: '',
  nombre: '',
  descripcion: '',
  categoria_id: '',
  es_inventariable: true,
  es_comprable: true,
  stock_minimo: '',
  punto_reorden: '',
  stock_maximo: '',
  lead_time_dias: '',
  ultimo_costo: '',
  almacen_id: '',
  cantidad_inicial: '',
};

/**
 * Alta de producto para cualquier giro: nada del formulario asume qué se
 * vende. Lo específico del negocio entra por categoría y unidad, ambas dadas
 * de alta aquí mismo, y por el stock inicial del almacén.
 */
export function AltaProducto({
  categorias,
  unidades,
  almacenes,
}: {
  categorias: Categoria[];
  unidades: Unidad[];
  almacenes: Almacen[];
}) {
  const router = useRouter();
  const [f, setF] = useState({ ...vacio, almacen_id: almacenes[0]?.id ?? '' });
  const [unidadId, setUnidadId] = useState(unidades[0]?.id ?? '');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string[] | null>(null);

  const set = (k: keyof typeof vacio, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const num = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setExito(null);

    try {
      if (unidades.length === 0) throw new Error('Crea primero una unidad de medida');

      const producto = await api<Producto>('catalogos/productos', {
        method: 'POST',
        body: {
          sku: f.sku.trim(),
          nombre: f.nombre.trim(),
          descripcion: f.descripcion.trim() || undefined,
          categoria_id: f.categoria_id || undefined,
          unidad_medida_id: unidadId,
          es_inventariable: f.es_inventariable,
          es_comprable: f.es_comprable,
          stock_minimo: num(f.stock_minimo) ?? 0,
          punto_reorden: num(f.punto_reorden) ?? 0,
          stock_maximo: num(f.stock_maximo),
          lead_time_dias: num(f.lead_time_dias) ?? 0,
          ultimo_costo: num(f.ultimo_costo) ?? 0,
        },
      });

      const lineas = [`Producto ${producto.sku} creado`];
      const inicial = num(f.cantidad_inicial);

      // El alta y la carga de stock son dos operaciones: si la segunda falla,
      // el producto YA existe. Se dice explícitamente en vez de mostrar error.
      if (f.es_inventariable && inicial && inicial > 0 && f.almacen_id) {
        try {
          const r = await api<ResultadoExistencia>('inventario/existencias', {
            method: 'POST',
            body: {
              almacen_id: f.almacen_id,
              producto_id: producto.id,
              cantidad: inicial,
              costo_unitario: num(f.ultimo_costo),
              motivo: 'Carga inicial desde catálogos',
            },
          });
          lineas.push(`Existencia inicial: ${n(r.cantidad_final)} (${r.movimiento?.folio ?? 'sin movimiento'})`);
        } catch (err) {
          lineas.push(`⚠ El producto se creó, pero el stock inicial falló — ${mensajeError(err)}`);
        }
      }

      setExito(lineas);
      setF({ ...vacio, almacen_id: f.almacen_id });
      router.refresh();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Panel titulo="Nuevo producto">
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-[130px_1fr] gap-3">
            <Campo etiqueta="SKU" hint="único">
              <input
                required
                className={`${claseInput} font-mono`}
                value={f.sku}
                onChange={(e) => set('sku', e.target.value)}
                placeholder="PRD-001"
              />
            </Campo>
            <Campo etiqueta="Nombre">
              <input required className={claseInput} value={f.nombre} onChange={(e) => set('nombre', e.target.value)} />
            </Campo>
          </div>

          <Campo etiqueta="Descripción" hint="opcional">
            <input className={claseInput} value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} />
          </Campo>

          <SelectorCategoria
            categorias={categorias}
            valor={f.categoria_id}
            alCambiar={(v) => set('categoria_id', v)}
          />

          <SelectorUnidad unidades={unidades} valor={unidadId} alCambiar={setUnidadId} />

          <div className="flex flex-wrap gap-4 pt-1">
            <Interruptor
              etiqueta="Se inventaría"
              hint="apagado = servicio o gasto directo"
              valor={f.es_inventariable}
              alCambiar={(v) => set('es_inventariable', v)}
            />
            <Interruptor etiqueta="Se compra" valor={f.es_comprable} alCambiar={(v) => set('es_comprable', v)} />
          </div>
        </div>
      </Panel>

      <Panel titulo="Reabastecimiento">
        <div className="grid grid-cols-2 gap-3 p-4">
          <Campo etiqueta="Stock mínimo">
            <input
              type="number"
              min="0"
              step="any"
              className={`${claseInput} text-right tabular-nums`}
              value={f.stock_minimo}
              onChange={(e) => set('stock_minimo', e.target.value)}
              placeholder="0"
            />
          </Campo>
          <Campo etiqueta="Punto de reorden" hint="dispara requisición">
            <input
              type="number"
              min="0"
              step="any"
              className={`${claseInput} text-right tabular-nums`}
              value={f.punto_reorden}
              onChange={(e) => set('punto_reorden', e.target.value)}
              placeholder="0"
            />
          </Campo>
          <Campo etiqueta="Stock máximo" hint="opcional">
            <input
              type="number"
              min="0"
              step="any"
              className={`${claseInput} text-right tabular-nums`}
              value={f.stock_maximo}
              onChange={(e) => set('stock_maximo', e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Lead time (días)">
            <input
              type="number"
              min="0"
              className={`${claseInput} text-right tabular-nums`}
              value={f.lead_time_dias}
              onChange={(e) => set('lead_time_dias', e.target.value)}
              placeholder="0"
            />
          </Campo>
        </div>
      </Panel>

      {f.es_inventariable && (
        <Panel titulo="Existencia inicial">
          <div className="grid grid-cols-2 gap-3 p-4">
            <Campo etiqueta="Almacén">
              <select className={claseInput} value={f.almacen_id} onChange={(e) => set('almacen_id', e.target.value)}>
                {almacenes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.codigo} — {a.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Cantidad" hint="vacío = sin stock">
              <input
                type="number"
                min="0"
                step="any"
                className={`${claseInput} text-right tabular-nums`}
                value={f.cantidad_inicial}
                onChange={(e) => set('cantidad_inicial', e.target.value)}
              />
            </Campo>
            <div className="col-span-2">
              <Campo etiqueta="Costo unitario" hint="alimenta el costo promedio del inventario">
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={`${claseInput} text-right tabular-nums`}
                  value={f.ultimo_costo}
                  onChange={(e) => set('ultimo_costo', e.target.value)}
                />
              </Campo>
            </div>
          </div>
        </Panel>
      )}

      {error && <Aviso tono="riesgo">{error}</Aviso>}
      {exito && (
        <Aviso tono="ok">
          <ul className="space-y-0.5">
            {exito.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Aviso>
      )}

      <Boton type="submit" cargando={cargando} className="w-full">
        Dar de alta
      </Boton>
    </form>
  );
}

/** Select de categoría con alta en línea: no obliga a salir del formulario. */
function SelectorCategoria({
  categorias,
  valor,
  alCambiar,
}: {
  categorias: Categoria[];
  valor: string;
  alCambiar: (v: string) => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [padre, setPadre] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setCargando(true);
    setError(null);
    try {
      const nueva = await api<Categoria>('catalogos/categorias', {
        method: 'POST',
        body: { codigo: codigo.trim(), nombre: nombre.trim(), padre_id: padre || undefined },
      });
      alCambiar(nueva.id);
      setCodigo('');
      setNombre('');
      setPadre('');
      setAbierto(false);
      router.refresh();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="space-y-2">
      <Campo etiqueta="Categoría" hint="agrupa el catálogo; opcional">
        <div className="flex gap-2">
          <select className={claseInput} value={valor} onChange={(e) => alCambiar(e.target.value)}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ruta ?? c.codigo} — {c.nombre}
              </option>
            ))}
          </select>
          <Boton type="button" variante="suave" onClick={() => setAbierto((v) => !v)} className="shrink-0">
            {abierto ? '×' : '＋'}
          </Boton>
        </div>
      </Campo>

      {abierto && (
        <div className="space-y-2 rounded-lg border border-borde bg-lienzo p-3">
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <input
              className={`${claseInput} font-mono`}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="CÓDIGO"
            />
            <input
              className={claseInput}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre de la categoría"
            />
          </div>
          <select className={claseInput} value={padre} onChange={(e) => setPadre(e.target.value)}>
            <option value="">Sin categoría padre (raíz)</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ruta ?? c.codigo} — {c.nombre}
              </option>
            ))}
          </select>
          {error && <Aviso tono="riesgo">{error}</Aviso>}
          <Boton
            type="button"
            variante="suave"
            cargando={cargando}
            disabled={!codigo.trim() || !nombre.trim()}
            onClick={crear}
            className="w-full"
          >
            Crear categoría
          </Boton>
        </div>
      )}
    </div>
  );
}

/** Igual que el de categoría: la unidad define cómo se cuenta en cada giro. */
function SelectorUnidad({
  unidades,
  valor,
  alCambiar,
}: {
  unidades: Unidad[];
  valor: string;
  alCambiar: (v: string) => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [decimales, setDecimales] = useState('2');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setCargando(true);
    setError(null);
    try {
      const nueva = await api<Unidad>('catalogos/unidades', {
        method: 'POST',
        body: { codigo: codigo.trim(), nombre: nombre.trim(), decimales: Number(decimales) },
      });
      alCambiar(nueva.id);
      setCodigo('');
      setNombre('');
      setAbierto(false);
      router.refresh();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="space-y-2">
      <Campo etiqueta="Unidad de medida">
        <div className="flex gap-2">
          <select
            className={claseInput}
            value={valor}
            onChange={(e) => alCambiar(e.target.value)}
            required={unidades.length > 0}
          >
            {unidades.length === 0 && <option value="">— crea una unidad —</option>}
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.codigo} — {u.nombre}
              </option>
            ))}
          </select>
          <Boton type="button" variante="suave" onClick={() => setAbierto((v) => !v)} className="shrink-0">
            {abierto ? '×' : '＋'}
          </Boton>
        </div>
      </Campo>

      {abierto && (
        <div className="space-y-2 rounded-lg border border-borde bg-lienzo p-3">
          <div className="grid grid-cols-[90px_1fr_80px] gap-2">
            <input
              className={`${claseInput} font-mono`}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="PZA"
            />
            <input
              className={claseInput}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Pieza"
            />
            <input
              type="number"
              min="0"
              max="6"
              className={`${claseInput} text-right tabular-nums`}
              value={decimales}
              onChange={(e) => setDecimales(e.target.value)}
              title="Decimales"
            />
          </div>
          {error && <Aviso tono="riesgo">{error}</Aviso>}
          <Boton
            type="button"
            variante="suave"
            cargando={cargando}
            disabled={!codigo.trim() || !nombre.trim()}
            onClick={crear}
            className="w-full"
          >
            Crear unidad
          </Boton>
        </div>
      )}
    </div>
  );
}

function Interruptor({
  etiqueta,
  hint,
  valor,
  alCambiar,
}: {
  etiqueta: string;
  hint?: string;
  valor: boolean;
  alCambiar: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => alCambiar(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-acento"
      />
      <span>
        <span className="block text-sm">{etiqueta}</span>
        {hint && <span className="block text-xs text-tenue">{hint}</span>}
      </span>
    </label>
  );
}
