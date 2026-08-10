import Link from 'next/link';
import { apiServidor } from '@/lib/api-servidor';
import { Panel, Tabla, Insignia, Vacio, Avance } from '@/components/ui';
import { n, fecha, haceRato, etiqueta, tonoEstatus } from '@/lib/formato';

export const dynamic = 'force-dynamic';

interface Fila {
  id: string;
  folio: string;
  origen: string;
  referencia_externa: string | null;
  estatus: string;
  prioridad: string;
  fecha_requerida: string | null;
  centro_costo: string | null;
  creado_en: string;
  items: Array<{
    id: string;
    cantidad_solicitada: number;
    cantidad_reservada: number;
    cantidad_surtida: number;
    cantidad_en_compra: number;
    producto: { sku: string; nombre: string };
  }>;
}

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ estatus?: string }> }) {
  const { estatus } = await searchParams;
  const pedidos = await apiServidor<Fila[]>(`pedidos?limite=50${estatus ? `&estatus=${estatus}` : ''}`);

  const filtros = [
    { v: '', l: 'Todos' },
    { v: 'reservado_total,reservado_parcial', l: 'Apartados' },
    { v: 'en_requisicion', l: 'En compras' },
    { v: 'surtido,surtido_parcial', l: 'Surtidos' },
    { v: 'cancelado', l: 'Cancelados' },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-sm text-tenue">Seguimiento de requerimientos y su avance de surtido</p>
        </div>
        <Link
          href="/pedidos/nuevo"
          className="rounded-lg bg-acento px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition"
        >
          Nuevo pedido
        </Link>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {filtros.map((f) => (
          <Link
            key={f.l}
            href={f.v ? `/pedidos?estatus=${f.v}` : '/pedidos'}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              (estatus ?? '') === f.v ? 'bg-acento-suave text-acento' : 'text-tenue hover:text-tinta hover:bg-panel'
            }`}
          >
            {f.l}
          </Link>
        ))}
      </div>

      <Panel>
        {pedidos.length === 0 ? (
          <Vacio mensaje="No hay pedidos con este filtro." />
        ) : (
          <Tabla cabeceras={['Folio', 'Referencia', 'Estatus', 'Prioridad', 'Requerido', 'Avance', '#Líneas', '']}>
            {pedidos.map((p) => {
              const sol = p.items.reduce((a, i) => a + Number(i.cantidad_solicitada), 0);
              const res = p.items.reduce((a, i) => a + Number(i.cantidad_reservada), 0);
              const sur = p.items.reduce((a, i) => a + Number(i.cantidad_surtida), 0);
              const compra = p.items.reduce((a, i) => a + Number(i.cantidad_en_compra), 0);
              return (
                <tr key={p.id} className="hover:bg-lienzo transition">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{p.folio}</span>
                    <span className="block text-xs text-tenue">{haceRato(p.creado_en)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-tenue text-xs">
                    {p.referencia_externa ?? '—'}
                    {p.centro_costo && <span className="block">{p.centro_costo}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Insignia tono={tonoEstatus(p.estatus)}>{etiqueta(p.estatus)}</Insignia>
                    {compra > 0 && <span className="block mt-1 text-xs text-alerta">{n(compra)} en compra</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Insignia tono={p.prioridad === 'urgente' || p.prioridad === 'alta' ? 'riesgo' : 'neutro'}>
                      {p.prioridad}
                    </Insignia>
                  </td>
                  <td className="px-4 py-2.5 text-tenue">{fecha(p.fecha_requerida)}</td>
                  <td className="px-4 py-2.5">
                    <Avance solicitado={sol} reservado={res} surtido={sur} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{p.items.length}</td>
                  <td className="px-4 py-2.5 text-right">
                    {res > 0 && (
                      <Link href={`/almacen/surtir/${p.id}`} className="text-sm font-medium text-acento hover:underline">
                        Surtir →
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </Tabla>
        )}
      </Panel>
    </div>
  );
}
