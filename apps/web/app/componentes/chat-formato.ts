/**
 * Cómo el chat escribe números, coordenadas y el pie de fuente de un dato. Sin React: se prueba aparte (pruebas/chat-formato.test.ts).
 * Los números van como en es-PE: punto decimal y coma para los miles (el chat no mezcla comas y puntos).
 */

export const decimales = (n: number, d: number): string => new Intl.NumberFormat('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const hasta2 = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 });
/** Un número con hasta dos decimales, sin ceros de sobra («85.5», «120»). */
export const numero = (n: number): string => hasta2.format(n);

/** «-16.39883, -71.53697»: latitud y longitud con punto decimal, separadas por coma y espacio (nunca «;»). */
export const coordenadasTexto = (lat: number, lon: number): string => `${decimales(lat, 5)}, ${decimales(lon, 5)}`;

/** Una distancia: metros hasta 999 m y, desde ahí, kilómetros con dos decimales («157 m», «1.50 km»). */
export const metros = (m: number): string => (m < 1000 ? `${Math.round(m)} m` : `${decimales(m / 1000, 2)} km`);
/** La distancia de referencia de un criterio («500 m», «1.5 km»). */
export const referenciaTexto = (m: number): string => (m < 1000 ? `${numero(m)} m` : `${decimales(m / 1000, 1)} km`);

/** La única frase que dice que a un dato le falta la fecha. */
export const SIN_FECHA = 'sin fecha registrada';

/**
 * El pie de un dato: «Fuente: X · datos del 2026-11-03» o, sin fecha, «Fuente: X · sin fecha registrada». Sin fuente la dice («sin registrar»).
 * null si no hay ni fuente ni fecha (un dato que no se pudo medir no tiene de dónde venir).
 */
export function pieDeFuente(fuente: string | null, fecha: string | null): string | null {
  if (!fuente && !fecha) return null;
  return `Fuente: ${fuente ?? 'sin registrar'} · ${fecha ? `datos del ${fecha}` : SIN_FECHA}`;
}
