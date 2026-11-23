import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'GeoVerificador · Predios de Arequipa', description: 'Busca vivienda en Arequipa con datos medidos y verificables: mapa, asistente y ficha de cada punto con su fuente.' };
export const viewport = { width: 'device-width', initialScale: 1 };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
