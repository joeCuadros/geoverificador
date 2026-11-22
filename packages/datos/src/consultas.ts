/**
 * consultas.ts — Consultas espaciales base (tarea 2.4): lugares a menos de N metros, manzana que contiene un punto, zona y peligros de un punto.
 *
 * Las distancias de PostGIS (::geography, elipsoide WGS84) sirven para ELEGIR candidatos. La cifra que se muestra a la persona la mide siempre el
 * núcleo de dominio (haversine con R = 6 371 008,8 m), igual que en la ficha: así la base y la aplicación dan el mismo número.
 */
import Calculos from '@geoverificador/dominio/nucleo/calculos';
import type { Base, Fila } from './cliente.ts';

export interface Punto {
  lat: number;
  lon: number;
}

export interface LugarCercano {
  id: number;
  categoria: string;
  nombre: string | null;
  grupos: string[];
  props: Record<string, any>;
  lat: number;
  lon: number;
  /** Geometría original cuando no es un punto (un parque, un mall). */
  forma: any | null;
  areaM2: number | null;
  /** Distancia en línea recta medida por el núcleo: al punto o, si hay forma, a su borde (0 si el punto está dentro). */
  distanciaM: number;
  fuenteId: string;
  fecha: string | null;
}

const PT = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';
/** Margen sobre el radio pedido: cubre la diferencia entre el elipsoide de PostGIS y la esfera del núcleo (menos del 0,6 %). */
const MARGEN = 1.01;

export function validarPunto(p: Punto): void {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) throw new RangeError('Punto no válido: se esperaba { lat, lon } en grados.');
}

function aLugar(f: Fila, p: Punto): LugarCercano {
  const distanciaM = f.forma ? Calculos.distanciaAGeometriaM(p.lat, p.lon, f.forma) : Calculos.haversine(p.lat, p.lon, f.lat, f.lon);
  return { id: Number(f.id), categoria: f.categoria, nombre: f.nombre, grupos: f.grupos, props: f.props, lat: f.lat, lon: f.lon, forma: f.forma, areaM2: f.area_m2, distanciaM, fuenteId: f.fuente_id, fecha: f.fecha };
}

const COLUMNAS_LUGAR = `l.id, l.categoria, l.nombre, l.grupos, l.props, ST_Y(l.punto) AS lat, ST_X(l.punto) AS lon, ST_AsGeoJSON(l.forma, 15)::jsonb AS forma, l.area_m2, a.fuente_id, to_char(f.fecha, 'YYYY-MM-DD') AS fecha`;
const DESDE_LUGAR = 'FROM lugar l JOIN archivo_dato a ON a.ruta = l.archivo JOIN fuente f ON f.id = a.fuente_id';

/** Lugares de una categoría a `radioM` metros o menos del punto, del más cercano al más lejano. `grupo` filtra por nivel o tipo. */
export async function lugaresCerca(base: Base, p: Punto, categoria: string, radioM: number, { grupo, limite = 50 }: { grupo?: string; limite?: number } = {}): Promise<LugarCercano[]> {
  validarPunto(p);
  const filas = await base.consulta(
    `SELECT ${COLUMNAS_LUGAR} ${DESDE_LUGAR}
     WHERE l.categoria = $3 AND ($5::text IS NULL OR $5 = ANY (l.grupos))
       AND ST_DWithin(COALESCE(l.forma, l.punto)::geography, ${PT}::geography, $4)`,
    [p.lon, p.lat, categoria, radioM * MARGEN, grupo ?? null],
  );
  return filas
    .map((f) => aLugar(f, p))
    .filter((l) => l.distanciaM <= radioM)
    .sort((a, b) => a.distanciaM - b.distanciaM)
    .slice(0, limite);
}

