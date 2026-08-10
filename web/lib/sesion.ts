import { cache } from 'react';
import { headers } from 'next/headers';
import { apiSeguro } from './api-servidor';
import type { Contexto, Rol } from './tipos';

/**
 * Identidad heredada del sistema padre. Este módulo NO autentica a nadie: es
 * un módulo desacoplado que confía en la aplicación contenedora.
 *
 *   x-api-key    credencial de la organización → la API resuelve org y rol
 *   x-user-role  rol del usuario final en el sistema padre (opcional)
 *
 * `x-user-role` es una PISTA DE UI, no una autorización. Un navegador que
 * llegue directo puede mandar el header que se le antoje, así que solo se le
 * permite RESTRINGIR lo que la credencial ya autoriza, nunca ampliarlo. Quien
 * autoriza de verdad sigue siendo la API (`requiereRol` sobre el rol de la
 * API Key), y esa decisión ocurre del otro lado de la red.
 */

export const ROLES: Rol[] = ['admin', 'compras', 'almacen', 'solicitante'];

export interface Sesion {
  /** Lo que la API reconoció para la credencial recibida. */
  ctx: Contexto;
  /** Rol con el que se pinta la interfaz. */
  rol: Rol;
  /** true si `x-user-role` acotó el rol de la credencial. */
  heredado: boolean;
}

const esRol = (v: string | null | undefined): v is Rol => Boolean(v) && ROLES.includes(v as Rol);

/**
 * El header solo puede bajar de privilegio:
 *   · una credencial `admin` puede presentarse como cualquier rol,
 *   · cualquier credencial puede degradarse a `solicitante`,
 *   · en cualquier otro caso mandan los permisos de la credencial.
 */
export function rolEfectivo(rolCredencial: Rol, rolSolicitado: Rol | null): Rol {
  if (!rolSolicitado || rolSolicitado === rolCredencial) return rolCredencial;
  if (rolCredencial === 'admin') return rolSolicitado;
  if (rolSolicitado === 'solicitante') return 'solicitante';
  return rolCredencial;
}

/**
 * Resuelve la sesión del request actual. Devuelve `null` cuando la API no
 * reconoce ninguna credencial — el contenedor no inyectó `x-api-key` y
 * tampoco hay `API_KEY` de servidor configurada.
 *
 * `cache()` la memoiza por render: el layout raíz, el de la sección y la
 * página comparten una sola llamada a `/me`.
 */
export const sesion = cache(async (): Promise<Sesion | null> => {
  const ctx = await apiSeguro<Contexto>('me');
  if (!ctx) return null;

  const solicitado = (await headers()).get('x-user-role');
  const rol = rolEfectivo(ctx.rol, esRol(solicitado) ? solicitado : null);

  return { ctx, rol, heredado: rol !== ctx.rol };
});

/** Dashboard que le toca a cada rol cuando se entra por la raíz. */
export function rutaInicial(rol: Rol): string {
  switch (rol) {
    case 'admin':
      return '/admin';
    case 'compras':
      return '/compras';
    case 'almacen':
      return '/almacen';
    default:
      return '/pedidos';
  }
}
