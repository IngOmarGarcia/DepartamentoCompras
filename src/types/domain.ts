/** Tipos de dominio — espejo exacto de los ENUM/estructuras de Postgres. */

export type Rol = 'admin' | 'compras' | 'almacen' | 'solicitante';

export type EstatusPedido =
  | 'borrador' | 'recibido' | 'validando' | 'reservado_parcial' | 'reservado_total'
  | 'en_requisicion' | 'surtido_parcial' | 'surtido' | 'cancelado';

export type EstatusReserva = 'activa' | 'surtida' | 'liberada' | 'expirada';

export type TipoMovimiento =
  | 'entrada' | 'salida' | 'merma' | 'ajuste_positivo' | 'ajuste_negativo'
  | 'transferencia_entrada' | 'transferencia_salida' | 'devolucion_proveedor' | 'devolucion_cliente';

export type EstatusRequisicion =
  | 'abierta' | 'cotizando' | 'aprobada' | 'rechazada' | 'en_orden' | 'cerrada' | 'cancelada';

export type EstatusOrdenCompra =
  | 'borrador' | 'enviada' | 'confirmada' | 'recibida_parcial' | 'recibida' | 'cancelada';

export type Prioridad = 'baja' | 'normal' | 'alta' | 'urgente';

/** Identidad resuelta por el middleware; viaja por toda la capa de servicios. */
export interface Contexto {
  organizacionId: string;
  rol: Rol;
  usuarioId: string | null;
  actor: string;
  scopes: string[];
}

export interface ResultadoValidacionStock {
  pedido_id: string;
  folio: string;
  estatus: EstatusPedido;
  /** Suma de todas las líneas del pedido. */
  total_solicitado: number;
  /** Faltante detectado en esta corrida (lo que no había en almacén). */
  total_faltante: number;
  /** Lo que sigue sin reserva ni orden de compra tras la corrida. */
  total_sin_cubrir: number;
  reservas: Array<{
    reserva_id: string;
    pedido_item_id: string;
    sku: string;
    almacen_id: string;
    cantidad: number;
  }>;
  faltantes: Array<{
    pedido_item_id: string;
    producto_id: string;
    sku: string;
    nombre: string;
    cantidad_faltante: number;
  }>;
  requisicion: { id: string; folio: string; lineas: number } | null;
  accion:
    | 'NOTIFICAR_ALMACEN_SURTIR'
    | 'NOTIFICAR_COMPRAS_COTIZAR'
    | 'SURTIR_PARCIAL'
    | 'SIN_STOCK_SIN_REQUISICION';
  /** Dashboards que deben recibir aviso: puede ser ambos a la vez. */
  notificar: Array<'almacen' | 'compras'>;
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

export interface ResultadoMovimiento {
  movimiento_id: string;
  folio: string;
  tipo: TipoMovimiento;
  cantidad: number;
  saldo_posterior: number;
}
