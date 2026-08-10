'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'suave' | 'peligro' | 'fantasma';

const V: Record<Variante, string> = {
  primario: 'bg-acento text-white hover:opacity-90',
  suave: 'bg-lienzo border border-borde hover:bg-acento-suave',
  peligro: 'bg-riesgo-suave text-riesgo hover:opacity-80',
  fantasma: 'text-tenue hover:text-tinta',
};

export function Boton({
  children,
  variante = 'primario',
  cargando = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; cargando?: boolean; children: ReactNode }) {
  return (
    <button
      {...props}
      disabled={props.disabled || cargando}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium
                  transition disabled:opacity-50 disabled:cursor-not-allowed ${V[variante]} ${className}`}
    >
      {cargando && (
        <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
      )}
      {children}
    </button>
  );
}

export function Campo({
  etiqueta,
  hint,
  children,
}: {
  etiqueta: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-tenue mb-1">{etiqueta}</span>
      {children}
      {hint && <span className="block mt-1 text-xs text-tenue">{hint}</span>}
    </label>
  );
}

export const claseInput =
  'w-full rounded-lg border border-borde bg-panel px-3 py-1.5 text-sm outline-none ' +
  'focus:border-acento focus:ring-2 focus:ring-acento-suave transition';
