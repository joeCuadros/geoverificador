import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'GeoVerificador — vivienda en Arequipa con datos medidos',
  description: 'Busca avisos de vivienda en Arequipa y mira qué hay cerca de cada uno: colegios, salud, paraderos, servicios y peligros, con su fuente y su fecha.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f6e5a' };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
