import { Seccion } from '@/components/acceso';

export default function AlmacenLayout({ children }: { children: React.ReactNode }) {
  return <Seccion requiere={['admin', 'almacen']}>{children}</Seccion>;
}
