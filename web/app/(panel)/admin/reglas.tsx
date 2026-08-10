'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FalloApi } from '@/lib/api';
import { Panel, Aviso } from '@/components/ui';
import { Boton, claseInput } from '@/components/boton';

interface Regla {
  clave: string;
  valor: unknown;
  descripcion: string | null;
}

/**
 * Las reglas cambian el comportamiento del flujo sin tocar código:
 * son la pieza que hace al sistema agnóstico al giro de la empresa.
 */
export function EditorReglas({ reglas }: { reglas: Regla[] }) {
  const router = useRouter();
  const [guardando, setGuardando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'riesgo'; texto: string } | null>(null);
  const [borrador, setBorrador] = useState<Record<string, string>>(
    () => Object.fromEntries(reglas.map((r) => [r.clave, JSON.stringify(r.valor)])),
  );

  async function guardar(clave: string) {
    setGuardando(clave);
    setMensaje(null);
    try {
      const crudo = borrador[clave] ?? '';
      let valor: unknown;
      try {
        valor = JSON.parse(crudo);
      } catch {
        throw new Error(`Valor inválido para ${clave}: debe ser JSON (true, 72, "prioridad")`);
      }
      await api(`catalogos/reglas/${clave}`, { method: 'PUT', body: { valor } });
      setMensaje({ tono: 'ok', texto: `${clave} actualizada` });
      router.refresh();
    } catch (e) {
      setMensaje({ tono: 'riesgo', texto: e instanceof FalloApi ? e.error.mensaje : (e as Error).message });
    } finally {
      setGuardando(null);
      setTimeout(() => setMensaje(null), 5000);
    }
  }

  function alternar(clave: string) {
    const actual = borrador[clave];
    setBorrador((b) => ({ ...b, [clave]: actual === 'true' ? 'false' : 'true' }));
  }

  return (
    <Panel
      titulo="Reglas de negocio"
      accion={mensaje && <Aviso tono={mensaje.tono}>{mensaje.texto}</Aviso>}
    >
      <ul className="divide-y divide-borde">
        {reglas.map((r) => {
          const esBooleana = borrador[r.clave] === 'true' || borrador[r.clave] === 'false';
          const activa = borrador[r.clave] === 'true';
          return (
            <li key={r.clave} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">{r.clave}</p>
                {r.descripcion && <p className="text-xs text-tenue">{r.descripcion}</p>}
              </div>

              {esBooleana ? (
                <button
                  type="button"
                  onClick={() => alternar(r.clave)}
                  role="switch"
                  aria-checked={activa}
                  aria-label={r.clave}
                  className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition ${activa ? 'bg-acento' : 'bg-borde'}`}
                >
                  <span
                    className={`block h-5 w-5 rounded-full bg-white transition-transform ${activa ? 'translate-x-5' : ''}`}
                  />
                </button>
              ) : (
                <input
                  className={`${claseInput} w-40 font-mono text-xs`}
                  value={borrador[r.clave] ?? ''}
                  onChange={(e) => setBorrador((b) => ({ ...b, [r.clave]: e.target.value }))}
                />
              )}

              <Boton variante="suave" onClick={() => guardar(r.clave)} cargando={guardando === r.clave}>
                Guardar
              </Boton>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
