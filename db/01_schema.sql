-- ============================================================================
--  ERP MODULAR · COMPRAS E INVENTARIOS
--  01_schema.sql — Estructura agnóstica al giro (bloquera, constructora,
--  comercio, servicios). Toda especialización vive en `metadata jsonb`
--  y en catálogos dinámicos (categorias, atributos, reglas_negocio).
--  Postgres 15+ / Supabase
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "btree_gin";

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. TIPOS
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type rol_usuario as enum ('admin', 'compras', 'almacen', 'solicitante');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estatus_pedido as enum (
    'borrador', 'recibido', 'validando', 'reservado_parcial', 'reservado_total',
    'en_requisicion', 'surtido_parcial', 'surtido', 'cancelado'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type estatus_reserva as enum ('activa', 'surtida', 'liberada', 'expirada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_movimiento as enum (
    'entrada', 'salida', 'merma', 'ajuste_positivo', 'ajuste_negativo',
    'transferencia_entrada', 'transferencia_salida', 'devolucion_proveedor',
    'devolucion_cliente'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type estatus_requisicion as enum (
    'abierta', 'cotizando', 'aprobada', 'rechazada', 'en_orden', 'cerrada', 'cancelada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type estatus_orden_compra as enum (
    'borrador', 'enviada', 'confirmada', 'recibida_parcial', 'recibida', 'cancelada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type prioridad as enum ('baja', 'normal', 'alta', 'urgente');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TENANT / IDENTIDAD
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists organizaciones (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  slug           text not null unique,
  giro           text,                                  -- etiqueta libre: 'bloquera', 'constructora'...
  moneda_base    char(3) not null default 'MXN',
  zona_horaria   text not null default 'America/Mexico_City',
  metadata       jsonb not null default '{}'::jsonb,
  activa         boolean not null default true,
  creado_en      timestamptz not null default now()
);

-- Perfil vinculado a auth.users de Supabase (id = auth.uid()).
create table if not exists perfiles (
  id               uuid primary key,
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  nombre           text not null,
  email            text not null,
  rol              rol_usuario not null default 'solicitante',
  almacen_default  uuid,
  activo           boolean not null default true,
  metadata         jsonb not null default '{}'::jsonb,
  creado_en        timestamptz not null default now()
);
create index if not exists ix_perfiles_org on perfiles(organizacion_id, rol) where activo;
create unique index if not exists ux_perfiles_email_org on perfiles(organizacion_id, lower(email));

-- API Keys para consumo máquina-a-máquina (capa MCP / integraciones).
create table if not exists api_keys (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  nombre           text not null,
  prefijo          text not null,                       -- 8 chars visibles para identificar la key
  hash             text not null unique,                -- sha256(key || pepper)
  rol              rol_usuario not null default 'admin',
  scopes           text[] not null default array['*'],
  ultimo_uso       timestamptz,
  expira_en        timestamptz,
  revocada         boolean not null default false,
  creado_en        timestamptz not null default now()
);
create index if not exists ix_api_keys_hash on api_keys(hash) where not revocada;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONFIGURACIÓN AGNÓSTICA (reglas + folios)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists reglas_negocio (
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  clave            text not null,
  valor            jsonb not null,
  descripcion      text,
  actualizado_en   timestamptz not null default now(),
  primary key (organizacion_id, clave)
);
comment on table reglas_negocio is
  'Motor de configuración. Claves soportadas: permitir_stock_negativo(bool), '
  'auto_generar_requisicion(bool), reserva_parcial(bool), horas_expiracion_reserva(int), '
  'estrategia_asignacion(text: prioridad|mayor_disponible|fifo), '
  'requiere_aprobacion_requisicion(bool), monto_aprobacion_automatica(number).';

create table if not exists folios (
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  tipo             text not null,                       -- 'PED','REQ','OC','MOV'
  prefijo          text not null default '',
  ultimo           bigint not null default 0,
  primary key (organizacion_id, tipo)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CATÁLOGOS DINÁMICOS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists unidades_medida (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  codigo           text not null,                       -- 'PZA','M3','TON','SRV','HR'
  nombre           text not null,
  decimales        smallint not null default 2 check (decimales between 0 and 6),
  activa           boolean not null default true
);
create unique index if not exists ux_um_codigo on unidades_medida(organizacion_id, upper(codigo));

create table if not exists categorias (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  padre_id         uuid references categorias(id) on delete set null,
  codigo           text not null,
  nombre           text not null,
  ruta             text,                                -- materializada: 'MAT/CEM/GRIS'
  metadata         jsonb not null default '{}'::jsonb,
  activa           boolean not null default true
);
create unique index if not exists ux_categorias_codigo on categorias(organizacion_id, upper(codigo));
create index if not exists ix_categorias_padre on categorias(padre_id);

-- Definición de atributos dinámicos por categoría (esquema flexible sin DDL).
create table if not exists atributos_definicion (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  categoria_id     uuid references categorias(id) on delete cascade,
  clave            text not null,
  etiqueta         text not null,
  tipo_dato        text not null check (tipo_dato in ('texto','numero','booleano','fecha','lista')),
  opciones         jsonb not null default '[]'::jsonb,
  requerido        boolean not null default false,
  orden            smallint not null default 0
);
create unique index if not exists ux_atributos_clave
  on atributos_definicion(organizacion_id, coalesce(categoria_id, '00000000-0000-0000-0000-000000000000'::uuid), clave);

create table if not exists productos (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references organizaciones(id) on delete cascade,
  sku                text not null,
  nombre             text not null,
  descripcion        text,
  categoria_id       uuid references categorias(id) on delete set null,
  unidad_medida_id   uuid not null references unidades_medida(id),
  es_inventariable   boolean not null default true,     -- false = servicio / gasto directo
  es_comprable       boolean not null default true,
  costo_promedio     numeric(18,6) not null default 0 check (costo_promedio >= 0),
  ultimo_costo       numeric(18,6) not null default 0 check (ultimo_costo >= 0),
  stock_minimo       numeric(18,4) not null default 0 check (stock_minimo >= 0),
  stock_maximo       numeric(18,4),
  punto_reorden      numeric(18,4) not null default 0 check (punto_reorden >= 0),
  lead_time_dias     smallint not null default 0,
  proveedor_default  uuid,
  atributos          jsonb not null default '{}'::jsonb, -- valores de atributos_definicion
  metadata           jsonb not null default '{}'::jsonb,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
create unique index if not exists ux_productos_sku on productos(organizacion_id, upper(sku));
create index if not exists ix_productos_categoria on productos(categoria_id) where activo;
create index if not exists ix_productos_busqueda on productos using gin (
  (coalesce(nombre,'') || ' ' || coalesce(sku,'') || ' ' || coalesce(descripcion,'')) gin_trgm_ops
);
create index if not exists ix_productos_atributos on productos using gin (atributos jsonb_path_ops);

create table if not exists almacenes (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  codigo           text not null,
  nombre           text not null,
  tipo             text not null default 'fisico' check (tipo in ('fisico','transito','virtual','obra')),
  direccion        jsonb not null default '{}'::jsonb,
  prioridad        smallint not null default 100,       -- menor = se surte primero
  permite_negativo boolean not null default false,
  responsable_id   uuid references perfiles(id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  activo           boolean not null default true
);
create unique index if not exists ux_almacenes_codigo on almacenes(organizacion_id, upper(codigo));
create index if not exists ix_almacenes_prioridad on almacenes(organizacion_id, prioridad) where activo;

alter table perfiles
  drop constraint if exists fk_perfiles_almacen,
  add constraint fk_perfiles_almacen foreign key (almacen_default)
    references almacenes(id) on delete set null;

create table if not exists proveedores (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references organizaciones(id) on delete cascade,
  codigo            text not null,
  razon_social      text not null,
  nombre_comercial  text,
  rfc               text,
  contacto          jsonb not null default '{}'::jsonb, -- {email, telefono, nombre}
  direccion         jsonb not null default '{}'::jsonb,
  dias_credito      smallint not null default 0,
  moneda            char(3) not null default 'MXN',
  calificacion      numeric(3,2) check (calificacion between 0 and 5),
  metadata          jsonb not null default '{}'::jsonb,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now()
);
create unique index if not exists ux_proveedores_codigo on proveedores(organizacion_id, upper(codigo));

alter table productos
  drop constraint if exists fk_productos_proveedor,
  add constraint fk_productos_proveedor foreign key (proveedor_default)
    references proveedores(id) on delete set null;

-- Catálogo de precios/tiempos por proveedor (para cotización automática).
create table if not exists proveedor_productos (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references organizaciones(id) on delete cascade,
  proveedor_id      uuid not null references proveedores(id) on delete cascade,
  producto_id       uuid not null references productos(id) on delete cascade,
  sku_proveedor     text,
  precio            numeric(18,6) not null check (precio >= 0),
  moneda            char(3) not null default 'MXN',
  lead_time_dias    smallint not null default 0,
  cantidad_minima   numeric(18,4) not null default 1,
  vigente_desde     date not null default current_date,
  vigente_hasta     date,
  activo            boolean not null default true
);
create unique index if not exists ux_prov_prod on proveedor_productos(proveedor_id, producto_id, vigente_desde);
create index if not exists ix_prov_prod_producto on proveedor_productos(producto_id) where activo;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. INVENTARIO
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists existencias (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null references organizaciones(id) on delete cascade,
  almacen_id          uuid not null references almacenes(id) on delete cascade,
  producto_id         uuid not null references productos(id) on delete cascade,
  cantidad            numeric(18,4) not null default 0,
  cantidad_reservada  numeric(18,4) not null default 0 check (cantidad_reservada >= 0),
  cantidad_disponible numeric(18,4) generated always as (cantidad - cantidad_reservada) stored,
  ubicacion           text,                              -- pasillo/rack, libre
  actualizado_en      timestamptz not null default now()
);
create unique index if not exists ux_existencias on existencias(almacen_id, producto_id);
create index if not exists ix_existencias_producto on existencias(producto_id);
create index if not exists ix_existencias_disponible on existencias(organizacion_id, producto_id, cantidad_disponible);

create table if not exists movimientos_inventario (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references organizaciones(id) on delete cascade,
  folio             text not null,
  almacen_id        uuid not null references almacenes(id),
  producto_id       uuid not null references productos(id),
  tipo              tipo_movimiento not null,
  cantidad          numeric(18,4) not null check (cantidad > 0),
  signo             smallint not null check (signo in (-1, 1)),
  costo_unitario    numeric(18,6) not null default 0,
  saldo_posterior   numeric(18,4),
  referencia_tipo   text,                                -- 'pedido','orden_compra','ajuste','transferencia'
  referencia_id     uuid,
  lote              text,
  motivo            text,
  usuario_id        uuid references perfiles(id) on delete set null,
  metadata          jsonb not null default '{}'::jsonb,
  creado_en         timestamptz not null default now()
);
create index if not exists ix_mov_almacen_prod on movimientos_inventario(almacen_id, producto_id, creado_en desc);
create index if not exists ix_mov_referencia on movimientos_inventario(referencia_tipo, referencia_id);
create index if not exists ix_mov_org_fecha on movimientos_inventario(organizacion_id, creado_en desc);
create unique index if not exists ux_mov_folio on movimientos_inventario(organizacion_id, folio);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PEDIDOS / REQUERIMIENTOS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists pedidos (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null references organizaciones(id) on delete cascade,
  folio               text not null,
  origen              text not null default 'interno',   -- 'interno','venta','obra','api','mcp'
  referencia_externa  text,
  solicitante_id      uuid references perfiles(id) on delete set null,
  centro_costo        text,
  almacen_preferente  uuid references almacenes(id) on delete set null,
  estatus             estatus_pedido not null default 'borrador',
  prioridad           prioridad not null default 'normal',
  fecha_requerida     date,
  notas               text,
  metadata            jsonb not null default '{}'::jsonb,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);
create unique index if not exists ux_pedidos_folio on pedidos(organizacion_id, folio);
create index if not exists ix_pedidos_estatus on pedidos(organizacion_id, estatus, creado_en desc);
create index if not exists ix_pedidos_solicitante on pedidos(solicitante_id);

create table if not exists pedido_items (
  id                    uuid primary key default gen_random_uuid(),
  organizacion_id       uuid not null references organizaciones(id) on delete cascade,
  pedido_id             uuid not null references pedidos(id) on delete cascade,
  linea                 smallint not null,
  producto_id           uuid not null references productos(id),
  cantidad_solicitada   numeric(18,4) not null check (cantidad_solicitada > 0),
  cantidad_reservada    numeric(18,4) not null default 0 check (cantidad_reservada >= 0),
  cantidad_surtida      numeric(18,4) not null default 0 check (cantidad_surtida >= 0),
  cantidad_en_compra    numeric(18,4) not null default 0 check (cantidad_en_compra >= 0),
  precio_estimado       numeric(18,6) not null default 0,
  notas                 text,
  metadata              jsonb not null default '{}'::jsonb,
  constraint ck_item_surtido check (cantidad_surtida <= cantidad_solicitada)
);
create unique index if not exists ux_pedido_items_linea on pedido_items(pedido_id, linea);
create index if not exists ix_pedido_items_producto on pedido_items(producto_id);

create table if not exists reservas (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  pedido_item_id   uuid not null references pedido_items(id) on delete cascade,
  almacen_id       uuid not null references almacenes(id),
  producto_id      uuid not null references productos(id),
  cantidad         numeric(18,4) not null check (cantidad > 0),
  estatus          estatus_reserva not null default 'activa',
  expira_en        timestamptz,
  creado_en        timestamptz not null default now(),
  cerrado_en       timestamptz
);
create index if not exists ix_reservas_item on reservas(pedido_item_id) where estatus = 'activa';
create index if not exists ix_reservas_almacen on reservas(almacen_id, producto_id) where estatus = 'activa';
create index if not exists ix_reservas_expira on reservas(expira_en) where estatus = 'activa';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. COMPRAS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists requisiciones (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references organizaciones(id) on delete cascade,
  folio              text not null,
  pedido_id          uuid references pedidos(id) on delete set null,
  origen             text not null default 'faltante_stock', -- 'faltante_stock','punto_reorden','manual'
  estatus            estatus_requisicion not null default 'abierta',
  prioridad          prioridad not null default 'normal',
  fecha_requerida    date,
  solicitante_id     uuid references perfiles(id) on delete set null,
  aprobador_id       uuid references perfiles(id) on delete set null,
  aprobado_en        timestamptz,
  motivo_rechazo     text,
  notas              text,
  metadata           jsonb not null default '{}'::jsonb,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
create unique index if not exists ux_requisiciones_folio on requisiciones(organizacion_id, folio);
create index if not exists ix_requisiciones_estatus on requisiciones(organizacion_id, estatus, creado_en desc);
create index if not exists ix_requisiciones_pedido on requisiciones(pedido_id);

create table if not exists requisicion_items (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null references organizaciones(id) on delete cascade,
  requisicion_id      uuid not null references requisiciones(id) on delete cascade,
  linea               smallint not null,
  producto_id         uuid not null references productos(id),
  pedido_item_id      uuid references pedido_items(id) on delete set null,
  cantidad            numeric(18,4) not null check (cantidad > 0),
  cantidad_ordenada   numeric(18,4) not null default 0 check (cantidad_ordenada >= 0),
  cantidad_recibida   numeric(18,4) not null default 0 check (cantidad_recibida >= 0),
  almacen_destino     uuid references almacenes(id) on delete set null,
  precio_estimado     numeric(18,6) not null default 0,
  metadata            jsonb not null default '{}'::jsonb
);
create unique index if not exists ux_req_items_linea on requisicion_items(requisicion_id, linea);
create index if not exists ix_req_items_producto on requisicion_items(producto_id);
create index if not exists ix_req_items_pedido_item on requisicion_items(pedido_item_id);

create table if not exists ordenes_compra (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references organizaciones(id) on delete cascade,
  folio              text not null,
  proveedor_id       uuid not null references proveedores(id),
  requisicion_id     uuid references requisiciones(id) on delete set null,
  almacen_destino    uuid not null references almacenes(id),
  estatus            estatus_orden_compra not null default 'borrador',
  moneda             char(3) not null default 'MXN',
  tipo_cambio        numeric(18,6) not null default 1,
  subtotal           numeric(18,4) not null default 0,
  impuestos          numeric(18,4) not null default 0,
  total              numeric(18,4) not null default 0,
  fecha_emision      date not null default current_date,
  fecha_promesa      date,
  comprador_id       uuid references perfiles(id) on delete set null,
  condiciones_pago   text,
  notas              text,
  metadata           jsonb not null default '{}'::jsonb,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
create unique index if not exists ux_oc_folio on ordenes_compra(organizacion_id, folio);
create index if not exists ix_oc_estatus on ordenes_compra(organizacion_id, estatus, creado_en desc);
create index if not exists ix_oc_proveedor on ordenes_compra(proveedor_id);

create table if not exists orden_compra_items (
  id                   uuid primary key default gen_random_uuid(),
  organizacion_id      uuid not null references organizaciones(id) on delete cascade,
  orden_compra_id      uuid not null references ordenes_compra(id) on delete cascade,
  linea                smallint not null,
  producto_id          uuid not null references productos(id),
  requisicion_item_id  uuid references requisicion_items(id) on delete set null,
  cantidad             numeric(18,4) not null check (cantidad > 0),
  cantidad_recibida    numeric(18,4) not null default 0 check (cantidad_recibida >= 0),
  precio_unitario      numeric(18,6) not null check (precio_unitario >= 0),
  tasa_impuesto        numeric(6,4) not null default 0.16,
  importe              numeric(18,4) generated always as (cantidad * precio_unitario) stored,
  metadata             jsonb not null default '{}'::jsonb,
  constraint ck_oc_item_recibido check (cantidad_recibida <= cantidad)
);
create unique index if not exists ux_oc_items_linea on orden_compra_items(orden_compra_id, linea);
create index if not exists ix_oc_items_req_item on orden_compra_items(requisicion_item_id);

create table if not exists recepciones (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references organizaciones(id) on delete cascade,
  folio             text not null,
  orden_compra_id   uuid not null references ordenes_compra(id) on delete cascade,
  almacen_id        uuid not null references almacenes(id),
  recibido_por      uuid references perfiles(id) on delete set null,
  factura_ref       text,
  notas             text,
  metadata          jsonb not null default '{}'::jsonb,
  creado_en         timestamptz not null default now()
);
create unique index if not exists ux_recepciones_folio on recepciones(organizacion_id, folio);
create index if not exists ix_recepciones_oc on recepciones(orden_compra_id);

create table if not exists recepcion_items (
  id                   uuid primary key default gen_random_uuid(),
  organizacion_id      uuid not null references organizaciones(id) on delete cascade,
  recepcion_id         uuid not null references recepciones(id) on delete cascade,
  orden_compra_item_id uuid not null references orden_compra_items(id),
  producto_id          uuid not null references productos(id),
  cantidad             numeric(18,4) not null check (cantidad > 0),
  cantidad_rechazada   numeric(18,4) not null default 0 check (cantidad_rechazada >= 0),
  costo_unitario       numeric(18,6) not null default 0,
  lote                 text,
  metadata             jsonb not null default '{}'::jsonb
);
create index if not exists ix_recepcion_items_rec on recepcion_items(recepcion_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. AUDITORÍA Y EVENTOS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists auditoria (
  id               bigserial primary key,
  organizacion_id  uuid,
  tabla            text not null,
  registro_id      text not null,
  accion           text not null check (accion in ('INSERT','UPDATE','DELETE')),
  usuario_id       uuid,
  actor            text,                                -- 'api_key:PREFIJO' | 'user:uuid' | 'system'
  datos_antes      jsonb,
  datos_despues    jsonb,
  creado_en        timestamptz not null default now()
);
create index if not exists ix_auditoria_tabla on auditoria(tabla, registro_id, creado_en desc);
create index if not exists ix_auditoria_org on auditoria(organizacion_id, creado_en desc);

-- Bitácora de eventos de dominio (consumible por webhooks / MCP).
create table if not exists eventos (
  id               bigserial primary key,
  organizacion_id  uuid not null references organizaciones(id) on delete cascade,
  tipo             text not null,                       -- 'pedido.reservado','requisicion.creada'...
  agregado_tipo    text not null,
  agregado_id      uuid not null,
  payload          jsonb not null default '{}'::jsonb,
  procesado        boolean not null default false,
  creado_en        timestamptz not null default now()
);
create index if not exists ix_eventos_pendientes on eventos(organizacion_id, creado_en) where not procesado;
create index if not exists ix_eventos_agregado on eventos(agregado_tipo, agregado_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. VISTAS OPERATIVAS (alimentan los 3 dashboards)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view v_stock_consolidado as
select
  e.organizacion_id,
  e.producto_id,
  p.sku,
  p.nombre,
  p.stock_minimo,
  p.punto_reorden,
  um.codigo                       as unidad,
  sum(e.cantidad)                 as cantidad_total,
  sum(e.cantidad_reservada)       as reservado_total,
  sum(e.cantidad_disponible)      as disponible_total,
  count(distinct e.almacen_id)    as almacenes,
  (sum(e.cantidad_disponible) <= p.punto_reorden) as requiere_reorden
from existencias e
join productos p on p.id = e.producto_id
join unidades_medida um on um.id = p.unidad_medida_id
where p.activo
group by e.organizacion_id, e.producto_id, p.sku, p.nombre, p.stock_minimo, p.punto_reorden, um.codigo;

create or replace view v_pedidos_pendientes as
select
  pe.id, pe.organizacion_id, pe.folio, pe.estatus, pe.prioridad, pe.fecha_requerida,
  pe.creado_en,
  count(pi.id)                                                as lineas,
  sum(pi.cantidad_solicitada)                                 as total_solicitado,
  sum(pi.cantidad_reservada)                                  as total_reservado,
  sum(pi.cantidad_surtida)                                    as total_surtido,
  sum(pi.cantidad_solicitada - pi.cantidad_reservada - pi.cantidad_surtida) as total_faltante
from pedidos pe
join pedido_items pi on pi.pedido_id = pe.id
where pe.estatus not in ('cancelado','surtido')
group by pe.id;

create or replace view v_requisiciones_abiertas as
select
  r.id, r.organizacion_id, r.folio, r.estatus, r.prioridad, r.fecha_requerida, r.creado_en,
  r.pedido_id,
  count(ri.id)                                     as lineas,
  sum(ri.cantidad)                                 as total_solicitado,
  sum(ri.cantidad_ordenada)                        as total_ordenado,
  sum(ri.cantidad_recibida)                        as total_recibido,
  sum(ri.cantidad * ri.precio_estimado)            as monto_estimado
from requisiciones r
join requisicion_items ri on ri.requisicion_id = r.id
where r.estatus not in ('cerrada','cancelada','rechazada')
group by r.id;

create or replace view v_kardex as
select
  m.organizacion_id, m.id, m.folio, m.creado_en, m.tipo, m.signo,
  m.cantidad, (m.signo * m.cantidad) as cantidad_neta, m.saldo_posterior,
  m.almacen_id, a.codigo as almacen_codigo,
  m.producto_id, p.sku, p.nombre as producto,
  m.referencia_tipo, m.referencia_id, m.motivo, m.usuario_id
from movimientos_inventario m
join almacenes a on a.id = m.almacen_id
join productos p on p.id = m.producto_id;
