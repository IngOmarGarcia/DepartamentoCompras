import { apiServidor } from '@/lib/api-servidor';
import type { Almacen, Producto } from '@/lib/tipos';
import { FormularioPedido } from './formulario';

export const dynamic = 'force-dynamic';

/** Punto de entrada del flujo: alta del requerimiento + validación de stock. */
export default async function NuevoPedido() {
  const [productos, almacenes] = await Promise.all([
    apiServidor<Producto[]>('catalogos/productos?limite=200'),
    apiServidor<Almacen[]>('catalogos/almacenes'),
  ]);

  return (
    <div className="max-w-4xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Nuevo pedido</h1>
        <p className="text-sm text-tenue">
          Al guardar, el sistema consulta el inventario: aparta lo disponible y genera requisición de compra por el
          faltante — todo en una sola transacción.
        </p>
      </header>

      <FormularioPedido productos={productos} almacenes={almacenes} />
    </div>
  );
}
