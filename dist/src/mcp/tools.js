import { z } from 'zod';
import { pedidosService } from '../core/pedidos.service.js';
import { inventarioService } from '../core/inventario.service.js';
import { comprasService } from '../core/compras.service.js';
import { catalogosService } from '../core/catalogos.service.js';
import { dashboardService } from '../core/dashboard.service.js';
import { CrearPedidoInput, ConsultarStockInput, MovimientoInput, TransferenciaInput, CrearOrdenCompraInput, RecibirOrdenCompraInput, CrearProductoInput, ListarInput, SurtirPedidoInput, AprobarRequisicionInput, CancelarPedidoInput, CrearCategoriaInput, CrearUnidadInput, EstablecerStockInput, } from '../schemas/index.js';
function herramienta(h) {
    return h;
}
/**
 * CONTRATO MCP — un solo catálogo consumido por Claude, n8n, Make o cualquier
 * cliente que hable Model Context Protocol. Reusa exactamente los mismos
 * servicios que la API REST: cero lógica duplicada.
 */
export const HERRAMIENTAS = [
    // ── INVENTARIO ────────────────────────────────────────────────────────────
    herramienta({
        nombre: 'inventario_consultar_stock',
        titulo: 'Consultar stock',
        descripcion: 'Devuelve existencia total, cantidad reservada y disponible real por producto y por almacén. ' +
            'Acepta SKUs o UUIDs. Úsala antes de comprometer material.',
        esquema: ConsultarStockInput,
        soloLectura: true,
        ejecutar: (ctx, a) => inventarioService.consultarStock(ctx, a),
    }),
    herramienta({
        nombre: 'inventario_registrar_movimiento',
        titulo: 'Registrar movimiento de inventario',
        descripcion: 'Registra entrada, salida, merma o ajuste. Nunca consume stock ya reservado por un pedido; ' +
            'falla con DISPONIBLE_INSUFICIENTE si no alcanza.',
        esquema: MovimientoInput,
        soloLectura: false,
        ejecutar: (ctx, a) => inventarioService.registrarMovimiento(ctx, a),
    }),
    herramienta({
        nombre: 'inventario_establecer_stock',
        titulo: 'Fijar existencia por conteo',
        descripcion: 'Deja la existencia de un producto en un almacén EXACTAMENTE en la cantidad indicada. ' +
            'Calcula solo el ajuste necesario, así que sirve tanto para la carga inicial como para un ' +
            'conteo físico. Falla con DISPONIBLE_INSUFICIENTE si el objetivo queda por debajo de lo ya reservado.',
        esquema: EstablecerStockInput,
        soloLectura: false,
        ejecutar: (ctx, a) => inventarioService.establecerStock(ctx, a),
    }),
    herramienta({
        nombre: 'inventario_transferir',
        titulo: 'Transferir entre almacenes',
        descripcion: 'Mueve material de un almacén a otro con reversa automática si la entrada falla.',
        esquema: TransferenciaInput,
        soloLectura: false,
        ejecutar: (ctx, a) => inventarioService.transferir(ctx, a),
    }),
    herramienta({
        nombre: 'inventario_alertas_reorden',
        titulo: 'Alertas de punto de reorden',
        descripcion: 'Lista productos en o por debajo del punto de reorden.',
        esquema: z.object({}),
        soloLectura: true,
        ejecutar: (ctx) => inventarioService.alertasReorden(ctx),
    }),
    herramienta({
        nombre: 'inventario_kardex',
        titulo: 'Kardex',
        descripcion: 'Historial de movimientos con saldo posterior, filtrable por producto, almacén y fechas.',
        esquema: ListarInput.extend({ producto_id: z.string().uuid().optional(), almacen_id: z.string().uuid().optional() }),
        soloLectura: true,
        ejecutar: (ctx, a) => inventarioService.kardex(ctx, a),
    }),
    // ── FLUJO PRINCIPAL ───────────────────────────────────────────────────────
    herramienta({
        nombre: 'pedido_recibir',
        titulo: 'Recibir pedido y validar stock',
        descripcion: 'FLUJO PRINCIPAL. Da de alta el requerimiento y en la misma transacción valida stock: ' +
            'lo disponible se APARTA (reserva) y lo faltante genera automáticamente una REQUISICIÓN DE COMPRA. ' +
            'El campo `accion` indica a quién notificar: NOTIFICAR_ALMACEN_SURTIR o NOTIFICAR_COMPRAS_COTIZAR.',
        esquema: CrearPedidoInput,
        soloLectura: false,
        ejecutar: (ctx, a) => pedidosService.recibir(ctx, a),
    }),
    herramienta({
        nombre: 'pedido_validar_stock',
        titulo: 'Re-validar stock de un pedido',
        descripcion: 'Vuelve a correr la asignación de stock sobre un pedido existente (útil tras una recepción de compra).',
        esquema: z.object({ pedido_id: z.string().uuid(), usuario_id: z.string().uuid().optional() }),
        soloLectura: false,
        ejecutar: (ctx, a) => pedidosService.validar(ctx, a.pedido_id, a.usuario_id),
    }),
    herramienta({
        nombre: 'pedido_surtir',
        titulo: 'Surtir pedido',
        descripcion: 'Convierte las reservas activas en salidas físicas de almacén. Sin `items`, surte todo lo reservado.',
        esquema: SurtirPedidoInput,
        soloLectura: false,
        ejecutar: (ctx, a) => pedidosService.surtir(ctx, a),
    }),
    herramienta({
        nombre: 'pedido_cancelar',
        titulo: 'Cancelar pedido',
        descripcion: 'Cancela el pedido, libera reservas y cancela requisiciones abiertas asociadas.',
        esquema: CancelarPedidoInput,
        soloLectura: false,
        ejecutar: (ctx, a) => pedidosService.cancelar(ctx, a),
    }),
    herramienta({
        nombre: 'pedido_listar',
        titulo: 'Listar pedidos',
        descripcion: 'Pedidos con sus líneas y avance (solicitado / reservado / surtido / en compra).',
        esquema: ListarInput,
        soloLectura: true,
        ejecutar: (ctx, a) => pedidosService.listar(ctx, a),
    }),
    herramienta({
        nombre: 'pedido_obtener',
        titulo: 'Detalle de pedido',
        descripcion: 'Pedido completo con reservas por almacén y requisiciones derivadas.',
        esquema: z.object({ pedido_id: z.string().uuid() }),
        soloLectura: true,
        ejecutar: (ctx, a) => pedidosService.obtener(ctx, a.pedido_id),
    }),
    herramienta({
        nombre: 'almacen_cola_surtido',
        titulo: 'Cola de surtido',
        descripcion: 'Pedidos con material apartado listos para que Almacén los surta, ordenados por prioridad.',
        esquema: z.object({}),
        soloLectura: true,
        ejecutar: (ctx) => pedidosService.colaSurtido(ctx),
    }),
    // ── COMPRAS ───────────────────────────────────────────────────────────────
    herramienta({
        nombre: 'compras_listar_requisiciones',
        titulo: 'Listar requisiciones',
        descripcion: 'Requisiciones abiertas generadas por faltante de stock o punto de reorden.',
        esquema: ListarInput,
        soloLectura: true,
        ejecutar: (ctx, a) => comprasService.listarRequisiciones(ctx, a),
    }),
    herramienta({
        nombre: 'compras_sugerir_proveedores',
        titulo: 'Sugerir proveedores',
        descripcion: 'Para cada línea de la requisición, devuelve proveedores con precio vigente ordenados por costo y lead time.',
        esquema: z.object({ requisicion_id: z.string().uuid() }),
        soloLectura: true,
        ejecutar: (ctx, a) => comprasService.sugerirProveedores(ctx, a.requisicion_id),
    }),
    herramienta({
        nombre: 'compras_aprobar_requisicion',
        titulo: 'Aprobar o rechazar requisición',
        descripcion: 'Aprueba o rechaza. Al rechazar, libera el "en compra" de las líneas del pedido origen.',
        esquema: AprobarRequisicionInput,
        soloLectura: false,
        ejecutar: (ctx, a) => comprasService.aprobarRequisicion(ctx, a),
    }),
    herramienta({
        nombre: 'compras_crear_orden',
        titulo: 'Crear orden de compra',
        descripcion: 'Emite una OC contra una requisición. Calcula subtotal/impuestos y descuenta el pendiente por comprar.',
        esquema: CrearOrdenCompraInput,
        soloLectura: false,
        ejecutar: (ctx, a) => comprasService.crearOrdenCompra(ctx, a),
    }),
    herramienta({
        nombre: 'compras_recibir_orden',
        titulo: 'Recibir mercancía de una OC',
        descripcion: 'Genera entradas de inventario, recalcula costo promedio ponderado, cierra la requisición y ' +
            'RE-DISPARA la validación de stock de los pedidos que esperaban ese material.',
        esquema: RecibirOrdenCompraInput,
        soloLectura: false,
        ejecutar: (ctx, a) => comprasService.recibirOrdenCompra(ctx, a),
    }),
    herramienta({
        nombre: 'compras_listar_ordenes',
        titulo: 'Listar órdenes de compra',
        descripcion: 'Órdenes con proveedor, montos y avance de recepción.',
        esquema: ListarInput,
        soloLectura: true,
        ejecutar: (ctx, a) => comprasService.listarOrdenes(ctx, a),
    }),
    // ── CATÁLOGOS Y DASHBOARDS ────────────────────────────────────────────────
    herramienta({
        nombre: 'catalogo_listar_productos',
        titulo: 'Listar productos',
        descripcion: 'Catálogo con atributos dinámicos por categoría (agnóstico al giro).',
        esquema: ListarInput.extend({ categoria_id: z.string().uuid().optional() }),
        soloLectura: true,
        ejecutar: (ctx, a) => catalogosService.listarProductos(ctx, a),
    }),
    herramienta({
        nombre: 'catalogo_crear_producto',
        titulo: 'Crear producto',
        descripcion: 'Alta de producto o servicio. `es_inventariable:false` ⇒ siempre va a compras, nunca a stock.',
        esquema: CrearProductoInput,
        soloLectura: false,
        ejecutar: (ctx, a) => catalogosService.crearProducto(ctx, a),
    }),
    herramienta({
        nombre: 'catalogo_actualizar_producto',
        titulo: 'Actualizar producto',
        descripcion: 'Modifica campos del producto: mínimos, punto de reorden, lead time, categoría, costos o `activo`. ' +
            'Solo se tocan las claves enviadas.',
        esquema: CrearProductoInput.partial().extend({ producto_id: z.string().uuid() }),
        soloLectura: false,
        ejecutar: (ctx, a) => {
            const { producto_id, ...cambios } = a;
            return catalogosService.actualizarProducto(ctx, producto_id, cambios);
        },
    }),
    herramienta({
        nombre: 'catalogo_listar_categorias',
        titulo: 'Listar categorías',
        descripcion: 'Árbol de categorías con su ruta materializada (PADRE/HIJO).',
        esquema: z.object({}),
        soloLectura: true,
        ejecutar: (ctx) => catalogosService.listarCategorias(ctx),
    }),
    herramienta({
        nombre: 'catalogo_crear_categoria',
        titulo: 'Crear categoría',
        descripcion: 'Da de alta una categoría del catálogo. Con `padre_id` cuelga del árbol existente. ' +
            'Es el mecanismo con el que el sistema se adapta a cualquier giro sin cambiar el esquema.',
        esquema: CrearCategoriaInput,
        soloLectura: false,
        ejecutar: (ctx, a) => catalogosService.crearCategoria(ctx, a),
    }),
    herramienta({
        nombre: 'catalogo_crear_unidad',
        titulo: 'Crear unidad de medida',
        descripcion: 'Alta de unidad (PZA, M3, TON, HR, SRV…) con los decimales que maneja.',
        esquema: CrearUnidadInput,
        soloLectura: false,
        ejecutar: (ctx, a) => catalogosService.crearUnidad(ctx, a),
    }),
    herramienta({
        nombre: 'catalogo_listar_almacenes',
        titulo: 'Listar almacenes',
        descripcion: 'Almacenes activos con su prioridad de surtido.',
        esquema: z.object({}),
        soloLectura: true,
        ejecutar: (ctx) => catalogosService.listarAlmacenes(ctx),
    }),
    herramienta({
        nombre: 'config_reglas_negocio',
        titulo: 'Leer reglas de negocio',
        descripcion: 'Configuración que altera el comportamiento del flujo sin tocar código.',
        esquema: z.object({}),
        soloLectura: true,
        ejecutar: (ctx) => catalogosService.reglas(ctx),
    }),
    herramienta({
        nombre: 'config_actualizar_regla',
        titulo: 'Actualizar regla de negocio',
        descripcion: 'Cambia una regla: permitir_stock_negativo, auto_generar_requisicion, reserva_parcial, ' +
            'horas_expiracion_reserva, estrategia_asignacion, permitir_multi_almacen.',
        esquema: z.object({ clave: z.string(), valor: z.unknown(), descripcion: z.string().optional() }),
        soloLectura: false,
        ejecutar: (ctx, a) => catalogosService.actualizarRegla(ctx, a.clave, a.valor, a.descripcion),
    }),
    herramienta({
        nombre: 'dashboard_resumen',
        titulo: 'Resumen de dashboard',
        descripcion: 'KPIs + alertas + bandejas del rol indicado (admin | compras | almacen).',
        esquema: z.object({ rol: z.enum(['admin', 'compras', 'almacen']).optional() }),
        soloLectura: true,
        ejecutar: (ctx, a) => dashboardService.resumen(ctx, a.rol),
    }),
];
export const HERRAMIENTAS_POR_NOMBRE = new Map(HERRAMIENTAS.map((h) => [h.nombre, h]));
//# sourceMappingURL=tools.js.map