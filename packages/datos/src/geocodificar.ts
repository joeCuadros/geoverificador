/**
 * geocodificar.ts — De un nombre o una dirección a un punto (tareas 3.2 y 6.1 `geocodificar_lugar`).
 *
 * Orden: (1) destinos con nombre de CONFIG.destinos; (2) lugares de la base por nombre (universidades, malls, colegios, salud…);
 * (3) distritos (el punto es una referencia dentro del distrito, con precisión baja); (4) Nominatim, solo si se entrega `fetch` y solo dentro de
 * la caja de Arequipa. Cada resultado dice de dónde salió y con qué precisión: un punto de baja precisión no sirve para «cerca de».
 */
import CONFIG from '@geoverificador/dominio/nucleo/config';
import { CAJA_AREQUIPA, enArequipa } from '@geoverificador/dominio/avisos';
import { normalizar } from '@geoverificador/dominio/texto';
import type { Base } from './cliente.ts';

export interface LugarHallado {
  nombre: string;
  lat: number;
  lon: number;
  /** Radio aproximado de incertidumbre en metros. */
  precisionM: number;
  origen: 'destino' | 'lugar' | 'distrito' | 'nominatim';
  categoria: string | null;
  distrito: string | null;
  fuenteId: string | null;
}

/** Precisión máxima para que un punto sirva como ubicación de un aviso o como origen de «cerca de». */
export const PRECISION_UTIL_M = 500;

const CATEGORIAS_BUSCABLES = ['educacion_superior', 'malls', 'salud', 'educacion', 'mercados', 'supermercados', 'transporte', 'areasVerdes'];
const PALABRAS_GENERICAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'arequipa', 'universidad', 'colegio', 'institucion', 'educativa', 'mall', 'centro', 'comercial', 'hospital', 'clinica', 'mercado', 'parque']);

