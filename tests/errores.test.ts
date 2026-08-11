import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { desdePostgres } from '../src/lib/errors.js';

/**
 * `desdePostgres` es el único traductor entre los errores de PostgREST/Postgres
 * y el contrato `{ codigo, mensaje }` que consumen REST y MCP. Un fallo de
 * configuración o de esquema no debe acabar como "error interno": ese
 * enmascaramiento fue el que ocultó un `.env` mal apuntado.
 */

function clasificar(error: Parameters<typeof desdePostgres>[0]) {
  const e = desdePostgres(error);
  return { codigo: e.codigo, status: e.status };
}

describe('desdePostgres · infraestructura y configuración', () => {
  it('marca como CONFIG_SUPABASE la credencial rechazada por el gateway', () => {
    assert.deepEqual(clasificar({ message: 'Invalid API key' }), { codigo: 'CONFIG_SUPABASE', status: 503 });
  });

  it('marca como CONFIG_SUPABASE la petición sin llave', () => {
    assert.deepEqual(clasificar({ message: 'No API key found in request' }), {
      codigo: 'CONFIG_SUPABASE',
      status: 503,
    });
  });

  it('explica qué revisar en el mensaje', () => {
    const e = desdePostgres({ message: 'Invalid API key' });
    assert.match(e.message, /SUPABASE_URL/);
    assert.match(e.message, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('marca como SUPABASE_INALCANZABLE un fallo de red', () => {
    assert.deepEqual(clasificar({ message: 'TypeError: fetch failed', code: '' }), {
      codigo: 'SUPABASE_INALCANZABLE',
      status: 503,
    });
  });

  it('marca como SUPABASE_INALCANZABLE un DNS que no resuelve', () => {
    assert.deepEqual(clasificar({ message: 'getaddrinfo ENOTFOUND db.x.supabase.co' }), {
      codigo: 'SUPABASE_INALCANZABLE',
      status: 503,
    });
  });
});

describe('desdePostgres · esquema desalineado', () => {
  const casos: Array<[string, string, string]> = [
    ['PGRST205', "Could not find the table 'public.requisiciones' in the schema cache", 'tabla ausente'],
    ['PGRST200', "Could not find a relationship between 'pedidos' and 'requisiciones'", 'embed sin relación'],
    ['PGRST204', "Could not find the 'centro_costo' column", 'columna ausente del cache'],
    ['PGRST202', 'Could not find the function public.fn_crear_pedido', 'función rpc ausente'],
    ['42P01', 'relation "requisiciones" does not exist', 'relación inexistente'],
    ['42703', 'column pedidos.centro_costo does not exist', 'columna inexistente'],
    ['42883', 'function fn_procesar_pedido(uuid) does not exist', 'función inexistente'],
  ];

  for (const [code, message, titulo] of casos) {
    it(`clasifica ${code} (${titulo})`, () => {
      assert.deepEqual(clasificar({ code, message }), { codigo: 'ESQUEMA_DESALINEADO', status: 500 });
    });
  }

  it('conserva el código original y apunta a los archivos SQL', () => {
    const e = desdePostgres({ code: 'PGRST200', message: 'sin relación' });
    assert.match(e.message, /PGRST200/);
    assert.match(e.message, /db\/01_schema\.sql/);
  });
});

describe('desdePostgres · contrato de dominio (regresión)', () => {
  it('respeta los códigos que lanzan las funciones plpgsql', () => {
    assert.deepEqual(clasificar({ message: 'STOCK_INSUFICIENTE: faltan 40 PZA' }), {
      codigo: 'STOCK_INSUFICIENTE',
      status: 409,
    });
    assert.deepEqual(clasificar({ message: 'PEDIDO_NO_ENCONTRADO: folio PED-1' }), {
      codigo: 'PEDIDO_NO_ENCONTRADO',
      status: 404,
    });
  });

  it('extrae el mensaje sin el prefijo del código', () => {
    assert.equal(desdePostgres({ message: 'STOCK_INSUFICIENTE: faltan 40 PZA' }).message, 'faltan 40 PZA');
  });

  it('un código de dominio desconocido cae en 400, no en 500', () => {
    assert.deepEqual(clasificar({ message: 'ALGO_NUEVO: pasó algo' }), { codigo: 'ALGO_NUEVO', status: 400 });
  });

  it('mantiene los códigos SQLSTATE ya soportados', () => {
    assert.deepEqual(clasificar({ code: '23505', message: 'duplicate key' }), { codigo: 'DUPLICADO', status: 409 });
    assert.deepEqual(clasificar({ code: '23503', message: 'fk' }), { codigo: 'REFERENCIA_INVALIDA', status: 422 });
    assert.deepEqual(clasificar({ code: '23514', message: 'check' }), { codigo: 'RESTRICCION_VIOLADA', status: 422 });
    assert.deepEqual(clasificar({ code: '42501', message: 'denied' }), { codigo: 'SIN_PERMISO', status: 403 });
    assert.deepEqual(clasificar({ code: 'PGRST116', message: 'no rows' }), { codigo: 'NO_ENCONTRADO', status: 404 });
  });

  it('lo verdaderamente desconocido sigue siendo ERROR_BD', () => {
    assert.deepEqual(clasificar({ code: 'XX000', message: 'algo raro pasó' }), { codigo: 'ERROR_BD', status: 500 });
  });

  it('tolera un error nulo', () => {
    assert.deepEqual(clasificar(null), { codigo: 'ERROR_BD', status: 500 });
  });
});
