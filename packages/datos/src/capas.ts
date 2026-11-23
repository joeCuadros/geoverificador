/**
 * capas.ts — Capas pesadas del mapa servidas por recorte (tarea 2.6): solo lo que cae en la ventana del mapa, simplificado según el zoom,
 * en lugar del archivo completo (rutas 3,4 MB, zonas 2,8 MB, censo 11 MB).
 */
import type { Base } from './cliente.ts';

export type Caja = [oeste: number, sur: number, este: number, norte: number];

interface DefCapa {
  sql: string;
  /** Zoom mínimo al que se sirve (más lejos serían demasiados elementos). */
  zoomMin: number;
  /** Máximo de elementos por respuesta. */
  maximo: number;
}

const ENV = 'ST_MakeEnvelope($1, $2, $3, $4, 4326)';
/** Geometría recortada a la ventana y simplificada con una tolerancia en grados ($5). */
const geo = (col: string) => `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${col}, $5), 6)::jsonb`;

export const CAPAS: Record<string, DefCapa> = {
  zonas: { zoomMin: 11, maximo: 2000, sql: `SELECT props, ${geo('geom')} AS geometry FROM zona WHERE geom && ${ENV} ORDER BY orden LIMIT $6` },
  rutas: { zoomMin: 11, maximo: 400, sql: `SELECT props, ${geo('geom')} AS geometry FROM ruta WHERE geom && ${ENV} ORDER BY orden LIMIT $6` },
  paraderos: { zoomMin: 13, maximo: 600, sql: `SELECT props, ST_AsGeoJSON(punto, 6)::jsonb AS geometry FROM paradero WHERE punto && ${ENV} AND $5::float8 IS NOT NULL ORDER BY orden LIMIT $6` },
  censo: {
    zoomMin: 15,
    maximo: 3000,
    sql: `SELECT props || jsonb_build_object('con_datos', con_datos) AS props, ${geo('geom')} AS geometry FROM manzana_censo WHERE geom && ${ENV} ORDER BY orden LIMIT $6`,
  },
  distritos: { zoomMin: 0, maximo: 50, sql: `SELECT props, ${geo('geom')} AS geometry FROM distrito WHERE geom && ${ENV} ORDER BY orden LIMIT $6` },
  volcan: { zoomMin: 10, maximo: 200, sql: `SELECT props, ${geo('geom')} AS geometry FROM peligro WHERE clase = 'volcanico' AND geom && ${ENV} ORDER BY orden LIMIT $6` },
  /** Zonas de peligro volcánico del Misti sin la ceniza: la ceniza cubre toda la ciudad y, dibujada, no dice nada de un lugar (como en la aplicación estática). */
  volcanZonas: { zoomMin: 10, maximo: 200, sql: `SELECT props, ${geo('geom')} AS geometry FROM peligro WHERE clase = 'volcanico' AND tipo IS DISTINCT FROM 'ceniza' AND geom && ${ENV} ORDER BY orden LIMIT $6` },
  /** Sismos reportados por el IGP (ventana reciente, no el catálogo histórico). */
  sismos: { zoomMin: 0, maximo: 400, sql: `SELECT props, ST_AsGeoJSON(geom, 6)::jsonb AS geometry FROM peligro WHERE clase = 'sismo' AND geom && ${ENV} AND $5::float8 IS NOT NULL ORDER BY orden LIMIT $6` },
  /** Peligros geológicos registrados por INGEMMET (inventario de eventos, no mapa de susceptibilidad). */
  geologicos: { zoomMin: 11, maximo: 600, sql: `SELECT props || jsonb_build_object('tipo', tipo) AS props, ST_AsGeoJSON(geom, 6)::jsonb AS geometry FROM peligro WHERE clase = 'geologico' AND geom && ${ENV} AND $5::float8 IS NOT NULL ORDER BY orden LIMIT $6` },
  /** Áreas de concesión de distribución eléctrica (MINEM-DGE): a quién le corresponde el servicio, no una conexión. */
  electricidad: { zoomMin: 9, maximo: 20, sql: `SELECT props, ${geo('geom')} AS geometry FROM concesion WHERE clase = 'electrica' AND geom && ${ENV} ORDER BY orden LIMIT $6` },
  /** Concesiones mineras vigentes o en trámite del Catastro Minero (las extinguidas no se sirven). */
  mineria: { zoomMin: 11, maximo: 400, sql: `SELECT props, ${geo('geom')} AS geometry FROM concesion WHERE clase = 'minera' AND props->>'estado' IS DISTINCT FROM 'EXTINGUIDO' AND geom && ${ENV} ORDER BY orden LIMIT $6` },
  cauces: { zoomMin: 11, maximo: 400, sql: `SELECT props, ${geo('geom')} AS geometry FROM peligro WHERE clase = 'cauce' AND geom && ${ENV} ORDER BY orden LIMIT $6` },
};

