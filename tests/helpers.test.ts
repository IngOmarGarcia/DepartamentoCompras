import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { idRuta } from '../src/api/helpers.js';
import { AppError } from '../src/lib/errors.js';

/**
 * Los identificadores de ruta llegan como texto libre. Validarlos en el borde
 * evita un viaje a la base para que Postgres devuelva un 22P02 que, sin
 * traducir, se reportaba como fallo del servidor.
 */
describe('idRuta', () => {
  it('deja pasar un UUID válido', () => {
    const id = '76e6d661-d47a-4633-a8b8-b584d4b6d3b5';
    assert.equal(idRuta(id), id);
  });

  it('rechaza un segmento de ruta que no es UUID', () => {
    assert.throws(
      () => idRuta('cola-surtido'),
      (e: unknown) => e instanceof AppError && e.codigo === 'ID_INVALIDO' && e.status === 400,
    );
  });

  it('rechaza la cadena vacía', () => {
    assert.throws(() => idRuta(''), (e: unknown) => e instanceof AppError && e.status === 400);
  });

  it('nombra el parámetro en el mensaje', () => {
    assert.throws(
      () => idRuta('xyz', 'requisicion_id'),
      (e: unknown) => e instanceof AppError && /requisicion_id/.test(e.message),
    );
  });
});
