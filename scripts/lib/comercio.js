/**
 * comercio.js — Lógica pura (sin red ni archivos) detrás de scripts/descargar-comercio.mjs: mercados de abastos, supermercados y malls
 * (centros comerciales) de Arequipa a partir de OpenStreetMap, y su cobertura frente al CENAMA 2016.
 * La usan scripts/descargar-comercio.mjs y test/comercio.spec.ts.
 *
 *   construirConsulta(caja)               → UNA consulta a Overpass con las tres categorías (out geom tags)
 *   convertirElementos(elementos)         → { features, sinGeometria, sinCategoria }: punto, Polygon o MultiPolygon + `categoria`
 *   deduplicar(features, { radioM })      → { features, descartados }: el mismo lugar mapeado dos veces cuenta una (nombre + distancia)
 *   enDistritos(features, dentro)         → solo lo que cae (algún vértice o su centro) dentro de los distritos
 *   verificarCurados(malls, curados)      → { features, sinOsm }: contrasta una lista curada con OSM sin inventar ubicaciones
 *   leerCenama(csv) / cobertura(...)      → conteo por distrito del CENAMA 2016 frente al de OSM
 *
 * Las etiquetas de cada categoría están en Calculos.FILTROS (única definición): de ahí salen la consulta, la clasificación y la lista en pantalla.
 */
const Calculos = require('../../public/js/calculos.js');
const V = require('./validacion-oficial.js');

const CATEGORIAS = ['mercados', 'supermercados', 'malls'];
const sinTildes = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ------------------------------------------------------------------ Consulta

/** Una sola consulta para toda la caja [sur, oeste, norte, este] (política de uso de Overpass): `out geom` da puntos, vías y relaciones con su forma. */
function construirConsulta(caja, timeoutS = 240) {
  const c = `(${caja.join(',')})`;
  const lineas = CATEGORIAS.flatMap((cat) => Calculos.selectoresOverpass(cat).map((s) => `  nwr${s}${c};`));
  return [`[out:json][timeout:${timeoutS}][maxsize:1073741824];`, '(', ...lineas, ');', 'out geom tags;'].join('\n');
}

// ------------------------------------------------------------------ Conversión

/**
 * Elementos de Overpass → Features. Un nodo es un punto; una vía cerrada o una relación multipolígono, un polígono; una vía sin cerrar o
 * una relación con el exterior abierto no tiene forma utilizable y se cuenta en `sinGeometria` (no se inventa). `categoria` es la primera
 * de mercados / supermercados / malls que dicen las etiquetas y el nombre (Calculos.categoriasDe); sin ninguna, se cuenta en `sinCategoria`.
 */
function convertirElementos(elementos) {
  const lista = (elementos || []).filter((e) => e && e.tags);
  const puntos = Calculos.osmAFeatures(lista.filter((e) => e.type === 'node'), 'puntos');
  const formas = Calculos.osmAFeatures(lista.filter((e) => e.type !== 'node'), 'poligonos');
  const porId = new Map([...puntos, ...formas].map((f) => [f.properties.osm, f]));
  const features = [];
  let sinGeometria = 0;
  let sinCategoria = 0;
  for (const e of lista) {
    const f = porId.get(`${e.type}/${e.id}`);
    if (!f) { sinGeometria++; continue; }
    const categoria = CATEGORIAS.find((c) => Calculos.categoriasDe(f.properties.tags, f.properties.nombre).includes(c));
    if (!categoria) { sinCategoria++; continue; }
    features.push({ ...f, properties: { ...f.properties, categoria } });
  }
  return { features, sinGeometria, sinCategoria };
}

// ------------------------------------------------------------------ Geometría

const anillosDe = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/** Posición representativa (lat, lon): el punto, o el centro de la caja del polígono. */
function posicion(f) {
  const g = f.geometry;
  if (g.type === 'Point') return { lat: g.coordinates[1], lon: g.coordinates[0] };
  return Calculos.centroDe ? Calculos.centroDe(g) : null;
}

/** Distancia (m) entre dos elementos: de un punto a un polígono, al borde (0 si está dentro); entre polígonos, el menor de los dos centros al otro. */
function distanciaEntre(a, b) {
  const aPunto = a.geometry.type === 'Point';
  const bPunto = b.geometry.type === 'Point';
  const pa = posicion(a);
  const pb = posicion(b);
  if (!pa || !pb) return Infinity;
  if (aPunto && bPunto) return Calculos.haversine(pa.lat, pa.lon, pb.lat, pb.lon);
  const aB = bPunto ? Infinity : Calculos.distanciaAGeometriaM(pa.lat, pa.lon, b.geometry);
  const bA = aPunto ? Infinity : Calculos.distanciaAGeometriaM(pb.lat, pb.lon, a.geometry);
  return Math.min(aB, bA);
}

// ------------------------------------------------------------------ Deduplicación

const SIN_NOMBRE_RADIO_M = 30;

function mismoNombre(a, b) {
  const x = V.normalizarNombre(a);
  const y = V.normalizarNombre(b);
  if (!x || !y) return false;
  const pal = (s) => ` ${s} `;
  return pal(x).includes(pal(y)) || pal(y).includes(pal(x)) || V.similitud(a, b) >= 0.9;
}

