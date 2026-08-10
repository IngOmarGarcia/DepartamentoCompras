'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Rol } from '@/lib/tipos';

interface Entrada {
  href: string;
  etiqueta: string;
  roles: Rol[];
  icono: string;
}

interface Grupo {
  titulo: string;
  entradas: Entrada[];
}

/**
 * Un solo mapa de navegación; cada dashboard es un filtro por rol sobre él.
 * El orden refleja el flujo operativo: TODO nace en Pedidos, de ahí se reparte
 * a Almacén (lo que hay) y a Compras (lo que falta). Configuración y
 * Administración van al final porque se tocan una vez, no todos los días.
 */
const GRUPOS: Grupo[] = [
  {
    titulo: 'Pedidos',
    entradas: [
      { href: '/pedidos', etiqueta: 'Pedidos', roles: ['admin', 'compras', 'almacen', 'solicitante'], icono: '◇' },
      { href: '/pedidos/nuevo', etiqueta: 'Nuevo pedido', roles: ['admin', 'compras', 'almacen', 'solicitante'], icono: '＋' },
    ],
  },
  {
    titulo: 'Almacén',
    entradas: [
      { href: '/almacen', etiqueta: 'Stock y surtido', roles: ['admin', 'almacen'], icono: '▦' },
      { href: '/almacen/movimientos', etiqueta: 'Movimientos', roles: ['admin', 'almacen'], icono: '⇅' },
    ],
  },
  {
    titulo: 'Compras',
    entradas: [
      { href: '/compras', etiqueta: 'Requisiciones', roles: ['admin', 'compras'], icono: '◈' },
      { href: '/compras/ordenes', etiqueta: 'Órdenes de compra', roles: ['admin', 'compras'], icono: '≡' },
    ],
  },
  {
    titulo: 'Configuración',
    entradas: [{ href: '/catalogos', etiqueta: 'Productos y catálogos', roles: ['admin', 'almacen'], icono: '⬡' }],
  },
  {
    titulo: 'Administración',
    entradas: [{ href: '/admin', etiqueta: 'Reglas y auditoría', roles: ['admin'], icono: '⚙' }],
  },
];

/**
 * Marca una sola entrada: la de href más largo que cubre la ruta actual. Sin
 * esto, `/almacen/movimientos` encendería también `/almacen`.
 */
function hrefActivo(ruta: string, entradas: Entrada[]): string | null {
  return entradas
    .filter((e) => ruta === e.href || ruta.startsWith(`${e.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

export function Navegacion({ rol, compacto = false }: { rol: Rol; compacto?: boolean }) {
  const ruta = usePathname();

  const grupos = GRUPOS.map((g) => ({
    ...g,
    entradas: g.entradas.filter((e) => e.roles.includes(rol)),
  })).filter((g) => g.entradas.length > 0);

  const entradas = grupos.flatMap((g) => g.entradas);
  const activo = hrefActivo(ruta, entradas);

  // En móvil el sidebar es una barra: una sola fila deslizable, sin encabezados.
  if (compacto) {
    return (
      <nav className="flex gap-1 overflow-x-auto">
        {entradas.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
              activo === e.href ? 'bg-acento-suave text-acento font-medium' : 'text-tenue hover:text-tinta'
            }`}
          >
            <span className="opacity-70">{e.icono}</span>
            {e.etiqueta}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-4">
      {grupos.map((g) => (
        <div key={g.titulo} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-tenue/70">{g.titulo}</p>
          {g.entradas.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                activo === e.href ? 'bg-acento-suave text-acento font-medium' : 'text-tenue hover:text-tinta hover:bg-lienzo'
              }`}
            >
              <span className="w-4 text-center opacity-70">{e.icono}</span>
              {e.etiqueta}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
