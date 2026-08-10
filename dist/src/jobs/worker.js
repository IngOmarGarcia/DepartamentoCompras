import { db, rpc } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { eventosService } from '../core/eventos.service.js';
/**
 * Worker de tareas periódicas:
 *   · libera reservas caducadas (devuelven el material a disponible)
 *   · genera requisiciones por punto de reorden
 *   · drena la cola de eventos hacia el webhook configurado
 */
const MIN = 60_000;
let ultimoReorden = 0;
function log(mensaje, extra) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[worker ${ts}] ${mensaje}`, extra !== undefined ? JSON.stringify(extra) : '');
}
async function organizacionesActivas() {
    const { data, error } = await db.from('organizaciones').select('id, nombre').eq('activa', true);
    if (error)
        throw new Error(`No se pudieron leer organizaciones: ${error.message}`);
    return (data ?? []);
}
async function liberarReservasExpiradas() {
    const r = await rpc('fn_liberar_reservas', {
        p_pedido_id: null,
        p_motivo: 'expiracion',
    });
    if (r.reservas_liberadas > 0)
        log('reservas expiradas liberadas', r);
}
async function reabastecer(orgs) {
    if (env.JOBS_REORDEN_HORAS <= 0)
        return;
    const debido = Date.now() - ultimoReorden >= env.JOBS_REORDEN_HORAS * 60 * MIN;
    if (!debido)
        return;
    ultimoReorden = Date.now();
    for (const org of orgs) {
        try {
            const r = await rpc('fn_generar_requisiciones_reorden', {
                p_org: org.id,
            });
            if (r.productos > 0)
                log(`reabastecimiento ${org.nombre}`, r);
        }
        catch (e) {
            log(`fallo reabastecimiento ${org.nombre}`, e.message);
        }
    }
}
async function ciclo() {
    try {
        const orgs = await organizacionesActivas();
        await liberarReservasExpiradas();
        await reabastecer(orgs);
        const eventos = await eventosService.drenar(200);
        if (eventos.procesados || eventos.fallidos)
            log('eventos drenados', eventos);
    }
    catch (e) {
        log('error en ciclo', e.message);
    }
}
async function main() {
    log(`iniciado · intervalo ${env.JOBS_INTERVALO_MIN} min · reorden cada ${env.JOBS_REORDEN_HORAS} h · webhook ${env.WEBHOOK_URL ? 'activo' : 'sin configurar'}`);
    await ciclo();
    const temporizador = setInterval(() => void ciclo(), env.JOBS_INTERVALO_MIN * MIN);
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => {
            clearInterval(temporizador);
            log('detenido');
            process.exit(0);
        });
    }
}
void main();
//# sourceMappingURL=worker.js.map