import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../lib/supabase.js';
import { hashApiKey, prefijoDeApiKey } from '../lib/crypto.js';
import { AppError, desdePostgres } from '../lib/errors.js';
import type { Contexto, Rol } from '../types/domain.js';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Contexto;
  }
}

interface EntradaCache {
  ctx: Contexto;
  expira: number;
}
const cache = new Map<string, EntradaCache>();
const TTL_MS = 60_000;

/** Resuelve API Key → contexto (organización + rol + scopes). */
export async function contextoDesdeApiKey(clave: string): Promise<Contexto> {
  const hash = hashApiKey(clave);
  const enCache = cache.get(hash);
  if (enCache && enCache.expira > Date.now()) return enCache.ctx;

  const { data, error } = await db
    .from('api_keys')
    .select('id, organizacion_id, rol, scopes, prefijo, revocada, expira_en')
    .eq('hash', hash)
    .maybeSingle();

  if (error) throw desdePostgres(error);
  if (!data) {
    await diagnosticarClaveDesconocida(clave);
    throw new AppError('NO_AUTORIZADO', 'API Key inválida o revocada', 401);
  }
  if (data.revocada) throw new AppError('NO_AUTORIZADO', 'API Key inválida o revocada', 401);
  if (data.expira_en && new Date(data.expira_en) < new Date()) {
    throw new AppError('NO_AUTORIZADO', 'API Key expirada', 401);
  }

  const ctx: Contexto = {
    organizacionId: data.organizacion_id as string,
    rol: data.rol as Rol,
    usuarioId: null,
    actor: `api_key:${data.prefijo}`,
    scopes: (data.scopes as string[]) ?? ['*'],
  };

  cache.set(hash, { ctx, expira: Date.now() + TTL_MS });
  void db.from('api_keys').update({ ultimo_uso: new Date().toISOString() }).eq('id', data.id).then(() => {});
  return ctx;
}

/**
 * Una credencial que no aparece por hash puede significar dos cosas muy
 * distintas: que no existe, o que existe y el hash se calculó con otra
 * `API_KEY_PEPPER` (típico al desplegar con la pimienta cambiada respecto a
 * donde se corrió `keygen`). Buscar por `prefijo` —la parte no secreta— las
 * separa. El resultado va sólo al log: al cliente se le responde 401 en ambos
 * casos, para no confirmarle que un prefijo existe.
 */
async function diagnosticarClaveDesconocida(clave: string): Promise<void> {
  const prefijo = prefijoDeApiKey(clave);
  if (!prefijo) return;

  const { data } = await db.from('api_keys').select('prefijo').eq('prefijo', prefijo).maybeSingle();
  if (!data) return;

  registrar.error(
    `API Key con prefijo "${prefijo}" existe en la base pero su hash no coincide. ` +
      'Casi siempre es API_KEY_PEPPER: debe ser idéntica en este servidor y en el ' +
      'entorno donde se generó la clave con `npm run keygen`. Si cambió, vuelve a ' +
      'emitir las credenciales.',
  );
}

/** Destino de los diagnósticos de autenticación. Sustituible en pruebas. */
export const registrar = {
  error: (mensaje: string): void => {
    process.stderr.write(`[auth] ${mensaje}\n`);
  },
};

/** Resuelve JWT de Supabase → contexto (perfil del usuario final). */
async function contextoDesdeJwt(token: string): Promise<Contexto> {
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new AppError('NO_AUTORIZADO', 'Token inválido', 401);

  const { data: perfil, error: e2 } = await db
    .from('perfiles')
    .select('id, organizacion_id, rol, activo')
    .eq('id', data.user.id)
    .maybeSingle();

  if (e2) throw desdePostgres(e2);
  if (!perfil || !perfil.activo) throw new AppError('NO_AUTORIZADO', 'Perfil inexistente o inactivo', 401);

  return {
    organizacionId: perfil.organizacion_id as string,
    rol: perfil.rol as Rol,
    usuarioId: perfil.id as string,
    actor: `user:${perfil.id}`,
    scopes: ['*'],
  };
}

/** Hook de autenticación: acepta `x-api-key` o `Authorization: Bearer <jwt>`. */
export async function autenticar(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    req.ctx = await contextoDesdeApiKey(apiKey);
    return;
  }

  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    req.ctx = await contextoDesdeJwt(auth.slice(7));
    return;
  }

  throw new AppError('NO_AUTORIZADO', 'Falta credencial: x-api-key o Bearer token', 401);
}

/** Guardia de rol. `admin` siempre pasa. */
export function requiereRol(...roles: Rol[]) {
  return async (req: FastifyRequest): Promise<void> => {
    const { rol, scopes } = req.ctx;
    if (rol === 'admin') return;
    if (roles.includes(rol)) return;
    if (scopes.includes('*')) return;
    throw new AppError('SIN_PERMISO', `Requiere rol: ${roles.join(' | ')} (actual: ${rol})`, 403);
  };
}

export function limpiarCacheAuth(): void {
  cache.clear();
}
