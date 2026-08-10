/**
 * Genera y registra una API Key. El valor en claro se imprime UNA sola vez.
 * Uso: npm run keygen -- --org <uuid> --nombre "MCP Claude" --rol admin
 */
import { db } from '../src/lib/supabase.js';
import { generarApiKey } from '../src/lib/crypto.js';
function arg(nombre, def) {
    const i = process.argv.indexOf(`--${nombre}`);
    const v = i >= 0 ? process.argv[i + 1] : undefined;
    if (!v && def === undefined) {
        console.error(`Falta --${nombre}`);
        process.exit(1);
    }
    return v ?? def;
}
const rolesValidos = ['admin', 'compras', 'almacen', 'solicitante'];
let organizacionId = process.argv.includes('--org') ? arg('org') : '';
if (!organizacionId) {
    const { data, error } = await db.from('organizaciones').select('id, nombre, slug').limit(2);
    if (error)
        throw error;
    if (!data?.length) {
        console.error('No hay organizaciones. Corre `npm run db:push -- --seed` primero.');
        process.exit(1);
    }
    organizacionId = data[0].id;
    console.log(`Organización: ${data[0].nombre} (${organizacionId})`);
}
const nombre = arg('nombre', 'Integración MCP');
const rol = arg('rol', 'admin');
if (!rolesValidos.includes(rol)) {
    console.error(`Rol inválido. Opciones: ${rolesValidos.join(', ')}`);
    process.exit(1);
}
const { clave, prefijo, hash } = generarApiKey(process.argv.includes('--test') ? 'test' : 'live');
const { error } = await db.from('api_keys').insert({
    organizacion_id: organizacionId,
    nombre,
    prefijo,
    hash,
    rol,
    scopes: ['*'],
});
if (error) {
    console.error(error);
    process.exit(1);
}
console.log('\n──────────────────────────────────────────────────────────────');
console.log(`  Nombre : ${nombre}`);
console.log(`  Rol    : ${rol}`);
console.log(`  Prefijo: ${prefijo}`);
console.log(`  API KEY: ${clave}`);
console.log('──────────────────────────────────────────────────────────────');
console.log('  Guárdala ahora: no vuelve a mostrarse. Ponla en MCP_API_KEY.\n');
//# sourceMappingURL=generate-api-key.js.map