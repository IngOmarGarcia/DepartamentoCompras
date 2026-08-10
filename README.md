# ERP Modular · Compras e Inventarios

Núcleo agnóstico al giro (bloquera, constructora, comercio, servicios). La especialización vive en catálogos dinámicos, `atributos_definicion` y `reglas_negocio` — nunca en el código.

## Arranque

```bash
cp .env.example .env          # llena SUPABASE_URL, SERVICE_ROLE_KEY, DB_URL, API_KEY_PEPPER
npm install
npm run db:push -- --seed     # aplica db/01..04 (el seed corre una demo del flujo)
npm run keygen                # imprime la API Key → cópiala a MCP_API_KEY y a API_KEY (web/.env.local)

npm run dev                   # API      → http://localhost:3000
npm run worker                # tareas periódicas (reservas expiradas, reorden, eventos)
npm run mcp                   # servidor MCP por stdio

cd web && cp .env.local.example .env.local && npm install && npm run dev
                              # Dashboards → http://localhost:5173
```

Sin `SUPABASE_DB_URL` puedes pegar `db/01_schema.sql` … `db/04_seed.sql` en el SQL Editor de Supabase, en ese orden.

### Sin cuenta de Supabase: stack local en Docker

`docker-compose.dev.yml` levanta un equivalente funcional (Postgres + PostgREST + un gateway
que expone las rutas `/rest/v1` que espera `supabase-js`). El esquema y el seed se aplican solos
al arrancar el contenedor.

```bash
npm run dev:db          # levanta el stack en http://localhost:54321 (Postgres en :54322)
npm run dev:keys        # imprime SUPABASE_SERVICE_ROLE_KEY y SUPABASE_ANON_KEY del stack local
npm run keygen          # crea la API Key de la organización demo
npm run dev:db:reset    # borra los datos y vuelve a aplicar db/01..04 desde cero
```

En `.env` usa `SUPABASE_URL=http://localhost:54321` y las llaves que imprime `dev:keys`.
No hace falta GoTrue ni Supabase Auth: este módulo no tiene login propio (ver *Identidad* abajo).
Basta con poner la API Key en `API_KEY` dentro de `web/.env.local`.

## Flujo operativo

```
POST /api/pedidos  ──►  fn_recibir_y_procesar_pedido()   [1 sola transacción]
                          │
                          ├── hay stock ──► reserva en existencias  ──► accion: NOTIFICAR_ALMACEN_SURTIR
                          │                 (cantidad_reservada ↑, disponible ↓)
                          │
                          └── no hay ─────► requisición de compra   ──► accion: NOTIFICAR_COMPRAS_COTIZAR
                                            (auto, si regla auto_generar_requisicion = true)

Compras: requisición → aprobar → OC → recepción
                                        └─► entrada de inventario + costo promedio
                                            + RE-VALIDACIÓN automática de los pedidos en espera

Almacén: POST /api/pedidos/:id/surtir  → reserva se convierte en salida física (kardex)
```

`accion` puede ser `SURTIR_PARCIAL` cuando el pedido tiene a la vez material apartado y líneas en compra; `notificar` lista los dashboards a avisar (`["almacen","compras"]`).

## Estructura

| Ruta | Contenido |
|---|---|
| `db/01_schema.sql` | Tablas, índices, vistas operativas (`v_stock_consolidado`, `v_pedidos_pendientes`, `v_requisiciones_abiertas`, `v_kardex`) |
| `db/02_functions.sql` | Lógica transaccional: reserva atómica, requisición automática, surtido, recepción, KPIs, auditoría |
| `db/03_rls.sql` | Multi-tenant + permisos por rol (admin / compras / almacén) |
| `db/04_seed.sql` | Catálogos demo + corrida end-to-end del flujo |
| `src/core/*.service.ts` | Servicios de negocio — única capa que la REST y MCP comparten |
| `src/api/` | Fastify: auth por API Key o JWT, rutas, manejo de errores |
| `src/mcp/` | Servidor MCP (29 herramientas) sobre los mismos servicios |
| `src/schemas/` | Contratos Zod compartidos por REST y MCP |
| `src/jobs/worker.ts` | Libera reservas caducadas, dispara reorden y drena eventos al webhook |
| `web/` | Next.js 15 + Tailwind v4 — dashboards y configuración de catálogos |

## Dashboards (`web/`)

El menú lateral sigue el flujo operativo, no el organigrama: **todo nace en Pedidos**, de ahí se
reparte a Almacén (lo que hay) y a Compras (lo que falta). Configuración y Administración van al
final porque se tocan una vez, no todos los días.

