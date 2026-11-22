/**
 * tipo-cambio.ts — Tipo de cambio fechado (tarea 3.4) desde la API de series del BCRP.
 * Serie PD04640PD: «Tipo de cambio - TC Sistema bancario SBS (S/ por US$) - Venta». Los días sin cotización («n.d.») se omiten: no se rellenan.
 */
import type { TipoCambio } from '@geoverificador/dominio/avisos';

export const SERIE_BCRP = 'PD04640PD';
export const URL_BCRP = 'https://estadisticas.bcrp.gob.pe/estadisticas/series/api';
const MESES: Record<string, string> = { ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06', jul: '07', ago: '08', set: '09', sep: '09', oct: '10', nov: '11', dic: '12' };

/** «12.Nov.26» → «2026-11-12»; null si no tiene esa forma. */
export function fechaBcrp(nombre: string): string | null {
  const m = /^(\d{2})\.([A-Za-z]{3})\.(\d{2})$/.exec(nombre.trim());
  const mes = m && MESES[m[2].toLowerCase()];
  return m && mes ? `20${m[3]}-${mes}-${m[1]}` : null;
}

/** Respuesta de la API → cotizaciones válidas, de la más antigua a la más reciente. */
export function leerSerieBcrp(json: any): (TipoCambio & { url: string })[] {
  const periodos = Array.isArray(json?.periods) ? json.periods : [];
  const nombre = json?.config?.series?.[0]?.name ?? 'BCRP';
  const out: (TipoCambio & { url: string })[] = [];
  for (const p of periodos) {
    const fecha = typeof p?.name === 'string' ? fechaBcrp(p.name) : null;
    const venta = Number(p?.values?.[0]);
    if (fecha && Number.isFinite(venta) && venta > 0) out.push({ fecha, venta, fuente: `BCRP, ${nombre}`, url: `${URL_BCRP}/${SERIE_BCRP}` });
  }
  return out.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

/** Cotizaciones entre dos días (AAAA-MM-DD). */
export async function descargarTipoCambio(desde: string, hasta: string, fetchFn: (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }> = fetch as any): Promise<(TipoCambio & { url: string })[]> {
  const res = await fetchFn(`${URL_BCRP}/${SERIE_BCRP}/json/${desde}/${hasta}/esp`, { headers: { 'User-Agent': 'geoverificador-datos/1.0 (descarga de datos abiertos)' } });
  if (!res.ok) throw new Error(`El BCRP respondió HTTP ${res.status}`);
  return leerSerieBcrp(await res.json());
}
