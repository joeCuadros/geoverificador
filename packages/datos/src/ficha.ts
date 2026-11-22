/**
 * ficha.ts — La ficha de un punto armada con consultas a la base (criterio de «hecho» de la fase 2).
 *
 * El cálculo es el mismo de la aplicación: `Equipamiento.evaluar` del núcleo de dominio. Lo que cambia es de dónde lee: en el navegador baja los
 * archivos completos de public/data; aquí cada «archivo» que pide se responde con una consulta espacial que trae solo los elementos que pueden
 * influir en el resultado de ese punto (los que están cerca y el más cercano de cada grupo). Por eso los valores coinciden con los de la aplicación.
 */
import CONFIG from '@geoverificador/dominio/nucleo/config';
import { configurar } from '@geoverificador/dominio/nucleo/entorno';
import { crearEquipamiento } from '@geoverificador/dominio/nucleo/equipamiento';
import type { Base } from './cliente.ts';
import { distritoDe, peligrosDe, validarPunto, zonaDe, type PeligroDePunto, type Punto } from './consultas.ts';

configurar({ CONFIG });

/** Un archivo con esta cantidad de elementos o menos se entrega entero: no vale la pena recortarlo. */
const ARCHIVO_PEQUENO = 200;
/** Radio en el que se entregan todos los elementos: el mismo que usa la aplicación cuando consulta Overpass en vivo. */
const RADIO_M = CONFIG.equipamiento.respaldoRadioM as number;
const MAS_CERCANOS = 8;
/** Archivos cuyo resultado informa cuántos elementos tiene el archivo completo (el directorio de puntos de acopio): se entregan enteros. */
const ENTEROS = new Set(['agua/puntos_acopio.geojson']);
const PT = 'ST_SetSRID(ST_MakePoint($2, $3), 4326)';

