import { createHmac } from 'node:crypto';
import { db } from '../lib/supabase.js';
import { desdePostgres } from '../lib/errors.js';
import { env } from '../config/env.js';

export interface EventoDominio {
  id: number;
  organizacion_id: string;
  tipo: string;
  agregado_tipo: string;
  agregado_id: string;
  payload: Record<string, unknown>;
  creado_en: string;
}

/**
 * Cola de eventos de dominio (`pedido.validado`, `requisicion.creada`, …).
 * El motor SQL los emite; aquí se drenan hacia un webhook externo.
 */
export const eventosService = {
  async pendientes(limite = 100): Promise<EventoDominio[]> {
    const { data, error } = await db
      .from('eventos')
      .select('*')
      .eq('procesado', false)
      .order('creado_en', { ascending: true })
      .limit(limite);
    if (error) throw desdePostgres(error);
    return (data ?? []) as EventoDominio[];
  },

  async marcarProcesados(ids: number[]): Promise<void> {
    if (!ids.length) return;
    const { error } = await db.from('eventos').update({ procesado: true }).in('id', ids);
    if (error) throw desdePostgres(error);
  },

  /** Entrega firmada (HMAC-SHA256) para que el receptor pueda verificar el origen. */
  async entregar(evento: EventoDominio): Promise<boolean> {
    if (!env.WEBHOOK_URL) return true; // sin destino configurado: solo se marca como drenado

    const cuerpo = JSON.stringify({
      id: evento.id,
      tipo: evento.tipo,
      organizacion_id: evento.organizacion_id,
      agregado: { tipo: evento.agregado_tipo, id: evento.agregado_id },
      payload: evento.payload,
      emitido_en: evento.creado_en,
    });

    const cabeceras: Record<string, string> = { 'content-type': 'application/json' };
    if (env.WEBHOOK_SECRET) {
      cabeceras['x-firma'] = createHmac('sha256', env.WEBHOOK_SECRET).update(cuerpo).digest('hex');
    }

    try {
      const r = await fetch(env.WEBHOOK_URL, {
        method: 'POST',
        headers: cabeceras,
        body: cuerpo,
        signal: AbortSignal.timeout(10_000),
      });
      return r.ok;
    } catch {
      return false;
    }
  },

  /** Drena la cola: entrega y marca. Devuelve cuántos se procesaron y cuántos fallaron. */
  async drenar(limite = 100): Promise<{ procesados: number; fallidos: number }> {
    const cola = await this.pendientes(limite);
    if (!cola.length) return { procesados: 0, fallidos: 0 };

    const entregados: number[] = [];
    let fallidos = 0;

    for (const evento of cola) {
      if (await this.entregar(evento)) entregados.push(evento.id);
      else fallidos += 1;
    }

    await this.marcarProcesados(entregados);
    return { procesados: entregados.length, fallidos };
  },
};
