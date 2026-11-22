import type { ReactNode } from 'react';

export const metadata = { title: 'GeoVerificador', description: 'Busca vivienda en Arequipa con datos medidos y verificables.' };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f6f7f9', color: '#1b1f24' }}>{children}</body>
    </html>
  );
}
