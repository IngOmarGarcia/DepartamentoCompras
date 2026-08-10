import { redirect } from 'next/navigation';
import { sesion, rutaInicial } from '@/lib/sesion';

export const dynamic = 'force-dynamic';

/**
 * Entrada del módulo: manda directo al dashboard que le toca al rol heredado.
 * Sin credencial, `/pedidos` se encarga de explicar qué falta (el layout del
 * panel pinta `SinCredencial`), así que no hay pantalla intermedia.
 */
export default async function Inicio() {
  const s = await sesion();
  redirect(s ? rutaInicial(s.rol) : '/pedidos');
}
