import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const PREFIJO_LONGITUD = 8;

/** Hash determinista de una API Key (sha256 con pimienta global). */
export function hashApiKey(clave: string): string {
  return createHash('sha256').update(`${clave}${env.API_KEY_PEPPER}`).digest('hex');
}

/** Genera una API Key nueva: el valor en claro solo se muestra una vez. */
export function generarApiKey(entorno: 'live' | 'test' = 'live'): {
  clave: string;
  prefijo: string;
  hash: string;
} {
  const cuerpo = randomBytes(24).toString('base64url');
  const clave = `sk_${entorno}_${cuerpo}`;
  return { clave, prefijo: cuerpo.slice(0, PREFIJO_LONGITUD), hash: hashApiKey(clave) };
}

/**
 * Extrae el `prefijo` que quedó guardado en `api_keys` al emitir esta clave.
 * Es la parte no secreta, y sirve para reconocer una credencial cuyo hash no
 * cuadra — señal de que `API_KEY_PEPPER` no es el mismo con el que se generó.
 * Devuelve null si el texto no tiene forma de API Key.
 */
export function prefijoDeApiKey(clave: string): string | null {
  const cuerpo = /^sk_(?:live|test)_(.+)$/.exec(clave)?.[1];
  return cuerpo && cuerpo.length >= PREFIJO_LONGITUD ? cuerpo.slice(0, PREFIJO_LONGITUD) : null;
}

export function comparacionSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
