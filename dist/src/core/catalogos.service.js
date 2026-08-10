import { db, consultar } from '../lib/supabase.js';
import { AppError, desdePostgres } from '../lib/errors.js';
/** `23505` genérico → mensaje que le sirve a quien está llenando el formulario. */
function duplicado(error, codigo, mensaje) {
    return error?.code === '23505' ? new AppError(codigo, mensaje, 409) : desdePostgres(error);
}
/** Catálogos dinámicos: lo que hace al sistema agnóstico al giro. */
export const catalogosService = {
    async listarProductos(ctx, filtros) {
        return consultar(async (client) => {
            let q = client
                .from('productos')
                .select(`id, sku, nombre, descripcion, es_inventariable, es_comprable, costo_promedio, ultimo_costo,
           stock_minimo, stock_maximo, punto_reorden, lead_time_dias, atributos, metadata, activo,
           categoria:categorias(id, codigo, nombre), unidad:unidades_medida(id, codigo, nombre, decimales)`, { count: 'exact' })
                .eq('organizacion_id', ctx.organizacionId)
                .order('sku')
                .range(filtros.offset, filtros.offset + filtros.limite - 1);
            if (filtros.categoria_id)
                q = q.eq('categoria_id', filtros.categoria_id);
            if (filtros.buscar)
                q = q.or(`sku.ilike.%${filtros.buscar}%,nombre.ilike.%${filtros.buscar}%`);
            return q;
        });
    },
    async crearProducto(ctx, input) {
        let unidadId = input.unidad_medida_id;
        if (!unidadId) {
            const codigo = input.unidad_codigo ?? 'PZA';
            const { data, error } = await db
                .from('unidades_medida')
                .select('id')
                .eq('organizacion_id', ctx.organizacionId)
                .ilike('codigo', codigo)
                .maybeSingle();
            if (error)
                throw desdePostgres(error);
            if (!data)
                throw new AppError('UNIDAD_NO_ENCONTRADA', `Unidad de medida "${codigo}" inexistente`, 422);
            unidadId = data.id;
        }
        const { unidad_codigo: _omitida, ...resto } = input;
        const { data, error } = await db
            .from('productos')
            .insert({ ...resto, unidad_medida_id: unidadId, organizacion_id: ctx.organizacionId })
            .select('*')
            .single();
        if (error)
            throw duplicado(error, 'SKU_DUPLICADO', `Ya existe un producto con el SKU "${input.sku}"`);
        return data;
    },
    async actualizarProducto(ctx, id, cambios) {
        const { unidad_codigo: _o, ...resto } = cambios;
        const { data, error } = await db
            .from('productos')
            .update(resto)
            .eq('organizacion_id', ctx.organizacionId)
            .eq('id', id)
            .select('*')
            .maybeSingle();
        if (error)
            throw desdePostgres(error);
        if (!data)
            throw desdePostgres({ code: 'PGRST116' });
        return data;
    },
    async listarAlmacenes(ctx) {
        return consultar(async (client) => client
            .from('almacenes')
            .select('*')
            .eq('organizacion_id', ctx.organizacionId)
            .order('prioridad'));
    },
    async listarCategorias(ctx) {
        return consultar(async (client) => client.from('categorias').select('*').eq('organizacion_id', ctx.organizacionId).order('ruta'));
    },
    /**
     * Alta de categoría. `ruta` se materializa como PADRE/HIJO para que el árbol
     * se pueda leer sin recursión desde el front.
     */
    async crearCategoria(ctx, input) {
        let ruta = input.codigo.toUpperCase();
        if (input.padre_id) {
            const { data: padre, error: ePadre } = await db
                .from('categorias')
                .select('codigo, ruta')
                .eq('organizacion_id', ctx.organizacionId)
                .eq('id', input.padre_id)
                .maybeSingle();
            if (ePadre)
                throw desdePostgres(ePadre);
            if (!padre)
                throw new AppError('CATEGORIA_NO_ENCONTRADA', 'La categoría padre no existe', 404);
            ruta = `${padre.ruta ?? String(padre.codigo).toUpperCase()}/${ruta}`;
        }
        const { data, error } = await db
            .from('categorias')
            .insert({ ...input, ruta, organizacion_id: ctx.organizacionId })
            .select('*')
            .single();
        if (error)
            throw duplicado(error, 'CATEGORIA_DUPLICADA', `Ya existe una categoría con el código "${input.codigo}"`);
        return data;
    },
    async listarUnidades(ctx) {
        return consultar(async (client) => client.from('unidades_medida').select('*').eq('organizacion_id', ctx.organizacionId).order('codigo'));
    },
    async crearUnidad(ctx, input) {
        const { data, error } = await db
            .from('unidades_medida')
            .insert({ ...input, organizacion_id: ctx.organizacionId })
            .select('*')
            .single();
        if (error)
            throw duplicado(error, 'UNIDAD_DUPLICADA', `Ya existe una unidad con el código "${input.codigo}"`);
        return data;
    },
    /** Esquema de atributos dinámicos: el front lo usa para pintar formularios sin recompilar. */
    async esquemaAtributos(ctx, categoriaId) {
        return consultar(async (client) => {
            let q = client
                .from('atributos_definicion')
                .select('*')
                .eq('organizacion_id', ctx.organizacionId)
                .order('orden');
            if (categoriaId)
                q = q.or(`categoria_id.eq.${categoriaId},categoria_id.is.null`);
            return q;
        });
    },
    async reglas(ctx) {
        return consultar(async (client) => client.from('reglas_negocio').select('*').eq('organizacion_id', ctx.organizacionId).order('clave'));
    },
    async actualizarRegla(ctx, clave, valor, descripcion) {
        const { data, error } = await db
            .from('reglas_negocio')
            .upsert({ organizacion_id: ctx.organizacionId, clave, valor, descripcion, actualizado_en: new Date().toISOString() }, { onConflict: 'organizacion_id,clave' })
            .select('*')
            .single();
        if (error)
            throw desdePostgres(error);
        return data;
    },
};
//# sourceMappingURL=catalogos.service.js.map