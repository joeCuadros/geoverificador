/**
 * servicios-osm.js — Lógica pura (sin red ni archivos) detrás de scripts/descargar-servicios-osm.mjs: bancos y cajeros, restaurantes y cafés, y áreas de juegos
 * infantiles de Arequipa a partir de OpenStreetMap. Son tres necesidades INFORMATIVAS más del comercio por necesidad (Calculos.COMERCIO). La usan ese script y
 * test/servicios-diarios.spec.ts. Reutiliza la consulta, la conversión, la deduplicación y el filtro por distritos de scripts/lib/comercio.js.
 *
 *   tipoDe(tags)                     → banco | cajero | restaurante | cafe | juego_infantil | null
 *   construirConsulta(caja)          → UNA consulta a Overpass con las tres necesidades (out geom tags)
 *   convertir(elementos)             → { features, sinGeometria, sinCategoria }: cada Feature con `categoria` (la necesidad) y `tipo`
 *   deduplicarPorTipo(features)      → { features, descartados }: el mismo lugar mapeado dos veces cuenta una, sin mezclar un banco con su cajero
 *
 * Las etiquetas de cada necesidad están en Calculos.FILTROS (única definición). Los parques y jardines (leisure=park, garden) NO se descargan aquí: ya son el criterio
 * «área verde» (public/data/equipamiento/areas_verdes.geojson).
 */
const C = require('./comercio.js');

const CATEGORIAS = ['finanzas', 'comida_fuera', 'recreacion'];

const TIPOS = {
  'amenity=bank': 'banco',
  'amenity=atm': 'cajero',
  'amenity=restaurant': 'restaurante',
  'amenity=cafe': 'cafe',
  'leisure=playground': 'juego_infantil',
};

/** El tipo de un elemento según sus etiquetas de OpenStreetMap, o null si no es ninguno de los cinco. */
function tipoDe(tags) {
  const t = tags || {};
  for (const [par, tipo] of Object.entries(TIPOS)) {
    const [clave, valor] = par.split('=');
    if (t[clave] === valor) return tipo;
  }
  return null;
}

function construirConsulta(caja, timeoutS = 240) {
  return C.construirConsulta(caja, timeoutS, CATEGORIAS);
}

function convertir(elementos) {
  const r = C.convertirElementos(elementos, CATEGORIAS);
  return { ...r, features: r.features.map((f) => ({ ...f, properties: { ...f.properties, tipo: tipoDe(f.properties.tags) } })) };
}

/** Deduplica por tipo (un banco y un cajero con el mismo nombre son dos lugares). Mismas reglas que C.deduplicar: mismo nombre a `radioM` o menos, o sin nombre a 30 m o menos. */
function deduplicarPorTipo(features, { radioM = 150 } = {}) {
  const salida = [];
  let descartados = 0;
  for (const tipo of [...new Set(features.map((f) => f.properties.tipo))]) {
    const d = C.deduplicar(features.filter((f) => f.properties.tipo === tipo), { radioM });
    salida.push(...d.features);
    descartados += d.descartados;
  }
  salida.sort((a, b) => (a.properties.osm < b.properties.osm ? -1 : 1));
  return { features: salida, descartados };
}

module.exports = { CATEGORIAS, TIPOS, tipoDe, construirConsulta, convertir, deduplicarPorTipo, enDistritos: C.enDistritos };
