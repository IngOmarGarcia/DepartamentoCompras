import type { ReactNode } from 'react';
import Link from 'next/link';
import { sesion } from '@/lib/sesion';
import type { Rol } from '@/lib/tipos';

const NOMBRE_ROL: Record<Rol, string> = {
  admin: 'Administración',
  compras: 'Compras',
  almacen: 'Almacén',
  solicitante: 'Solicitante',
};

/**
 * No hay pantalla de login: si falta la credencial, el problema es de
 * integración con el sistema padre, no del usuario. Se dice qué falta.
 */
export function SinCredencial() {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md space-y-4 animar">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-riesgo-suave text-riesgo font-bold text-lg">
            !
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Sin credencial</h1>
            <p className="text-sm text-tenue">El módulo no recibió una identidad válida.</p>
          </div>
        </div>

        <div className="rounded-xl border border-borde bg-panel p-5 text-sm space-y-3">
          <p className="text-tenue">
            Este módulo se integra dentro de una aplicación principal y hereda de ella la identidad. Espera
            recibir en cada petición:
          </p>
          <ul className="space-y-1.5">
            <li>
              <code className="rounded bg-lienzo px-1.5 py-0.5 text-xs">x-api-key</code>
              <span className="text-tenue"> — credencial de la organización (obligatoria)</span>
            </li>
            <li>
              <code className="rounded bg-lienzo px-1.5 py-0.5 text-xs">x-user-role</code>
              <span className="text-tenue"> — rol del usuario: admin, compras, almacen o solicitante (opcional)</span>
            </li>
          </ul>
          <p className="text-tenue">
            Para correrlo suelto en desarrollo, define <code className="rounded bg-lienzo px-1.5 py-0.5 text-xs">API_KEY</code>{' '}
            en <code className="rounded bg-lienzo px-1.5 py-0.5 text-xs">web/.env.local</code> y el servidor la
            adjuntará por su cuenta.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Puerta de una sección completa. Se usa desde el `layout.tsx` de cada área
 * para que la guarda cubra también las rutas anidadas (`/compras/ordenes/[id]`,
 * `/almacen/surtir/[id]`…) sin repetirla en cada página.
 *
 * Es control de INTERFAZ: evita enseñar una sección que no corresponde. La
 * autorización real la impone la API sobre el rol de la credencial.
 */
export async function Seccion({ requiere, children }: { requiere: Rol[]; children: ReactNode }) {
  const s = await sesion();
  if (!s) return null; // el layout del panel ya está pintando `SinCredencial`
  if (!requiere.includes(s.rol)) return <SinPermiso rol={s.rol} requiere={requiere} />;
  return <>{children}</>;
}

/** El rol heredado no alcanza para esta sección. */
export function SinPermiso({ rol, requiere }: { rol: Rol; requiere: Rol[] }) {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="w-full max-w-md space-y-4 animar">
        <div className="rounded-xl border border-borde bg-panel p-5 space-y-3">
          <h1 className="text-base font-semibold">Sección no disponible para tu rol</h1>
          <p className="text-sm text-tenue">
            Entraste como <strong className="text-tinta">{NOMBRE_ROL[rol]}</strong> y esta sección es de{' '}
            {requiere.map((r) => NOMBRE_ROL[r]).join(' o ')}.
          </p>
          <p className="text-sm text-tenue">
            El rol lo determina la aplicación principal. Si necesitas otro acceso, se cambia allá — aquí no hay
            forma de elevarlo.
          </p>
          <Link href="/pedidos" className="inline-block text-sm font-medium text-acento hover:underline">
            Ir a Pedidos →
          </Link>
        </div>
      </div>
    </div>
  );
}
