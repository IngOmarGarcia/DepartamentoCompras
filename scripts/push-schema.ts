/**
 * Aplica los archivos SQL en orden contra la base de Supabase.
 * Uso: npm run db:push            (schema + funciones + rls)
 *      npm run db:push -- --seed  (incluye datos demo)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { env } from '../src/config/env.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const dbDir = join(aqui, '..', 'db');

const archivos = ['01_schema.sql', '02_functions.sql', '03_rls.sql'];
if (process.argv.includes('--seed')) archivos.push('04_seed.sql');

if (!env.SUPABASE_DB_URL) {
  console.error('Falta SUPABASE_DB_URL en .env (cadena de conexión directa a Postgres).');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
client.on('notice', (n) => console.log(`  · ${n.message}`));

for (const archivo of archivos) {
  const sql = await readFile(join(dbDir, archivo), 'utf8');
  process.stdout.write(`▶ ${archivo} … `);
  try {
    await client.query(sql);
    console.log('OK');
  } catch (e) {
    console.log('FALLÓ');
    console.error(e);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log('\n✔ Esquema aplicado.');
