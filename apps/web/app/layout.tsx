import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * Las dos familias del diseño, servidas desde la propia aplicación (sin pedirlas a Google al compilar ni al abrir la página: la compilación de las pruebas
 * de extremo a extremo y la de producción no dependen de internet). Son las variables de Instrument Sans (texto) y Bricolage Grotesque (títulos y cifras
 * destacadas), con licencia OFL (ver fonts/LICENCIAS.txt), solo el subconjunto latino: alcanza para el español. `swap` muestra el texto enseguida con la fuente
 * del sistema, de métricas ajustadas.
 */
const instrumentSans = localFont({
  src: './fonts/InstrumentSans-latin-wght.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--fuente-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  adjustFontFallback: 'Arial',
});
const bricolage = localFont({
  src: './fonts/BricolageGrotesque-latin-opsz-wght.woff2',
  weight: '200 800',
  display: 'swap',
  variable: '--fuente-titulo',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

const DESCRIPCION = 'Consulta datos públicos de un punto de Arequipa: zonificación, entorno y avisos, sin recomendar ni calificar.';

export const metadata: Metadata = {
  title: { default: 'GeoVerificador · Predios de Arequipa', template: '%s · GeoVerificador' },
  description: DESCRIPCION,
  applicationName: 'GeoVerificador',
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: '/icono.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
  openGraph: { type: 'website', locale: 'es_PE', siteName: 'GeoVerificador', title: 'GeoVerificador · Predios de Arequipa', description: DESCRIPCION },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // El contenido llega hasta los bordes de pantallas con muescas; los márgenes seguros ya los respeta el CSS (env(safe-area-inset-*)).
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fffcf7' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1713' },
  ],
  colorScheme: 'light dark',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-PE" className={`${instrumentSans.variable} ${bricolage.variable}`}>
      <body>{children}</body>
    </html>
  );
}
