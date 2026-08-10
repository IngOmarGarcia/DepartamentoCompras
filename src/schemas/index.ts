import { z } from 'zod';

/** Contratos de entrada compartidos por REST y MCP (única fuente de verdad). */

const uuid = z.string().uuid();
const cantidad = z.number().positive().finite();

export const PedidoItemInput = z
  .object({
    producto_id: uuid.optional(),
    sku: z.string().min(1).optional(),
    cantidad,
    precio_estimado: z.number().nonnegative().optional(),
    notas: z.string().max(500).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((v) => Boolean(v.producto_id || v.sku), {
    message: 'Debe indicar producto_id o sku',
    path: ['producto_id'],
  });

export const CrearPedidoInput = z.object({
  origen: z.enum(['interno', 'venta', 'obra', 'api', 'mcp']).default('interno'),
  referencia_externa: z.string().max(120).optional(),
  solicitante_id: uuid.optional(),
  centro_costo: z.string().max(60).optional(),
  almacen_preferente: uuid.optional(),
  prioridad: z.enum(['baja', 'normal', 'alta', 'urgente']).default('normal'),
  fecha_requerida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notas: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
  items: z.array(PedidoItemInput).min(1),
  /** true = ejecuta la validación de stock en la misma transacción. */
  procesar: z.boolean().default(true),
});

export const ConsultarStockInput = z.object({
  producto_ids: z.array(uuid).optional(),
  skus: z.array(z.string()).optional(),
  almacen_id: uuid.optional(),
  solo_bajo_minimo: z.boolean().default(false),
});

export const ProcesarPedidoInput = z.object({
  pedido_id: uuid,
  usuario_id: uuid.optional(),
});

export const SurtirPedidoInput = z.object({
  pedido_id: uuid,
  items: z.array(z.object({ pedido_item_id: uuid, cantidad })).optional(),
  usuario_id: uuid.optional(),
});

export const CancelarPedidoInput = z.object({
  pedido_id: uuid,
  motivo: z.string().max(300).optional(),
});

export const MovimientoInput = z.object({
  almacen_id: uuid,
  producto_id: uuid,
  tipo: z.enum([
    'entrada', 'salida', 'merma', 'ajuste_positivo', 'ajuste_negativo',
    'transferencia_entrada', 'transferencia_salida', 'devolucion_proveedor', 'devolucion_cliente',
  ]),
  cantidad,
  motivo: z.string().max(300).optional(),
  costo_unitario: z.number().nonnegative().optional(),
  lote: z.string().max(60).optional(),
  referencia_tipo: z.string().max(40).default('manual'),
  referencia_id: uuid.optional(),
  usuario_id: uuid.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const TransferenciaInput = z.object({
  producto_id: uuid,
  almacen_origen: uuid,
  almacen_destino: uuid,
  cantidad,
  motivo: z.string().max(300).optional(),
  usuario_id: uuid.optional(),
});

export const AprobarRequisicionInput = z.object({
  requisicion_id: uuid,
  /** Opcional: un actor con API Key (integración/MCP) no tiene perfil asociado. */
  aprobador_id: uuid.optional(),
  aprobar: z.boolean().default(true),
  motivo: z.string().max(300).optional(),
});

export const CrearOrdenCompraInput = z.object({
  proveedor_id: uuid,
  requisicion_id: uuid.optional(),
  almacen_destino: uuid.optional(),
  moneda: z.string().length(3).default('MXN'),
  tipo_cambio: z.number().positive().default(1),
  fecha_promesa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  comprador_id: uuid.optional(),
  condiciones_pago: z.string().max(200).optional(),
  notas: z.string().max(1000).optional(),
  estatus: z.enum(['borrador', 'enviada']).default('borrador'),
  metadata: z.record(z.unknown()).optional(),
  items: z
    .array(
      z.object({
        requisicion_item_id: uuid.optional(),
        producto_id: uuid.optional(),
        cantidad,
        precio_unitario: z.number().nonnegative().optional(),
        tasa_impuesto: z.number().min(0).max(1).default(0.16),
        metadata: z.record(z.unknown()).optional(),
      }).refine((v) => Boolean(v.requisicion_item_id || v.producto_id), {
        message: 'Debe indicar requisicion_item_id o producto_id',
      }),
    )
    .min(1),
});

export const RecibirOrdenCompraInput = z.object({
  orden_compra_id: uuid,
  almacen_id: uuid.optional(),
  factura_ref: z.string().max(80).optional(),
  usuario_id: uuid.optional(),
  items: z
    .array(
      z.object({
        orden_compra_item_id: uuid,
        cantidad,
        costo_unitario: z.number().nonnegative().optional(),
        rechazada: z.number().nonnegative().default(0),
        lote: z.string().max(60).optional(),
      }),
    )
    .min(1),
});

export const CrearProductoInput = z.object({
  sku: z.string().min(1).max(60),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(1000).optional(),
  categoria_id: uuid.optional(),
  unidad_medida_id: uuid.optional(),
  unidad_codigo: z.string().max(10).optional(),
  es_inventariable: z.boolean().default(true),
  es_comprable: z.boolean().default(true),
  stock_minimo: z.number().nonnegative().default(0),
  stock_maximo: z.number().nonnegative().optional(),
  punto_reorden: z.number().nonnegative().default(0),
  lead_time_dias: z.number().int().nonnegative().default(0),
  proveedor_default: uuid.optional(),
  ultimo_costo: z.number().nonnegative().default(0),
  atributos: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
});

export const CrearCategoriaInput = z.object({
  codigo: z.string().min(1).max(40),
  nombre: z.string().min(1).max(120),
  padre_id: uuid.optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const CrearUnidadInput = z.object({
  codigo: z.string().min(1).max(10),
  nombre: z.string().min(1).max(80),
  decimales: z.number().int().min(0).max(6).default(2),
});

/**
 * Fija la existencia física a un valor absoluto (lo que arrojó el conteo).
 * El servicio calcula el delta y emite el ajuste — el usuario no tiene que
 * razonar en términos de "cuánto sumar o restar".
 */
export const EstablecerStockInput = z.object({
  almacen_id: uuid,
  producto_id: uuid,
  cantidad: z.number().nonnegative().finite(),
  costo_unitario: z.number().nonnegative().optional(),
  motivo: z.string().max(300).optional(),
  usuario_id: uuid.optional(),
});

export const ListarInput = z.object({
  estatus: z.string().optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  buscar: z.string().max(120).optional(),
  // `coerce` porque los query strings llegan como texto y los payloads MCP como número.
  limite: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CrearPedidoInput = z.infer<typeof CrearPedidoInput>;
export type ConsultarStockInput = z.infer<typeof ConsultarStockInput>;
export type MovimientoInput = z.infer<typeof MovimientoInput>;
export type TransferenciaInput = z.infer<typeof TransferenciaInput>;
export type CrearOrdenCompraInput = z.infer<typeof CrearOrdenCompraInput>;
export type RecibirOrdenCompraInput = z.infer<typeof RecibirOrdenCompraInput>;
export type CrearProductoInput = z.infer<typeof CrearProductoInput>;
export type CrearCategoriaInput = z.infer<typeof CrearCategoriaInput>;
export type CrearUnidadInput = z.infer<typeof CrearUnidadInput>;
export type EstablecerStockInput = z.infer<typeof EstablecerStockInput>;
export type ListarInput = z.infer<typeof ListarInput>;
