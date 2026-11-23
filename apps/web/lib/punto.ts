import { enArequipa } from '@geoverificador/dominio/avisos';
import type { Punto } from '@geoverificador/datos/consultas';

export type LecturaDePunto = { ok: true; punto: Punto } | { ok: false; error: string };

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Un único valor numérico decimal; acepta la coma decimal. null si falta, está repetido o no es un número. */
function leerGrado(params: URLSearchParams, nombre: string): number | null {
  const valores = params.getAll(nombre);
  if (valores.length !== 1) return null;
  const texto = valores[0].trim().replace(',', '.');
  return DECIMAL.test(texto) ? Number(texto) : null;
}

/**
 * Lee la latitud y la longitud de la consulta (`lat` y `lon`, o los nombres que se pidan) y comprueba que sean grados válidos dentro de Arequipa
 * (la caja que usa el agente para ubicar avisos).
 */
export function leerPunto(params: URLSearchParams, nombreLat = 'lat', nombreLon = 'lon'): LecturaDePunto {
  const lat = leerGrado(params, nombreLat);
  const lon = leerGrado(params, nombreLon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, error: `Indica ${nombreLat} y ${nombreLon} en grados decimales (por ejemplo ${nombreLat}=-16.39883&${nombreLon}=-71.53697).` };
  }
  if (!enArequipa(lat, lon)) return { ok: false, error: 'El punto está fuera de Arequipa: los datos de GeoVerificador solo cubren Arequipa metropolitana.' };
  return { ok: true, punto: { lat, lon } };
}
