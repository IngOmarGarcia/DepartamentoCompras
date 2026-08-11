import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generarApiKey, prefijoDeApiKey } from '../src/lib/crypto.js';

/**
 * El `prefijo` es la parte no secreta de una API Key: se guarda en claro para
 * poder identificarla sin conocerla. Derivarlo de la clave presentada permite
 * distinguir "esta credencial no existe" de "existe pero el hash no cuadra",
 * que es lo que ocurre cuando API_KEY_PEPPER difiere entre entornos.
 */
describe('prefijoDeApiKey', () => {
  it('coincide con el prefijo que guarda generarApiKey', () => {
    for (let i = 0; i < 50; i++) {
      const { clave, prefijo } = generarApiKey('live');
      assert.equal(prefijoDeApiKey(clave), prefijo);
    }
  });

  it('funciona con claves de prueba', () => {
    const { clave, prefijo } = generarApiKey('test');
    assert.equal(prefijoDeApiKey(clave), prefijo);
  });

  it('respeta los guiones bajos del cuerpo base64url', () => {
    // base64url usa "-" y "_": cortar por el primer "_" daria un prefijo mal.
    assert.equal(prefijoDeApiKey('sk_live_a_BcD3f9restodelaclave'), 'a_BcD3f9');
  });

  it('devuelve null si no tiene forma de API Key', () => {
    assert.equal(prefijoDeApiKey('token-cualquiera'), null);
    assert.equal(prefijoDeApiKey(''), null);
    assert.equal(prefijoDeApiKey('sk_live_corta'), null);
  });
});
