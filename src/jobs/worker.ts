import { db, rpc } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { verificarSupabase } from '../config/verificar-supabase.js';
import { eventosService } from '../core/eventos.service.js';

/**
 * Worker de tareas periódicas:
 *   · libera reservas caducadas (devuelven el material a disponible)
 *   · genera requisiciones por punto de reorden
 *   · drena la cola de eventos hacia el webhook configurado
 */

const MIN = 60_000;
let ultimoReorden = 0;

function log(mensaje: string, extra?: unknown): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[worker ${ts}] ${mensaje}`, extra !== undefined ? JSON.stringify(extra) : '');
}

async function organizacionesActivas(): Promise<Array<{ id: string; nombre: string }>> {
  const { data, error } = await db.from('organizaciones').select('id, nombre').eq('activa', true);
  if (error) throw new Error(`No se pudieron leer organizaciones: ${error.message}`);
  return (data ?? []) as Array<{ id: string; nombre: string }>;
}

async function liberarReservasExpiradas(): Promise<void> {
  const r = await rpc<{ reservas_liberadas: number; cantidad: number }>('fn_liberar_reservas', {
    p_pedido_id: null,
    p_motivo: 'expiracion',
  });
  if (r.reservas_liberadas > 0) log('reservas expiradas liberadas', r);
}

async function reabastecer(orgs: Array<{ id: string; nombre: string }>): Promise<void> {
  if (env.JOBS_REORDEN_HORAS <= 0) return;
  const debido = Date.now() - ultimoReorden >= env.JOBS_REORDEN_HORAS * 60 * MIN;
  if (!debido) return;
  ultimoReorden = Date.now();

  for (const org of orgs) {
    try {
      const r = await rpc<{ folio: string | null; productos: number }>('fn_generar_requisiciones_reorden', {
        p_org: org.id,
      });
      if (r.productos > 0) log(`reabastecimiento ${org.nombre}`, r);
    } catch (e) {
      log(`fallo reabastecimiento ${org.nombre}`, (e as Error).message);
    }
  }
}

async function ciclo(): Promise<void> {
  try {
    const orgs = await organizacionesActivas();
    await liberarReservasExpiradas();
    await reabastecer(orgs);

    const eventos = await eventosService.drenar(200);
    if (eventos.procesados || eventos.fallidos) log('eventos drenados', eventos);
  } catch (e) {
    log('error en ciclo', (e as Error).message);
  }
}

async function main(): Promise<void> {
  // `ciclo()` atrapa sus errores para no morirse por un fallo puntual, así que
  // sin esta comprobación un `.env` mal configurado reintentaría en silencio.
  try {
    await verificarSupabase({ warn: (m) => log(m) });
  } catch (e) {
    log((e as Error).message);
    process.exit(1);
  }

  log(
    `iniciado · intervalo ${env.JOBS_INTERVALO_MIN} min · reorden cada ${env.JOBS_REORDEN_HORAS} h · webhook ${
      env.WEBHOOK_URL ? 'activo' : 'sin configurar'
    }`,
  );

  await ciclo();
  const temporizador = setInterval(() => void ciclo(), env.JOBS_INTERVALO_MIN * MIN);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      clearInterval(temporizador);
      log('detenido');
      process.exit(0);
    });
  }
}

void main();
