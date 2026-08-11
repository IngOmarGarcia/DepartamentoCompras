import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { diagnosticar, probarCredencial } from '../src/config/verificar-supabase.js';

/**
 * Chequeo de arranque. El caso que lo motivó: las llaves del stack local de
 * `docker-compose.dev.yml` en un `.env` que apunta a Supabase Cloud. El
 * gateway las rechaza y toda la API responde CONFIG_SUPABASE, sin pista de
 * que el problema está en la configuración.
 */

const NUBE = 'https://giscybshrxivnmyrdoin.supabase.co';
const REF = 'giscybshrxivnmyrdoin';
const LOCAL = 'http://localhost:54321';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function jwt(carga: Record<string, unknown>): string {
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64({ alg: 'HS256', typ: 'JWT' });
  const cuerpo = b64({ iat: ahora, exp: ahora + 3600, ...carga });
  const firma = createHmac('sha256', 'irrelevante').update(`${cabecera}.${cuerpo}`).digest('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}

const srNube = () => jwt({ role: 'service_role', ref: REF });
const anonNube = () => jwt({ role: 'anon', ref: REF });
const srLocal = () => jwt({ role: 'service_role', iss: 'supabase-local' });
const anonLocal = () => jwt({ role: 'anon', iss: 'supabase-local' });

describe('diagnosticar · configuraciones que deben abortar el arranque', () => {
  it('detecta llaves del stack local apuntando a la nube', () => {
    const d = diagnosticar(NUBE, srLocal(), anonLocal());
    assert.equal(d.fatales.length, 2);
    assert.match(d.fatales[0]!, /supabase-local/);
    assert.match(d.fatales[0]!, new RegExp(REF));
  });

  it('detecta una llave de otro proyecto', () => {
    const d = diagnosticar(NUBE, jwt({ role: 'service_role', ref: 'otroproyectoabcdefgh' }));
    assert.equal(d.fatales.length, 1);
    assert.match(d.fatales[0]!, /otroproyectoabcdefgh/);
  });

  it('detecta la anon key en la ranura de service_role', () => {
    const d = diagnosticar(NUBE, jwt({ role: 'anon', ref: REF }));
    assert.match(d.fatales[0]!, /rol "anon"/);
  });

  it('detecta una llave expirada', () => {
    const d = diagnosticar(NUBE, jwt({ role: 'service_role', ref: REF, exp: Math.floor(Date.now() / 1000) - 10 }));
    assert.match(d.fatales[0]!, /expiró/);
  });

  it('detecta la llave publicable nueva en la ranura secreta', () => {
    const d = diagnosticar(NUBE, 'sb_publishable_abc123');
    assert.match(d.fatales[0]!, /sb_secret_/);
  });

  it('detecta la llave secreta nueva expuesta como anon', () => {
    const d = diagnosticar(NUBE, 'sb_secret_abc123', 'sb_secret_abc123');
    assert.equal(d.fatales.length, 1);
    assert.match(d.fatales[0]!, /SUPABASE_ANON_KEY/);
  });
});

describe('diagnosticar · configuraciones válidas', () => {
  it('acepta un par coherente del mismo proyecto', () => {
    assert.deepEqual(diagnosticar(NUBE, srNube(), anonNube()).fatales, []);
  });

  it('acepta las llaves nuevas bien colocadas', () => {
    assert.deepEqual(diagnosticar(NUBE, 'sb_secret_abc123', 'sb_publishable_abc123').fatales, []);
  });

  it('acepta el stack local, donde las llaves no llevan ref', () => {
    assert.deepEqual(diagnosticar(LOCAL, srLocal(), anonLocal()).fatales, []);
  });

  it('tolera la barra final en la URL', () => {
    assert.deepEqual(diagnosticar(`${NUBE}/`, srNube()).fatales, []);
  });

  it('avisa, sin abortar, cuando la llave no se puede interpretar', () => {
    const d = diagnosticar(NUBE, 'una-cadena-cualquiera-larga');
    assert.deepEqual(d.fatales, []);
    assert.equal(d.avisos.length, 1);
  });

  it('no exige la anon key', () => {
    assert.deepEqual(diagnosticar(NUBE, srNube()).fatales, []);
  });
});

describe('probarCredencial · comprobación en vivo', () => {
  async function conServidor(status: number, cuerpo: string, prueba: (url: string) => Promise<void>) {
    const server: Server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(cuerpo);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    try {
      await prueba(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it('aborta si el proyecto rechaza la credencial (caza llaves rotadas)', async () => {
    await conServidor(401, '{"message":"Invalid API key"}', async (url) => {
      const d = await probarCredencial(url, 'lo-que-sea');
      assert.equal(d.fatales.length, 1);
      assert.match(d.fatales[0]!, /HTTP 401/);
    });
  });

  it('acepta una credencial que el proyecto reconoce', async () => {
    await conServidor(200, '{}', async (url) => {
      assert.deepEqual((await probarCredencial(url, 'lo-que-sea')).fatales, []);
    });
  });

  it('sin conexión avisa pero no impide arrancar', async () => {
    // Puerto cerrado: el arranque no debe depender de tener red.
    const d = await probarCredencial('http://127.0.0.1:1', 'lo-que-sea', 1000);
    assert.deepEqual(d.fatales, []);
    assert.equal(d.avisos.length, 1);
  });
});
