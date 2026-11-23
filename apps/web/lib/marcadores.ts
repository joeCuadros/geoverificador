import { enArequipa } from '@geoverificador/dominio/avisos';

/** Un aviso tal como lo devuelve POST /api/agente. */
export interface AvisoApi {
  id: number;
  titulo: string | null;
  url: string;
  lat: number | null;
  lon: number | null;
  cumplidos: number;
  pedidos: number;
  precio?: number | null;
  moneda?: string | null;
  distrito?: string | null;
}

export interface Marcador {
  id: number;
  titulo: string;
  lat: number;
  lon: number;
  /** Enlace al aviso original; null si no es http(s). */
  url: string | null;
  detalle: string;
}

/** Solo enlaces http(s): lo que traen los portales es dato de terceros y no debe poder ejecutar código. */
export function enlaceSeguro(url: string | null | undefined): string | null {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

export function textoPrecio(precio: number | null | undefined, moneda: string | null | undefined): string {
  if (precio == null || (moneda !== 'PEN' && moneda !== 'USD')) return 'Precio no indicado';
  return `${moneda === 'PEN' ? 'S/' : 'US$'} ${miles(precio)}`;
}

const capitalizar = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Los avisos que se pueden ubicar en el mapa: con coordenadas válidas dentro de Arequipa. Los demás se listan en el chat pero no tienen marcador. */
export function aMarcadores(avisos: AvisoApi[]): Marcador[] {
  const marcadores: Marcador[] = [];
  for (const a of avisos) {
    if (a.lat === null || a.lon === null || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !enArequipa(a.lat, a.lon)) continue;
    const partes = [textoPrecio(a.precio, a.moneda)];
    if (a.distrito) partes.push(capitalizar(a.distrito));
    if (a.pedidos > 0) partes.push(`cumple ${a.cumplidos} de ${a.pedidos} criterios`);
    marcadores.push({ id: a.id, titulo: a.titulo?.trim() || 'Aviso sin título', lat: a.lat, lon: a.lon, url: enlaceSeguro(a.url), detalle: partes.join(' · ') });
  }
  return marcadores;
}
