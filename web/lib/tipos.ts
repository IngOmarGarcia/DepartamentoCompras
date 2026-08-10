export type Rol = 'admin' | 'compras' | 'almacen' | 'solicitante';

export interface Contexto {
  organizacionId: string;
  rol: Rol;
  usuarioId: string | null;
  actor: string;
  scopes: string[];
}

export interface Kpis {
  almacen?: {
    skus_activos: number;
    valor_inventario: number;
    unidades_reservadas: number;
    bajo_minimo: number;
    pedidos_por_surtir: number;
    movimientos_hoy: number;
    mermas_30d: number;
  };
  compras?: {
    requisiciones_abiertas: number;
    requisiciones_por_aprobar: number;
    ordenes_en_transito: number;
    monto_comprometido: number;
    proveedores_activos: number;
    gasto_30d: number;
  };
  global?: {
    pedidos_totales: number;
    pedidos_abiertos: number;
    usuarios_activos: number;
    almacenes: number;
    eventos_pendientes: number;
    fill_rate_30d: number;
  };
}

export interface AlertaStock {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  cantidad_total: number;
  reservado_total: number;
  disponible_total: number;
  punto_reorden: number;
  stock_minimo: number;
  requiere_reorden: boolean;
}

export interface PedidoResumen {
  id: string;
  folio: string;
  estatus: string;
  prioridad: string;
  fecha_requerida: string | null;
  creado_en: string;
  lineas: number;
  total_solicitado: number;
  total_reservado: number;
  total_surtido: number;
  total_faltante: number;
}

export interface PedidoDetalle {
  id: string;
  folio: string;
  origen: string;
  referencia_externa: string | null;
  centro_costo: string | null;
  estatus: string;
  prioridad: string;
  fecha_requerida: string | null;
  notas: string | null;
  creado_en: string;
  items: Array<{
    id: string;
    linea: number;
    cantidad_solicitada: number;
    cantidad_reservada: number;
    cantidad_surtida: number;
    cantidad_en_compra: number;
    producto: { id: string; sku: string; nombre: string };
    reservas: Array<{ id: string; almacen_id: string; cantidad: number; estatus: string; expira_en: string | null }>;
  }>;
  requisiciones: Array<{ id: string; folio: string; estatus: string; creado_en: string }>;
}

export interface RequisicionResumen {
  id: string;
  folio: string;
  origen: string;
  estatus: string;
  prioridad: string;
  fecha_requerida: string | null;
  creado_en: string;
  pedido_id: string | null;
  pedido?: { folio: string; referencia_externa: string | null; centro_costo: string | null } | null;
  items: Array<{
    id: string;
    linea: number;
    cantidad: number;
    cantidad_ordenada: number;
    cantidad_recibida: number;
    precio_estimado: number;
    almacen_destino: string | null;
    producto: { id: string; sku: string; nombre: string; lead_time_dias: number; proveedor_default: string | null };
  }>;
}

export interface OrdenCompra {
  id: string;
  folio: string;
  estatus: string;
  moneda: string;
  subtotal: number;
  impuestos: number;
  total: number;
  fecha_emision: string;
  fecha_promesa: string | null;
  creado_en: string;
  proveedor: { id: string; codigo: string; razon_social: string } | null;
  items: Array<{
    id: string;
    linea: number;
    cantidad: number;
    cantidad_recibida: number;
    precio_unitario: number;
    importe: number;
    producto: { id: string; sku: string; nombre: string };
  }>;
}

export interface Sugerencia {
  requisicion_item_id: string;
  cantidad: number;
  producto: { sku: string; nombre: string; proveedor_default: string | null } | null;
  mejor_opcion: OpcionProveedor | null;
  opciones: OpcionProveedor[];
}

export interface OpcionProveedor {
  proveedor_id: string;
  precio: number;
  total: number;
  moneda: string;
  lead_time_dias: number;
  cantidad_minima: number;
  proveedor: { codigo: string; razon_social: string; dias_credito: number; calificacion: number | null } | null;
}

export interface Almacen {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  prioridad: number;
  activo: boolean;
}

export interface Producto {
  id: string;
  sku: string;
  nombre: string;
  descripcion: string | null;
  es_inventariable: boolean;
  es_comprable: boolean;
  costo_promedio: number;
  ultimo_costo: number;
  stock_minimo: number;
  stock_maximo: number | null;
  punto_reorden: number;
  lead_time_dias: number;
  activo: boolean;
  atributos: Record<string, unknown>;
  categoria: { id: string; codigo: string; nombre: string } | null;
  unidad: { id: string; codigo: string; nombre: string; decimales: number } | null;
}

export interface Categoria {
  id: string;
  padre_id: string | null;
  codigo: string;
  nombre: string;
  /** Ruta materializada `PADRE/HIJO` — evita recursión en el front. */
  ruta: string | null;
  activa: boolean;
}

export interface Unidad {
  id: string;
  codigo: string;
  nombre: string;
  decimales: number;
  activa: boolean;
}

export interface StockProducto {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  punto_reorden: number;
  stock_minimo: number;
  total: number;
  reservado: number;
  disponible: number;
  requiere_reorden: boolean;
  por_almacen: Array<{
    almacen_id: string;
    codigo: string;
    nombre: string;
    cantidad: number;
    reservado: number;
    disponible: number;
    ubicacion: string | null;
  }>;
}

/** Respuesta de `POST /api/inventario/existencias`. */
export interface ResultadoExistencia {
  cantidad_anterior: number;
  cantidad_final: number;
  delta: number;
  reservado: number;
  movimiento: { folio: string; saldo_posterior: number } | null;
}

export interface Evento {
  id: number;
  tipo: string;
  agregado_tipo: string;
  agregado_id: string;
  payload: Record<string, unknown>;
  creado_en: string;
}

export interface ResultadoValidacion {
  pedido_id: string;
  folio: string;
  estatus: string;
  total_solicitado: number;
  total_faltante: number;
  total_sin_cubrir: number;
  reservas: Array<{ reserva_id: string; sku: string; almacen_id: string; cantidad: number }>;
  faltantes: Array<{ sku: string; nombre: string; cantidad_faltante: number }>;
  requisicion: { id: string; folio: string; lineas: number } | null;
  accion: string;
  notificar: string[];
}
