/** Errores de dominio con código estable, consumibles por REST y por MCP. */
export class AppError extends Error {
    codigo;
    status;
    detalle;
    constructor(codigo, message, status = 400, detalle) {
        super(message);
        this.codigo = codigo;
        this.status = status;
        this.detalle = detalle;
        this.name = 'AppError';
    }
    toJSON() {
        return { ok: false, error: { codigo: this.codigo, mensaje: this.message, detalle: this.detalle ?? null } };
    }
}
/** Códigos que las funciones plpgsql lanzan como `CODIGO: mensaje`. */
const MAPA_STATUS = {
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
/** Traduce un error de PostgREST/Postgres al contrato de errores del dominio. */
export function desdePostgres(error) {
    const raw = error?.message ?? 'Error desconocido de base de datos';
    const match = /^([A-Z_]{4,}):\s*(.*)$/s.exec(raw.trim());
    if (match) {
        const codigo = match[1];
        return new AppError(codigo, match[2].trim() || codigo, MAPA_STATUS[codigo] ?? 400, error?.details);
    }
    if (error?.code === '23505')
        return new AppError('DUPLICADO', 'El registro ya existe', 409, error.details);
    if (error?.code === '23503')
        return new AppError('REFERENCIA_INVALIDA', 'Referencia inexistente', 422, error.details);
    if (error?.code === '23514')
        return new AppError('RESTRICCION_VIOLADA', raw, 422, error.details);
    if (error?.code === '42501')
        return new AppError('SIN_PERMISO', 'Permiso denegado por RLS', 403, error.details);
    if (error?.code === 'PGRST116')
        return new AppError('NO_ENCONTRADO', 'Registro no encontrado', 404, error.details);
    return new AppError('ERROR_BD', raw, 500, error?.details);
}
export function assert(cond, codigo, mensaje, status = 400) {
    if (!cond)
        throw new AppError(codigo, mensaje, status);
}
//# sourceMappingURL=errors.js.map