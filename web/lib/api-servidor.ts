import { headers } from 'next/headers';
import { peticion, type OpcionesPeticion } from './api';

/**
 * Cliente para Server Components. Importa `next/headers`, así que este módulo
 * NUNCA debe importarse desde un componente con 'use client'.
 */
export async function apiServidor<T>(ruta: string, init?: OpcionesPeticion): Promise<T> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:5173';
  const proto = h.get('x-forwarded-proto') ?? 'http';

  // Propaga la identidad heredada del sistema padre hasta el BFF: sin esto,
  // la llamada interna del Server Component llegaría sin credencial.
  const heredados: Record<string, string> = {};
  for (const cabecera of ['x-api-key', 'authorization', 'x-user-role']) {
    const valor = h.get(cabecera);
    if (valor) heredados[cabecera] = valor;
  }

  return peticion<T>(`${proto}://${host}/bff/${ruta.replace(/^\//, '')}`, init, heredados);
}

/** Variante tolerante: devuelve `null` en vez de lanzar (widgets no críticos, guardas de sesión). */
export async function apiSeguro<T>(ruta: string): Promise<T | null> {
  try {
    return await apiServidor<T>(ruta);
  } catch {
    return null;
  }
}
