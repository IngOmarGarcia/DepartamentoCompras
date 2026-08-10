'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FalloApi } from '@/lib/api';
import { Boton } from '@/components/boton';

/** Genera requisiciones para todo lo que cruzó el punto de reorden. */
export function BotonReabastecer() {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function ejecutar() {
    setCargando(true);
    setMsg(null);
    try {
      const r = await api<{ requisicion_id: string | null; folio: string | null; productos: number }>(
        'inventario/reabastecer',
        { method: 'POST', body: {} },
      );
      setMsg(r.productos ? `${r.folio} · ${r.productos} productos` : 'Nada por reabastecer');
      router.refresh();
    } catch (e) {
      setMsg(e instanceof FalloApi ? e.error.mensaje : 'Error');
    } finally {
      setCargando(false);
      setTimeout(() => setMsg(null), 5000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-tenue">{msg}</span>}
      <Boton variante="suave" onClick={ejecutar} cargando={cargando}>
        Generar reabastecimiento
      </Boton>
    </div>
  );
}