| Ruta | Rol | Qué resuelve |
|---|---|---|
| `/pedidos` | todos | Seguimiento con barra de avance solicitado → apartado → surtido |
| `/pedidos/nuevo` | todos | Alta del requerimiento — dispara la validación de stock |
| `/almacen` | almacén, admin | KPIs, cola de surtido y alertas de punto de reorden |
| `/almacen/surtir/[id]` | almacén | Convierte el material apartado en salida física (total o parcial) |
| `/almacen/movimientos` | almacén | Entradas, salidas, mermas, ajustes, transferencias + kardex en vivo |
| `/compras` | compras, admin | Bandeja de requisiciones generadas por faltante de stock |
| `/compras/requisiciones/[id]` | compras | Aprobación, sugerencia de proveedor por precio/lead time y emisión de OC |
| `/compras/ordenes/[id]` | compras | Recepción de mercancía; muestra qué pedidos se re-validaron solos |
| `/catalogos` | almacén, admin | **Configuración del giro**: alta de productos, categorías y unidades + carga y conteo de existencias |
| `/admin` | admin | KPIs globales, editor de reglas de negocio, eventos y auditoría |

### `/catalogos` — dónde el sistema se vuelve tuyo

Es la pantalla que adapta el núcleo a cualquier giro sin tocar el esquema ni recompilar:

- **Alta de producto** con categoría y unidad de medida creables en línea, sin salir del formulario.
- **Existencia inicial** en el mismo paso del alta: el producto nace con stock y ya es surtible.
- **Conteo físico** por renglón — se captura *cuántas hay*, no cuánto sumar; el backend calcula el
  ajuste. Repetir el mismo número no genera movimiento.
- **Umbrales** de mínimo, punto de reorden y lead time editables en la tabla.

Lo que se da de alta aquí aparece de inmediato en `/pedidos/nuevo`, y el motor de reserva lo trata
igual que a cualquier otro producto.

## Identidad: el módulo no autentica, hereda

**No hay pantalla de login.** Es un módulo desacoplado, pensado para vivir dentro de una aplicación
principal que ya resolvió quién es el usuario. La identidad llega en los headers de cada petición:

| Header | Obligatorio | Para qué |
|---|---|---|
| `x-api-key` | sí | Credencial de la organización. La API resuelve con ella `organizacion_id` y rol. |
| `x-user-role` | no | Rol del usuario en el sistema padre: `admin`, `compras`, `almacen` o `solicitante`. |

Al entrar por `/`, el módulo redirige solo al dashboard que le toca al rol. Si no llega credencial
válida, se muestra una pantalla que explica qué falta — no hay a dónde iniciar sesión.

**`x-user-role` es una pista de interfaz, no una autorización.** Un navegador que llegue directo
puede mandar el header que quiera, así que solo se le permite **restringir** lo que la credencial ya
autoriza, nunca ampliarlo (`web/lib/sesion.ts`):

- una credencial `admin` puede presentarse como cualquier rol;
- cualquier credencial puede degradarse a `solicitante`;
- en cualquier otro caso mandan los permisos de la API Key.

Quien autoriza de verdad sigue siendo la API, con `requiereRol` sobre el rol de la credencial, del
otro lado de la red. Si necesitas permisos reales por usuario, emite **una API Key por rol** y deja
que el sistema padre inyecte la que corresponda.

Las guardas de sección viven en el `layout.tsx` de cada área (`admin`, `compras`, `almacen`,
`catalogos`), así que cubren también las rutas anidadas sin repetirse.

**El navegador nunca ve la API Key.** Todas las llamadas pasan por el BFF
(`web/app/bff/[...ruta]/route.ts`), que reenvía el `x-api-key` recibido o, si no viene, adjunta en el
servidor la `API_KEY` del entorno — pensada para correr el módulo suelto en desarrollo.

## Endpoints principales

