import Link from 'next/link';
import { sesion } from '@/lib/sesion';
import { Navegacion } from '@/components/navegacion';
import { SinCredencial } from '@/components/acceso';

const NOMBRE_ROL: Record<string, string> = {
  admin: 'Administración',
  compras: 'Compras',
  almacen: 'Almacén',
  solicitante: 'Solicitante',
};

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // Sin login: la identidad la hereda del sistema padre. Si no llegó, se
  // explica qué falta en vez de mandar a una pantalla de acceso inexistente.
  const s = await sesion();
  if (!s) return <SinCredencial />;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-60 shrink-0 flex-col gap-6 border-r border-borde bg-panel p-4">
        <Link href="/" className="flex items-center gap-2 px-1">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-acento text-white font-bold">C</span>
          <span className="text-sm font-semibold leading-tight">
            Compras
            <br />
            <span className="text-tenue font-normal">e Inventarios</span>
          </span>
        </Link>

        <Navegacion rol={s.rol} />

        <div className="mt-auto rounded-lg border border-borde p-3">
          <p className="text-xs text-tenue">Rol activo</p>
          <p className="text-sm font-medium">{NOMBRE_ROL[s.rol] ?? s.rol}</p>
          <p className="mt-0.5 text-xs text-tenue break-all">{s.ctx.actor}</p>
          <p className="mt-2 text-xs text-tenue">
            {s.heredado ? 'Rol acotado por el sistema principal' : 'Rol de la credencial'}
          </p>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="md:hidden border-b border-borde bg-panel px-4 py-3">
          <Navegacion rol={s.rol} compacto />
        </div>
        <div className="p-4 md:p-6 max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
