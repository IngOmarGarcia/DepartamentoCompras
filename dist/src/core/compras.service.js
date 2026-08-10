import { db, rpc, consultar } from '../lib/supabase.js';
import { desdePostgres } from '../lib/errors.js';
export const comprasService = {
    /** Bandeja de requisiciones — origen: faltante de stock o punto de reorden. */
    async listarRequisiciones(ctx, filtros) {
        return consultar(async (client) => {
            let q = client
                .from('requisiciones')
                .select(`id, folio, origen, estatus, prioridad, fecha_requerida, pedido_id, creado_en,
           pedido:pedidos(folio, referencia_externa, centro_costo),
           items:requisicion_items(
             id, linea, cantidad, cantidad_ordenada, cantidad_recibida, precio_estimado, almacen_destino,
             producto:productos(id, sku, nombre, lead_time_dias, proveedor_default)
           )`, { count: 'exact' })
                .eq('organizacion_id', ctx.organizacionId)
                .order('creado_en', { ascending: false })
                .range(filtros.offset, filtros.offset + filtros.limite - 1);
            if (filtros.estatus)
                q = q.in('estatus', filtros.estatus.split(','));
            else
                q = q.not('estatus', 'in', '("cerrada","cancelada","rechazada")');
            if (filtros.buscar)
                q = q.ilike('folio', `%${filtros.buscar}%`);
            return q;
        });
    },
    async obtenerRequisicion(ctx, id) {
        const { data, error } = await db
            .from('requisiciones')
            .select('*, items:requisicion_items(*, producto:productos(id, sku, nombre, proveedor_default))')
            .eq('organizacion_id', ctx.organizacionId)
            .eq('id', id)
            .maybeSingle();
        if (error)
            throw desdePostgres(error);
        if (!data)
            throw desdePostgres({ code: 'PGRST116' });
        return data;
    },
    async aprobarRequisicion(ctx, input) {
        return rpc('fn_aprobar_requisicion', {
            p_requisicion_id: input.requisicion_id,
            p_aprobador_id: input.aprobador_id ?? ctx.usuarioId,
            p_aprobar: input.aprobar,
            p_motivo: input.motivo ?? null,
        });
    },
    /** Sugerencia de proveedores con precio vigente para cada línea de la requisición. */
    async sugerirProveedores(ctx, requisicionId) {
        const { data: items, error } = await db
            .from('requisicion_items')
            .select('id, producto_id, cantidad, producto:productos(sku, nombre, proveedor_default)')
            .eq('organizacion_id', ctx.organizacionId)
            .eq('requisicion_id', requisicionId);
        if (error)
            throw desdePostgres(error);
        const productoIds = (items ?? []).map((i) => i.producto_id);
        if (!productoIds.length)
            return [];
        const { data: precios, error: e2 } = await db
            .from('proveedor_productos')
            .select('producto_id, proveedor_id, precio, moneda, lead_time_dias, cantidad_minima, proveedor:proveedores(codigo, razon_social, dias_credito, calificacion)')
            .eq('organizacion_id', ctx.organizacionId)
            .eq('activo', true)
            .in('producto_id', productoIds)
            .lte('vigente_desde', new Date().toISOString().slice(0, 10));
        if (e2)
            throw desdePostgres(e2);
        return (items ?? []).map((it) => {
            const opciones = (precios ?? [])
                .filter((p) => p.producto_id === it.producto_id)
                .map((p) => ({ ...p, precio: Number(p.precio), total: Number(p.precio) * Number(it.cantidad) }))
                .sort((a, b) => a.precio - b.precio || a.lead_time_dias - b.lead_time_dias);
            return {
                requisicion_item_id: it.id,
                producto: it.producto,
                cantidad: Number(it.cantidad),
                mejor_opcion: opciones[0] ?? null,
                opciones,
            };
        });
    },
    /** Emisión de orden de compra: descuenta pendiente de la requisición de forma atómica. */
    async crearOrdenCompra(ctx, input) {
        return rpc('fn_crear_orden_compra', {
            p_payload: {
                organizacion_id: ctx.organizacionId,
                ...input,
                comprador_id: input.comprador_id ?? ctx.usuarioId,
            },
        });
    },
    async obtenerOrden(ctx, id) {
        const { data, error } = await db
            .from('ordenes_compra')
            .select(`*, proveedor:proveedores(id, codigo, razon_social, dias_credito, contacto),
         almacen:almacenes!ordenes_compra_almacen_destino_fkey(id, codigo, nombre),
         items:orden_compra_items(*, producto:productos(id, sku, nombre)),
         recepciones:recepciones(id, folio, factura_ref, creado_en)`)
            .eq('organizacion_id', ctx.organizacionId)
            .eq('id', id)
            .maybeSingle();
        if (error)
            throw desdePostgres(error);
        if (!data)
            throw desdePostgres({ code: 'PGRST116' });
        return data;
    },
    async cambiarEstatusOrden(ctx, id, estatus) {
        const { data, error } = await db
            .from('ordenes_compra')
            .update({ estatus })
            .eq('organizacion_id', ctx.organizacionId)
            .eq('id', id)
            .select('id, folio, estatus')
            .maybeSingle();
        if (error)
            throw desdePostgres(error);
        if (!data)
            throw desdePostgres({ code: 'PGRST116' });
        return data;
    },
    /**
     * Recepción de mercancía: genera entradas de inventario, recalcula costo
     * promedio, cierra la requisición y RE-DISPARA la validación de stock de los
     * pedidos que estaban esperando ese material.
     */
    async recibirOrdenCompra(ctx, input) {
        return rpc('fn_recibir_orden_compra', {
            p_orden_compra_id: input.orden_compra_id,
            p_items: input.items,
            p_usuario_id: input.usuario_id ?? ctx.usuarioId,
            p_factura_ref: input.factura_ref ?? null,
            p_almacen_id: input.almacen_id ?? null,
        });
    },
    async listarOrdenes(ctx, filtros) {
        return consultar(async (client) => {
            let q = client
                .from('ordenes_compra')
                .select(`id, folio, estatus, moneda, subtotal, impuestos, total, fecha_emision, fecha_promesa, creado_en,
           proveedor:proveedores(id, codigo, razon_social),
           items:orden_compra_items(id, linea, cantidad, cantidad_recibida, precio_unitario, importe,
             producto:productos(id, sku, nombre))`, { count: 'exact' })
                .eq('organizacion_id', ctx.organizacionId)
                .order('creado_en', { ascending: false })
                .range(filtros.offset, filtros.offset + filtros.limite - 1);
            if (filtros.estatus)
                q = q.in('estatus', filtros.estatus.split(','));
            if (filtros.buscar)
                q = q.ilike('folio', `%${filtros.buscar}%`);
            return q;
        });
    },
    async listarProveedores(ctx, filtros) {
        return consultar(async (client) => {
            let q = client
                .from('proveedores')
                .select('*', { count: 'exact' })
                .eq('organizacion_id', ctx.organizacionId)
                .order('razon_social')
                .range(filtros.offset, filtros.offset + filtros.limite - 1);
            if (filtros.buscar)
                q = q.or(`razon_social.ilike.%${filtros.buscar}%,codigo.ilike.%${filtros.buscar}%`);
            return q;
        });
    },
};
//# sourceMappingURL=compras.service.js.map