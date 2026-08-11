import { z, type ZodTypeAny } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';

const UUID = z.string().uuid();

/**
 * Valida un identificador que viene en la ruta. Sin esto el texto llega tal
 * cual a Postgres, que responde `22P02`, y un error de quien llama acababa
 * reportado como fallo del servidor.
 */
export function idRuta(valor: string, nombre = 'id'): string {
  const r = UUID.safeParse(valor);
  if (!r.success) {
    throw new AppError('ID_INVALIDO', `El parámetro "${nombre}" no es un UUID válido`, 400);
  }
  return r.data;
}

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

/**
 * Registra `GET /` con el índice de endpoints del módulo, para que la raíz no
 * sea un 404 desconcertante cuando solo existen subrutas.
 *
 * La lista se deriva de las rutas que el propio módulo registra, así que no
 * puede quedar desfasada. Llamar al principio del plugin: el hook `onRoute`
 * solo ve lo que se registra después de añadirlo — y por eso el índice
 * tampoco se incluye a sí mismo.
 */
export function indiceDeModulo(app: FastifyInstance, modulo: string): void {
  const endpoints: string[] = [];

  app.get('/', async () => ok({ modulo, endpoints: [...endpoints].sort() }));

  app.addHook('onRoute', (ruta) => {
    const metodos = Array.isArray(ruta.method) ? ruta.method : [ruta.method];
    for (const metodo of metodos) {
      if (metodo === 'HEAD') continue; // Fastify lo añade solo para cada GET
      endpoints.push(`${metodo} ${ruta.url}`);
    }
  });
}

/** Normaliza el resultado de PostgREST con `count` a `{ items, total }`. */
export function paginado(resultado: unknown, limite: number, offset: number) {
  const items = Array.isArray(resultado) ? resultado : [];
  return ok(items, { limite, offset, count: items.length });
}