/** El lugar más cercano de una categoría (y, si se pide, de un grupo), esté a la distancia que esté. null si la categoría está vacía. */
export async function lugarMasCercano(base: Base, p: Punto, categoria: string, { grupo }: { grupo?: string } = {}): Promise<LugarCercano | null> {
  validarPunto(p);
  const filas = await base.consulta(
    `SELECT ${COLUMNAS_LUGAR} ${DESDE_LUGAR}
     WHERE l.categoria = $3 AND ($4::text IS NULL OR $4 = ANY (l.grupos))
     ORDER BY COALESCE(l.forma, l.punto)::geography <-> ${PT}::geography LIMIT 8`,
    [p.lon, p.lat, categoria, grupo ?? null],
  );
  const lista = filas.map((f) => aLugar(f, p)).sort((a, b) => a.distanciaM - b.distanciaM);
  return lista[0] ?? null;
}

/** ¿El punto cae dentro de la geometría (Polygon o MultiPolygon)? Mismo criterio que la aplicación (punto en polígono del núcleo). */
function dentroDe(p: Punto, g: { type: string; coordinates: any }): boolean {
  const poligonos = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return poligonos.some((anillos: number[][][]) => Calculos.puntoEnPoligono(p.lat, p.lon, anillos));
}

/**
 * Distrito que contiene el punto, o null si cae fuera de los 25 distritos. La base elige los candidatos por caja (índice espacial) y el núcleo
 * decide si el punto está dentro: el plano tiene polígonos que PostGIS considera no válidos y ST_Covers no es fiable en ellos.
 * Si hay más de uno, gana el primero del archivo, como en la aplicación.
 */
export async function distritoDe(base: Base, p: Punto): Promise<{ ubigeo: string; nombre: string; props: Record<string, any> } | null> {
  validarPunto(p);
  const filas = await base.consulta(`SELECT ubigeo, nombre, props, ST_AsGeoJSON(geom, 15)::jsonb AS geometry FROM distrito WHERE geom && ${PT} ORDER BY orden`, [p.lon, p.lat]);
  const f = filas.find((x) => dentroDe(p, x.geometry));
  return f ? { ubigeo: f.ubigeo, nombre: f.nombre, props: f.props } : null;
}

/**
 * Zona del plano de zonificación que contiene el punto, con la regla de esa zona si existe; null fuera del plano.
 * Si el punto cae en más de un polígono, gana el último del archivo, como en la aplicación; `coincidencias` dice cuántos fueron.
 */
export async function zonaDe(base: Base, p: Punto): Promise<{ codigo: string; color: string | null; regla: Record<string, any> | null; coincidencias: number; fuenteId: string } | null> {
  validarPunto(p);
  const filas = await base.consulta(
    `SELECT z.codigo, z.props, a.fuente_id, ST_AsGeoJSON(z.geom, 15)::jsonb AS geometry,
            (SELECT d.contenido -> z.codigo FROM documento d WHERE d.archivo = 'reglas_zonas.json') AS regla
     FROM zona z JOIN archivo_dato a ON a.ruta = z.archivo WHERE z.geom && ${PT} ORDER BY z.orden`,
    [p.lon, p.lat],
  );
  const dentro = filas.filter((x) => dentroDe(p, x.geometry));
  const f = dentro[dentro.length - 1];
  return f ? { codigo: f.codigo, color: f.props?.color ?? null, regla: f.regla ?? null, coincidencias: dentro.length, fuenteId: f.fuente_id } : null;
}
/** Manzana del censo que contiene el punto o, si el punto está en la calle, la más cercana a `cercanaM` metros o menos. */
export async function manzanaDe(base: Base, p: Punto, cercanaM = 30): Promise<{ codigo: string; ubigeo: string; conDatos: boolean; props: Record<string, any>; geometry: any; dentro: boolean } | null> {
  validarPunto(p);
  const filas = await base.consulta(
    `SELECT codigo, ubigeo, con_datos, props, ST_AsGeoJSON(geom, 15)::jsonb AS geometry, ST_Covers(geom, ${PT}) AS dentro
     FROM manzana_censo WHERE ST_DWithin(geom::geography, ${PT}::geography, $3)
     ORDER BY ST_Covers(geom, ${PT}) DESC, geom::geography <-> ${PT}::geography LIMIT 1`,
    [p.lon, p.lat, cercanaM * MARGEN],
  );
  const f = filas[0];
  return f ? { codigo: f.codigo, ubigeo: f.ubigeo, conDatos: f.con_datos, props: f.props, geometry: f.geometry, dentro: f.dentro } : null;
}

