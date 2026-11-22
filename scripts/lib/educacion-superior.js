/**
 * educacion-superior.js — Lógica pura (sin red ni archivos) detrás de scripts/descargar-educacion-superior.mjs: universidades e institutos de
 * Arequipa a partir de OpenStreetMap, contrastados con la lista de universidades licenciadas de SUNEDU. Tarea 4.1 del plan.
 *
 *   construirConsulta(caja)            → UNA consulta a Overpass (amenity=university | college; out center tags)
 *   tipoDe(tags)                       → 'universidad' | 'instituto' | null
 *   convertir(elementos)               → { features, sinGeometria, sinNombre }
 *   cruzarSunedu(features, lista)      → features con `sunedu` (nombre de la lista) o null, y cuáles de la lista no tienen sede en el mapa
 *   deduplicar(features, { radioM })   → la misma sede mapeada dos veces (un punto y su contorno) cuenta una
 *
 * Lo que NO dice: OpenStreetMap es colaborativo, así que una sede que nadie mapeó no aparece. `sunedu: null` no significa «no licenciada»:
 * significa que el nombre no coincide con ninguna universidad con sede en Arequipa en la lista (puede ser una filial o un instituto).
 */
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const RADIO_TIERRA_M = 6371008.8;
function haversine(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(a));
}

/** `caja`: [sur, oeste, norte, este]. */
function construirConsulta(caja, timeoutS = 180) {
  const b = caja.join(',');
  return `[out:json][timeout:${timeoutS}];\n(\n  nwr["amenity"="university"](${b});\n  nwr["amenity"="college"](${b});\n);\nout center tags;`;
}

function tipoDe(tags) {
  const t = tags || {};
  if (t.amenity === 'university') return 'universidad';
  if (t.amenity === 'college') return 'instituto';
  return null;
}

/** Elementos de Overpass → Features de punto. Un elemento sin nombre se descarta: no se le puede decir a nadie «cerca de (sin nombre)». */
function convertir(elementos) {
  const features = [];
  let sinGeometria = 0;
  let sinNombre = 0;
  for (const e of elementos) {
    const tipo = tipoDe(e.tags);
    if (!tipo) continue;
    const lat = e.type === 'node' ? e.lat : e.center && e.center.lat;
    const lon = e.type === 'node' ? e.lon : e.center && e.center.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      sinGeometria++;
      continue;
    }
    const nombre = typeof e.tags.name === 'string' && e.tags.name.trim() ? e.tags.name.trim() : null;
    if (!nombre) {
      sinNombre++;
      continue;
    }
    const { name: _n, ...tags } = e.tags;
    features.push({
      type: 'Feature',
      properties: { fuente: 'OSM', osm: `${e.type}/${e.id}`, nombre, tipo, operador: e.tags.operator || null, tags },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }
  features.sort((a, b) => (a.properties.osm < b.properties.osm ? -1 : 1));
  return { features, sinGeometria, sinNombre };
}

/** Misma sede mapeada dos veces: mismo nombre normalizado y mismo tipo a `radioM` o menos. Se conserva la primera. */
function deduplicar(features, { radioM = 150 } = {}) {
  const salida = [];
  let descartados = 0;
  for (const f of features) {
    const k = sinTildes(f.properties.nombre);
    const [lon, lat] = f.geometry.coordinates;
    const repetido = salida.some((g) => g.properties.tipo === f.properties.tipo && sinTildes(g.properties.nombre) === k && haversine(lat, lon, g.geometry.coordinates[1], g.geometry.coordinates[0]) <= radioM);
    if (repetido) descartados++;
    else salida.push(f);
  }
  return { features: salida, descartados };
}

/** Marca cada universidad con el nombre de la lista de SUNEDU con el que coincide (por nombre u operador), o null. */
function cruzarSunedu(features, lista) {
  const halladas = new Set();
  const salida = features.map((f) => {
    if (f.properties.tipo !== 'universidad') return { ...f, properties: { ...f.properties, sunedu: null } };
    const texto = ` ${sinTildes(f.properties.nombre)} ${sinTildes(f.properties.operador)} ${sinTildes(f.properties.tags && f.properties.tags.short_name)} `;
    const u = lista.find((x) => x.claves.some((c) => texto.includes(` ${sinTildes(c)} `) || texto.includes(sinTildes(c)) && sinTildes(c).length > 6));
    if (u) halladas.add(u.nombre);
    return { ...f, properties: { ...f.properties, sunedu: u ? u.nombre : null } };
  });
  return { features: salida, sinSedeEnElMapa: lista.filter((u) => !halladas.has(u.nombre)).map((u) => u.nombre) };
}

module.exports = { construirConsulta, tipoDe, convertir, deduplicar, cruzarSunedu, sinTildes };
