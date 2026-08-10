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

export function comparacionSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
