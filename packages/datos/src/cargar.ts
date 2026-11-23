/**
 * cargar.ts — Cargadores desde los archivos de apps/estatica/public/data a la base (tarea 2.3).
 *
 * Un archivo se carga entero o no se carga: se borra lo anterior de ese archivo y se inserta lo nuevo en una transacción. Si su SHA-256 no cambió,
 * no se toca. Las propiedades y la geometría de cada elemento se guardan tal cual, de modo que la colección original se puede reconstruir.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Calculos from '@geoverificador/dominio/nucleo/calculos';
import { normalizar } from '@geoverificador/dominio/texto';
import type { Base } from './cliente.ts';
import { ARCHIVOS, FUENTES, definicionDe, type DefArchivo } from './catalogo.ts';

const LOTE = 400;

export interface ResultadoCarga {
  ruta: string;
  tabla: string;
  registros: number;
  estado: 'cargado' | 'sin_cambios';
}

/** Todos los archivos de datos bajo `carpeta`, como rutas relativas con «/». */
export function listarArchivos(carpeta: string): string[] {
  const andar = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? andar(path.join(d, e.name)) : [path.join(d, e.name)]));
  return andar(carpeta)
    .map((f) => path.relative(carpeta, f).replace(/\\/g, '/'))
    .filter((f) => /\.(geo)?json$/.test(f))
    .sort();
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const dia = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Fecha del dato según los metadatos del archivo (cada descargador la llama distinto). */
export function fechaDe(meta: Record<string, unknown>): string | null {
  return dia(meta.fecha_extraccion) ?? dia(meta.fecha_descarga) ?? dia(meta.descargado) ?? dia(meta.fecha_publicacion) ?? null;
}

/** Crea o actualiza las fuentes del catálogo. Lo que una persona haya escrito a mano en la base (licencia verificada, permiso de publicar) no se pisa. */
export async function sembrarFuentes(base: Base): Promise<void> {
  for (const f of FUENTES) {
    await base.consulta(
      `INSERT INTO fuente (id, nombre, licencia, licencia_verificada, url, atribucion, permite_publicar, limite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, url = EXCLUDED.url, limite = EXCLUDED.limite,
         licencia = COALESCE(fuente.licencia, EXCLUDED.licencia), atribucion = COALESCE(fuente.atribucion, EXCLUDED.atribucion)`,
      [f.id, f.nombre, f.licencia ?? null, f.licenciaVerificada ?? false, f.url ?? null, f.atribucion ?? null, f.permitePublicar ?? true, f.limite ?? null],
    );
  }
}

const SQL_GEOM = "ST_SetSRID(ST_GeomFromGeoJSON(e->>'g'), 4326)";

