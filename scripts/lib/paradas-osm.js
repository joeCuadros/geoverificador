/**
 * paradas-osm.js — Lógica pura (sin red ni archivos) para las paradas de bus de OpenStreetMap y su relación con las rutas de scripts/lib/rutas-osm.js.
 * La usan scripts/descargar-rutas-osm.mjs y test/paradas-osm.spec.ts.
 *
 *   construirConsultaParadas(caja)    → UNA consulta a Overpass con los nodos y vías de parada (highway=bus_stop, public_transport=platform|stop_position)
 *   convertirParadas(elementos)       → { features, descartadas }: una Feature Point por parada
 *   clavesEmpresa(texto)              → las empresas del SIT que nombra un texto, como claves estables («Coutm Express S.A.C.» → cotum)
 *   asociar(rutas, paradas, opciones) → { paradas, resumen }: a qué rutas sirve cada parada y cuántas rutas tienen paradas mapeadas
 *   paradasPorRuta(paradas)           → { 'relation/…': n }
 *
 * Qué hay en OpenStreetMap y qué no: las relaciones route=bus de Arequipa no traen paradas como miembros (ningún miembro con rol stop o platform). Las paradas
 * existen como objetos sueltos, a veces con la empresa (operator) que las usa, nunca con la línea. Una parada se liga a una ruta SOLO si cae a `radioM` o menos
 * de su trazado y, cuando nombra una empresa del SIT, si esa empresa es la de la ruta. Una ruta sin ninguna parada ligada queda «sin paradas mapeadas»: no se
 * inventa ninguna posición.
 */
const Calculos = require('../../public/js/calculos.js');

function construirConsultaParadas(caja, timeoutS = 240) {
  const c = caja.join(',');
  return [
    `[out:json][timeout:${timeoutS}][maxsize:1073741824];`,
    '(',
    `  node["highway"="bus_stop"](${c});`,
    `  node["public_transport"~"^(platform|stop_position)$"](${c});`,
    `  way["public_transport"="platform"](${c});`,
    ');',
    'out tags center;',
  ].join('\n');
}

const texto = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

function clase(tags) {
  if (tags.public_transport === 'platform' || tags.public_transport === 'stop_position') return tags.public_transport;
  return 'bus_stop';
}

