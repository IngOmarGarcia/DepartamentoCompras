import { Seccion } from '@/components/acceso';

export default function CatalogosLayout({ children }: { children: React.ReactNode }) {
  return <Seccion requiere={['admin', 'almacen']}>{children}</Seccion>;
}