/**
 * Un mercado, supermercado o mall suele estar mapeado dos veces (el nodo del cartel y el polígono del edificio, o el edificio y el terreno).
 * Se conserva uno por lugar: el de mayor `preferir` (por omisión, un polígono antes que un punto) y se anotan los demás en `osm_asociados`.
 * Dos elementos son el mismo lugar si sus nombres coinciden (uno contiene al otro como palabras, o parecido >= 0,9) y están a `radioM` o
 * menos; si alguno no tiene nombre, solo si están a 30 m o menos.
 */
function deduplicar(features, { radioM = 150, preferir = () => 0 } = {}) {
  const puntaje = (f) => preferir(f) * 10 + (f.geometry.type === 'Point' ? 0 : 1);
  const orden = [...features].sort((a, b) => puntaje(b) - puntaje(a) || (a.properties.osm < b.properties.osm ? -1 : 1));
  const kept = [];
  let descartados = 0;
  for (const f of orden) {
    const dueno = kept.find((k) => {
      const nombrados = k.properties.nombre && f.properties.nombre;
      const d = distanciaEntre(f, k);
      return nombrados ? mismoNombre(f.properties.nombre, k.properties.nombre) && d <= radioM : d <= SIN_NOMBRE_RADIO_M;
    });
    if (dueno) {
      dueno.properties.osm_asociados = [...(dueno.properties.osm_asociados || []), f.properties.osm].sort();
      descartados++;
    } else kept.push({ ...f, properties: { ...f.properties } });
  }
  kept.sort((a, b) => (a.properties.osm < b.properties.osm ? -1 : 1));
  return { features: kept, descartados };
}

// ------------------------------------------------------------------ Distritos

/** Deja lo que tiene algún vértice, o su centro, dentro de los distritos (`dentro(lat, lon)`). */
function enDistritos(features, dentro) {
  return features.filter((f) => {
    const g = f.geometry;
    if (g.type === 'Point') return dentro(g.coordinates[1], g.coordinates[0]);
    const c = posicion(f);
    if (c && dentro(c.lat, c.lon)) return true;
    return anillosDe(g).some((anillos) => (anillos[0] || []).some(([lon, lat]) => dentro(lat, lon)));
  });
}

// ------------------------------------------------------------------ Malls curados

/**
 * Contrasta una lista curada de malls { id, nombre, patron, url, entidad } con los elementos de OSM: el elemento cuyo nombre cumple el `patron`
 * (expresión regular, sin tildes ni mayúsculas) recibe `verificado: { id, nombre, url, entidad }`. Un mall curado que OSM no tiene se devuelve en
 * `sinOsm`: no se le inventa una ubicación.
 */
function verificarCurados(features, curados) {
  const marcas = new Map();
  const sinOsm = [];
  for (const c of curados) {
    const re = new RegExp(c.patron, 'i');
    const hallados = features.filter((f) => f.properties.nombre && re.test(sinTildes(f.properties.nombre)));
    if (hallados.length === 0) { sinOsm.push(c); continue; }
    for (const f of hallados) if (!marcas.has(f.properties.osm)) marcas.set(f.properties.osm, { id: c.id, nombre: c.nombre, url: c.url, entidad: c.entidad });
  }
  return {
    features: features.map((f) => (marcas.has(f.properties.osm) ? { ...f, properties: { ...f.properties, verificado: marcas.get(f.properties.osm) } } : f)),
    sinOsm,
  };
}

// ------------------------------------------------------------------ CENAMA

/**
 * CENAMA 2016 (INEI, publicado por PRODUCE en datosabiertos.gob.pe): CSV con barra vertical, anonimizado, SIN nombre, dirección ni coordenadas.
 * Se queda con la provincia de Arequipa (departamento y provincia AREQUIPA).
 */
function leerCenama(csv) {
  const { columnas, filas } = V.parsearCsv(csv, '|');
  for (const c of ['departamento', 'provincia', 'distrito', 'tipo_mercado']) {
    if (!columnas.includes(c)) throw new Error(`El CSV del CENAMA no trae la columna «${c}».`);
  }
  const registros = filas.filter((r) => r.departamento === 'AREQUIPA' && r.provincia === 'AREQUIPA');
  const porTipo = {};
  registros.forEach((r) => { porTipo[r.tipo_mercado] = (porTipo[r.tipo_mercado] || 0) + 1; });
  return { totalPais: filas.length, registros, porTipo };
}

/** Conteo por distrito del CENAMA frente al de OSM (`distritoDe(lat, lon)` devuelve el nombre en mayúsculas o null). */
function cobertura(registros, features, distritoDe) {
  const cuentas = new Map();
  const sumar = (d, k) => { if (!d) return; if (!cuentas.has(d)) cuentas.set(d, { distrito: d, cenama: 0, osm: 0 }); cuentas.get(d)[k]++; };
  registros.forEach((r) => sumar(r.distrito, 'cenama'));
  features.forEach((f) => { const p = posicion(f); if (p) sumar(distritoDe(p.lat, p.lon), 'osm'); });
  const filas = [...cuentas.values()].sort((a, b) => (a.distrito < b.distrito ? -1 : 1));
  return { filas, totales: { cenama: filas.reduce((t, f) => t + f.cenama, 0), osm: filas.reduce((t, f) => t + f.osm, 0) } };
}

module.exports = { CATEGORIAS, construirConsulta, convertirElementos, deduplicar, enDistritos, verificarCurados, leerCenama, cobertura, posicion, distanciaEntre };
