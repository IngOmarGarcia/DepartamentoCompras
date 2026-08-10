import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../lib/errors.js';

/** Valida con Zod y traduce el fallo al contrato de errores del dominio. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw new AppError(
      'VALIDACION',
      'Payload inválido',
      422,
      r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    );
  }
  return r.data;
}

/** Respuesta uniforme: `{ ok, data, meta }`. */
export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return { ok: true as const, data, ...(meta ? { meta } : {}) };
}

/** Normaliza el resultado de PostgREST con `count` a `{ items, total }`. */
export function paginado(resultado: unknown, limite: number, offset: number) {
  const items = Array.isArray(resultado) ? resultado : [];
  return ok(items, { limite, offset, count: items.length });
}
