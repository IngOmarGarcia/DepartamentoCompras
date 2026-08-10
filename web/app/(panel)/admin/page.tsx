import { apiServidor } from '@/lib/api-servidor';
import type { Kpis, Evento } from '@/lib/tipos';
import { Panel, Kpi, Tabla, Insignia, Vacio } from '@/components/ui';
import { n, dinero, pct, fechaHora, haceRato } from '@/lib/formato';
import { EditorReglas } from './reglas';

export const dynamic = 'force-dynamic';

interface Regla {
  clave: string;
  valor: unknown;
  descripcion: string | null;
  actualizado_en: string;
}

interface Auditoria {
  id: number;
  tabla: string;
  registro_id: string;
  accion: string;
  actor: string | null;
  creado_en: string;
}

/** DASHBOARD 3 · ADMIN — control total, reglas de negocio y auditoría. */
export default async function DashboardAdmin() {
  const [kpis, reglas, eventos, auditoria] = await Promise.all([
    apiServidor<Kpis>('dashboard/kpis?rol=admin'),
    apiServidor<Regla[]>('catalogos/reglas'),
    apiServidor<Evento[]>('dashboard/actividad'),
    apiServidor<Auditoria[]>('dashboard/auditoria'),
  ]);

  const g = kpis.global;
  const a = kpis.almacen;
  const c = kpis.compras;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Administración</h1>
        <p className="text-sm text-tenue">Salud del sistema, reglas de negocio y trazabilidad completa</p>
      </header>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi etiqueta="Pedidos abiertos" valor={n(g?.pedidos_abiertos)} pie={`${n(g?.pedidos_totales)} históricos`} />
        <Kpi
          etiqueta="Fill rate 30 días"
          valor={pct(g?.fill_rate_30d)}
          tono={Number(g?.fill_rate_30d ?? 0) < 0.9 ? 'alerta' : 'ok'}
          pie="surtido / solicitado"
        />
        <Kpi etiqueta="Valor del inventario" valor={dinero(a?.valor_inventario)} pie={`${n(a?.skus_activos)} SKUs`} />
        <Kpi etiqueta="Monto comprometido" valor={dinero(c?.monto_comprometido)} pie={`${n(c?.ordenes_en_transito)} OC en tránsito`} />
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi etiqueta="Almacenes" valor={n(g?.almacenes)} />
        <Kpi etiqueta="Usuarios activos" valor={n(g?.usuarios_activos)} />
        <Kpi etiqueta="Bajo punto de reorden" valor={n(a?.bajo_minimo)} tono={a?.bajo_minimo ? 'riesgo' : 'ok'} />
        <Kpi etiqueta="Eventos sin procesar" valor={n(g?.eventos_pendientes)} pie="cola de webhooks" />
      </div>

      <EditorReglas reglas={reglas} />

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <Panel titulo="Actividad del sistema" accion={<span className="text-xs text-tenue">eventos de dominio</span>}>
          {eventos.length === 0 ? (
            <Vacio mensaje="Sin actividad registrada." />
          ) : (
            <ul className="divide-y divide-borde max-h-96 overflow-y-auto">
              {eventos.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Insignia tono={e.tipo.includes('requisicion') ? 'alerta' : e.tipo.includes('surtido') ? 'ok' : 'acento'}>
                      {e.tipo}
                    </Insignia>
                    <p className="mt-1 text-xs text-tenue truncate">
                      {e.agregado_tipo} · {e.agregado_id.slice(0, 8)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-tenue">{haceRato(e.creado_en)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel titulo="Auditoría" accion={<span className="text-xs text-tenue">quién cambió qué</span>}>
          {auditoria.length === 0 ? (
            <Vacio mensaje="Sin cambios auditados." />
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Tabla cabeceras={['Fecha', 'Tabla', 'Acción', 'Actor']}>
                {auditoria.map((x) => (
                  <tr key={x.id}>
                    <td className="px-4 py-2 text-xs text-tenue whitespace-nowrap">{fechaHora(x.creado_en)}</td>
                    <td className="px-4 py-2 text-xs font-mono">{x.tabla}</td>
                    <td className="px-4 py-2">
                      <Insignia tono={x.accion === 'DELETE' ? 'riesgo' : x.accion === 'INSERT' ? 'ok' : 'neutro'}>
                        {x.accion}
                      </Insignia>
                    </td>
                    <td className="px-4 py-2 text-xs text-tenue truncate max-w-40">{x.actor ?? 'system'}</td>
                  </tr>
                ))}
              </Tabla>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
