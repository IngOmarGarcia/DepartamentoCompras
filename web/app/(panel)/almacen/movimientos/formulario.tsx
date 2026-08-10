'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FalloApi } from '@/lib/api';
import type { Almacen, Producto } from '@/lib/tipos';
import { Panel, Aviso } from '@/components/ui';
import { Boton, Campo, claseInput } from '@/components/boton';
import { n } from '@/lib/formato';

const TIPOS = [
  { v: 'entrada', l: 'Entrada' },
  { v: 'salida', l: 'Salida' },
  { v: 'merma', l: 'Merma' },
  { v: 'ajuste_positivo', l: 'Ajuste +' },
  { v: 'ajuste_negativo', l: 'Ajuste −' },
  { v: 'devolucion_cliente', l: 'Devolución de cliente' },
  { v: 'devolucion_proveedor', l: 'Devolución a proveedor' },
] as const;

export function FormularioMovimiento({ almacenes, productos }: { almacenes: Almacen[]; productos: Producto[] }) {
  const router = useRouter();
  const [modo, setModo] = useState<'movimiento' | 'transferencia'>('movimiento');
  const [almacen, setAlmacen] = useState(almacenes[0]?.id ?? '');
  const [destino, setDestino] = useState(almacenes[1]?.id ?? '');
  const [producto, setProducto] = useState(productos[0]?.id ?? '');
  const [tipo, setTipo] = useState<string>('entrada');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setExito(null);
    try {
      if (modo === 'transferencia') {
        await api('inventario/transferencias', {
          method: 'POST',
          body: {
            producto_id: producto,
            almacen_origen: almacen,
            almacen_destino: destino,
            cantidad: Number(cantidad),
            motivo: motivo || undefined,
          },
        });
        setExito(`Transferidas ${n(cantidad)} unidades`);
      } else {
        const r = await api<{ folio: string; saldo_posterior: number }>('inventario/movimientos', {
          method: 'POST',
          body: {
            almacen_id: almacen,
            producto_id: producto,
            tipo,
            cantidad: Number(cantidad),
            motivo: motivo || undefined,
            costo_unitario: costo ? Number(costo) : undefined,
            referencia_tipo: 'manual',
          },
        });
        setExito(`${r.folio} · saldo ${n(r.saldo_posterior)}`);
      }
      setCantidad('');
      setMotivo('');
      setCosto('');
      router.refresh();
    } catch (err) {
      setError(err instanceof FalloApi ? `${err.error.codigo}: ${err.error.mensaje}` : (err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <Panel titulo="Registrar">
      <div className="flex gap-1 border-b border-borde px-4 py-2">
        {(['movimiento', 'transferencia'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              modo === m ? 'bg-acento-suave text-acento' : 'text-tenue hover:text-tinta'
            }`}
          >
            {m === 'movimiento' ? 'Movimiento' : 'Transferencia'}
          </button>
        ))}
      </div>

      <form onSubmit={enviar} className="space-y-3 p-4">
        {modo === 'movimiento' && (
          <Campo etiqueta="Tipo">
            <select className={claseInput} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.l}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo etiqueta={modo === 'transferencia' ? 'Almacén origen' : 'Almacén'}>
          <select className={claseInput} value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
            {almacenes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.codigo} — {a.nombre}
              </option>
            ))}
          </select>
        </Campo>

        {modo === 'transferencia' && (
          <Campo etiqueta="Almacén destino">
            <select className={claseInput} value={destino} onChange={(e) => setDestino(e.target.value)}>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo} — {a.nombre}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo etiqueta="Producto">
          <select className={claseInput} value={producto} onChange={(e) => setProducto(e.target.value)}>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.nombre}
              </option>
            ))}
          </select>
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Cantidad">
            <input
              type="number"
              min="0"
              step="any"
              required
              className={`${claseInput} text-right tabular-nums`}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </Campo>
          {modo === 'movimiento' && (
            <Campo etiqueta="Costo unitario" hint="opcional">
              <input
                type="number"
                min="0"
                step="any"
                className={`${claseInput} text-right tabular-nums`}
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
              />
            </Campo>
          )}
        </div>

        <Campo etiqueta="Motivo">
          <input className={claseInput} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Referencia libre" />
        </Campo>

        {error && <Aviso tono="riesgo">{error}</Aviso>}
        {exito && <Aviso tono="ok">{exito}</Aviso>}

        <Boton type="submit" cargando={cargando} className="w-full">
          Registrar
        </Boton>
      </form>
    </Panel>
  );
}
