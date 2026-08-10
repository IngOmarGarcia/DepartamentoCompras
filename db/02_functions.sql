-- ============================================================================
--  02_functions.sql — Lógica de negocio transaccional (fuente de verdad).
--  Todo lo que muta stock es atómico y se bloquea en el orden
--  (producto_id, almacen.prioridad, almacen.id) para evitar deadlocks.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- UTILIDADES
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_regla(p_org uuid, p_clave text, p_default jsonb)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select valor from reglas_negocio where organizacion_id = p_org and clave = p_clave), p_default);
$$;

create or replace function fn_siguiente_folio(p_org uuid, p_tipo text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_num bigint; v_prefijo text;
begin
  insert into folios (organizacion_id, tipo, prefijo, ultimo)
  values (p_org, p_tipo, p_tipo || '-', 1)
  on conflict (organizacion_id, tipo)
  do update set ultimo = folios.ultimo + 1
  returning ultimo, prefijo into v_num, v_prefijo;
  return v_prefijo || to_char(now(), 'YYYY') || '-' || lpad(v_num::text, 6, '0');
end $$;

create or replace function fn_signo_movimiento(p_tipo tipo_movimiento)
returns smallint language sql immutable as $$
  select case p_tipo
    when 'entrada' then 1
    when 'ajuste_positivo' then 1
    when 'transferencia_entrada' then 1
    when 'devolucion_cliente' then 1
    else -1
  end::smallint;
$$;

create or replace function trg_touch()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists tg_touch_productos on productos;
create trigger tg_touch_productos before update on productos
  for each row execute function trg_touch();
drop trigger if exists tg_touch_pedidos on pedidos;
create trigger tg_touch_pedidos before update on pedidos
  for each row execute function trg_touch();
drop trigger if exists tg_touch_requisiciones on requisiciones;
create trigger tg_touch_requisiciones before update on requisiciones
  for each row execute function trg_touch();
drop trigger if exists tg_touch_oc on ordenes_compra;
create trigger tg_touch_oc before update on ordenes_compra
  for each row execute function trg_touch();

create or replace function fn_emitir_evento(p_org uuid, p_tipo text, p_agr_tipo text, p_agr_id uuid, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into eventos (organizacion_id, tipo, agregado_tipo, agregado_id, payload)
  values (p_org, p_tipo, p_agr_tipo, p_agr_id, p_payload);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDITORÍA GENÉRICA
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function trg_auditoria()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_id text;
begin
  if tg_op = 'DELETE' then
    v_antes := to_jsonb(old); v_despues := null;
  elsif tg_op = 'UPDATE' then
    v_antes := to_jsonb(old); v_despues := to_jsonb(new);
    if v_antes = v_despues then return new; end if;
  else
    v_antes := null; v_despues := to_jsonb(new);
  end if;

  -- Identificador agnóstico: tablas con PK compuesta (reglas_negocio, folios)
  -- no tienen columna `id`.
  v_id := coalesce(
    coalesce(v_despues, v_antes) ->> 'id',
    coalesce(v_despues, v_antes) ->> 'clave',
    md5((coalesce(v_despues, v_antes))::text)
  );

  v_org := nullif(coalesce(v_despues, v_antes) ->> 'organizacion_id', '')::uuid;

  insert into auditoria (organizacion_id, tabla, registro_id, accion, usuario_id, actor, datos_antes, datos_despues)
  values (
    v_org, tg_table_name, v_id, tg_op,
    coalesce(
      nullif(current_setting('app.usuario_id', true), '')::uuid,
      nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    ),
    coalesce(
      nullif(current_setting('app.actor', true), ''),
      'jwt:' || nullif(current_setting('request.jwt.claim.sub', true), ''),
      'system'
    ),
    v_antes, v_despues
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'productos','almacenes','existencias','pedidos','pedido_items',
    'requisiciones','requisicion_items','ordenes_compra','orden_compra_items',
    'proveedores','reglas_negocio','perfiles'
  ] loop
    execute format('drop trigger if exists tg_audit_%1$s on %1$s', t);
    execute format(
      'create trigger tg_audit_%1$s after insert or update or delete on %1$s
       for each row execute function trg_auditoria()', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- MOTOR DE MOVIMIENTOS: aplica el delta sobre existencias de forma atómica
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function trg_aplicar_movimiento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_saldo numeric(18,4);
  v_reservado numeric(18,4);
  v_permite_neg boolean;
  v_delta numeric(18,4);
begin
  new.signo := fn_signo_movimiento(new.tipo);
  if new.folio is null or new.folio = '' then
    new.folio := fn_siguiente_folio(new.organizacion_id, 'MOV');
  end if;
  v_delta := new.signo * new.cantidad;

  insert into existencias (organizacion_id, almacen_id, producto_id, cantidad, cantidad_reservada)
  values (new.organizacion_id, new.almacen_id, new.producto_id, 0, 0)
  on conflict (almacen_id, producto_id) do nothing;

  select e.cantidad, e.cantidad_reservada into v_saldo, v_reservado
  from existencias e where e.almacen_id = new.almacen_id and e.producto_id = new.producto_id
  for update;

  v_saldo := v_saldo + v_delta;

  select (a.permite_negativo or (fn_regla(new.organizacion_id, 'permitir_stock_negativo', 'false'::jsonb))::boolean)
    into v_permite_neg
  from almacenes a where a.id = new.almacen_id;

  if v_saldo < 0 and not coalesce(v_permite_neg, false) then
    raise exception 'STOCK_INSUFICIENTE: producto % en almacén % (resultado %)',
      new.producto_id, new.almacen_id, v_saldo using errcode = 'P0001';
  end if;

  update existencias
     set cantidad = v_saldo, actualizado_en = now()
   where almacen_id = new.almacen_id and producto_id = new.producto_id;

  new.saldo_posterior := v_saldo;
  return new;
end $$;

drop trigger if exists tg_aplicar_movimiento on movimientos_inventario;
create trigger tg_aplicar_movimiento before insert on movimientos_inventario
  for each row execute function trg_aplicar_movimiento();

-- API pública de movimiento manual (entradas, mermas, ajustes).
create or replace function fn_registrar_movimiento(
  p_org uuid,
  p_almacen_id uuid,
  p_producto_id uuid,
  p_tipo tipo_movimiento,
  p_cantidad numeric,
  p_motivo text default null,
  p_usuario_id uuid default null,
  p_costo_unitario numeric default null,
  p_referencia_tipo text default 'manual',
  p_referencia_id uuid default null,
  p_lote text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mov movimientos_inventario%rowtype; v_disp numeric;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'CANTIDAD_INVALIDA: debe ser > 0' using errcode = 'P0001';
  end if;

  -- Una salida/merma nunca puede consumir stock ya reservado por un pedido.
  if fn_signo_movimiento(p_tipo) = -1 then
    select cantidad_disponible into v_disp from existencias
      where almacen_id = p_almacen_id and producto_id = p_producto_id for update;
    if coalesce(v_disp, 0) < p_cantidad
       and not (fn_regla(p_org, 'permitir_stock_negativo', 'false'::jsonb))::boolean then
      raise exception 'DISPONIBLE_INSUFICIENTE: disponible %, solicitado %',
        coalesce(v_disp,0), p_cantidad using errcode = 'P0001';
    end if;
  end if;

  insert into movimientos_inventario (
    organizacion_id, almacen_id, producto_id, tipo, cantidad, signo,
    costo_unitario, referencia_tipo, referencia_id, lote, motivo, usuario_id, metadata
  ) values (
    p_org, p_almacen_id, p_producto_id, p_tipo, p_cantidad, 1,
    coalesce(p_costo_unitario, (select ultimo_costo from productos where id = p_producto_id), 0),
    p_referencia_tipo, p_referencia_id, p_lote, p_motivo, p_usuario_id, coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_mov;

  perform fn_emitir_evento(p_org, 'inventario.movimiento', 'movimiento', v_mov.id,
    jsonb_build_object('tipo', p_tipo, 'cantidad', p_cantidad, 'producto_id', p_producto_id,
                       'almacen_id', p_almacen_id, 'saldo', v_mov.saldo_posterior));

  return jsonb_build_object(
    'movimiento_id', v_mov.id, 'folio', v_mov.folio, 'tipo', v_mov.tipo,
    'cantidad', v_mov.cantidad, 'saldo_posterior', v_mov.saldo_posterior
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSULTA DE DISPONIBILIDAD
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_consultar_stock(
  p_org uuid,
  p_productos uuid[] default null,
  p_almacen_id uuid default null
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x->>'sku'), '[]'::jsonb) from (
    select jsonb_build_object(
      'producto_id', p.id,
      'sku', p.sku,
      'nombre', p.nombre,
      'unidad', um.codigo,
      'punto_reorden', p.punto_reorden,
      'stock_minimo', p.stock_minimo,
      'total', coalesce(sum(e.cantidad), 0),
      'reservado', coalesce(sum(e.cantidad_reservada), 0),
      'disponible', coalesce(sum(e.cantidad_disponible), 0),
      'requiere_reorden', coalesce(sum(e.cantidad_disponible), 0) <= p.punto_reorden,
      'por_almacen', coalesce(jsonb_agg(
          jsonb_build_object(
            'almacen_id', a.id, 'codigo', a.codigo, 'nombre', a.nombre,
            'cantidad', e.cantidad, 'reservado', e.cantidad_reservada,
            'disponible', e.cantidad_disponible, 'ubicacion', e.ubicacion
          ) order by a.prioridad
        ) filter (where a.id is not null), '[]'::jsonb)
    ) as x
    from productos p
    join unidades_medida um on um.id = p.unidad_medida_id
    left join existencias e
      on e.producto_id = p.id
     and (p_almacen_id is null or e.almacen_id = p_almacen_id)
    left join almacenes a on a.id = e.almacen_id and a.activo
    where p.organizacion_id = p_org
      and p.activo
      and (p_productos is null or p.id = any(p_productos))
    group by p.id, p.sku, p.nombre, um.codigo, p.punto_reorden, p.stock_minimo
  ) s;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ALTA DE PEDIDO (recepción del requerimiento)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_crear_pedido(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p_payload->>'organizacion_id')::uuid;
  v_pedido pedidos%rowtype;
  v_item jsonb;
  v_linea smallint := 0;
  v_prod productos%rowtype;
  v_cant numeric;
begin
  if v_org is null then raise exception 'ORG_REQUERIDA' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') = 0 then
    raise exception 'ITEMS_REQUERIDOS: el pedido necesita al menos una línea' using errcode = 'P0001';
  end if;

  insert into pedidos (
    organizacion_id, folio, origen, referencia_externa, solicitante_id, centro_costo,
    almacen_preferente, estatus, prioridad, fecha_requerida, notas, metadata
  ) values (
    v_org,
    fn_siguiente_folio(v_org, 'PED'),
    coalesce(p_payload->>'origen', 'interno'),
    p_payload->>'referencia_externa',
    nullif(p_payload->>'solicitante_id','')::uuid,
    p_payload->>'centro_costo',
    nullif(p_payload->>'almacen_preferente','')::uuid,
    'recibido',
    coalesce(nullif(p_payload->>'prioridad','')::prioridad, 'normal'),
    nullif(p_payload->>'fecha_requerida','')::date,
    p_payload->>'notas',
    coalesce(p_payload->'metadata', '{}'::jsonb)
  ) returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
    v_linea := v_linea + 1;
    v_cant := (v_item->>'cantidad')::numeric;

    -- Resolución flexible: acepta producto_id o sku (agnóstico al front).
    select * into v_prod from productos
     where organizacion_id = v_org
       and activo
       and (
         (nullif(v_item->>'producto_id','') is not null and id = (v_item->>'producto_id')::uuid)
         or
         (nullif(v_item->>'sku','') is not null and upper(sku) = upper(v_item->>'sku'))
       )
     limit 1;

    if not found then
      raise exception 'PRODUCTO_NO_ENCONTRADO: %', coalesce(v_item->>'producto_id', v_item->>'sku')
        using errcode = 'P0002';
    end if;
    if v_cant is null or v_cant <= 0 then
      raise exception 'CANTIDAD_INVALIDA en línea %', v_linea using errcode = 'P0001';
    end if;

    insert into pedido_items (
      organizacion_id, pedido_id, linea, producto_id, cantidad_solicitada,
      precio_estimado, notas, metadata
    ) values (
      v_org, v_pedido.id, v_linea, v_prod.id, v_cant,
      coalesce((v_item->>'precio_estimado')::numeric, v_prod.ultimo_costo, 0),
      v_item->>'notas',
      coalesce(v_item->'metadata', '{}'::jsonb)
    );
  end loop;

  perform fn_emitir_evento(v_org, 'pedido.recibido', 'pedido', v_pedido.id,
    jsonb_build_object('folio', v_pedido.folio, 'lineas', v_linea));

  return jsonb_build_object('pedido_id', v_pedido.id, 'folio', v_pedido.folio,
                            'estatus', v_pedido.estatus, 'lineas', v_linea);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ★ NÚCLEO: VALIDACIÓN DE STOCK → RESERVA o REQUISICIÓN AUTOMÁTICA
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_procesar_pedido(p_pedido_id uuid, p_usuario_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ped              pedidos%rowtype;
  v_org              uuid;
  v_item             record;
  v_cand             record;
  v_disp             numeric(18,4);
  v_pendiente        numeric(18,4);
  v_tomar            numeric(18,4);
  v_reservado_item   numeric(18,4);
  v_total_disp       numeric(18,4);
  v_permitir_parcial boolean;
  v_auto_req         boolean;
  v_horas            int;
  v_estrategia       text;
  v_expira           timestamptz;
  v_reservas         jsonb := '[]'::jsonb;
  v_faltantes        jsonb := '[]'::jsonb;
  v_sum_solicitado   numeric(18,4) := 0;
  v_sum_cubierto     numeric(18,4) := 0;
  v_sum_faltante     numeric(18,4) := 0;   -- pendiente NO cubierto tras la corrida
  v_detectado        numeric(18,4) := 0;   -- faltante detectado EN esta corrida
  v_req_id           uuid;
  v_req_folio        text;
  v_req_linea        smallint := 0;
  v_estatus          estatus_pedido;
  v_reserva_id       uuid;
  v_hay_reserva      boolean := false;
  v_hay_compra       boolean := false;
begin
  select * into v_ped from pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: %', p_pedido_id using errcode = 'P0002';
  end if;
  if v_ped.estatus in ('cancelado', 'surtido') then
    raise exception 'PEDIDO_ESTATUS_INVALIDO: %', v_ped.estatus using errcode = 'P0001';
  end if;
  v_org := v_ped.organizacion_id;

  v_permitir_parcial := (fn_regla(v_org, 'reserva_parcial', 'true'::jsonb))::boolean;
  v_auto_req         := (fn_regla(v_org, 'auto_generar_requisicion', 'true'::jsonb))::boolean;
  v_horas            := (fn_regla(v_org, 'horas_expiracion_reserva', '72'::jsonb))::int;
  v_estrategia       := fn_regla(v_org, 'estrategia_asignacion', '"prioridad"'::jsonb) #>> '{}';
  v_expira           := case when v_horas > 0 then now() + make_interval(hours => v_horas) else null end;

  update pedidos set estatus = 'validando' where id = p_pedido_id;

  -- Orden estable por producto_id ⇒ los locks se toman siempre en el mismo orden.
  for v_item in
    select pi.*, p.es_inventariable, p.sku, p.nombre as producto_nombre, p.ultimo_costo
      from pedido_items pi
      join productos p on p.id = pi.producto_id
     where pi.pedido_id = p_pedido_id
     order by pi.producto_id
  loop
    v_sum_solicitado := v_sum_solicitado + v_item.cantidad_solicitada;
    v_pendiente := v_item.cantidad_solicitada
                 - v_item.cantidad_reservada
                 - v_item.cantidad_surtida
                 - v_item.cantidad_en_compra;

    if v_pendiente <= 0 then
      v_sum_cubierto := v_sum_cubierto + (v_item.cantidad_reservada + v_item.cantidad_surtida + v_item.cantidad_en_compra);
      continue;
    end if;

    v_reservado_item := 0;

    -- Los no inventariables (servicios/gastos) van directo a compras.
    if v_item.es_inventariable then
      select coalesce(sum(e.cantidad_disponible), 0) into v_total_disp
        from existencias e
        join almacenes a on a.id = e.almacen_id and a.activo
       where e.producto_id = v_item.producto_id
         and e.organizacion_id = v_org
         and (v_ped.almacen_preferente is null or e.almacen_id = v_ped.almacen_preferente
              or (fn_regla(v_org, 'permitir_multi_almacen', 'true'::jsonb))::boolean);

      if v_total_disp > 0 and (v_total_disp >= v_pendiente or v_permitir_parcial) then
        for v_cand in
          select e.almacen_id
            from existencias e
            join almacenes a on a.id = e.almacen_id and a.activo
           where e.producto_id = v_item.producto_id
             and e.organizacion_id = v_org
             and e.cantidad_disponible > 0
             and (v_ped.almacen_preferente is null or e.almacen_id = v_ped.almacen_preferente
                  or (fn_regla(v_org, 'permitir_multi_almacen', 'true'::jsonb))::boolean)
           order by
             (case when e.almacen_id = v_ped.almacen_preferente then 0 else 1 end),
             (case when v_estrategia = 'mayor_disponible' then 0 else a.prioridad end),
             (case when v_estrategia = 'mayor_disponible' then -e.cantidad_disponible else 0 end),
             a.id
        loop
          exit when v_pendiente <= 0;

          -- Re-lectura bajo lock: el disponible pudo cambiar entre el plan y el bloqueo.
          select cantidad_disponible into v_disp
            from existencias
           where almacen_id = v_cand.almacen_id and producto_id = v_item.producto_id
           for update;

          if coalesce(v_disp, 0) <= 0 then continue; end if;
          v_tomar := least(v_disp, v_pendiente);

          update existencias
             set cantidad_reservada = cantidad_reservada + v_tomar,
                 actualizado_en = now()
           where almacen_id = v_cand.almacen_id and producto_id = v_item.producto_id;

          insert into reservas (organizacion_id, pedido_item_id, almacen_id, producto_id, cantidad, expira_en)
          values (v_org, v_item.id, v_cand.almacen_id, v_item.producto_id, v_tomar, v_expira)
          returning id into v_reserva_id;

          v_pendiente      := v_pendiente - v_tomar;
          v_reservado_item := v_reservado_item + v_tomar;

          v_reservas := v_reservas || jsonb_build_object(
            'reserva_id', v_reserva_id, 'pedido_item_id', v_item.id, 'sku', v_item.sku,
            'almacen_id', v_cand.almacen_id, 'cantidad', v_tomar
          );
        end loop;
      end if;
    end if;

    if v_reservado_item > 0 then
      update pedido_items
         set cantidad_reservada = cantidad_reservada + v_reservado_item
       where id = v_item.id;
    end if;

    v_sum_cubierto := v_sum_cubierto + v_item.cantidad_reservada + v_item.cantidad_surtida
                    + v_item.cantidad_en_compra + v_reservado_item;

    if v_pendiente > 0 then
      v_detectado := v_detectado + v_pendiente;
      v_faltantes := v_faltantes || jsonb_build_object(
        'pedido_item_id', v_item.id, 'producto_id', v_item.producto_id, 'sku', v_item.sku,
        'nombre', v_item.producto_nombre, 'cantidad_faltante', v_pendiente
      );

      -- ── Generación automática de requisición de compra ──
      if v_auto_req then
        if v_req_id is null then
          v_req_folio := fn_siguiente_folio(v_org, 'REQ');
          insert into requisiciones (
            organizacion_id, folio, pedido_id, origen, estatus, prioridad,
            fecha_requerida, solicitante_id, notas
          ) values (
            v_org, v_req_folio, v_ped.id, 'faltante_stock', 'abierta', v_ped.prioridad,
            v_ped.fecha_requerida, coalesce(p_usuario_id, v_ped.solicitante_id),
            'Generada automáticamente por faltante de stock del pedido ' || v_ped.folio
          ) returning id into v_req_id;
        end if;

        v_req_linea := v_req_linea + 1;
        insert into requisicion_items (
          organizacion_id, requisicion_id, linea, producto_id, pedido_item_id,
          cantidad, almacen_destino, precio_estimado
        ) values (
          v_org, v_req_id, v_req_linea, v_item.producto_id, v_item.id,
          v_pendiente,
          coalesce(v_ped.almacen_preferente,
                   (select id from almacenes where organizacion_id = v_org and activo
                     order by prioridad, id limit 1)),
          coalesce(v_item.ultimo_costo, 0)
        );

        update pedido_items
           set cantidad_en_compra = cantidad_en_compra + v_pendiente
         where id = v_item.id;
      end if;
    end if;
  end loop;

  -- ── Resolución de estatus (recalculada desde el estado real de las líneas) ──
  select
    coalesce(sum(cantidad_solicitada), 0),
    coalesce(sum(cantidad_reservada + cantidad_surtida + cantidad_en_compra), 0),
    coalesce(sum(greatest(cantidad_solicitada - cantidad_reservada - cantidad_surtida - cantidad_en_compra, 0)), 0)
    into v_sum_solicitado, v_sum_cubierto, v_sum_faltante
  from pedido_items where pedido_id = p_pedido_id;

  v_hay_compra  := exists (select 1 from pedido_items where pedido_id = p_pedido_id and cantidad_en_compra > 0);
  v_hay_reserva := exists (
    select 1 from reservas r join pedido_items pi on pi.id = r.pedido_item_id
     where pi.pedido_id = p_pedido_id and r.estatus = 'activa');

  if v_req_id is not null or v_hay_compra then
    v_estatus := 'en_requisicion';
  elsif v_sum_faltante = 0 and v_sum_cubierto >= v_sum_solicitado then
    v_estatus := case when (select coalesce(sum(cantidad_surtida),0) from pedido_items where pedido_id = p_pedido_id)
                           >= v_sum_solicitado
                      then 'surtido'::estatus_pedido else 'reservado_total'::estatus_pedido end;
  elsif v_sum_cubierto > 0 then
    v_estatus := 'reservado_parcial';
  else
    v_estatus := 'recibido';
  end if;

  update pedidos set estatus = v_estatus where id = p_pedido_id;

  perform fn_emitir_evento(v_org, 'pedido.validado', 'pedido', p_pedido_id,
    jsonb_build_object('estatus', v_estatus, 'reservas', v_reservas, 'faltantes', v_faltantes,
                       'requisicion_id', v_req_id));

  if v_req_id is not null then
    perform fn_emitir_evento(v_org, 'requisicion.creada', 'requisicion', v_req_id,
      jsonb_build_object('folio', v_req_folio, 'pedido_id', p_pedido_id, 'lineas', v_req_linea));
  end if;

  return jsonb_build_object(
    'pedido_id',     p_pedido_id,
    'folio',         v_ped.folio,
    'estatus',       v_estatus,
    'total_solicitado', v_sum_solicitado,
    'total_faltante',   v_detectado,      -- lo que no había en almacén en esta corrida
    'total_sin_cubrir', v_sum_faltante,   -- lo que sigue sin reserva ni orden de compra
    'reservas',      v_reservas,
    'faltantes',     v_faltantes,
    'requisicion',   case when v_req_id is null then null
                     else jsonb_build_object('id', v_req_id, 'folio', v_req_folio, 'lineas', v_req_linea) end,
    'accion',        case
                       when v_hay_reserva and v_hay_compra then 'SURTIR_PARCIAL'
                       when v_hay_reserva                  then 'NOTIFICAR_ALMACEN_SURTIR'
                       when v_hay_compra                   then 'NOTIFICAR_COMPRAS_COTIZAR'
                       else 'SIN_STOCK_SIN_REQUISICION'
                     end,
    -- A quién debe avisar la capa de aplicación/MCP.
    'notificar',     (case when v_hay_reserva then jsonb_build_array('almacen') else '[]'::jsonb end)
                     || (case when v_hay_compra then jsonb_build_array('compras') else '[]'::jsonb end)
  );
end $$;

-- Atajo transaccional: alta + validación en una sola llamada.
create or replace function fn_recibir_y_procesar_pedido(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_creado jsonb; v_res jsonb;
begin
  v_creado := fn_crear_pedido(p_payload);
  v_res := fn_procesar_pedido((v_creado->>'pedido_id')::uuid,
                              nullif(p_payload->>'solicitante_id','')::uuid);
  return v_creado || v_res;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SURTIDO (consume reservas → salida real de almacén)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_surtir_pedido(
  p_pedido_id uuid,
  p_items jsonb default null,        -- [{pedido_item_id, cantidad}]  null = surtir todo lo reservado
  p_usuario_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ped        pedidos%rowtype;
  v_org        uuid;
  v_item       record;
  v_res        record;
  v_solicitado numeric(18,4);
  v_pendiente  numeric(18,4);
  v_tomar      numeric(18,4);
  v_salidas    jsonb := '[]'::jsonb;
  v_total      numeric(18,4) := 0;
  v_mov        jsonb;
  v_falta      numeric(18,4);
begin
  select * into v_ped from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'PEDIDO_NO_ENCONTRADO: %', p_pedido_id using errcode = 'P0002'; end if;
  if v_ped.estatus = 'cancelado' then
    raise exception 'PEDIDO_CANCELADO' using errcode = 'P0001';
  end if;
  v_org := v_ped.organizacion_id;

  for v_item in
    select pi.*, p.sku
      from pedido_items pi
      join productos p on p.id = pi.producto_id
     where pi.pedido_id = p_pedido_id
     order by pi.producto_id
  loop
    if p_items is null then
      v_solicitado := v_item.cantidad_reservada;
    else
      select coalesce((x->>'cantidad')::numeric, 0) into v_solicitado
        from jsonb_array_elements(p_items) x
       where (x->>'pedido_item_id')::uuid = v_item.id
       limit 1;
      v_solicitado := coalesce(v_solicitado, 0);
    end if;

    if v_solicitado is null or v_solicitado <= 0 then continue; end if;
    if v_solicitado > v_item.cantidad_reservada then
      raise exception 'SURTIDO_EXCEDE_RESERVA: item % reservado %, solicitado %',
        v_item.id, v_item.cantidad_reservada, v_solicitado using errcode = 'P0001';
    end if;

    v_pendiente := v_solicitado;

    for v_res in
      select * from reservas
       where pedido_item_id = v_item.id and estatus = 'activa'
       order by creado_en, id
       for update
    loop
      exit when v_pendiente <= 0;
      v_tomar := least(v_res.cantidad, v_pendiente);

      -- 1) Libera la porción reservada …
      update existencias
         set cantidad_reservada = cantidad_reservada - v_tomar, actualizado_en = now()
       where almacen_id = v_res.almacen_id and producto_id = v_res.producto_id;

      -- 2) … y la descuenta físicamente (el trigger actualiza `cantidad`).
      v_mov := fn_registrar_movimiento(
        v_org, v_res.almacen_id, v_res.producto_id, 'salida', v_tomar,
        'Surtido de pedido ' || v_ped.folio, p_usuario_id, null, 'pedido', p_pedido_id, null,
        jsonb_build_object('pedido_item_id', v_item.id, 'reserva_id', v_res.id)
      );

      if v_tomar >= v_res.cantidad then
        update reservas set estatus = 'surtida', cerrado_en = now() where id = v_res.id;
      else
        update reservas set cantidad = cantidad - v_tomar where id = v_res.id;
        insert into reservas (organizacion_id, pedido_item_id, almacen_id, producto_id,
                              cantidad, estatus, cerrado_en)
        values (v_org, v_item.id, v_res.almacen_id, v_res.producto_id, v_tomar, 'surtida', now());
      end if;

      v_pendiente := v_pendiente - v_tomar;
      v_total := v_total + v_tomar;
      v_salidas := v_salidas || jsonb_build_object(
        'pedido_item_id', v_item.id, 'sku', v_item.sku, 'almacen_id', v_res.almacen_id,
        'cantidad', v_tomar, 'movimiento', v_mov
      );
    end loop;

    if v_pendiente > 0 then
      raise exception 'RESERVAS_INCONSISTENTES: item % no cubre % unidades', v_item.id, v_pendiente
        using errcode = 'P0001';
    end if;

    update pedido_items
       set cantidad_surtida  = cantidad_surtida + v_solicitado,
           cantidad_reservada = cantidad_reservada - v_solicitado
     where id = v_item.id;
  end loop;

  select coalesce(sum(cantidad_solicitada - cantidad_surtida), 0) into v_falta
    from pedido_items where pedido_id = p_pedido_id;

  update pedidos
     set estatus = case
       when v_falta <= 0 then 'surtido'::estatus_pedido
       when exists (select 1 from pedido_items where pedido_id = p_pedido_id and cantidad_en_compra > 0)
            then 'en_requisicion'::estatus_pedido
       else 'surtido_parcial'::estatus_pedido end
   where id = p_pedido_id;

  perform fn_emitir_evento(v_org, 'pedido.surtido', 'pedido', p_pedido_id,
    jsonb_build_object('cantidad', v_total, 'pendiente', v_falta));

  return jsonb_build_object('pedido_id', p_pedido_id, 'surtido', v_total,
                            'pendiente', v_falta, 'detalle', v_salidas,
                            'estatus', (select estatus from pedidos where id = p_pedido_id));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- LIBERACIÓN DE RESERVAS (cancelación / expiración)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_liberar_reservas(p_pedido_id uuid default null, p_motivo text default 'liberacion_manual')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res record; v_n int := 0; v_total numeric := 0;
begin
  for v_res in
    select r.* from reservas r
     join pedido_items pi on pi.id = r.pedido_item_id
    where r.estatus = 'activa'
      and (
        (p_pedido_id is not null and pi.pedido_id = p_pedido_id)
        or
        (p_pedido_id is null and r.expira_en is not null and r.expira_en < now())
      )
    order by r.almacen_id, r.producto_id, r.id
    for update of r
  loop
    update existencias
       set cantidad_reservada = greatest(cantidad_reservada - v_res.cantidad, 0), actualizado_en = now()
     where almacen_id = v_res.almacen_id and producto_id = v_res.producto_id;

    update reservas
       set estatus = case when p_pedido_id is null then 'expirada'::estatus_reserva else 'liberada'::estatus_reserva end,
           cerrado_en = now()
     where id = v_res.id;

    update pedido_items
       set cantidad_reservada = greatest(cantidad_reservada - v_res.cantidad, 0)
     where id = v_res.pedido_item_id;

    v_n := v_n + 1;
    v_total := v_total + v_res.cantidad;
  end loop;

  if p_pedido_id is not null then
    perform fn_emitir_evento(
      (select organizacion_id from pedidos where id = p_pedido_id),
      'pedido.reservas_liberadas', 'pedido', p_pedido_id,
      jsonb_build_object('reservas', v_n, 'cantidad', v_total, 'motivo', p_motivo));
  end if;

  return jsonb_build_object('reservas_liberadas', v_n, 'cantidad', v_total);
end $$;

create or replace function fn_cancelar_pedido(p_pedido_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_lib jsonb;
begin
  v_lib := fn_liberar_reservas(p_pedido_id, coalesce(p_motivo, 'cancelacion'));
  update requisiciones set estatus = 'cancelada'
   where pedido_id = p_pedido_id and estatus in ('abierta','cotizando');
  update pedido_items set cantidad_en_compra = 0 where pedido_id = p_pedido_id;
  update pedidos set estatus = 'cancelado',
         metadata = metadata || jsonb_build_object('motivo_cancelacion', p_motivo)
   where id = p_pedido_id;
  return jsonb_build_object('pedido_id', p_pedido_id, 'estatus', 'cancelado', 'liberacion', v_lib);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- COMPRAS: requisición → orden de compra → recepción
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_aprobar_requisicion(
  p_requisicion_id uuid, p_aprobador_id uuid, p_aprobar boolean default true, p_motivo text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_req requisiciones%rowtype;
begin
  select * into v_req from requisiciones where id = p_requisicion_id for update;
  if not found then raise exception 'REQUISICION_NO_ENCONTRADA' using errcode = 'P0002'; end if;
  if v_req.estatus not in ('abierta','cotizando') then
    raise exception 'REQUISICION_ESTATUS_INVALIDO: %', v_req.estatus using errcode = 'P0001';
  end if;

  update requisiciones
     set estatus = case when p_aprobar then 'aprobada'::estatus_requisicion else 'rechazada'::estatus_requisicion end,
         aprobador_id = p_aprobador_id,
         aprobado_en = now(),
         motivo_rechazo = case when p_aprobar then null else p_motivo end
   where id = p_requisicion_id;

  if not p_aprobar then
    update pedido_items pi
       set cantidad_en_compra = greatest(pi.cantidad_en_compra - ri.cantidad, 0)
      from requisicion_items ri
     where ri.requisicion_id = p_requisicion_id and ri.pedido_item_id = pi.id;
  end if;

  perform fn_emitir_evento(v_req.organizacion_id,
    case when p_aprobar then 'requisicion.aprobada' else 'requisicion.rechazada' end,
    'requisicion', p_requisicion_id, jsonb_build_object('motivo', p_motivo));

  return jsonb_build_object('requisicion_id', p_requisicion_id,
                            'estatus', case when p_aprobar then 'aprobada' else 'rechazada' end);
end $$;

create or replace function fn_crear_orden_compra(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org       uuid := (p_payload->>'organizacion_id')::uuid;
  v_oc        ordenes_compra%rowtype;
  v_item      jsonb;
  v_linea     smallint := 0;
  v_ri        requisicion_items%rowtype;
  v_prod      uuid;
  v_cant      numeric;
  v_precio    numeric;
  v_tasa      numeric;
  v_sub       numeric := 0;
  v_imp       numeric := 0;
  v_almacen   uuid;
  v_req_id    uuid := nullif(p_payload->>'requisicion_id','')::uuid;
  v_req_est   estatus_requisicion;
begin
  if v_org is null then raise exception 'ORG_REQUERIDA' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') = 0 then
    raise exception 'ITEMS_REQUERIDOS' using errcode = 'P0001';
  end if;

  -- La regla `requiere_aprobacion_requisicion` se aplica aquí: sin este control
  -- la configuración existiría pero nadie la respetaría.
  if v_req_id is not null
     and (fn_regla(v_org, 'requiere_aprobacion_requisicion', 'false'::jsonb))::boolean then
    select estatus into v_req_est from requisiciones where id = v_req_id;
    if v_req_est is null then
      raise exception 'REQUISICION_NO_ENCONTRADA: %', v_req_id using errcode = 'P0002';
    end if;
    if v_req_est not in ('aprobada', 'en_orden') then
      raise exception 'REQUISICION_NO_APROBADA: la requisición está en "%" y la organización exige aprobación previa', v_req_est
        using errcode = 'P0001';
    end if;
  end if;

  v_almacen := coalesce(
    nullif(p_payload->>'almacen_destino','')::uuid,
    (select almacen_destino from requisicion_items where requisicion_id = v_req_id and almacen_destino is not null limit 1),
    (select id from almacenes where organizacion_id = v_org and activo order by prioridad, id limit 1)
  );
  if v_almacen is null then raise exception 'ALMACEN_DESTINO_REQUERIDO' using errcode = 'P0001'; end if;

  insert into ordenes_compra (
    organizacion_id, folio, proveedor_id, requisicion_id, almacen_destino, estatus,
    moneda, tipo_cambio, fecha_promesa, comprador_id, condiciones_pago, notas, metadata
  ) values (
    v_org, fn_siguiente_folio(v_org, 'OC'),
    (p_payload->>'proveedor_id')::uuid, v_req_id, v_almacen,
    coalesce(nullif(p_payload->>'estatus','')::estatus_orden_compra, 'borrador'),
    coalesce(p_payload->>'moneda', 'MXN'),
    coalesce((p_payload->>'tipo_cambio')::numeric, 1),
    nullif(p_payload->>'fecha_promesa','')::date,
    nullif(p_payload->>'comprador_id','')::uuid,
    p_payload->>'condiciones_pago',
    p_payload->>'notas',
    coalesce(p_payload->'metadata','{}'::jsonb)
  ) returning * into v_oc;

  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
    v_linea := v_linea + 1;
    v_cant  := (v_item->>'cantidad')::numeric;
    v_tasa  := coalesce((v_item->>'tasa_impuesto')::numeric, 0.16);

    if nullif(v_item->>'requisicion_item_id','') is not null then
      select * into v_ri from requisicion_items
       where id = (v_item->>'requisicion_item_id')::uuid for update;
      if not found then raise exception 'REQUISICION_ITEM_NO_ENCONTRADO' using errcode = 'P0002'; end if;
      if v_cant > (v_ri.cantidad - v_ri.cantidad_ordenada) then
        raise exception 'CANTIDAD_EXCEDE_REQUISICION: pendiente %', (v_ri.cantidad - v_ri.cantidad_ordenada)
          using errcode = 'P0001';
      end if;
      v_prod := v_ri.producto_id;
      update requisicion_items set cantidad_ordenada = cantidad_ordenada + v_cant where id = v_ri.id;
    else
      v_prod := (v_item->>'producto_id')::uuid;
    end if;

    v_precio := coalesce(
      (v_item->>'precio_unitario')::numeric,
      (select pp.precio from proveedor_productos pp
        where pp.proveedor_id = (p_payload->>'proveedor_id')::uuid
          and pp.producto_id = v_prod and pp.activo
          and pp.vigente_desde <= current_date
          and (pp.vigente_hasta is null or pp.vigente_hasta >= current_date)
        order by pp.vigente_desde desc limit 1),
      (select ultimo_costo from productos where id = v_prod), 0);

    insert into orden_compra_items (
      organizacion_id, orden_compra_id, linea, producto_id, requisicion_item_id,
      cantidad, precio_unitario, tasa_impuesto, metadata
    ) values (
      v_org, v_oc.id, v_linea, v_prod, nullif(v_item->>'requisicion_item_id','')::uuid,
      v_cant, v_precio, v_tasa, coalesce(v_item->'metadata','{}'::jsonb)
    );

    v_sub := v_sub + (v_cant * v_precio);
    v_imp := v_imp + (v_cant * v_precio * v_tasa);
  end loop;

  update ordenes_compra
     set subtotal = v_sub, impuestos = v_imp, total = v_sub + v_imp
   where id = v_oc.id;

  if v_req_id is not null then
    update requisiciones set estatus = 'en_orden'
     where id = v_req_id and estatus in ('abierta','cotizando','aprobada');
  end if;

  perform fn_emitir_evento(v_org, 'orden_compra.creada', 'orden_compra', v_oc.id,
    jsonb_build_object('folio', v_oc.folio, 'total', v_sub + v_imp, 'lineas', v_linea));

  return jsonb_build_object('orden_compra_id', v_oc.id, 'folio', v_oc.folio,
    'subtotal', v_sub, 'impuestos', v_imp, 'total', v_sub + v_imp, 'lineas', v_linea);
end $$;

create or replace function fn_recibir_orden_compra(
  p_orden_compra_id uuid,
  p_items jsonb,                     -- [{orden_compra_item_id, cantidad, costo_unitario?, lote?, rechazada?}]
  p_usuario_id uuid default null,
  p_factura_ref text default null,
  p_almacen_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_oc        ordenes_compra%rowtype;
  v_org       uuid;
  v_rec       recepciones%rowtype;
  v_it        jsonb;
  v_oci       orden_compra_items%rowtype;
  v_cant      numeric;
  v_costo     numeric;
  v_almacen   uuid;
  v_ex_total  numeric;
  v_costo_prom numeric;
  v_detalle   jsonb := '[]'::jsonb;
  v_pend      numeric;
  v_pedidos   uuid[];
  v_ped       uuid;
  v_reproc    jsonb := '[]'::jsonb;
begin
  select * into v_oc from ordenes_compra where id = p_orden_compra_id for update;
  if not found then raise exception 'ORDEN_COMPRA_NO_ENCONTRADA' using errcode = 'P0002'; end if;
  if v_oc.estatus in ('cancelada','recibida') then
    raise exception 'OC_ESTATUS_INVALIDO: %', v_oc.estatus using errcode = 'P0001';
  end if;
  v_org := v_oc.organizacion_id;
  v_almacen := coalesce(p_almacen_id, v_oc.almacen_destino);

  insert into recepciones (organizacion_id, folio, orden_compra_id, almacen_id, recibido_por, factura_ref)
  values (v_org, fn_siguiente_folio(v_org, 'REC'), p_orden_compra_id, v_almacen, p_usuario_id, p_factura_ref)
  returning * into v_rec;

  for v_it in select * from jsonb_array_elements(p_items) loop
    select * into v_oci from orden_compra_items
     where id = (v_it->>'orden_compra_item_id')::uuid and orden_compra_id = p_orden_compra_id
     for update;
    if not found then raise exception 'OC_ITEM_NO_ENCONTRADO' using errcode = 'P0002'; end if;

    v_cant := (v_it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
    if v_cant > (v_oci.cantidad - v_oci.cantidad_recibida) then
      raise exception 'RECEPCION_EXCEDE_OC: pendiente %', (v_oci.cantidad - v_oci.cantidad_recibida)
        using errcode = 'P0001';
    end if;
    v_costo := coalesce((v_it->>'costo_unitario')::numeric, v_oci.precio_unitario);

    -- Costo promedio ponderado global antes de la entrada.
    select coalesce(sum(cantidad), 0) into v_ex_total from existencias where producto_id = v_oci.producto_id;
    select costo_promedio into v_costo_prom from productos where id = v_oci.producto_id for update;
    update productos
       set costo_promedio = case when (v_ex_total + v_cant) > 0
                                 then ((v_ex_total * coalesce(v_costo_prom,0)) + (v_cant * v_costo)) / (v_ex_total + v_cant)
                                 else v_costo end,
           ultimo_costo = v_costo
     where id = v_oci.producto_id;

    perform fn_registrar_movimiento(
      v_org, v_almacen, v_oci.producto_id, 'entrada', v_cant,
      'Recepción OC ' || v_oc.folio, p_usuario_id, v_costo, 'orden_compra', p_orden_compra_id,
      v_it->>'lote', jsonb_build_object('recepcion_id', v_rec.id, 'oc_item_id', v_oci.id)
    );

    insert into recepcion_items (organizacion_id, recepcion_id, orden_compra_item_id, producto_id,
                                 cantidad, cantidad_rechazada, costo_unitario, lote)
    values (v_org, v_rec.id, v_oci.id, v_oci.producto_id, v_cant,
            coalesce((v_it->>'rechazada')::numeric, 0), v_costo, v_it->>'lote');

    update orden_compra_items set cantidad_recibida = cantidad_recibida + v_cant where id = v_oci.id;

    if v_oci.requisicion_item_id is not null then
      update requisicion_items set cantidad_recibida = cantidad_recibida + v_cant
       where id = v_oci.requisicion_item_id;

      -- Libera el "en compra" del pedido origen para que la validación reserve el stock nuevo.
      update pedido_items pi
         set cantidad_en_compra = greatest(pi.cantidad_en_compra - v_cant, 0)
        from requisicion_items ri
       where ri.id = v_oci.requisicion_item_id and pi.id = ri.pedido_item_id;
    end if;

    v_detalle := v_detalle || jsonb_build_object('oc_item_id', v_oci.id, 'producto_id', v_oci.producto_id,
                                                 'cantidad', v_cant, 'costo_unitario', v_costo);
  end loop;

  select coalesce(sum(cantidad - cantidad_recibida), 0) into v_pend
    from orden_compra_items where orden_compra_id = p_orden_compra_id;

  update ordenes_compra
     set estatus = case when v_pend <= 0 then 'recibida'::estatus_orden_compra
                        else 'recibida_parcial'::estatus_orden_compra end
   where id = p_orden_compra_id;

  if v_oc.requisicion_id is not null then
    update requisiciones r set estatus = 'cerrada'
     where r.id = v_oc.requisicion_id
       and not exists (select 1 from requisicion_items ri
                        where ri.requisicion_id = r.id and ri.cantidad_recibida < ri.cantidad);
  end if;

  -- Re-disparo automático de la validación de stock en los pedidos afectados.
  select array_agg(distinct pi.pedido_id) into v_pedidos
    from orden_compra_items oci
    join requisicion_items ri on ri.id = oci.requisicion_item_id
    join pedido_items pi on pi.id = ri.pedido_item_id
    join pedidos pe on pe.id = pi.pedido_id
   where oci.orden_compra_id = p_orden_compra_id
     and pe.estatus not in ('cancelado','surtido');

  if v_pedidos is not null then
    foreach v_ped in array v_pedidos loop
      v_reproc := v_reproc || fn_procesar_pedido(v_ped, p_usuario_id);
    end loop;
  end if;

  perform fn_emitir_evento(v_org, 'orden_compra.recibida', 'orden_compra', p_orden_compra_id,
    jsonb_build_object('recepcion_id', v_rec.id, 'pendiente', v_pend));

  return jsonb_build_object(
    'recepcion_id', v_rec.id, 'folio', v_rec.folio,
    'orden_compra_id', p_orden_compra_id,
    'estatus_oc', (select estatus from ordenes_compra where id = p_orden_compra_id),
    'pendiente', v_pend, 'detalle', v_detalle, 'pedidos_reprocesados', v_reproc
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- REABASTECIMIENTO POR PUNTO DE REORDEN (job programable)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_generar_requisiciones_reorden(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row record; v_req_id uuid; v_folio text; v_linea smallint := 0; v_n int := 0;
begin
  for v_row in
    select p.id as producto_id, p.sku, p.stock_maximo, p.punto_reorden, p.ultimo_costo,
           coalesce(sum(e.cantidad_disponible), 0) as disponible
      from productos p
      left join existencias e on e.producto_id = p.id
     where p.organizacion_id = p_org and p.activo and p.es_inventariable and p.es_comprable
     group by p.id
    having coalesce(sum(e.cantidad_disponible), 0) <= p.punto_reorden
       and p.punto_reorden > 0
       and not exists (
         select 1 from requisicion_items ri
          join requisiciones r on r.id = ri.requisicion_id
         where ri.producto_id = p.id and r.estatus not in ('cerrada','cancelada','rechazada'))
  loop
    if v_req_id is null then
      v_folio := fn_siguiente_folio(p_org, 'REQ');
      insert into requisiciones (organizacion_id, folio, origen, estatus, prioridad, notas)
      values (p_org, v_folio, 'punto_reorden', 'abierta', 'normal',
              'Reabastecimiento automático por punto de reorden')
      returning id into v_req_id;
    end if;
    v_linea := v_linea + 1; v_n := v_n + 1;
    insert into requisicion_items (organizacion_id, requisicion_id, linea, producto_id, cantidad,
                                   almacen_destino, precio_estimado)
    values (p_org, v_req_id, v_linea, v_row.producto_id,
            greatest(coalesce(v_row.stock_maximo, v_row.punto_reorden * 2) - v_row.disponible, 1),
            (select id from almacenes where organizacion_id = p_org and activo order by prioridad, id limit 1),
            coalesce(v_row.ultimo_costo, 0));
  end loop;

  if v_req_id is not null then
    perform fn_emitir_evento(p_org, 'requisicion.creada', 'requisicion', v_req_id,
      jsonb_build_object('folio', v_folio, 'origen', 'punto_reorden', 'lineas', v_linea));
  end if;
  return jsonb_build_object('requisicion_id', v_req_id, 'folio', v_folio, 'productos', v_n);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- KPIs POR DASHBOARD
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fn_kpis(p_org uuid, p_rol text default 'admin')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb := '{}'::jsonb;
begin
  if p_rol in ('almacen','admin') then
    v := v || jsonb_build_object('almacen', (
      select jsonb_build_object(
        'skus_activos',        (select count(*) from productos where organizacion_id = p_org and activo),
        'valor_inventario',    (select coalesce(sum(e.cantidad * p.costo_promedio),0)
                                  from existencias e join productos p on p.id = e.producto_id
                                 where e.organizacion_id = p_org),
        'unidades_reservadas', (select coalesce(sum(cantidad_reservada),0) from existencias where organizacion_id = p_org),
        'bajo_minimo',         (select count(*) from v_stock_consolidado where organizacion_id = p_org and requiere_reorden),
        'pedidos_por_surtir',  (select count(*) from pedidos where organizacion_id = p_org
                                 and estatus in ('reservado_total','reservado_parcial','surtido_parcial')),
        'movimientos_hoy',     (select count(*) from movimientos_inventario
                                 where organizacion_id = p_org and creado_en >= current_date),
        'mermas_30d',          (select coalesce(sum(cantidad),0) from movimientos_inventario
                                 where organizacion_id = p_org and tipo = 'merma'
                                   and creado_en >= now() - interval '30 days')
      )));
  end if;

  if p_rol in ('compras','admin') then
    v := v || jsonb_build_object('compras', (
      select jsonb_build_object(
        'requisiciones_abiertas', (select count(*) from requisiciones where organizacion_id = p_org and estatus = 'abierta'),
        'requisiciones_por_aprobar', (select count(*) from requisiciones where organizacion_id = p_org and estatus = 'cotizando'),
        'ordenes_en_transito',    (select count(*) from ordenes_compra where organizacion_id = p_org
                                    and estatus in ('enviada','confirmada','recibida_parcial')),
        'monto_comprometido',     (select coalesce(sum(total),0) from ordenes_compra where organizacion_id = p_org
                                    and estatus in ('enviada','confirmada','recibida_parcial')),
        'proveedores_activos',    (select count(*) from proveedores where organizacion_id = p_org and activo),
        'gasto_30d',              (select coalesce(sum(total),0) from ordenes_compra where organizacion_id = p_org
                                    and estatus in ('recibida','recibida_parcial')
                                    and creado_en >= now() - interval '30 days')
      )));
  end if;

  if p_rol = 'admin' then
    v := v || jsonb_build_object('global', (
      select jsonb_build_object(
        'pedidos_totales',   (select count(*) from pedidos where organizacion_id = p_org),
        'pedidos_abiertos',  (select count(*) from pedidos where organizacion_id = p_org
                               and estatus not in ('surtido','cancelado')),
        'usuarios_activos',  (select count(*) from perfiles where organizacion_id = p_org and activo),
        'almacenes',         (select count(*) from almacenes where organizacion_id = p_org and activo),
        'eventos_pendientes',(select count(*) from eventos where organizacion_id = p_org and not procesado),
        'fill_rate_30d',     (select case when coalesce(sum(pi.cantidad_solicitada),0) = 0 then 1
                                     else round(coalesce(sum(pi.cantidad_surtida),0) / sum(pi.cantidad_solicitada), 4) end
                                from pedido_items pi join pedidos pe on pe.id = pi.pedido_id
                               where pe.organizacion_id = p_org and pe.creado_en >= now() - interval '30 days')
      )));
  end if;

  return v;
end $$;
