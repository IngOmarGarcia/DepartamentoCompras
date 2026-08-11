/**
 * Validación de arranque de las credenciales de Supabase.
 *
 * Un `.env` que mezcla proyectos (p. ej. las llaves del stack local de
 * `docker-compose.dev.yml` con la URL de Supabase Cloud) no falla al importar
 * el cliente: falla en la primera consulta, y todas las rutas empiezan a
 * responder CONFIG_SUPABASE. Detectarlo en el boot convierte ese síntoma
 * difuso en un mensaje concreto antes de aceptar tráfico.
 */

export interface Diagnostico {
  /** Impiden operar: el arranque debe abortar. */
  fatales: string[];
  /** Sospechosos o no verificables: se registran y se sigue. */
  avisos: string[];
}

export interface Registrador {
  warn(mensaje: string): void;
}

const URL_NUBE = /^https:\/\/([a-z0-9]+)\.supabase\.(?:co|in)$/i;

interface CargaJwt {
  role?: string;
  ref?: string;
  iss?: string;
  exp?: number;
}

function cargaJwt(clave: string): CargaJwt | null {
  const partes = clave.split('.');
  if (partes.length !== 3 || !partes[1]) return null;
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) as CargaJwt;
  } catch {
    return null;
  }
}

function revisarLlave(
  variable: string,
  clave: string,
  rolEsperado: 'service_role' | 'anon',
  refProyecto: string | null,
  d: Diagnostico,
): void {
  // Llaves del formato nuevo (sb_secret_… / sb_publishable_…): son opacas, así
  // que sólo podemos comprobar que no estén intercambiadas.
  if (/^sb_(secret|publishable)_/.test(clave)) {
    const esSecreta = clave.startsWith('sb_secret_');
    if (rolEsperado === 'service_role' && !esSecreta) {
      d.fatales.push(`${variable} tiene la llave publicable; ahí va la secreta (sb_secret_…).`);
    }
    if (rolEsperado === 'anon' && esSecreta) {
      d.fatales.push(`${variable} tiene la llave secreta; ahí va la publicable (sb_publishable_…).`);
    }
    return;
  }

  const carga = cargaJwt(clave);
  if (!carga) {
    d.avisos.push(`${variable} no parece un JWT ni una llave sb_*; no se pudo validar su contenido.`);
    return;
  }

  if (carga.role && carga.role !== rolEsperado) {
    d.fatales.push(`${variable} tiene una llave de rol "${carga.role}"; se esperaba "${rolEsperado}".`);
  }

  if (carga.exp && carga.exp * 1000 < Date.now()) {
    d.fatales.push(`${variable} expiró el ${new Date(carga.exp * 1000).toISOString().slice(0, 10)}.`);
  }

  // Coherencia proyecto ↔ llave. Sólo aplica contra Supabase Cloud: en el
  // stack local las llaves no llevan `ref`.
  if (!refProyecto) return;

  if (!carga.ref) {
    d.fatales.push(
      `${variable} no fue emitida por Supabase Cloud${carga.iss ? ` (iss: "${carga.iss}")` : ''}, ` +
        `pero SUPABASE_URL apunta al proyecto "${refProyecto}". ` +
        'Cópiala de Project Settings → API.',
    );
  } else if (carga.ref !== refProyecto) {
    d.fatales.push(
      `${variable} pertenece al proyecto "${carga.ref}" y SUPABASE_URL apunta a "${refProyecto}".`,
    );
  }
}

/** Revisa la coherencia entre la URL y las llaves. Puro: no toca la red. */
export function diagnosticar(url: string, claveServicio: string, claveAnon?: string): Diagnostico {
  const d: Diagnostico = { fatales: [], avisos: [] };
  const refProyecto = URL_NUBE.exec(url.replace(/\/+$/, ''))?.[1] ?? null;

  revisarLlave('SUPABASE_SERVICE_ROLE_KEY', claveServicio, 'service_role', refProyecto, d);
  if (claveAnon) revisarLlave('SUPABASE_ANON_KEY', claveAnon, 'anon', refProyecto, d);

  return d;
}

/** Confirma contra el proyecto que la credencial del backend es aceptada. */
export async function probarCredencial(url: string, clave: string, timeoutMs = 5000): Promise<Diagnostico> {
  const d: Diagnostico = { fatales: [], avisos: [] };
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/`, {
      headers: { apikey: clave, Authorization: `Bearer ${clave}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 401 || r.status === 403) {
      const cuerpo = await r.text().catch(() => '');
      d.fatales.push(`Supabase rechazó SUPABASE_SERVICE_ROLE_KEY (HTTP ${r.status}). ${cuerpo.slice(0, 200)}`);
    }
  } catch (e) {
    // Estar sin red no es motivo para no arrancar: si sigue caído, las
    // peticiones saldrán como SUPABASE_INALCANZABLE con su propio mensaje.
    d.avisos.push(`No se pudo verificar la credencial contra Supabase: ${(e as Error).message}`);
  }
  return d;
}

/**
 * Chequeo de arranque. Lanza si la configuración es inviable.
 * `enLinea: false` omite la llamada de red (útil en pruebas o arranques offline).
 */
export async function verificarSupabase(log: Registrador, enLinea = true): Promise<void> {
  // Import diferido: mantiene las funciones puras de arriba utilizables (y
  // testeables) sin exigir que exista un `.env` cargado y válido.
  const { env } = await import('./env.js');

  const d = diagnosticar(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_ANON_KEY);

  // Si la estructura ya está mal, no gastamos una llamada de red en confirmarlo.
  if (d.fatales.length === 0 && enLinea) {
    const enVivo = await probarCredencial(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    d.fatales.push(...enVivo.fatales);
    d.avisos.push(...enVivo.avisos);
  }

  for (const aviso of d.avisos) log.warn(`Supabase: ${aviso}`);

  if (d.fatales.length > 0) {
    throw new Error(
      `Configuración de Supabase inválida — la API no puede operar:\n${d.fatales
        .map((f) => `  · ${f}`)
        .join('\n')}`,
    );
  }
}