/** Sentencia de inserción de cada tabla. Cada elemento del lote es { o: orden, p: propiedades, g: geometría, … }. */
const INSERCION: Record<string, string> = {
  distrito: `INSERT INTO distrito (archivo, orden, ubigeo, nombre, props, geom)
    SELECT $1, (e->>'o')::int, e->'p'->>'ubigeo', e->'p'->>'distrito', e->'p', ${SQL_GEOM} FROM jsonb_array_elements($2::jsonb) e`,
  zona: `INSERT INTO zona (archivo, orden, codigo, props, geom)
    SELECT $1, (e->>'o')::int, e->'p'->>'codigo', e->'p', ${SQL_GEOM} FROM jsonb_array_elements($2::jsonb) e`,
  manzana_censo: `INSERT INTO manzana_censo (archivo, orden, ubigeo, codigo, con_datos, props, geom)
    SELECT $1, (e->>'o')::int, e->>'ubigeo', e->'p'->>'id', (e->>'con_datos')::boolean, e->'p', ${SQL_GEOM} FROM jsonb_array_elements($2::jsonb) e`,
  ruta: `INSERT INTO ruta (archivo, orden, linea, ramal, nombre, props, geom)
    SELECT $1, (e->>'o')::int, e->'p'->>'linea', e->'p'->>'ramal', e->'p'->>'nombre', e->'p', ${SQL_GEOM} FROM jsonb_array_elements($2::jsonb) e`,
  paradero: `INSERT INTO paradero (archivo, orden, nombre, props, punto)
    SELECT $1, (e->>'o')::int, e->'p'->>'nombre', e->'p', ${SQL_GEOM} FROM jsonb_array_elements($2::jsonb) e`,
  peligro: `INSERT INTO peligro (archivo, orden, clase, tipo, nivel, nombre, props, geom)
    SELECT $1, (e->>'o')::int, $3, e->'p'->>'tipo', e->'p'->>'nivel', COALESCE(e->'p'->>'nombre', e->'p'->>'sector'), e->'p', ${SQL_GEOM} FROM jsonb_array_elements($2::jsonb) e`,
  concesion: `INSERT INTO concesion (archivo, orden, clase, nombre, props, geom)
    SELECT $1, (e->>'o')::int, $3, COALESCE(e->'p'->>'nombre', e->'p'->>'nombre_zona'), e->'p', ${SQL_GEOM} FROM jsonb_array_elements($2::jsonb) e`,
  lugar: `INSERT INTO lugar (archivo, orden, categoria, nombre, nombre_norm, grupos, props, punto, forma, area_m2)
    SELECT $1, (e->>'o')::int, $3, e->'p'->>'nombre', e->>'norm', ARRAY(SELECT jsonb_array_elements_text(e->'grupos')), e->'p',
      ST_SetSRID(ST_MakePoint((e->>'lon')::float8, (e->>'lat')::float8), 4326),
      CASE WHEN e->'g'->>'type' = 'Point' THEN NULL ELSE ${SQL_GEOM} END, (e->>'area')::float8
    FROM jsonb_array_elements($2::jsonb) e`,
};

type Elemento = Record<string, unknown>;

/** Subgrupos de un lugar para «el más cercano de cada uno»: niveles del colegio o tipo del comercio. */
function gruposDe(categoria: string, props: Record<string, any>): string[] {
  if (categoria === 'educacion' || categoria === 'educacion_osm') return Calculos.nivelesDe(props) as string[];
  return typeof props.tipo === 'string' ? [props.tipo] : [];
}

function elementosDe(tabla: string, def: DefArchivo, features: any[], meta: Record<string, any>): Elemento[] {
  return features.map((f, o) => {
    const base: Elemento = { o, p: f.properties ?? {}, g: f.geometry };
    if (tabla === 'manzana_censo') {
      const p = f.properties ?? {};
      return { ...base, ubigeo: meta.ubigeo ?? String(p.id ?? '').slice(0, 6), con_datos: Object.keys(p).length > 1 };
    }
    if (tabla === 'lugar') {
      const esPunto = f.geometry.type === 'Point';
      const centro = esPunto ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] } : Calculos.centroDe(f.geometry);
      return { ...base, lat: centro.lat, lon: centro.lon, area: esPunto ? null : Calculos.areaGeometriaM2(f.geometry), grupos: gruposDe(def.clase!, f.properties ?? {}), norm: typeof f.properties?.nombre === 'string' ? normalizar(f.properties.nombre) : null };
    }
    return base;
  });
}

async function insertar(tx: Base, tabla: string, ruta: string, elementos: Elemento[], clase?: string): Promise<void> {
  const conClase = /\$3/.test(INSERCION[tabla]);
  for (let i = 0; i < elementos.length; i += LOTE) {
    const lote = JSON.stringify(elementos.slice(i, i + LOTE));
    await tx.consulta(INSERCION[tabla], conClase ? [ruta, lote, clase] : [ruta, lote]);
  }
}

