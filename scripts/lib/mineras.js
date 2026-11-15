/**
 * mineras.js — Lógica pura (sin red ni archivos) detrás de scripts/descargar-concesiones-mineras.mjs: el Catastro Minero de INGEMMET (GEOCATMIN) en Arequipa
 * metropolitana. La usan ese script y test/mineras.spec.ts.
 *
 *   parametrosConsulta(caja)   → URLSearchParams de la consulta (GeoJSON en WGS84, lo que interseca la caja, SIN el titular)
 *   convertir(features)        → { features, descartados }: propiedades con nombre propio, estado en palabras, polígonos enteros y cerrados
 *   resumir(features)          → { total, por_estado, por_sustancia, hectareas }
 *
 * El nombre del titular de la concesión (TIT_CONCES) no se pide ni se guarda: es el nombre de una persona o empresa, no hace falta para decir que un punto cae
 * dentro de una concesión y no es asunto de esta herramienta.
 */

/** Campos del servicio SERV_CATASTRO_MINERO/MapServer/0 que se piden. */
const CAMPOS = ['CODIGOU', 'CONCESION', 'HECTAGIS', 'ESTADO', 'D_ESTADO', 'LEYENDA', 'ESTADO_MINEM', 'SUSTANCIA', 'DISTRI', 'FEC_DENU', 'FECHA_ACTUALIZACION'];

/** La consulta: todo polígono que interseca la caja [sur, oeste, norte, este], entero. El servicio no admite paginado: devuelve hasta su máximo (1000) de una vez. */
function parametrosConsulta(caja) {
  const [sur, oeste, norte, este] = caja;
  return new URLSearchParams({
    f: 'geojson', where: '1=1', outFields: CAMPOS.join(','), outSR: '4326', returnGeometry: 'true',
    geometry: `${oeste},${sur},${este},${norte}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  });
}

const ESTADOS = { TITULADO: 'TITULADO', TRAMITE: 'EN TRÁMITE', EXTINGUIDO: 'EXTINGUIDO', OTROS: 'OTRO' };
const SUSTANCIAS = { M: 'metálica', N: 'no metálica' };
const anillosDe = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null);
const cerrado = (a) => Array.isArray(a) && a.length >= 4 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1];
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function convertir(features) {
  const out = [];
  const descartados = [];
  for (const f of features || []) {
    const p = (f && f.properties) || {};
    const g = f && f.geometry;
    const polis = g ? anillosDe(g) : null;
    const codigo = texto(p.CODIGOU);
    if (!polis) { descartados.push({ codigo, motivo: g ? `la geometría es ${g.type}, no un polígono` : 'no trae geometría' }); continue; }
    if (!polis.every((anillos) => anillos.length > 0 && anillos.every(cerrado))) { descartados.push({ codigo, motivo: 'el polígono tiene un anillo sin cerrar o con menos de 4 puntos' }); continue; }
    out.push({
      type: 'Feature',
      properties: {
        codigo, nombre: texto(p.CONCESION), hectareas: Number.isFinite(p.HECTAGIS) ? p.HECTAGIS : null, estado: ESTADOS[p.LEYENDA] || 'OTRO', estado_detalle: texto(p.D_ESTADO),
        sustancia: SUSTANCIAS[p.SUSTANCIA] || null, explotacion_o_exploracion: texto(p.ESTADO_MINEM),
        distritos: String(p.DISTRI || '').split('/').map((d) => d.trim()).filter(Boolean), fecha_denuncio: iso(p.FEC_DENU), actualizado: iso(p.FECHA_ACTUALIZACION),
      },
      geometry: g,
    });
  }
  return { features: out, descartados };
}

function resumir(features) {
  const por = (k) => features.reduce((o, f) => { const v = f.properties[k] || '(sin dato)'; o[v] = (o[v] || 0) + 1; return o; }, {});
  return { total: features.length, por_estado: por('estado'), por_sustancia: por('sustancia'), hectareas: Math.round(features.reduce((t, f) => t + (f.properties.hectareas || 0), 0)) };
}

module.exports = { CAMPOS, parametrosConsulta, convertir, resumir };
