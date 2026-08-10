-- ============================================================================
--  04_seed.sql — Datos de arranque + demo end-to-end.
--  El giro ("bloquera") vive solo en catálogos y metadata: cambiando el seed
--  el mismo core sirve para constructora, comercio o servicios.
-- ============================================================================

do $$
declare
  v_org   uuid;
  v_pza   uuid; v_m3 uuid; v_ton uuid; v_srv uuid;
  v_cat_mp uuid; v_cat_pt uuid; v_cat_serv uuid;
  v_alm_p uuid; v_alm_o uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_prov1 uuid; v_prov2 uuid;
  v_res jsonb;
  v_ped uuid;
begin
  -- ── Organización ──
  insert into organizaciones (nombre, slug, giro, moneda_base, metadata)
  values ('Bloquera Demo SA de CV', 'bloquera-demo', 'manufactura', 'MXN',
          jsonb_build_object('demo', true))
  on conflict (slug) do update set nombre = excluded.nombre
  returning id into v_org;

  -- ── Reglas de negocio ──
  insert into reglas_negocio (organizacion_id, clave, valor, descripcion) values
    (v_org, 'permitir_stock_negativo',        'false', 'Bloquea salidas sin existencia física'),
    (v_org, 'auto_generar_requisicion',       'true',  'Crea requisición al detectar faltante'),
    (v_org, 'reserva_parcial',                'true',  'Aparta lo disponible aunque no cubra todo'),
    (v_org, 'permitir_multi_almacen',         'true',  'Puede surtir combinando almacenes'),
    (v_org, 'horas_expiracion_reserva',       '72',    'Las reservas caducan a las 72 h'),
    (v_org, 'estrategia_asignacion',          '"prioridad"', 'prioridad | mayor_disponible'),
    (v_org, 'requiere_aprobacion_requisicion','true',  'Requisición pasa por aprobación'),
    (v_org, 'monto_aprobacion_automatica',    '5000',  'OC bajo este monto no requiere firma')
  on conflict (organizacion_id, clave) do update set valor = excluded.valor;

  -- ── Unidades de medida ──
  insert into unidades_medida (organizacion_id, codigo, nombre, decimales)
  values (v_org,'PZA','Pieza',0) on conflict do nothing;
  insert into unidades_medida (organizacion_id, codigo, nombre, decimales)
  values (v_org,'M3','Metro cúbico',3) on conflict do nothing;
  insert into unidades_medida (organizacion_id, codigo, nombre, decimales)
  values (v_org,'TON','Tonelada',3) on conflict do nothing;
  insert into unidades_medida (organizacion_id, codigo, nombre, decimales)
  values (v_org,'SRV','Servicio',2) on conflict do nothing;

  select id into v_pza from unidades_medida where organizacion_id = v_org and codigo = 'PZA';
  select id into v_m3  from unidades_medida where organizacion_id = v_org and codigo = 'M3';
  select id into v_ton from unidades_medida where organizacion_id = v_org and codigo = 'TON';
  select id into v_srv from unidades_medida where organizacion_id = v_org and codigo = 'SRV';

  -- ── Categorías ──
  insert into categorias (organizacion_id, codigo, nombre, ruta)
  values (v_org,'MP','Materia prima','MP') on conflict do nothing;
  insert into categorias (organizacion_id, codigo, nombre, ruta)
  values (v_org,'PT','Producto terminado','PT') on conflict do nothing;
  insert into categorias (organizacion_id, codigo, nombre, ruta)
  values (v_org,'SRV','Servicios','SRV') on conflict do nothing;
  select id into v_cat_mp   from categorias where organizacion_id = v_org and codigo = 'MP';
  select id into v_cat_pt   from categorias where organizacion_id = v_org and codigo = 'PT';
  select id into v_cat_serv from categorias where organizacion_id = v_org and codigo = 'SRV';

  -- ── Atributos dinámicos (esquema flexible por categoría) ──
  insert into atributos_definicion (organizacion_id, categoria_id, clave, etiqueta, tipo_dato, requerido, orden)
  values
    (v_org, v_cat_pt, 'resistencia_kg_cm2', 'Resistencia (kg/cm²)', 'numero',  true, 1),
    (v_org, v_cat_pt, 'medida',             'Medida nominal',       'texto',   true, 2),
    (v_org, v_cat_mp, 'granulometria',      'Granulometría',        'texto',   false, 1)
  on conflict do nothing;

  -- ── Almacenes ──
  insert into almacenes (organizacion_id, codigo, nombre, tipo, prioridad)
  values (v_org,'ALM-PRIN','Almacén Principal','fisico',10) on conflict do nothing;
  insert into almacenes (organizacion_id, codigo, nombre, tipo, prioridad)
  values (v_org,'ALM-OBRA','Patio de Obra','obra',50) on conflict do nothing;
  select id into v_alm_p from almacenes where organizacion_id = v_org and codigo = 'ALM-PRIN';
  select id into v_alm_o from almacenes where organizacion_id = v_org and codigo = 'ALM-OBRA';

  -- ── Proveedores ──
  insert into proveedores (organizacion_id, codigo, razon_social, rfc, dias_credito, contacto)
  values (v_org,'PROV-001','Cementos del Norte SA','CNO900101AAA',30,
          jsonb_build_object('email','ventas@cementosnorte.mx','telefono','8112345678'))
  on conflict do nothing;
  insert into proveedores (organizacion_id, codigo, razon_social, rfc, dias_credito, contacto)
  values (v_org,'PROV-002','Agregados Pétreos SA','APE850505BBB',15,
          jsonb_build_object('email','pedidos@agregados.mx','telefono','8187654321'))
  on conflict do nothing;
  select id into v_prov1 from proveedores where organizacion_id = v_org and codigo = 'PROV-001';
  select id into v_prov2 from proveedores where organizacion_id = v_org and codigo = 'PROV-002';

  -- ── Productos ──
  insert into productos (organizacion_id, sku, nombre, categoria_id, unidad_medida_id,
                         stock_minimo, punto_reorden, stock_maximo, lead_time_dias,
                         proveedor_default, ultimo_costo, costo_promedio, atributos)
  values (v_org,'CEM-GRIS-50','Cemento gris 50 kg', v_cat_mp, v_pza, 100, 150, 800, 3, v_prov1, 210, 210,
          jsonb_build_object('granulometria','CPC 30R'))
  on conflict do nothing;

  insert into productos (organizacion_id, sku, nombre, categoria_id, unidad_medida_id,
                         stock_minimo, punto_reorden, stock_maximo, lead_time_dias,
                         proveedor_default, ultimo_costo, costo_promedio, atributos)
  values (v_org,'ARE-FINA-M3','Arena fina', v_cat_mp, v_m3, 20, 30, 200, 2, v_prov2, 380, 380,
          jsonb_build_object('granulometria','0-4 mm'))
  on conflict do nothing;

  insert into productos (organizacion_id, sku, nombre, categoria_id, unidad_medida_id,
                         stock_minimo, punto_reorden, stock_maximo, ultimo_costo, costo_promedio, atributos)
  values (v_org,'BLK-15X20X40','Block hueco 15x20x40', v_cat_pt, v_pza, 500, 1000, 20000, 14, 14,
          jsonb_build_object('resistencia_kg_cm2', 60, 'medida','15x20x40'))
  on conflict do nothing;

  insert into productos (organizacion_id, sku, nombre, categoria_id, unidad_medida_id,
                         es_inventariable, es_comprable, ultimo_costo)
  values (v_org,'SRV-FLETE','Flete local', v_cat_serv, v_srv, false, true, 1500)
  on conflict do nothing;

  select id into v_p1 from productos where organizacion_id = v_org and sku = 'CEM-GRIS-50';
  select id into v_p2 from productos where organizacion_id = v_org and sku = 'ARE-FINA-M3';
  select id into v_p3 from productos where organizacion_id = v_org and sku = 'BLK-15X20X40';
  select id into v_p4 from productos where organizacion_id = v_org and sku = 'SRV-FLETE';

  -- ── Precios de proveedor ──
  insert into proveedor_productos (organizacion_id, proveedor_id, producto_id, precio, lead_time_dias, cantidad_minima)
  values (v_org, v_prov1, v_p1, 208, 3, 50) on conflict do nothing;
  insert into proveedor_productos (organizacion_id, proveedor_id, producto_id, precio, lead_time_dias, cantidad_minima)
  values (v_org, v_prov2, v_p2, 375, 2, 10) on conflict do nothing;

  -- ── Existencias iniciales (vía movimientos, para que quede kardex) ──
  if not exists (select 1 from movimientos_inventario where organizacion_id = v_org) then
    perform fn_registrar_movimiento(v_org, v_alm_p, v_p1, 'entrada', 500, 'Inventario inicial', null, 210, 'ajuste', null);
    perform fn_registrar_movimiento(v_org, v_alm_p, v_p2, 'entrada',  45, 'Inventario inicial', null, 380, 'ajuste', null);
    perform fn_registrar_movimiento(v_org, v_alm_p, v_p3, 'entrada', 800, 'Inventario inicial', null,  14, 'ajuste', null);
    perform fn_registrar_movimiento(v_org, v_alm_o, v_p3, 'entrada', 300, 'Inventario inicial', null,  14, 'ajuste', null);
  end if;

  -- ── DEMO del flujo: 1 línea con stock, 1 sin stock, 1 servicio ──
  v_res := fn_recibir_y_procesar_pedido(jsonb_build_object(
    'organizacion_id', v_org,
    'origen', 'obra',
    'referencia_externa', 'OBRA-TORRE-A',
    'centro_costo', 'CC-100',
    'prioridad', 'alta',
    'notas', 'Demo automática del flujo de validación de stock',
    'items', jsonb_build_array(
      jsonb_build_object('sku','BLK-15X20X40','cantidad', 600),   -- hay stock  → reserva
      jsonb_build_object('sku','CEM-GRIS-50','cantidad', 900),    -- insuficiente → parcial + requisición
      jsonb_build_object('sku','SRV-FLETE','cantidad', 1)         -- no inventariable → requisición
    )
  ));

  raise notice 'DEMO → %', jsonb_pretty(v_res);
end $$;
