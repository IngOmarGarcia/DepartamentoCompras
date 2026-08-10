import { db, rpc, consultar } from '../lib/supabase.js';
import { AppError, desdePostgres } from '../lib/errors.js';
import type { Contexto, ResultadoMovimiento, StockProducto } from '../types/domain.js';
import type {
  ConsultarStockInput, MovimientoInput, TransferenciaInput, EstablecerStockInput, ListarInput,
} from '../schemas/index.js';

/** `existencias.cantidad` es numeric(18,4): el delta se compara con esa misma precisión. */
const redondear4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Resuelve SKUs → UUIDs dentro de la organización del contexto. */
async function resolverProductos(ctx: Contexto, skus: string[]): Promise<string[]> {
  if (!skus.length) return [];
  const { data, error } = await db
    .from('productos')
    .select('id, sku')
    .eq('organizacion_id', ctx.organizacionId)
    .in('sku', skus);
  if (error) throw desdePostgres(error);
  const encontrados = new Set((data ?? []).map((r) => r.sku as string));
  const faltan = skus.filter((s) => !encontrados.has(s));
  if (faltan.length) {
    throw new AppError('PRODUCTO_NO_ENCONTRADO', `SKU inexistente: ${faltan.join(', ')}`, 404);
  }
  return (data ?? []).map((r) => r.id as string);
}