export interface PeligroDePunto {
  clase: string;
  tipo: string | null;
  nivel: string | null;
  nombre: string | null;
  props: Record<string, any>;
  /** 0 si el punto está dentro del polígono. */
  distanciaM: number;
  fuenteId: string;
}

/**
 * Peligros del punto: zonas de peligro volcánico que lo contienen, y cauces y peligros geológicos a `radioM` metros o menos.
 * No incluye sismos ni denuncias (son registros de eventos, no una condición del terreno): se piden aparte con `clases`.
 */
export async function peligrosDe(base: Base, p: Punto, { radioM = 500, clases = ['volcanico', 'cauce', 'geologico'] }: { radioM?: number; clases?: string[] } = {}): Promise<PeligroDePunto[]> {
  validarPunto(p);
  const filas = await base.consulta(
    `SELECT g.clase, g.tipo, g.nivel, g.nombre, g.props, a.fuente_id, GeometryType(g.geom) AS forma, ST_AsGeoJSON(g.geom, 15)::jsonb AS geometry
     FROM peligro g JOIN archivo_dato a ON a.ruta = g.archivo
     WHERE g.clase = ANY ($3::text[])
       AND CASE WHEN g.clase = 'volcanico' THEN ST_Covers(g.geom, ${PT}) ELSE ST_DWithin(g.geom::geography, ${PT}::geography, $4) END
     ORDER BY g.archivo, g.orden`,
    [p.lon, p.lat, clases, radioM * MARGEN],
  );
  return filas
    .map((f) => {
      const g = f.geometry;
      const distanciaM = g.type === 'Point' ? Calculos.haversine(p.lat, p.lon, g.coordinates[1], g.coordinates[0]) : /LineString/.test(g.type) ? Calculos.distanciaAGeometriaLineaM(p.lat, p.lon, g) : Calculos.distanciaAGeometriaM(p.lat, p.lon, g);
      return { clase: f.clase, tipo: f.tipo, nivel: f.nivel, nombre: f.nombre, props: f.props, distanciaM, fuenteId: f.fuente_id };
    })
    .filter((x) => x.clase === 'volcanico' || x.distanciaM <= radioM)
    .sort((a, b) => a.distanciaM - b.distanciaM);
}

/** Concesiones (eléctricas o mineras) que contienen el punto. */
export async function concesionesDe(base: Base, p: Punto, clase: 'electrica' | 'minera'): Promise<{ nombre: string | null; props: Record<string, any> }[]> {
  validarPunto(p);
  return base.consulta(`SELECT nombre, props FROM concesion WHERE clase = $3 AND ST_Covers(geom, ${PT}) ORDER BY orden`, [p.lon, p.lat, clase]);
}

/** La fuente de un dato con su licencia, fecha y límite (lo que cita `explicar_fuente`). */
export async function fuente(base: Base, id: string): Promise<Fila | null> {
  const filas = await base.consulta(`SELECT id, nombre, licencia, licencia_verificada, url, to_char(fecha, 'YYYY-MM-DD') AS fecha, atribucion, permite_publicar, limite FROM fuente WHERE id = $1`, [id]);
  return filas[0] ?? null;
}

export async function fuentes(base: Base): Promise<Fila[]> {
  return base.consulta(
    `SELECT f.id, f.nombre, f.licencia, f.licencia_verificada, f.url, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.atribucion, f.permite_publicar, f.limite,
            COALESCE((SELECT sum(a.registros) FROM archivo_dato a WHERE a.fuente_id = f.id), 0)::int AS registros,
            (SELECT count(*) FROM archivo_dato a WHERE a.fuente_id = f.id)::int AS archivos
     FROM fuente f ORDER BY f.nombre`,
  );
}
