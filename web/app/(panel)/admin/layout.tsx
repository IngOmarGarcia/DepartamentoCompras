import { Seccion } from '@/components/acceso';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <Seccion requiere={['admin']}>{children}</Seccion>;
}
