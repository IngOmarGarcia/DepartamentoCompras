import type { ReactNode } from 'react';

type Tono = 'ok' | 'alerta' | 'riesgo' | 'neutro' | 'acento';

const TONOS: Record<Tono, string> = {
  ok: 'bg-ok-suave text-ok',
  alerta: 'bg-alerta-suave text-alerta',
  riesgo: 'bg-riesgo-suave text-riesgo',
  acento: 'bg-acento-suave text-acento',
  neutro: 'bg-lienzo text-tenue',
};

export function Panel({
  children,
  titulo,
  accion,
  className = '',
}: {
  children: ReactNode;
  titulo?: string;
  accion?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-panel border border-borde rounded-xl overflow-hidden ${className}`}>
      {(titulo || accion) && (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-borde">
          {titulo && <h2 className="text-sm font-semibold tracking-tight">{titulo}</h2>}
          {accion}
        </header>
      )}
      {children}
    </section>
  );
}

export function Insignia({ children, tono = 'neutro' }: { children: ReactNode; tono?: Tono }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONOS[tono]}`}>
      {children}
    </span>
  );
}

export function Kpi({
  etiqueta,
  valor,
  pie,
  tono = 'neutro',
}: {
  etiqueta: string;
  valor: string | number;
  pie?: string;
  tono?: Tono;
}) {
  return (
    <div className="bg-panel border border-borde rounded-xl p-4 animar">
      <p className="text-xs text-tenue font-medium uppercase tracking-wide">{etiqueta}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${tono === 'riesgo' ? 'text-riesgo' : tono === 'alerta' ? 'text-alerta' : ''}`}>
        {valor}
      </p>
      {pie && <p className="mt-0.5 text-xs text-tenue">{pie}</p>}
    </div>
  );
}

export function Tabla({ cabeceras, children }: { cabeceras: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-borde">
            {cabeceras.map((c) => (
              <th
                key={c}
                className={`px-4 py-2.5 text-xs font-medium text-tenue uppercase tracking-wide ${
                  c.startsWith('#') ? 'text-right' : 'text-left'
                }`}
              >
                {c.replace(/^#/, '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borde">{children}</tbody>
      </table>
    </div>
  );
}

export function Vacio({ mensaje, icono = '·' }: { mensaje: string; icono?: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-3xl text-borde">{icono}</p>
      <p className="mt-2 text-sm text-tenue">{mensaje}</p>
    </div>
  );
}

/** Barra de avance solicitado → reservado → surtido. */
export function Avance({ solicitado, reservado, surtido }: { solicitado: number; reservado: number; surtido: number }) {
  const t = Math.max(solicitado, 1);
  const s = Math.min((surtido / t) * 100, 100);
  const r = Math.min((reservado / t) * 100, 100 - s);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-lienzo overflow-hidden flex">
        <div className="h-full bg-ok" style={{ width: `${s}%` }} />
        <div className="h-full bg-acento" style={{ width: `${r}%` }} />
      </div>
      <span className="text-xs text-tenue tabular-nums">{Math.round(s + r)}%</span>
    </div>
  );
}

export function Aviso({ tono = 'alerta', children }: { tono?: Tono; children: ReactNode }) {
  return <div className={`rounded-lg px-3 py-2 text-sm ${TONOS[tono]}`}>{children}</div>;
}