| Método | Ruta | Rol |
|---|---|---|
| `POST` | `/api/pedidos` | cualquiera |
| `POST` | `/api/pedidos/:id/validar` | cualquiera |
| `POST` | `/api/pedidos/:id/surtir` | almacén |
| `GET`  | `/api/pedidos/cola/surtido` | almacén |
| `POST` | `/api/inventario/stock` | cualquiera |
| `POST` | `/api/inventario/movimientos` | almacén |
| `POST` | `/api/inventario/existencias` | almacén |
| `POST` | `/api/inventario/transferencias` | almacén |
| `GET`  | `/api/inventario/kardex` | cualquiera |
| `GET`/`POST` | `/api/catalogos/productos` | cualquiera / almacén |
| `PATCH` | `/api/catalogos/productos/:id` | almacén |
| `GET`/`POST` | `/api/catalogos/categorias` | cualquiera / almacén |
| `GET`/`POST` | `/api/catalogos/unidades` | cualquiera / almacén |
| `GET`  | `/api/compras/requisiciones` | compras |
| `GET`  | `/api/compras/requisiciones/:id/sugerencias` | compras |
| `POST` | `/api/compras/ordenes` | compras |
| `POST` | `/api/compras/ordenes/:id/recepcion` | compras |
| `GET`  | `/api/dashboard?rol=admin\|compras\|almacen` | cualquiera |
| `GET`  | `/api/dashboard/auditoria` | admin |

Autenticación: header `x-api-key: sk_live_…` (o `Authorization: Bearer <jwt>` si integras un
proveedor de identidad propio; el módulo web no lo usa).

`POST /api/inventario/existencias` es el hermano *declarativo* de `movimientos`: recibe la cantidad
que **debe** quedar (`{almacen_id, producto_id, cantidad}`), calcula el delta contra lo que hay y
emite un solo `ajuste_positivo` / `ajuste_negativo`. Es idempotente — mandar el mismo número dos
veces no genera un segundo movimiento — y sigue sin poder consumir material apartado por un pedido.

## Reglas de negocio (sin recompilar)

`PUT /api/catalogos/reglas/:clave`

| Clave | Efecto |
|---|---|
| `permitir_stock_negativo` | Permite salidas sin existencia física |
| `auto_generar_requisicion` | Crea requisición automática al detectar faltante |
| `reserva_parcial` | Aparta lo disponible aunque no cubra la línea completa |
| `permitir_multi_almacen` | Surte combinando varios almacenes |
| `horas_expiracion_reserva` | Caducidad de reservas (0 = sin caducidad) |
| `estrategia_asignacion` | `prioridad` \| `mayor_disponible` |

## Conectar el MCP a Claude Desktop

```json
{
  "mcpServers": {
    "erp-compras": {
      "command": "node",
      "args": ["C:/Users/66762/Desktop/DepartamentoCompras/dist/mcp/server.js"],
      "env": { "MCP_API_KEY": "sk_live_…" }
    }
  }
}
```

## Garantías de concurrencia

- Los bloqueos se toman siempre en el orden `(producto_id, almacen.prioridad, almacen.id)` → sin deadlocks entre pedidos simultáneos.
- El disponible se **re-lee bajo `FOR UPDATE`** antes de apartar: dos pedidos concurrentes nunca reservan la misma unidad.
- `existencias.cantidad_disponible` es columna generada (`cantidad - cantidad_reservada`): imposible que se desincronice.
- Una salida manual jamás puede consumir stock ya apartado por un pedido.

## Worker de tareas periódicas

`npm run worker` — sin él, las reservas caducadas nunca devuelven el material a disponible.

| Tarea | Frecuencia |
|---|---|
| Liberar reservas expiradas | `JOBS_INTERVALO_MIN` (5 min por defecto) |
| Requisiciones por punto de reorden | `JOBS_REORDEN_HORAS` (12 h; `0` lo desactiva) |
| Drenar eventos hacia `WEBHOOK_URL` | cada ciclo, firmado con HMAC-SHA256 en `x-firma` |

Si no defines `WEBHOOK_URL`, los eventos simplemente se marcan como procesados para que la cola no crezca.

## Verificación ejecutada

Sistema levantado completo (Postgres + PostgREST + API + Next.js) y probado de punta a punta:

| Paso | Verificado |
|---|---|
| Pedido de 700 con 500 en almacén | aparta 500, requisita 200, `accion: SURTIR_PARCIAL`, `notificar: [almacen, compras]` |
| OC sin aprobación previa | rechazada con `REQUISICION_NO_APROBADA` (regla `requiere_aprobacion_requisicion`) |
| Aprobación con API Key (sin perfil) | acepta `aprobador_id` nulo |
| OC 200 × 12.50 | subtotal 2 500 · total 2 900 con IVA |
| Recepción | OC `recibida` + **re-validación automática** que apartó las 200 recién llegadas |
| Surtido | 700 unidades, pendiente 0, pedido `surtido` |
| Invariante de stock | `cantidad = apartado + disponible` se mantiene tras todo el ciclo |
| Merma sobre stock apartado | bloqueada con `DISPONIBLE_INSUFICIENTE` |
| 12 rutas del front | HTTP 200 con datos reales renderizados |