/** Carga un archivo. `forzar` lo vuelve a cargar aunque no haya cambiado. */
export async function cargarArchivo(base: Base, carpeta: string, ruta: string, { forzar = false } = {}): Promise<ResultadoCarga> {
  const def = definicionDe(ruta);
  if (!def) throw new Error(`${ruta}: no está en el catálogo (packages/datos/src/catalogo.ts). Un archivo nuevo de apps/estatica/public/data necesita su entrada.`);
  const bytes = fs.readFileSync(path.join(carpeta, ruta));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const previo = await base.consulta<{ sha256: string; registros: number }>('SELECT sha256, registros FROM archivo_dato WHERE ruta = $1', [ruta]);
  if (!forzar && previo[0]?.sha256 === sha256) return { ruta, tabla: def.tabla, registros: previo[0].registros, estado: 'sin_cambios' };

  const json = JSON.parse(bytes.toString('utf8'));
  const esColeccion = json.type === 'FeatureCollection' && Array.isArray(json.features);
  if (def.tabla !== 'documento' && !esColeccion) throw new Error(`${ruta}: se esperaba un FeatureCollection.`);
  const meta: Record<string, any> = esColeccion ? { ...(json.metadata ?? {}), ...(json.name ? { name: json.name } : {}), ...(json.crs ? { crs: json.crs } : {}) } : {};
  const registros = esColeccion ? json.features.length : 1;

  await base.transaccion(async (tx) => {
    await tx.consulta('DELETE FROM archivo_dato WHERE ruta = $1', [ruta]); // borra en cascada lo que cargó este archivo
    await tx.consulta('INSERT INTO archivo_dato (ruta, fuente_id, tabla, sha256, bytes, registros, metadatos) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)', [ruta, def.fuente, def.tabla, sha256, bytes.length, registros, JSON.stringify(meta)]);
    if (def.tabla === 'documento') {
      await tx.consulta('INSERT INTO documento (archivo, contenido) VALUES ($1, $2::jsonb)', [ruta, JSON.stringify(json)]);
    } else if (def.tabla === 'ruta_y_paradero') {
      // El archivo trae los recorridos (líneas) y las paradas (puntos) juntos; `orden` conserva la posición en el archivo.
      const todos = elementosDe('ruta', def, json.features, meta);
      await insertar(tx, 'ruta', ruta, todos.filter((e: any) => e.g.type !== 'Point'));
      await insertar(tx, 'paradero', ruta, todos.filter((e: any) => e.g.type === 'Point'));
    } else {
      await insertar(tx, def.tabla, ruta, elementosDe(def.tabla, def, json.features, meta), def.clase);
    }
    // La fecha y la licencia de la fuente son las que declara el archivo más reciente de esa fuente.
    const origen = esColeccion ? meta : json.metadata && typeof json.metadata === 'object' ? json.metadata : json;
    const fecha = fechaDe(origen);
    await tx.consulta(
      `UPDATE fuente SET fecha = GREATEST(fecha, $2::date), licencia = COALESCE(licencia, $3), atribucion = COALESCE(atribucion, $4) WHERE id = $1`,
      [def.fuente, fecha, texto(origen.licencia), texto(origen.atribucion)],
    );
  });
  return { ruta, tabla: def.tabla, registros, estado: 'cargado' };
}

/** Carga todos los archivos de `carpeta` (o solo los que cumplan `filtro`) y quita de la base los que ya no existen. */
export async function cargarTodo(base: Base, carpeta: string, { filtro, forzar = false }: { filtro?: (ruta: string) => boolean; forzar?: boolean } = {}): Promise<ResultadoCarga[]> {
  await sembrarFuentes(base);
  const rutas = listarArchivos(carpeta);
  const resultados: ResultadoCarga[] = [];
  for (const ruta of rutas.filter(filtro ?? (() => true))) resultados.push(await cargarArchivo(base, carpeta, ruta, { forzar }));
  if (!filtro) {
    const enBase = await base.consulta<{ ruta: string }>('SELECT ruta FROM archivo_dato');
    for (const { ruta } of enBase) if (!rutas.includes(ruta)) await base.consulta('DELETE FROM archivo_dato WHERE ruta = $1', [ruta]);
  }
  return resultados;
}

export { ARCHIVOS };
