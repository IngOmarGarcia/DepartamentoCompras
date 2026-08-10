import { db } from '../lib/supabase.js';
import { hashApiKey } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
const cache = new Map();
const TTL_MS = 60_000;
/** Resuelve API Key → contexto (organización + rol + scopes). */
export async function contextoDesdeApiKey(clave) {
    const hash = hashApiKey(clave);
    const enCache = cache.get(hash);
    if (enCache && enCache.expira > Date.now())
        return enCache.ctx;
    const { data, error } = await db
        .from('api_keys')
        .select('id, organizacion_id, rol, scopes, prefijo, revocada, expira_en')
        .eq('hash', hash)
        .maybeSingle();
    if (error)
        throw new AppError('ERROR_BD', error.message, 500);
    if (!data || data.revocada)
        throw new AppError('NO_AUTORIZADO', 'API Key inválida o revocada', 401);
    if (data.expira_en && new Date(data.expira_en) < new Date()) {
        throw new AppError('NO_AUTORIZADO', 'API Key expirada', 401);
    }
    const ctx = {
        organizacionId: data.organizacion_id,
        rol: data.rol,
        usuarioId: null,
        actor: `api_key:${data.prefijo}`,
        scopes: data.scopes ?? ['*'],
    };
    cache.set(hash, { ctx, expira: Date.now() + TTL_MS });
    void db.from('api_keys').update({ ultimo_uso: new Date().toISOString() }).eq('id', data.id).then(() => { });
    return ctx;
}
/** Resuelve JWT de Supabase → contexto (perfil del usuario final). */
async function contextoDesdeJwt(token) {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user)
        throw new AppError('NO_AUTORIZADO', 'Token inválido', 401);
    const { data: perfil, error: e2 } = await db
        .from('perfiles')
        .select('id, organizacion_id, rol, activo')
        .eq('id', data.user.id)
        .maybeSingle();
    if (e2)
        throw new AppError('ERROR_BD', e2.message, 500);
    if (!perfil || !perfil.activo)
        throw new AppError('NO_AUTORIZADO', 'Perfil inexistente o inactivo', 401);
    return {
        organizacionId: perfil.organizacion_id,
        rol: perfil.rol,
        usuarioId: perfil.id,
        actor: `user:${perfil.id}`,
        scopes: ['*'],
    };
}
/** Hook de autenticación: acepta `x-api-key` o `Authorization: Bearer <jwt>`. */
export async function autenticar(req, _reply) {
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
export function requiereRol(...roles) {
    return async (req) => {
        const { rol, scopes } = req.ctx;
        if (rol === 'admin')
            return;
        if (roles.includes(rol))
            return;
        if (scopes.includes('*'))
            return;
        throw new AppError('SIN_PERMISO', `Requiere rol: ${roles.join(' | ')} (actual: ${rol})`, 403);
    };
}
export function limpiarCacheAuth() {
    cache.clear();
}
//# sourceMappingURL=auth.js.map