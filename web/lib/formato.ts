export const metros = (m: number | null | undefined) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);
export const enteros = (n: number) => Math.round(n).toLocaleString('es-PE').replace(/,/g, ' ');
export const soles = (n: number) => `S/ ${enteros(n)}`;
export const dolares = (n: number) => `US$ ${enteros(n)}`;
export const precio = (n: number | null, moneda: string | null) => (n == null ? 'Precio no indicado' : moneda === 'USD' ? dolares(n) : soles(n));
export const fechaCorta = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
};
export type Tono = 'ok' | 'mal' | 'info' | 'aviso';
export function tonoDe(estado?: string): { tono: Tono; texto: string } {
  const e = (estado ?? '').toUpperCase().replace(/_/g, ' ');
  if (e === 'CUMPLE') return { tono: 'ok', texto: 'Cumple' };
  if (e.startsWith('NO CUMPLE')) return { tono: 'mal', texto: 'No cumple' };
  if (e.includes('SIN DATO')) return { tono: 'aviso', texto: 'Sin dato' };
  return { tono: 'info', texto: 'Informativo' };
}
