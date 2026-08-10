import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { contextoDesdeApiKey } from '../api/auth.js';
import { HERRAMIENTAS } from './tools.js';
import type { Contexto } from '../types/domain.js';

/**
 * Servidor MCP (stdio). Autentica una sola vez con MCP_API_KEY y expone el
 * mismo núcleo de negocio que la API REST.
 */
async function main(): Promise<void> {
  if (!env.MCP_API_KEY) {
    throw new Error('Falta MCP_API_KEY en el entorno: genera una con `npm run keygen`.');
  }

  const ctx: Contexto = await contextoDesdeApiKey(env.MCP_API_KEY);

  const server = new McpServer(
    { name: env.MCP_SERVER_NAME, version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  for (const h of HERRAMIENTAS) {
    const shape = h.esquema instanceof z.ZodObject ? (h.esquema.shape as z.ZodRawShape) : ({} as z.ZodRawShape);

    server.registerTool(
      h.nombre,
      {
        title: h.titulo,
        description: h.descripcion,
        inputSchema: shape,
        annotations: {
          readOnlyHint: h.soloLectura,
          destructiveHint: !h.soloLectura,
          idempotentHint: h.soloLectura,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        try {
          const parsed = h.esquema.parse(args ?? {});
          const resultado = await h.ejecutar(ctx, parsed);
          return { content: [{ type: 'text' as const, text: JSON.stringify(resultado, null, 2) }] };
        } catch (e) {
          const err =
            e instanceof AppError
              ? e.toJSON()
              : e instanceof z.ZodError
                ? { ok: false, error: { codigo: 'VALIDACION', mensaje: 'Payload inválido', detalle: e.issues } }
                : { ok: false, error: { codigo: 'ERROR_INTERNO', mensaje: (e as Error).message } };
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }] };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[MCP] ${env.MCP_SERVER_NAME} listo · org=${ctx.organizacionId} · rol=${ctx.rol} · ${HERRAMIENTAS.length} herramientas\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`[MCP] Error fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