/** Convierte los elementos de Overpass (`out tags center`) en paradas. Cuenta lo que descarta y por qué. */
function convertirParadas(elementos) {
  const features = [];
  const descartadas = { sinCoordenada: 0, noEsBus: 0, repetidas: 0 };
  const vistos = new Set();
  for (const e of elementos || []) {
    if (e.type !== 'node' && e.type !== 'way') continue;
    const t = e.tags || {};
    const esParada = t.highway === 'bus_stop' || t.public_transport === 'platform' || t.public_transport === 'stop_position';
    if (!esParada) continue;
    const osm = `${e.type}/${e.id}`;
    if (vistos.has(osm)) { descartadas.repetidas++; continue; }
    vistos.add(osm);
    const lat = e.type === 'node' ? e.lat : e.center && e.center.lat;
    const lon = e.type === 'node' ? e.lon : e.center && e.center.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { descartadas.sinCoordenada++; continue; }
    if ((t.train === 'yes' || t.railway) && t.bus !== 'yes') { descartadas.noEsBus++; continue; }
    features.push({
      type: 'Feature',
      properties: { tipo: 'parada', osm, nombre: texto(t.name), clase: clase(t), operador: texto(t.operator), red: texto(t.network), rutas: [], lineas: [] },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }
  return { features, descartadas };
}

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Empresas del SIT (una clave por empresa) y las formas en que OpenStreetMap las escribe, con sus erratas.
const EMPRESAS = [
  ['integra', /integra\b/],
  ['conorte', /cono\s*norte|empresarial\s+norte/],
  ['transcayma', /trans\s*cayma/],
  ['unionaqp', /union\s+aqp/],
  ['uniongrau', /union\s+grau/],
  ['aqpmasivo', /aqp\s*masivo/],
  ['emarsistran', /emarsi?stran/],
  ['megabus', /mega\s*bus/],
  ['cotum', /cotum|coutm|pachacutec/],
  ['etrabus', /etrabus|mariano\s+melgar/],
  ['characato', /characato/],
];

/** Las empresas del SIT que nombra un texto («A;B» nombra a las dos). Vacío o desconocido → conjunto vacío. */
function clavesEmpresa(valor) {
  const out = new Set();
  if (valor == null) return out;
  const t = sinTildes(valor);
  EMPRESAS.forEach(([clave, re]) => { if (re.test(t)) out.add(clave); });
  return out;
}

const geometriaLinea = (f) => f.geometry;

function bbox(g) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const rec = (a) => { if (typeof a[0] === 'number') { b[0] = Math.min(b[0], a[0]); b[1] = Math.min(b[1], a[1]); b[2] = Math.max(b[2], a[0]); b[3] = Math.max(b[3], a[1]); } else a.forEach(rec); };
  rec(g.coordinates);
  return b;
}

/**
 * Liga cada parada a las rutas que pasan a `radioM` (25 m por omisión) o menos y, si la parada nombra una empresa del SIT y la ruta también, que coincidan.
 * Devuelve paradas nuevas (las de entrada no se modifican) con `rutas` (osm de las relaciones) y `lineas`, y el resumen por línea.
 */
function asociar(rutas, paradas, { radioM = 25 } = {}) {
  const M = (Math.PI / 180) * Calculos.RADIO_TIERRA_M;
  const items = (rutas || []).map((r) => ({ r, b: bbox(geometriaLinea(r)), claves: clavesEmpresa(r.properties.operador) }));
  const salida = (paradas || []).map((p) => {
    const [lon, lat] = p.geometry.coordinates;
    const dLat = radioM / M;
    const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    const claves = clavesEmpresa(p.properties.operador);
    const ids = [];
    const lineas = new Set();
    items.forEach(({ r, b, claves: cr }) => {
      if (lon < b[0] - dLon || lon > b[2] + dLon || lat < b[1] - dLat || lat > b[3] + dLat) return;
      if (claves.size && cr.size && ![...claves].some((c) => cr.has(c))) return;
      if (Calculos.distanciaAGeometriaLineaM(lat, lon, r.geometry) <= radioM) { ids.push(r.properties.osm); if (r.properties.linea) lineas.add(r.properties.linea); }
    });
    return { ...p, properties: { ...p.properties, rutas: ids, lineas: [...lineas].sort() } };
  });
  const conParadas = new Set();
  salida.forEach((p) => p.properties.rutas.forEach((id) => conParadas.add(id)));
  const porLinea = {};
  (rutas || []).forEach((r) => {
    const l = r.properties.linea || '(sin línea)';
    porLinea[l] = porLinea[l] || { rutas: 0, conParadas: 0 };
    porLinea[l].rutas++;
    if (conParadas.has(r.properties.osm)) porLinea[l].conParadas++;
  });
  const total = (rutas || []).length;
  return {
    paradas: salida,
    resumen: {
      rutas: total,
      conParadas: (rutas || []).filter((r) => conParadas.has(r.properties.osm)).length,
      sinParadas: total - (rutas || []).filter((r) => conParadas.has(r.properties.osm)).length,
      sinParadasIds: (rutas || []).filter((r) => !conParadas.has(r.properties.osm)).map((r) => r.properties.osm),
      porLinea,
      paradas: salida.length,
      paradasSinRuta: salida.filter((p) => p.properties.rutas.length === 0).length,
      radioM,
    },
  };
}

/** { 'relation/…': número de paradas ligadas } */
function paradasPorRuta(paradas) {
  const out = {};
  (paradas || []).forEach((p) => p.properties.rutas.forEach((id) => { out[id] = (out[id] || 0) + 1; }));
  return out;
}

module.exports = { construirConsultaParadas, convertirParadas, clavesEmpresa, asociar, paradasPorRuta, EMPRESAS };
