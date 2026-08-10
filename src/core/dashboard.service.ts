import { rpc, consultar } from '../lib/supabase.js';
import type { Contexto, Rol } from '../types/domain.js';

/** Agregados listos para pintar cada uno de los 3 dashboards. */
export const dashboardService = {
  async kpis(ctx: Contexto, rol?: Rol) {
    return rpc<Record<string, unknown>>('fn_kpis', {
      p_org: ctx.organizacionId,
      p_rol: rol ?? ctx.rol,
    });
  },

  /** Payload completo del dashboard según el rol que consulta. */
  async resumen(ctx: Contexto, rol?: Rol) {
    const efectivo = rol ?? ctx.rol;
    const [kpis, alertas, pendientes, requisiciones, eventos] = await Promise.all([
      this.kpis(ctx, efectivo),
      efectivo === 'compras'
        ? Promise.resolve([])
        : consultar(async (c) =>
            c.from('v_stock_consolidado').select('*').eq('organizacion_id', ctx.organizacionId)
              .eq('requiere_reorden', true).order('disponible_total').limit(20)),
      efectivo === 'compras'
        ? Promise.resolve([])
        : consultar(async (c) =>
            c.from('v_pedidos_pendientes').select('*').eq('organizacion_id', ctx.organizacionId)
              .order('creado_en', { ascending: false }).limit(20)),
      efectivo === 'almacen'
        ? Promise.resolve([])
        : consultar(async (c) =>
            c.from('v_requisiciones_abiertas').select('*').eq('organizacion_id', ctx.organizacionId)
              .order('creado_en', { ascending: false }).limit(20)),
      consultar(async (c) =>
        c.from('eventos').select('id, tipo, agregado_tipo, agregado_id, payload, creado_en')
          .eq('organizacion_id', ctx.organizacionId)
          .order('creado_en', { ascending: false }).limit(25)),
    ]);

    return { rol: efectivo, kpis, alertas_stock: alertas, pedidos: pendientes, requisiciones, actividad: eventos };
  },

  async actividad(ctx: Contexto, limite = 50) {
    return consultar(async (c) =>
      c.from('eventos').select('*').eq('organizacion_id', ctx.organizacionId)
        .order('creado_en', { ascending: false }).limit(limite));
  },

  async auditoria(ctx: Contexto, limite = 100) {
    return consultar(async (c) =>
      c.from('auditoria').select('*').eq('organizacion_id', ctx.organizacionId)
        .order('creado_en', { ascending: false }).limit(limite));
  },
};
