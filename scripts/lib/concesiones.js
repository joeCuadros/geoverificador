/**
 * concesiones.js — Lógica pura (sin red ni archivos) detrás de scripts/descargar-concesiones-electricas.mjs: las concesiones de distribución
 * eléctrica del MINEM (Dirección General de Electricidad) que tocan Arequipa. La usan ese script y test/concesiones.spec.ts.
 *
 *   parametrosConsulta(caja, offset, n)   → URLSearchParams de una página de la consulta al servicio ArcGIS REST (GeoJSON, WGS84)
 *   concesionariaDe(empresa)              → «SEAL», «Electrosur» o el nombre de la empresa tal como viene
 *   convertir(features)                   → { features, descartados }: propiedades con nombre propio, polígonos enteros y cerrados
 *   resumir(features)                     → { total, por_concesionaria, expedientes }
 */

/** Campos del servicio (capa 0) → propiedades del archivo. Los nombres de la izquierda son los del servicio. */
const CAMPOS = {
  OBJECTID: 'objectid',
  NOMBRE_ZON: 'nombre_zona',
  SITUACION: 'situacion',
  CONCESION: 'concesion',
  EMPRESA: 'empresa',
  EXPEDIENTE: 'expediente',
  TIPO_CONCE: 'tipo_concesion',
  SISTEMA_EL: 'sistema_electrico',
};

const sinTildes = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Una página de la consulta: las geometrías que intersecan la caja [sur, oeste, norte, este] (como en CONFIG.viewbox), enteras y no recortadas
 * (el servicio devuelve el polígono completo, no solo la parte que cae en la caja), ordenadas por OBJECTID para que el paginado sea estable.
 */
function parametrosConsulta(caja, offset, n) {
  const [sur, oeste, norte, este] = caja;
  return new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    returnGeometry: 'true',
    geometry: `${oeste},${sur},${este},${norte}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: String(n),
  });
}

/** Etiqueta corta de la empresa concesionaria; si no la conocemos, el nombre tal como viene. null si no hay nombre. */
function concesionariaDe(empresa) {
  const t = sinTildes(empresa).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/sociedad electrica del sur oeste/.test(t)) return 'SEAL';
  if (/electrosur/.test(t)) return 'Electrosur';
  return String(empresa).replace(/\s+/g, ' ').trim();
}

const anillosDe = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null);
const cerrado = (a) => Array.isArray(a) && a.length >= 4 && a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1];

/**
 * Features del servicio → Features del archivo. Se conserva el polígono ENTERO (no se recorta a los distritos ni a la caja) y cada campo del
 * servicio pasa a una propiedad con nombre propio; se añade `concesionaria`. Lo que no es un polígono con anillos cerrados no se usa: se
 * devuelve en `descartados` con su motivo, sin repararlo.
 */
function convertir(features) {
  const out = [];
  const descartados = [];
  for (const f of features || []) {
    const p = (f && f.properties) || {};
    const g = f && f.geometry;
    const polis = g ? anillosDe(g) : null;
    if (!polis) { descartados.push({ objectid: p.OBJECTID ?? null, motivo: g ? `la geometría es ${g.type}, no un polígono` : 'no trae geometría' }); continue; }
    if (!polis.every((anillos) => anillos.length > 0 && anillos.every(cerrado))) { descartados.push({ objectid: p.OBJECTID ?? null, motivo: 'el polígono tiene un anillo sin cerrar o con menos de 4 puntos' }); continue; }
    const props = {};
    for (const [campo, nombre] of Object.entries(CAMPOS)) {
      props[nombre] = typeof p[campo] === 'string' ? p[campo].trim() : (p[campo] ?? null);
      if (campo === 'EMPRESA') props.concesionaria = concesionariaDe(p[campo]);
    }
    const ordenadas = {
      objectid: props.objectid, nombre_zona: props.nombre_zona, situacion: props.situacion, concesion: props.concesion, empresa: props.empresa,
      concesionaria: props.concesionaria, expediente: props.expediente, tipo_concesion: props.tipo_concesion, sistema_electrico: props.sistema_electrico,
    };
    out.push({ type: 'Feature', properties: ordenadas, geometry: g });
  }
  return { features: out, descartados };
}

/** Cuántas concesiones hay por concesionaria y qué expedientes las respaldan. */
function resumir(features) {
  const por = {};
  for (const f of features) por[f.properties.concesionaria] = (por[f.properties.concesionaria] || 0) + 1;
  return { total: features.length, por_concesionaria: por, expedientes: [...new Set(features.map((f) => f.properties.expediente))].sort() };
}

module.exports = { CAMPOS, parametrosConsulta, concesionariaDe, convertir, resumir };