/** Busca en los datos locales (sin red). Devuelve los candidatos del mejor al peor; vacío si no hay ninguno. */
export async function geocodificarLocal(base: Base, texto: string, { limite = 5 }: { limite?: number } = {}): Promise<LugarHallado[]> {
  const q = normalizar(texto);
  if (q.length < 2) return [];
  const hallados: LugarHallado[] = [];
  const lugares: LugarHallado[] = [];

  for (const d of CONFIG.destinos as any[]) {
    const claves = [d.nombre, ...(d.alias ?? [])].map((x: string) => normalizar(x));
    if (claves.some((c: string) => c === q || q.includes(c) || (c.includes(q) && q.length >= 4))) hallados.push({ nombre: d.nombre, lat: d.lat, lon: d.lon, precisionM: 300, origen: 'destino', categoria: d.tipo ?? null, distrito: null, fuenteId: 'osm' });
  }

  const significativas = q.split(' ').filter((p) => p.length > 1 && !PALABRAS_GENERICAS.has(p));
  if (significativas.length) {
    const filas = await base.consulta(
      `SELECT l.nombre, l.nombre_norm, l.categoria, ST_Y(l.punto) AS lat, ST_X(l.punto) AS lon, a.fuente_id, l.props->>'distrito' AS distrito, l.props->>'sunedu' AS sunedu
       FROM lugar l JOIN archivo_dato a ON a.ruta = l.archivo
       WHERE l.categoria = ANY ($1::text[]) AND l.nombre_norm IS NOT NULL AND l.nombre_norm LIKE ALL ($2::text[])
       ORDER BY array_position($1::text[], l.categoria), length(l.nombre_norm), l.orden LIMIT 40`,
      [CATEGORIAS_BUSCABLES, significativas.map((p) => `%${p.replace(/[%_]/g, '')}%`)],
    );
    // Primero la coincidencia exacta del nombre; luego las sedes de universidades licenciadas; luego el resto en el orden de la consulta.
    const peso = (f: any) => (f.nombre_norm === q ? 0 : f.sunedu ? 1 : 2);
    for (const f of [...filas].sort((x, y) => peso(x) - peso(y))) lugares.push({ nombre: f.nombre, lat: f.lat, lon: f.lon, precisionM: 100, origen: 'lugar', categoria: f.categoria, distrito: f.distrito, fuenteId: f.fuente_id });
  }

  const distritos = await base.consulta(`SELECT nombre, ST_Y(ST_PointOnSurface(ST_MakeValid(geom))) AS lat, ST_X(ST_PointOnSurface(ST_MakeValid(geom))) AS lon, sqrt(ST_Area(geom::geography)) / 2 AS radio FROM distrito`);
  for (const d of distritos) {
    const n = normalizar(d.nombre);
    if (n === q || q === `distrito de ${n}` || q === `distrito ${n}`) hallados.push({ nombre: d.nombre, lat: d.lat, lon: d.lon, precisionM: Math.round(d.radio), origen: 'distrito', categoria: 'distrito', distrito: d.nombre, fuenteId: 'ingemmet_limites' });
  }

  // Un distrito nombrado tal cual va antes que los lugares que llevan ese nombre («Cayma» antes que «Mercado de Cayma»).
  hallados.push(...lugares);
  const vistos = new Set<string>();
  return hallados
    .filter((h) => {
      const k = `${h.origen}|${normalizar(h.nombre)}|${h.lat.toFixed(4)}|${h.lon.toFixed(4)}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .slice(0, limite);
}

export interface OpcionesNominatim {
  fetch: (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
  /** Identificación que pide la política de uso de Nominatim. */
  agente?: string;
  url?: string;
}

const PRECISION_NOMINATIM: Record<string, number> = { house: 30, building: 30, amenity: 80, shop: 80, office: 80, highway: 250, residential: 250, neighbourhood: 600, suburb: 1200, quarter: 800, city_district: 3000, administrative: 5000 };

/**
 * Geocodifica una dirección con Nominatim (OpenStreetMap), restringida a la caja de Arequipa. Una consulta por llamada: quien llame debe respetar
 * el máximo de una consulta por segundo de la política de uso. Devuelve null si no hay resultado dentro de la ciudad.
 */
export async function geocodificarNominatim(texto: string, opciones: OpcionesNominatim): Promise<LugarHallado | null> {
  const q = texto.trim();
  if (q.length < 4) return null;
  const { oeste, sur, este, norte } = CAJA_AREQUIPA;
  const url = `${opciones.url ?? 'https://nominatim.openstreetmap.org/search'}?format=jsonv2&limit=1&countrycodes=pe&bounded=1&viewbox=${oeste},${norte},${este},${sur}&addressdetails=1&q=${encodeURIComponent(`${q}, Arequipa, Perú`)}`;
  const res = await opciones.fetch(url, { headers: { 'User-Agent': opciones.agente ?? 'geoverificador/1.0 (geocodificación de direcciones)', 'Accept-Language': 'es' } });
  if (!res.ok) throw new Error(`Nominatim respondió HTTP ${res.status}`);
  const lista = await res.json();
  const r = Array.isArray(lista) ? lista[0] : null;
  if (!r) return null;
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !enArequipa(lat, lon)) return null;
  const precisionM = PRECISION_NOMINATIM[r.addresstype] ?? PRECISION_NOMINATIM[r.type] ?? PRECISION_NOMINATIM[r.category] ?? 1500;
  const dir = r.address ?? {};
  return { nombre: String(r.display_name ?? q).split(',').slice(0, 2).join(',').trim(), lat, lon, precisionM, origen: 'nominatim', categoria: r.type ?? null, distrito: dir.city_district ?? dir.suburb ?? dir.town ?? null, fuenteId: 'osm' };
}

/** Texto que se geocodifica para un aviso: dirección, zona y distrito. null si no hay dirección ni zona (solo distrito no ubica un inmueble). */
export function textoDeAviso(a: { direccion: string | null; zona: string | null; distrito: string | null }): string | null {
  const partes = [a.direccion, a.zona].filter((x): x is string => !!x && x.trim().length > 2);
  if (!partes.length) return null;
  const zonaTraeDistrito = a.distrito && partes.some((p) => normalizar(p).includes(normalizar(a.distrito!)));
  return [...partes, zonaTraeDistrito ? null : a.distrito].filter(Boolean).join(', ');
}
