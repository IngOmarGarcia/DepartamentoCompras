/** Errores de dominio con código estable, consumibles por REST y por MCP. */
export class AppError extends Error {
  constructor(
    public readonly codigo: string,
    message: string,
    public readonly status = 400,
    public readonly detalle?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return { ok: false, error: { codigo: this.codigo, mensaje: this.message, detalle: this.detalle ?? null } };
  }
}

/** Códigos que las funciones plpgsql lanzan como `CODIGO: mensaje`. */
const MAPA_STATUS: Record<string, number> = {
  PEDIDO_NO_ENCONTRADO: 404,
  PRODUCTO_NO_ENCONTRADO: 404,
  REQUISICION_NO_ENCONTRADA: 404,
  REQUISICION_ITEM_NO_ENCONTRADO: 404,
  ORDEN_COMPRA_NO_ENCONTRADA: 404,
  OC_ITEM_NO_ENCONTRADO: 404,
  STOCK_INSUFICIENTE: 409,
  DISPONIBLE_INSUFICIENTE: 409,
  SURTIDO_EXCEDE_RESERVA: 409,
  RECEPCION_EXCEDE_OC: 409,
  CANTIDAD_EXCEDE_REQUISICION: 409,
  RESERVAS_INCONSISTENTES: 409,
  PEDIDO_ESTATUS_INVALIDO: 409,
  REQUISICION_ESTATUS_INVALIDO: 409,
  REQUISICION_NO_APROBADA: 409,
  OC_ESTATUS_INVALIDO: 409,
  PEDIDO_CANCELADO: 409,
  CANTIDAD_INVALIDA: 422,
  ITEMS_REQUERIDOS: 422,
  ORG_REQUERIDA: 422,
  ALMACEN_DESTINO_REQUERIDO: 422,
  NO_AUTORIZADO: 401,
  SIN_PERMISO: 403,
};

/**
 * Códigos que significan "la base respondió, pero no tiene la estructura que
 * el código espera": esquema sin aplicar o desalineado respecto a db/*.sql.
 */
const CODIGOS_ESQUEMA = new Set([
  'PGRST200', // no existe la relación/FK que pide un embed
  'PGRST202', // no existe la función del rpc()
  'PGRST204', // columna ausente del cache de esquema
  'PGRST205', // tabla o vista ausente del cache de esquema
  '42P01',    // undefined_table
  '42703',    // undefined_column
  '42883',    // undefined_function
]);

/**
 * Fallos de infraestructura o configuración. No los provoca quien llama a la
 * API ni son parte del dominio, así que no deben salir como "error interno":
 * un `.env` mal apuntado o un esquema sin aplicar necesitan un código propio
 * para que el operador sepa qué revisar.
 */
function deInfraestructura(raw: string, code: string, detalle?: unknown): AppError | null {
  // El gateway de Supabase rechazó la credencial con la que corre el backend.
  if (/invalid api key|no api key found/i.test(raw)) {
    return new AppError(
      'CONFIG_SUPABASE',
      'Supabase rechazó la credencial del backend. Revisa que SUPABASE_URL y ' +
        'SUPABASE_SERVICE_ROLE_KEY sean del mismo proyecto.',
      503,
      detalle,
    );
  }

  // Nunca hubo respuesta: URL equivocada, proyecto pausado o red caída.
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(raw)) {
    return new AppError(
      'SUPABASE_INALCANZABLE',
      `No se pudo contactar a Supabase (${raw}). Verifica SUPABASE_URL y que el proyecto esté activo.`,
      503,
      detalle,
    );
  }

  if (CODIGOS_ESQUEMA.has(code)) {
    return new AppError(
      'ESQUEMA_DESALINEADO',
      `La base no tiene la estructura que espera la API [${code}]: ${raw}. ` +
        'Aplica db/01_schema.sql, db/02_functions.sql y db/03_rls.sql.',
      500,
      detalle,
    );
  }

  return null;
}

/** Traduce un error de PostgREST/Postgres al contrato de errores del dominio. */
export function desdePostgres(error: { message?: string; code?: string; details?: unknown } | null): AppError {
  const raw = error?.message ?? 'Error desconocido de base de datos';
  const match = /^([A-Z_]{4,}):\s*(.*)$/s.exec(raw.trim());

  if (match) {
    const codigo = match[1]!;
    return new AppError(codigo, match[2]!.trim() || codigo, MAPA_STATUS[codigo] ?? 400, error?.details);
  }

  const infra = deInfraestructura(raw.trim(), error?.code ?? '', error?.details);
  if (infra) return infra;

  if (error?.code === '23505') return new AppError('DUPLICADO', 'El registro ya existe', 409, error.details);
  if (error?.code === '23503') return new AppError('REFERENCIA_INVALIDA', 'Referencia inexistente', 422, error.details);
  if (error?.code === '23514') return new AppError('RESTRICCION_VIOLADA', raw, 422, error.details);
  if (error?.code === '42501') return new AppError('SIN_PERMISO', 'Permiso denegado por RLS', 403, error.details);
  if (error?.code === 'PGRST116') return new AppError('NO_ENCONTRADO', 'Registro no encontrado', 404, error.details);

  return new AppError('ERROR_BD', raw, 500, error?.details);
}

export function assert(cond: unknown, codigo: string, mensaje: string, status = 400): asserts cond {
  if (!cond) throw new AppError(codigo, mensaje, status);
}
