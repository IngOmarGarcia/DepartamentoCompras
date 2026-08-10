import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Compras e Inventarios',
  description: 'Módulo de gestión de compras, almacenes y requisiciones',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