/** Ruta relativa a public/data a partir de la URL que usa CONFIG («data/equipamiento/salud.geojson»). */
const rutaDe = (url: string): string => url.replace(/^.*?data\//, '');

const coleccion = (meta: Record<string, any>, filas: Record<string, any>[]) => {
  const { name, crs, ...metadata } = meta;
  return { type: 'FeatureCollection', ...(name ? { name } : {}), ...(crs ? { crs } : {}), metadata, features: filas.map((f) => ({ type: 'Feature', properties: f.props, geometry: f.geometry })) };
};

/**
 * Lo que la aplicación leería del archivo `ruta`, recortado a lo que puede influir en la ficha de `p`. null si el archivo no está en la base.
 * Los elementos salen en el orden del archivo.
 */
export async function coleccionCerca(base: Base, ruta: string, p: Punto): Promise<any | null> {
  const info = (await base.consulta<{ tabla: string; registros: number; metadatos: Record<string, any> }>('SELECT tabla, registros, metadatos FROM archivo_dato WHERE ruta = $1', [ruta]))[0];
  if (!info) return null;
  if (info.tabla === 'documento') return (await base.consulta('SELECT contenido FROM documento WHERE archivo = $1', [ruta]))[0].contenido;
  const todo = info.registros <= ARCHIVO_PEQUENO || ENTEROS.has(ruta);

  if (info.tabla === 'lugar') {
    const filas = await base.consulta(
      `WITH cerca AS (
         SELECT id FROM lugar WHERE archivo = $1 AND ($4 OR ST_DWithin(COALESCE(forma, punto)::geography, ${PT}::geography, $5))
       ), proximos AS (
         SELECT id FROM (SELECT id FROM lugar WHERE archivo = $1 ORDER BY COALESCE(forma, punto)::geography <-> ${PT}::geography LIMIT $6) q
       ), por_grupo AS (
         SELECT id FROM (
           SELECT l.id, row_number() OVER (PARTITION BY g ORDER BY COALESCE(l.forma, l.punto)::geography <-> ${PT}::geography) AS n
           FROM lugar l, unnest(l.grupos) g WHERE l.archivo = $1
         ) q WHERE n <= $6
       ), grandes AS (
         SELECT id FROM (
           SELECT l.id, row_number() OVER (PARTITION BY u ORDER BY l.forma::geography <-> ${PT}::geography) AS n
           FROM lugar l, unnest($7::float8[]) u WHERE l.archivo = $1 AND l.area_m2 >= u * 0.98
         ) q WHERE n <= $6
       )
       SELECT l.props, ST_AsGeoJSON(COALESCE(l.forma, l.punto), 15)::jsonb AS geometry
       FROM lugar l WHERE l.id IN (SELECT id FROM cerca UNION SELECT id FROM proximos UNION SELECT id FROM por_grupo UNION SELECT id FROM grandes)
       ORDER BY l.orden`,
      [ruta, p.lon, p.lat, todo, RADIO_M, MAS_CERCANOS, [CONFIG.umbrales.areaVerde.areaMinM2, CONFIG.umbrales.areaVerde.areaGrandeM2]],
    );
    return coleccion(info.metadatos, filas);
  }

  if (info.tabla === 'manzana_censo') {
    const filas = await base.consulta(
      `SELECT props, ST_AsGeoJSON(geom, 15)::jsonb AS geometry FROM manzana_censo
       WHERE archivo = $1 AND (ST_DWithin(geom::geography, ${PT}::geography, $4)
         -- La más cercana va siempre: con ella el núcleo distingue «el punto no está en ninguna manzana» de «falta el archivo».
         OR id = (SELECT id FROM manzana_censo WHERE archivo = $1 ORDER BY geom <-> ${PT} LIMIT 1))
       ORDER BY orden`,
      [ruta, p.lon, p.lat, (CONFIG.censo.manzanaCercanaM as number) * 3],
    );
    return coleccion(info.metadatos, filas);
  }

  if (info.tabla === 'concesion') {
    const filas = await base.consulta(
      `SELECT props, ST_AsGeoJSON(geom, 15)::jsonb AS geometry FROM concesion
       WHERE archivo = $1 AND ($4 OR ST_Covers(geom, ${PT})
         OR id IN (SELECT id FROM (SELECT id FROM concesion WHERE archivo = $1 ORDER BY geom::geography <-> ${PT}::geography LIMIT $5) q))
       ORDER BY orden`,
      [ruta, p.lon, p.lat, todo, MAS_CERCANOS * 4],
    );
    return coleccion(info.metadatos, filas);
  }

  if (info.tabla === 'ruta_y_paradero') {
    // Los recorridos que pasan cerca y todas las paradas (son pocas y cada línea busca la suya más cercana).
    const filas = await base.consulta(
      `SELECT props, geometry FROM (
         SELECT orden, props, ST_AsGeoJSON(geom, 15)::jsonb AS geometry FROM ruta WHERE archivo = $1 AND ST_DWithin(geom::geography, ${PT}::geography, $4)
         UNION ALL
         SELECT orden, props, ST_AsGeoJSON(punto, 15)::jsonb FROM paradero WHERE archivo = $1
       ) q ORDER BY orden`,
      [ruta, p.lon, p.lat, (CONFIG.umbrales.transporte as number) * 1.5],
    );
    return coleccion(info.metadatos, filas);
  }

  const tabla = info.tabla === 'distrito' || info.tabla === 'zona' || info.tabla === 'peligro' ? info.tabla : null;
  if (!tabla) return null;
  return coleccion(info.metadatos, await base.consulta(`SELECT props, ST_AsGeoJSON(geom, 15)::jsonb AS geometry FROM ${tabla} WHERE archivo = $1 ORDER BY orden`, [ruta]));
}

/** Un `fetch` que responde las URL de datos de CONFIG con consultas a la base alrededor de `p`. */
export function fetchDesdeBase(base: Base, p: Punto) {
  return async (url: string) => {
    const datos = await coleccionCerca(base, rutaDe(String(url)), p);
    return { ok: datos !== null, status: datos === null ? 404 : 200, json: async () => datos };
  };
}

export interface FichaDePunto {
  punto: Punto;
  distrito: Awaited<ReturnType<typeof distritoDe>>;
  zona: Awaited<ReturnType<typeof zonaDe>>;
  /** El resultado de Equipamiento.evaluar: salud, educación por nivel, transporte, área verde, comercio, electricidad, censo, minería y acopio. */
  entorno: Record<string, any>;
  peligros: PeligroDePunto[];
}

/** La ficha completa de un punto con consultas a la base. */
export async function fichaDePunto(base: Base, p: Punto): Promise<FichaDePunto> {
  validarPunto(p);
  const equipamiento = crearEquipamiento({ fetch: fetchDesdeBase(base, p) });
  const [distrito, zona, entorno, peligros] = await Promise.all([distritoDe(base, p), zonaDe(base, p), equipamiento.evaluar(p.lat, p.lon), peligrosDe(base, p)]);
  return { punto: p, distrito, zona, entorno, peligros };
}
