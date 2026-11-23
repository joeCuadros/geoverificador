import Calculos from '@geoverificador/dominio/nucleo/calculos';
import CONFIG from '@geoverificador/dominio/nucleo/config';
import { configurar } from '@geoverificador/dominio/nucleo/entorno';
import { crearDelitos } from '@geoverificador/dominio/nucleo/delitos';
import { crearDistritos } from '@geoverificador/dominio/nucleo/distritos';
import { crearCenepred } from '@geoverificador/dominio/nucleo/cenepred';
import { crearPrecios } from '@geoverificador/dominio/nucleo/precios';
import { crearPeligros } from '@geoverificador/dominio/nucleo/peligros';
import { fetchArchivos } from '../../../lib/datosArchivos.ts';

export const runtime = 'nodejs';
configurar({ CONFIG });
// delitos y peligros llaman a Geo.haversine (la fórmula vive en calculos.js).
(globalThis as any).Geo = { haversine: (a: number, b: number, c: number, d: number) => Calculos.haversine(a, b, c, d) };

/** Seguridad (denuncias), peligros geológicos y zona sísmica del punto: lo que necesita el registro de riesgos. Mismas bibliotecas que la app anterior. */
const delitos = crearDelitos({ fetch: fetchArchivos as any });
const distritos = crearDistritos({ fetch: fetchArchivos as any });
const peligros = crearPeligros({ fetch: fetchArchivos as any });
const precios = crearPrecios({ fetch: fetchArchivos as any });
const cenepred = crearCenepred({ fetch: fetchArchivos as any });

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const lat = Number(u.get('lat'));
  const lon = Number(u.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: 'lat y lon son obligatorios' }, { status: 400 });
  const [d, dis, pel] = await Promise.allSettled([delitos.indicador(lat, lon), distritos.lookup(lat, lon), peligros.indicador(lat, lon)]);
  const val = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
  const nombre = (val(dis) as any)?.distrito ?? null;
  const [pre, cen] = await Promise.allSettled([precios.load().then((d: any) => precios.buscar(d, nombre)), cenepred.load().then((d: any) => ({ resultado: cenepred.buscar(d, nombre), lineas: cenepred.lineas(cenepred.buscar(d, nombre)) }))]);
  return Response.json(
    { delito: val(d), distrito: val(dis), peligro: val(pel), precio: val(pre), cenepred: val(cen), errores: [d, dis, pel, pre, cen].map((r) => (r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : null)) },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
