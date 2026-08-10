/**
 * Cliente HTTP seguro para el navegador. NO puede importar `next/headers`:
 * este módulo entra al bundle de cliente. La variante de servidor vive en
 * `lib/api-servidor.ts`.
 */

export interface ErrorApi {
  codigo: string;
  mensaje: string;
  detalle?: unknown;
}

export class FalloApi extends Error {
  constructor(public readonly error: ErrorApi, public readonly status: number) {
    super(error.mensaje);
    this.name = 'FalloApi';
  }
}

type Respuesta<T> = { ok: true; data: T; meta?: Record<string, unknown> } | { ok: false; error: ErrorApi };

export interface OpcionesPeticion {
  method?: string;
  body?: unknown;
}

/** Cuánto del cuerpo crudo se incluye en el mensaje de error. */
const MAX_EXTRACTO = 280;

/**
 * Deja legible un cuerpo que no era JSON: quita etiquetas HTML, colapsa
 * espacios y recorta. Un 500 de nginx o un stack trace de Node se vuelven una
 * línea que se puede leer en un `<Aviso>`.
 */
function extracto(texto: string): string {
  const limpio = texto
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!limpio) return '(cuerpo sin texto legible)';
  return limpio.length > MAX_EXTRACTO ? `${limpio.slice(0, MAX_EXTRACTO)}…` : limpio;
}

const describeHttp = (r: Response): string => `HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ''}`;

/**
 * Núcleo compartido por el cliente y el servidor.
 *
 * El cuerpo se lee UNA sola vez como texto: `r.json()` y `r.text()` consumen
 * el mismo stream, así que no se puede intentar el primero y caer al segundo.
 * A partir de ese texto se decide qué pasó, y cualquier respuesta que no sea
 * el contrato `{ok, data}` se convierte en un `FalloApi` que dice exactamente
 * qué devolvió el servidor — nunca en un SyntaxError suelto.
 */
export async function peticion<T>(
  url: string,
  init?: OpcionesPeticion,
  extra?: Record<string, string>,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(extra ?? {}) },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch (e) {
    // Ni siquiera hubo respuesta: DNS, conexión rechazada, offline, CORS.
    throw new FalloApi(
      {
        codigo: 'SIN_RESPUESTA',
        mensaje: `No se pudo contactar al servidor: ${(e as Error).message}`,
        detalle: { url },
      },
      0,
    );
  }

  const tipo = (r.headers.get('content-type') ?? '').toLowerCase();
  const esJson = tipo.includes('application/json') || tipo.includes('+json');

  let crudo: string;
  try {
    crudo = await r.text();
  } catch (e) {
    throw new FalloApi(
      {
        codigo: 'CUERPO_ILEGIBLE',
        mensaje: `${describeHttp(r)}: la respuesta se cortó antes de poder leerla (${(e as Error).message})`,
        detalle: { url },
      },
      r.status,
    );
  }

  // 1) Cuerpo vacío — 204, HEAD, o un proceso que murió a media respuesta.
  if (crudo.trim() === '') {
    if (r.ok) return undefined as T; // 204 No Content y similares: no hay `data` que devolver.
    throw new FalloApi(
      {
        codigo: `HTTP_${r.status}`,
        mensaje: `${describeHttp(r)}: el servidor respondió sin contenido`,
        detalle: { url, contentType: tipo || null },
      },
      r.status,
    );
  }

  // 2) No dice ser JSON — página de error HTML, texto plano, un proxy en medio.
  if (!esJson) {
    throw new FalloApi(
      {
        codigo: r.ok ? 'RESPUESTA_NO_JSON' : `HTTP_${r.status}`,
        mensaje:
          `${describeHttp(r)}: se esperaba JSON y llegó ` +
          `${tipo || 'contenido sin Content-Type'} → ${extracto(crudo)}`,
        detalle: { url, contentType: tipo || null, cuerpo: extracto(crudo) },
      },
      r.status,
    );
  }

  // 3) Dice ser JSON pero no parsea — truncado, doble cuerpo, BOM.
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch (e) {
    throw new FalloApi(
      {
        codigo: 'JSON_MALFORMADO',
        mensaje: `${describeHttp(r)}: el JSON no se pudo parsear (${(e as Error).message}) → ${extracto(crudo)}`,
        detalle: { url, cuerpo: extracto(crudo) },
      },
      r.status,
    );
  }

  // 4) JSON válido: se exige el contrato `{ok, data}` de la API.
  if (json !== null && typeof json === 'object' && 'ok' in json) {
    const cuerpo = json as Respuesta<T>;
    if (cuerpo.ok) return cuerpo.data;

    const err = cuerpo.error;
    throw new FalloApi(
      err && typeof err === 'object' && typeof err.codigo === 'string'
        ? err
        : {
            codigo: `HTTP_${r.status}`,
            mensaje: `${describeHttp(r)}: la API reportó un fallo sin describirlo`,
            detalle: { url, cuerpo: json },
          },
      r.status,
    );
  }

  // 5) JSON legítimo pero ajeno al contrato: otro servicio contestó por error.
  throw new FalloApi(
    {
      codigo: r.ok ? 'CONTRATO_INESPERADO' : `HTTP_${r.status}`,
      mensaje: `${describeHttp(r)}: la respuesta JSON no tiene la forma {ok, data} → ${extracto(crudo)}`,
      detalle: { url, cuerpo: json },
    },
    r.status,
  );
}

/** Cliente para componentes con 'use client'. */
export async function api<T>(ruta: string, init?: OpcionesPeticion): Promise<T> {
  return peticion<T>(`/bff/${ruta.replace(/^\//, '')}`, init);
}
