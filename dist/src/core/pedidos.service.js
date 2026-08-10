import { db, rpc, consultar } from '../lib/supabase.js';
import { desdePostgres } from '../lib/errors.js';
/**
 * FLUJO OPERATIVO PRINCIPAL
 *   recibir()  → crea el requerimiento
 *   validar()  → consulta stock:  hay → reserva  |  no hay → requisición de compra
 *   surtir()   → convierte la reserva en salida física
 */
export const pedidosService = {
    /** Paso 1 y 2 del flujo, atómicos en una sola transacción de base de datos. */
    async recibir(ctx, input) {
        const payload = {
            organizacion_id: ctx.organizacionId,
            origen: input.origen,
            referencia_externa: input.referencia_externa ?? null,
            solicitante_id: input.solicitante_id ?? ctx.usuarioId,
            centro_costo: input.centro_costo ?? null,
            almacen_preferente: input.almacen_preferente ?? null,
            prioridad: input.prioridad,
            fecha_requerida: input.fecha_requerida ?? null,
            notas: input.notas ?? null,
            metadata: { ...(input.metadata ?? {}), creado_por: ctx.actor },
            items: input.items,
        };
        const fn = input.procesar ? 'fn_recibir_y_procesar_pedido' : 'fn_crear_pedido';
        const data = await rpc(fn, { p_payload: payload });
        return normalizar(data);
    },
    /** Re-ejecuta la validación de stock (p. ej. tras una recepción de compra). */
    async validar(ctx, pedidoId, usuarioId) {
        const data = await rpc('fn_procesar_pedido', {
            p_pedido_id: pedidoId,
            p_usuario_id: usuarioId ?? ctx.usuarioId,
        });
        return normalizar(data);
    },
    /** Salida física de almacén contra las reservas activas. */
    async surtir(ctx, input) {
        return rpc('fn_surtir_pedido', {
            p_pedido_id: input.pedido_id,
            p_items: input.items ?? null,
            p_usuario_id: input.usuario_id ?? ctx.usuarioId,
        });
    },
    async cancelar(_ctx, input) {
        return rpc('fn_cancelar_pedido', { p_pedido_id: input.pedido_id, p_motivo: input.motivo ?? null });
    },
    /** Libera reservas caducadas de toda la organización (job periódico). */
    async liberarExpiradas() {
        return rpc('fn_liberar_reservas', { p_pedido_id: null, p_motivo: 'expiracion' });
    },
    async listar(ctx, filtros) {
        return consultar(async (client) => {
            let q = client
                .from('pedidos')
                .select(`id, folio, origen, referencia_externa, estatus, prioridad, fecha_requerida,
           centro_costo, notas, creado_en, actualizado_en,
           almacen_preferente, solicitante_id,
           items:pedido_items(
             id, linea, cantidad_solicitada, cantidad_reservada, cantidad_surtida, cantidad_en_compra,
             producto:productos(id, sku, nombre)
           )`, { count: 'exact' })
                .eq('organizacion_id', ctx.organizacionId)
                .order('creado_en', { ascending: false })
                .range(filtros.offset, filtros.offset + filtros.limite - 1);
            if (filtros.estatus)
                q = q.in('estatus', filtros.estatus.split(','));
            if (filtros.desde)
                q = q.gte('creado_en', filtros.desde);
            if (filtros.hasta)
                q = q.lte('creado_en', filtros.hasta);
            if (filtros.buscar)
                q = q.or(`folio.ilike.%${filtros.buscar}%,referencia_externa.ilike.%${filtros.buscar}%`);
            return q;
        });
    },
    async obtener(ctx, pedidoId) {
        const { data, error } = await db
            .from('pedidos')
            .select(`*,
         items:pedido_items(
           *, producto:productos(id, sku, nombre, unidad_medida_id),
           reservas:reservas(id, almacen_id, cantidad, estatus, expira_en)
         ),
         requisiciones:requisiciones(id, folio, estatus, creado_en)`)
            .eq('organizacion_id', ctx.organizacionId)
            .eq('id', pedidoId)
            .maybeSingle();
        if (error)
            throw desdePostgres(error);
        if (!data)
            throw desdePostgres({ code: 'PGRST116' });
        return data;
    },
    /** Cola de surtido para el dashboard de Almacén. */
    async colaSurtido(ctx) {
        return consultar(async (client) => client
            .from('v_pedidos_pendientes')
            .select('*')
            .eq('organizacion_id', ctx.organizacionId)
            .in('estatus', ['reservado_total', 'reservado_parcial', 'surtido_parcial'])
            .order('prioridad', { ascending: false })
            .order('fecha_requerida', { ascending: true, nullsFirst: false }));
    },
};
function normalizar(d) {
    return {
        ...d,
        total_solicitado: Number(d.total_solicitado ?? 0),
        total_faltante: Number(d.total_faltante ?? 0),
        total_sin_cubrir: Number(d.total_sin_cubrir ?? 0),
        reservas: (d.reservas ?? []).map((r) => ({ ...r, cantidad: Number(r.cantidad) })),
        faltantes: (d.faltantes ?? []).map((f) => ({ ...f, cantidad_faltante: Number(f.cantidad_faltante) })),
    };
}
//# sourceMappingURL=pedidos.service.js.map