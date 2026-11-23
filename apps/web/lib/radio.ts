/** El radio de «cerca de» (el círculo de referencia del mapa): cómo se valida y cómo se escribe. Sin dependencias: lo usan el servidor y el navegador. */

/** Un radio es un número finito y positivo, en metros. */
export const radioValido = (m: unknown): m is number => typeof m === 'number' && Number.isFinite(m) && m > 0;

/** «150 m», «1,5 km»: igual que el chat dice la distancia que la persona pidió. */
export function etiquetaDeRadio(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(Math.round(m / 100) / 10).toFixed(1).replace('.', ',')} km`;
}
