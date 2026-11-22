/** texto.ts — Normalización de texto compartida por la búsqueda por nombre, los avisos y el agente. */

/** Minúsculas, sin tildes ni signos, espacios colapsados: «Universidad Católica  San Pablo» → «universidad catolica san pablo». */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

/** Lista en español: «a», «a y b», «a, b y c». */
export function lista(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** Distancia para decirla: «350 m», «1,2 km». */
export function decirDistancia(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(Math.round(m / 100) / 10).toFixed(1).replace('.', ',')} km`;
}

/** Soles con separador de miles: «S/ 450 000». */
export function decirSoles(n: number): string {
  return `S/ ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/** Dólares con separador de miles: «US$ 120 000». */
export function decirDolares(n: number): string {
  return `US$ ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}
