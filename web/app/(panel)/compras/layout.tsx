import { Seccion } from '@/components/acceso';

export default function ComprasLayout({ children }: { children: React.ReactNode }) {
  return <Seccion requiere={['admin', 'compras']}>{children}</Seccion>;
}
