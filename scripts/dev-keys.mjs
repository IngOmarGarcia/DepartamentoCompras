/**
 * Genera las llaves JWT del stack local (docker-compose.dev.yml).
 * Son JWT HS256 con claim `role`, exactamente como los emite Supabase.
 *   node scripts/dev-keys.mjs
 */
import { createHmac } from 'node:crypto';

const SECRETO = process.env.PGRST_JWT_SECRET ?? 'secreto-local-de-desarrollo-de-al-menos-32-caracteres';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function firmar(rol) {
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64({ alg: 'HS256', typ: 'JWT' });
  const carga = b64({ role: rol, iss: 'supabase-local', iat: ahora, exp: ahora + 60 * 60 * 24 * 365 });
  const firma = createHmac('sha256', SECRETO).update(`${cabecera}.${carga}`).digest('base64url');
  return `${cabecera}.${carga}.${firma}`;
}

const llaves = { anon: firmar('anon'), service_role: firmar('service_role') };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(llaves));
} else {
  console.log(`SUPABASE_ANON_KEY=${llaves.anon}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY=${llaves.service_role}`);
}
