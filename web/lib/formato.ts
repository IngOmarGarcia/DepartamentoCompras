const NUM = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const DIN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const FECHA = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
const HORA = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const n = (v: unknown) => NUM.format(Number(v ?? 0));
export const dinero = (v: unknown) => DIN.format(Number(v ?? 0));
export const pct = (v: unknown) => `${(Number(v ?? 0) * 100).toFixed(1)}%`;
export const fecha = (v: string | null | undefined) => (v ? FECHA.format(new Date(v)) : '—');
export const fechaHora = (v: string | null | undefined) => (v ? HORA.format(new Date(v)) : '—');

export function haceRato(v: string): string {
  const seg = Math.floor((Date.now() - new Date(v).getTime()) / 1000);
  if (seg < 60) return 'hace instantes';
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  return `hace ${Math.floor(seg / 86400)} d`;
}

/** Semántica de color por estatus — consistente en los 3 dashboards. */
export function tonoEstatus(estatus: string): 'ok' | 'alerta' | 'riesgo' | 'neutro' | 'acento' {
  switch (estatus) {
    case 'surtido':
    case 'reservado_total':
    case 'recibida':
    case 'cerrada':
    case 'aprobada':
      return 'ok';
    case 'en_requisicion':
    case 'reservado_parcial':
    case 'surtido_parcial':
    case 'recibida_parcial':
    case 'cotizando':
    case 'abierta':
      return 'alerta';
    case 'cancelado':
    case 'cancelada':
    case 'rechazada':
      return 'riesgo';
    case 'validando':
    case 'enviada':
    case 'confirmada':
    case 'en_orden':
      return 'acento';
    default:
      return 'neutro';
  }
}

export const ETIQUETA_ESTATUS: Record<string, string> = {
  borrador: 'Borrador',
  recibido: 'Recibido',
  validando: 'Validando',
  reservado_parcial: 'Apartado parcial',
  reservado_total: 'Apartado',
  en_requisicion: 'En compras',
  surtido_parcial: 'Surtido parcial',
  surtido: 'Surtido',
  cancelado: 'Cancelado',
  abierta: 'Abierta',
  cotizando: 'Cotizando',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  en_orden: 'En orden',
  cerrada: 'Cerrada',
  cancelada: 'Cancelada',
  enviada: 'Enviada',
  confirmada: 'Confirmada',
  recibida_parcial: 'Recibida parcial',
  recibida: 'Recibida',
};

export const etiqueta = (v: string) => ETIQUETA_ESTATUS[v] ?? v.replace(/_/g, ' ');
