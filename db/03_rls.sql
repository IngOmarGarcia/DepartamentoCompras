-- ============================================================================
--  03_rls.sql — Aislamiento multi-tenant + permisos por rol.
--  El backend usa SERVICE_ROLE (bypassa RLS); el front usa ANON/JWT y queda
--  restringido por estas políticas.
-- ============================================================================

create or replace function fn_org_actual()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select organizacion_id from perfiles where id = auth.uid() and activo;
$$;

create or replace function fn_rol_actual()
returns rol_usuario language sql stable security definer set search_path = public, pg_temp as $$
  select rol from perfiles where id = auth.uid() and activo;
$$;

create or replace function fn_es(p_roles rol_usuario[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(fn_rol_actual() = any(p_roles), false);
$$;

-- ── Activación de RLS ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'organizaciones','perfiles','api_keys','reglas_negocio','folios',
    'unidades_medida','categorias','atributos_definicion','productos','almacenes',
    'proveedores','proveedor_productos','existencias','movimientos_inventario',
    'pedidos','pedido_items','reservas','requisiciones','requisicion_items',
    'ordenes_compra','orden_compra_items','recepciones','recepcion_items',
    'auditoria','eventos'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ── Plantilla: lectura para cualquier miembro de la organización ────────────
do $$
declare t text;
begin
  foreach t in array array[
    'reglas_negocio','unidades_medida','categorias','atributos_definicion',
    'productos','almacenes','proveedores','proveedor_productos','existencias',
    'movimientos_inventario','pedidos','pedido_items','reservas','requisiciones',
    'requisicion_items','ordenes_compra','orden_compra_items','recepciones',
    'recepcion_items','eventos'
  ] loop
    execute format('drop policy if exists p_%1$s_select on %1$s', t);
    execute format(
      'create policy p_%1$s_select on %1$s for select
       using (organizacion_id = fn_org_actual())', t);
  end loop;
end $$;

-- ── Identidad ───────────────────────────────────────────────────────────────
drop policy if exists p_org_select on organizaciones;
create policy p_org_select on organizaciones for select
  using (id = fn_org_actual());

drop policy if exists p_org_update on organizaciones;
create policy p_org_update on organizaciones for update
  using (id = fn_org_actual() and fn_es(array['admin']::rol_usuario[]));

drop policy if exists p_perfiles_select on perfiles;
create policy p_perfiles_select on perfiles for select
  using (organizacion_id = fn_org_actual());

drop policy if exists p_perfiles_admin on perfiles;
create policy p_perfiles_admin on perfiles for all
  using (organizacion_id = fn_org_actual() and fn_es(array['admin']::rol_usuario[]))
  with check (organizacion_id = fn_org_actual() and fn_es(array['admin']::rol_usuario[]));

-- api_keys, folios y auditoría: solo admin (y nunca exponen el secreto en claro).
drop policy if exists p_api_keys_admin on api_keys;
create policy p_api_keys_admin on api_keys for all
  using (organizacion_id = fn_org_actual() and fn_es(array['admin']::rol_usuario[]))
  with check (organizacion_id = fn_org_actual() and fn_es(array['admin']::rol_usuario[]));

drop policy if exists p_folios_admin on folios;
create policy p_folios_admin on folios for select
  using (organizacion_id = fn_org_actual() and fn_es(array['admin']::rol_usuario[]));

drop policy if exists p_auditoria_admin on auditoria;
create policy p_auditoria_admin on auditoria for select
  using (organizacion_id = fn_org_actual() and fn_es(array['admin']::rol_usuario[]));

-- ── Catálogos: escribe admin; compras mantiene proveedores/precios ─────────
do $$
declare t text;
begin
  foreach t in array array['unidades_medida','categorias','atributos_definicion','productos','almacenes','reglas_negocio'] loop
    execute format('drop policy if exists p_%1$s_write on %1$s', t);
    execute format(
      'create policy p_%1$s_write on %1$s for all
       using (organizacion_id = fn_org_actual() and fn_es(array[''admin'']::rol_usuario[]))
       with check (organizacion_id = fn_org_actual() and fn_es(array[''admin'']::rol_usuario[]))', t);
  end loop;

  foreach t in array array['proveedores','proveedor_productos'] loop
    execute format('drop policy if exists p_%1$s_write on %1$s', t);
    execute format(
      'create policy p_%1$s_write on %1$s for all
       using (organizacion_id = fn_org_actual() and fn_es(array[''admin'',''compras'']::rol_usuario[]))
       with check (organizacion_id = fn_org_actual() and fn_es(array[''admin'',''compras'']::rol_usuario[]))', t);
  end loop;
end $$;

-- ── Inventario: almacén y admin ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['existencias','movimientos_inventario','recepciones','recepcion_items'] loop
    execute format('drop policy if exists p_%1$s_write on %1$s', t);
    execute format(
      'create policy p_%1$s_write on %1$s for all
       using (organizacion_id = fn_org_actual() and fn_es(array[''admin'',''almacen'']::rol_usuario[]))
       with check (organizacion_id = fn_org_actual() and fn_es(array[''admin'',''almacen'']::rol_usuario[]))', t);
  end loop;
end $$;

-- ── Pedidos: crea cualquiera; mutan almacén/admin ──────────────────────────
drop policy if exists p_pedidos_insert on pedidos;
create policy p_pedidos_insert on pedidos for insert
  with check (organizacion_id = fn_org_actual());

drop policy if exists p_pedido_items_insert on pedido_items;
create policy p_pedido_items_insert on pedido_items for insert
  with check (organizacion_id = fn_org_actual());

do $$
declare t text;
begin
  foreach t in array array['pedidos','pedido_items','reservas'] loop
    execute format('drop policy if exists p_%1$s_update on %1$s', t);
    execute format(
      'create policy p_%1$s_update on %1$s for update
       using (organizacion_id = fn_org_actual() and fn_es(array[''admin'',''almacen'',''compras'']::rol_usuario[]))
       with check (organizacion_id = fn_org_actual())', t);
  end loop;
end $$;

-- ── Compras: requisiciones y órdenes ───────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['requisiciones','requisicion_items','ordenes_compra','orden_compra_items'] loop
    execute format('drop policy if exists p_%1$s_write on %1$s', t);
    execute format(
      'create policy p_%1$s_write on %1$s for all
       using (organizacion_id = fn_org_actual() and fn_es(array[''admin'',''compras'']::rol_usuario[]))
       with check (organizacion_id = fn_org_actual() and fn_es(array[''admin'',''compras'']::rol_usuario[]))', t);
  end loop;
end $$;

-- ── Grants (PostgREST) ──────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on
  pedidos, pedido_items, productos, almacenes, categorias, unidades_medida,
  proveedores, proveedor_productos, requisiciones, requisicion_items,
  ordenes_compra, orden_compra_items, recepciones, recepcion_items,
  movimientos_inventario, existencias, reservas, reglas_negocio, perfiles
to authenticated;

grant execute on function
  fn_consultar_stock(uuid, uuid[], uuid),
  fn_crear_pedido(jsonb),
  fn_procesar_pedido(uuid, uuid),
  fn_recibir_y_procesar_pedido(jsonb),
  fn_surtir_pedido(uuid, jsonb, uuid),
  fn_liberar_reservas(uuid, text),
  fn_cancelar_pedido(uuid, text),
  fn_aprobar_requisicion(uuid, uuid, boolean, text),
  fn_crear_orden_compra(jsonb),
  fn_recibir_orden_compra(uuid, jsonb, uuid, text, uuid),
  fn_registrar_movimiento(uuid, uuid, uuid, tipo_movimiento, numeric, text, uuid, numeric, text, uuid, text, jsonb),
  fn_generar_requisiciones_reorden(uuid),
  fn_kpis(uuid, text)
to authenticated;

-- Las claves de API jamás se exponen al rol del navegador.
revoke all on api_keys from anon, authenticated;
revoke all on auditoria from anon;
