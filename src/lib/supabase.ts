import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { desdePostgres } from './errors.js';

/**
 * Cliente único con SERVICE_ROLE: la autorización real la resuelve la capa de
 * middleware (API Key → organizacion_id + rol). Nunca se expone al navegador.
 */
export const db: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
  global: { headers: { 'x-application-name': 'erp-compras-almacen' } },
});

/** Cliente con el JWT del usuario final: respeta RLS. Útil para lecturas del dashboard. */
export function dbComoUsuario(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Ejecuta una función SQL y normaliza el error al contrato del dominio. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw desdePostgres(error);
  return data as T;
}

/** SELECT tipado con manejo de error homogéneo. */
export async function consultar<T = unknown>(
  build: (client: SupabaseClient) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T> {
  const { data, error } = await build(db);
  if (error) throw desdePostgres(error as never);
  return data as T;
}
