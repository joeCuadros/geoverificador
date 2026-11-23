import Calculos from '@geoverificador/dominio/nucleo/calculos';
import CONFIG from '@geoverificador/dominio/nucleo/config';
import { configurar } from '@geoverificador/dominio/nucleo/entorno';
import { crearDelitos } from '@geoverificador/dominio/nucleo/delitos';
import { fetchArchivos } from '../../../lib/datosArchivos.ts';

export const runtime = 'nodejs';
configurar({ CONFIG });
(globalThis as any).Geo = { haversine: (a: number, b: number, c: number, d: number) => Calculos.haversine(a, b, c, d) };
const delitos = crearDelitos({ fetch: fetchArchivos as any });

const CELDA = 0.0025; // grados (~275 m): la denuncia nunca se ve como punto individual

let cache: { celdas: { lat: number; lon: number; n: number }[]; max: number; meta: any } | null = null;

/** Denuncias agregadas en celdas, en el mismo periodo homogéneo que el indicador del punto. */
export async function GET() {
  if (!cache) {
    const { meta } = await delitos.indicador(-16.39883, -71.53697);
    const fc = await (await fetchArchivos(CONFIG.delitos.geojsonUrl)).json();
    const cuenta = new Map<string, { lat: number; lon: number; n: number }>();
    for (const f of fc.features) {
      const p = f.properties ?? {};
      const c = f.geometry?.coordinates;
      if (!c || !p.fecha || p.fecha < meta.ventanaDesde || p.fecha > meta.hasta) continue;
      const i = Math.floor(c[1] / CELDA);
      const j = Math.floor(c[0] / CELDA);
      const k = `${i}|${j}`;
      const e = cuenta.get(k) ?? { lat: (i + 0.5) * CELDA, lon: (j + 0.5) * CELDA, n: 0 };
      e.n++;
      cuenta.set(k, e);
    }
    const celdas = [...cuenta.values()];
    cache = { celdas, max: Math.max(1, ...celdas.map((c) => c.n)), meta };
  }
  return Response.json({ ...cache, celda: CELDA }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
