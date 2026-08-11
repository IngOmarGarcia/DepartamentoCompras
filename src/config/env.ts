import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Localiza el `.env` subiendo desde este módulo. No basta una ruta relativa
 * fija: en desarrollo se ejecuta `src/config/env.ts` (dos niveles hasta la
 * raíz) y compilado `dist/src/config/env.js` (tres). Buscar hacia arriba
 * funciona en ambos y no depende del directorio desde el que se invoque.
 */
function rutaEnv(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidato = join(dir, '.env');
    if (existsSync(candidato)) return candidato;
    const padre = dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  return null;
}

// Carga `.env` sin dependencias externas (Node ≥ 21.7).
try {
  const ruta = rutaEnv();
  if (ruta) process.loadEnvFile?.(ruta);
} catch {
  /* sin .env: se usan las variables ya presentes en el entorno */
}

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_DB_URL: z.string().optional(),

  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('*'),

  API_KEY_PEPPER: z.string().min(8),

  MCP_SERVER_NAME: z.string().default('erp-compras-almacen'),
  MCP_API_KEY: z.string().optional(),

  // ── Worker de tareas periódicas ──
  JOBS_INTERVALO_MIN: z.coerce.number().int().positive().default(5),
  JOBS_REORDEN_HORAS: z.coerce.number().int().nonnegative().default(12),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detalle = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuración inválida (.env):\n${detalle}`);
}

export const env = parsed.data;
export const esProduccion = env.NODE_ENV === 'production';
export const corsOrigins = env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim());