/** Categorías de `lugar` que se sirven como capa de puntos (colegios, salud, universidades, malls…). */
const CATEGORIA = /^[a-zA-Z_]{3,30}$/;

export class ErrorDeCapa extends Error {}

/** Tolerancia de simplificación en grados: cerca de medio píxel al zoom dado; 0 desde zoom 16 (geometría original). */
export function tolerancia(zoom: number): number {
  return zoom >= 16 ? 0 : 360 / (256 * 2 ** zoom) / 2;
}

export function validarCaja(caja: unknown): Caja {
  if (!Array.isArray(caja) || caja.length !== 4 || !caja.every((n) => Number.isFinite(n))) throw new ErrorDeCapa('La caja debe ser oeste,sur,este,norte en grados.');
  const [o, s, e, n] = caja as number[];
  if (o >= e || s >= n || o < -180 || e > 180 || s < -90 || n > 90) throw new ErrorDeCapa('La caja no es válida.');
  if (e - o > 2 || n - s > 2) throw new ErrorDeCapa('La caja es demasiado grande.');
  return [o, s, e, n];
}

/**
 * Elementos de una capa dentro de la caja. `recortada` es true si había más elementos que el máximo (el mapa debe pedir acercarse).
 * `capa` es una de CAPAS o `lugar:<categoría>`.
 */
export async function capaRecortada(base: Base, capa: string, caja: Caja, zoom: number): Promise<{ type: 'FeatureCollection'; capa: string; recortada: boolean; requiereZoom?: number; features: any[] }> {
  const [o, s, e, n] = validarCaja(caja);
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) throw new ErrorDeCapa('Zoom no válido.');
  let def: DefCapa | undefined = CAPAS[capa];
  let extra: unknown[] = [];
  if (!def && capa.startsWith('lugar:')) {
    const categoria = capa.slice('lugar:'.length);
    if (!CATEGORIA.test(categoria)) throw new ErrorDeCapa('Categoría no válida.');
    def = {
      zoomMin: 12,
      maximo: 2500,
      sql: `SELECT props || jsonb_build_object('categoria', categoria) AS props, COALESCE(${geo('forma')}, ST_AsGeoJSON(punto, 6)::jsonb) AS geometry FROM lugar WHERE categoria = $7 AND COALESCE(forma, punto) && ${ENV} ORDER BY orden LIMIT $6`,
    };
    extra = [categoria];
  }
  if (!def) throw new ErrorDeCapa(`Capa desconocida: ${capa}.`);
  if (zoom < def.zoomMin) return { type: 'FeatureCollection', capa, recortada: true, requiereZoom: def.zoomMin, features: [] };
  const filas = await base.consulta(def.sql, [o, s, e, n, tolerancia(zoom), def.maximo + 1, ...extra]);
  const recortada = filas.length > def.maximo;
  return { type: 'FeatureCollection', capa, recortada, features: filas.slice(0, def.maximo).filter((f) => f.geometry).map((f) => ({ type: 'Feature', properties: f.props, geometry: f.geometry })) };
}

/** Zoom mínimo y máximo de elementos de una capa (para que la web los diga sin pedirla). */
export function limitesDeCapa(capa: string): { zoomMin: number; maximo: number } {
  const def = CAPAS[capa];
  if (def) return { zoomMin: def.zoomMin, maximo: def.maximo };
  if (capa.startsWith('lugar:')) return { zoomMin: 12, maximo: 2500 };
  throw new ErrorDeCapa(`Capa desconocida: ${capa}.`);
}