export const inventarioService = {
  /** Fotografía de disponibilidad (total, reservado, disponible) por producto y almacén. */
  async consultarStock(ctx: Contexto, input: ConsultarStockInput): Promise<StockProducto[]> {
    const porSku = input.skus?.length ? await resolverProductos(ctx, input.skus) : [];
    const ids = [...new Set([...(input.producto_ids ?? []), ...porSku])];

    const data = await rpc<StockProducto[]>('fn_consultar_stock', {
      p_org: ctx.organizacionId,
      p_productos: ids.length ? ids : null,
      p_almacen_id: input.almacen_id ?? null,
    });

    const filas = (data ?? []).map(normalizarStock);
    return input.solo_bajo_minimo ? filas.filter((f) => f.requiere_reorden) : filas;
  },

  /** Entradas, salidas, mermas y ajustes. Valida disponible ≠ reservado en el motor SQL. */
  async registrarMovimiento(ctx: Contexto, input: MovimientoInput): Promise<ResultadoMovimiento> {
    const data = await rpc<ResultadoMovimiento>('fn_registrar_movimiento', {
      p_org: ctx.organizacionId,
      p_almacen_id: input.almacen_id,
      p_producto_id: input.producto_id,
      p_tipo: input.tipo,
      p_cantidad: input.cantidad,
      p_motivo: input.motivo ?? null,
      p_usuario_id: input.usuario_id ?? ctx.usuarioId,
      p_costo_unitario: input.costo_unitario ?? null,
      p_referencia_tipo: input.referencia_tipo,
      p_referencia_id: input.referencia_id ?? null,
      p_lote: input.lote ?? null,
      p_metadata: input.metadata ?? {},
    });
    return { ...data, cantidad: Number(data.cantidad), saldo_posterior: Number(data.saldo_posterior) };
  },

  /**
   * Fija la existencia a un valor absoluto (conteo físico o carga inicial).
   * Calcula el delta contra lo que hay y emite un solo ajuste, de modo que la
   * pantalla de catálogos pueda pedir "cuántas hay" en vez de "cuántas sumo".
   * Bajar por debajo de lo reservado falla con DISPONIBLE_INSUFICIENTE: el
   * motor SQL nunca deja consumir material ya apartado por un pedido.
   */
  async establecerStock(ctx: Contexto, input: EstablecerStockInput) {
    const { data, error } = await db
      .from('existencias')
      .select('cantidad, cantidad_reservada')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('almacen_id', input.almacen_id)
      .eq('producto_id', input.producto_id)
      .maybeSingle();
    if (error) throw desdePostgres(error);

    const anterior = Number(data?.cantidad ?? 0);
    const reservado = Number(data?.cantidad_reservada ?? 0);
    const delta = redondear4(input.cantidad - anterior);

    if (delta === 0) {
      return { cantidad_anterior: anterior, cantidad_final: anterior, delta: 0, reservado, movimiento: null };
    }

    const movimiento = await this.registrarMovimiento(ctx, {
      almacen_id: input.almacen_id,
      producto_id: input.producto_id,
      tipo: delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo',
      cantidad: Math.abs(delta),
      motivo: input.motivo ?? (anterior === 0 ? 'Carga inicial de existencias' : 'Ajuste por conteo físico'),
      costo_unitario: input.costo_unitario,
      referencia_tipo: 'conteo',
      usuario_id: input.usuario_id ?? ctx.usuarioId ?? undefined,
      metadata: { cantidad_anterior: anterior, cantidad_objetivo: input.cantidad },
    } as MovimientoInput);

    return {
      cantidad_anterior: anterior,
      cantidad_final: movimiento.saldo_posterior,
      delta,
      reservado,
      movimiento,
    };
  },

  /** Transferencia entre almacenes = salida + entrada correlacionadas. */
  async transferir(ctx: Contexto, input: TransferenciaInput) {
    if (input.almacen_origen === input.almacen_destino) {
      throw new AppError('TRANSFERENCIA_INVALIDA', 'Origen y destino deben diferir', 422);
    }
    const referencia = crypto.randomUUID();
    const salida = await this.registrarMovimiento(ctx, {
      almacen_id: input.almacen_origen,
      producto_id: input.producto_id,
      tipo: 'transferencia_salida',
      cantidad: input.cantidad,
      motivo: input.motivo ?? 'Transferencia entre almacenes',
      referencia_tipo: 'transferencia',
      referencia_id: referencia,
      usuario_id: input.usuario_id ?? ctx.usuarioId ?? undefined,
      metadata: { destino: input.almacen_destino },
    } as MovimientoInput);

    try {
      const entrada = await this.registrarMovimiento(ctx, {
        almacen_id: input.almacen_destino,
        producto_id: input.producto_id,
        tipo: 'transferencia_entrada',
        cantidad: input.cantidad,
        motivo: input.motivo ?? 'Transferencia entre almacenes',
        referencia_tipo: 'transferencia',
        referencia_id: referencia,
        usuario_id: input.usuario_id ?? ctx.usuarioId ?? undefined,
        metadata: { origen: input.almacen_origen },
      } as MovimientoInput);
      return { referencia, salida, entrada };
    } catch (e) {
      // Compensación: la entrada falló, se revierte la salida para no perder stock.
      await this.registrarMovimiento(ctx, {
        almacen_id: input.almacen_origen,
        producto_id: input.producto_id,
        tipo: 'transferencia_entrada',
        cantidad: input.cantidad,
        motivo: 'Reversa automática de transferencia fallida',
        referencia_tipo: 'transferencia_reversa',
        referencia_id: referencia,
        metadata: { error: (e as Error).message },
      } as MovimientoInput);
      throw e;
    }
  },

  /** Kardex paginado por almacén/producto. */
  async kardex(ctx: Contexto, filtros: ListarInput & { producto_id?: string; almacen_id?: string }) {
    return consultar(async (client) => {
      let q = client
        .from('v_kardex')
        .select('*', { count: 'exact' })
        .eq('organizacion_id', ctx.organizacionId)
        .order('creado_en', { ascending: false })
        .range(filtros.offset, filtros.offset + filtros.limite - 1);

      if (filtros.producto_id) q = q.eq('producto_id', filtros.producto_id);
      if (filtros.almacen_id) q = q.eq('almacen_id', filtros.almacen_id);
      if (filtros.desde) q = q.gte('creado_en', filtros.desde);
      if (filtros.hasta) q = q.lte('creado_en', filtros.hasta);
      return q;
    });
  },

  /** Productos en o bajo punto de reorden — alimenta la alerta del dashboard de Almacén. */
  async alertasReorden(ctx: Contexto) {
    return consultar(async (client) =>
      client
        .from('v_stock_consolidado')
        .select('*')
        .eq('organizacion_id', ctx.organizacionId)
        .eq('requiere_reorden', true)
        .order('disponible_total', { ascending: true }),
    );
  },

  /** Dispara requisiciones de reabastecimiento para todo lo que cruzó el punto de reorden. */
  async generarReabastecimiento(ctx: Contexto) {
    return rpc('fn_generar_requisiciones_reorden', { p_org: ctx.organizacionId });
  },
};

function normalizarStock(f: StockProducto): StockProducto {
  return {
    ...f,
    total: Number(f.total),
    reservado: Number(f.reservado),
    disponible: Number(f.disponible),
    punto_reorden: Number(f.punto_reorden),
    stock_minimo: Number(f.stock_minimo),
    por_almacen: (f.por_almacen ?? []).map((a) => ({
      ...a,
      cantidad: Number(a.cantidad),
      reservado: Number(a.reservado),
      disponible: Number(a.disponible),
    })),
  };
}
