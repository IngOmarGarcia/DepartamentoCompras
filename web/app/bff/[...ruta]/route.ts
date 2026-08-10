import { NextResponse, type NextRequest } from 'next/server';

/**
 * BFF: único punto de salida hacia la API. La credencial se resuelve SIEMPRE
 * en el servidor, nunca en el navegador.
 *   · `x-api-key` en la petición  → la reenvía (la inyecta el sistema padre)
 *   · si no viene                 → usa `API_KEY` del entorno del servidor
 *
 * `x-user-role` no se reenvía: la API no lo interpreta, deriva el rol de la
 * credencial. Ese header solo acota la interfaz (ver `lib/sesion.ts`).
 */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';

function credencial(req: NextRequest): HeadersInit {
  const heredada = req.headers.get('x-api-key');
  if (heredada) return { 'x-api-key': heredada };

  const autorizacion = req.headers.get('authorization');
  if (autorizacion?.startsWith('Bearer ')) return { Authorization: autorizacion };

  const propia = process.env.API_KEY ?? process.env.DEMO_API_KEY;
  return propia ? { 'x-api-key': propia } : {};
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await ctx.params;
  const destino = `${API_URL}/api/${ruta.join('/')}${req.nextUrl.search}`;

  const cuerpo = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text();

  try {
    const r = await fetch(destino, {
      method: req.method,
      headers: { 'content-type': 'application/json', ...credencial(req) },
      body: cuerpo,
      cache: 'no-store',
    });

    const texto = await r.text();
    return new NextResponse(texto, {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: { codigo: 'API_INALCANZABLE', mensaje: `No se pudo contactar ${API_URL}` } },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const dynamic = 'force-dynamic';
