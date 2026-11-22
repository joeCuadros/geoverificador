import { abrirBase, type Base } from '@geoverificador/datos/cliente';

/** Una sola conexión por proceso. DATABASE_URL: postgres://… en producción, pglite://<carpeta> en desarrollo. */
let base: Promise<Base> | null = null;
export function laBase(): Promise<Base> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');
  base ??= abrirBase(url);
  return base;
}

/** ADR 0002: qué avisos se pueden mostrar. Por omisión, ninguno hasta que el dueño lo active. */
export function publicar(): 'ninguna' | 'permitidas' | 'todas' {
  const v = process.env.AVISOS_PUBLICAR;
  return v === 'todas' || v === 'permitidas' ? v : 'ninguna';
}
