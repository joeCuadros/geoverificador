/**
 * descargar-peligros.mjs — Descarga el inventario de peligros geológicos de Arequipa como GeoJSON.
 *
 * Fuente: capa «Peligro Geológico» de GEOCATMIN (INGEMMET), servicio
 * DGAR/SRV__PELIGRO__GEOLOGICO. Es un INVENTARIO de eventos registrados (movimientos en masa,
 * erosión, inundaciones), no un mapa de susceptibilidad: solo existe el punto donde un geólogo,
 * un informe o una fotointerpretación documentó el evento.
 *
 * Uso:   node scripts/descargar-peligros.mjs
 * Sale:  public/data/peligros_aqp.geojson
 *
 * Decisiones:
 *  - Se consulta por caja envolvente (la de CONFIG.viewbox: Arequipa metropolitana). El servicio no
 *    admite paginación y entrega hasta 2000 registros; si llega ese tope el script falla en vez de
 *    guardar datos incompletos.
 *  - Los códigos de tipo y subtipo se traducen con el diccionario OFICIAL que publica la propia capa
 *    (dominios 04_DC_TIPO_PELIGRO, 04_DC_SUB_TIPO_PELIGRO y 04_DC_FUENTE_INF_BIBLIOGRAFICA).
 *    Si aparece un código que el diccionario no conoce, no se adivina su significado: el campo queda
 *    en null («sin clasificar») y los códigos se listan en metadata.codigosSinDefinir.
 *  - No se guardan nombres de responsables ni datos de contacto; solo lo necesario para ubicar y describir el evento.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ CONFIGURACIÓN
const SERVICIO =
  process.env.PELIGROS_URL ||
  'https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/DGAR/SRV__PELIGRO__GEOLOGICO/MapServer/0';

// Misma caja que CONFIG.viewbox en public/js/config.js (oeste, sur, este, norte).
const CAJA = [-71.75, -16.6, -71.35, -16.2];
const DECIMALES = 5;
const TOPE_SERVICIO = 2000;
const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'peligros_aqp.geojson');

const CAMPOS = ['OBJECTID', 'TIP_PELIGRO', 'NOM_PELIGRO', 'NM_PROV', 'NM_DIST', 'NM_SECTOR', 'FECHA', 'FUENTE'];

// ------------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, params) {
  const destino = `${url}?${new URLSearchParams({ f: 'json', ...params })}`;
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(destino);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`el servicio respondió ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (err) {
      if (intento >= 3) throw new Error(`Falló la consulta tras 3 intentos (${err.message}).\nURL: ${destino}`);
      await esperar(2000 * intento);
    }
  }
}

// Diccionario oficial: { campo → { código → nombre } } a partir de los dominios de la capa.
async function diccionarios() {
  const meta = await pedir(SERVICIO, {});
  const out = {};
  for (const campo of ['TIP_PELIGRO', 'NOM_PELIGRO', 'FUENTE']) {
    const dom = (meta.fields || []).find((f) => f.name === campo)?.domain;
    if (!dom || !Array.isArray(dom.codedValues)) throw new Error(`La capa no publica el diccionario de «${campo}».`);
    out[campo] = Object.fromEntries(dom.codedValues.map((v) => [v.code, v.name]));
  }
  return out;
}

const redondear = (n) => Math.round(n * 10 ** DECIMALES) / 10 ** DECIMALES;

// ------------------------------------------------------------------------- PRINCIPAL
async function main() {
  console.log(`Capa: ${SERVICIO}\n`);
  const dic = await diccionarios();
  const [oeste, sur, este, norte] = CAJA;
  const data = await pedir(`${SERVICIO}/query`, {
    geometry: `${oeste},${sur},${este},${norte}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: CAMPOS.join(','),
    returnGeometry: 'true',
    outSR: '4326',
  });
  const crudos = data.features || [];
  console.log(`Registros recibidos: ${crudos.length}`);
  if (data.exceededTransferLimit || crudos.length >= TOPE_SERVICIO) {
    throw new Error('El servicio llegó a su tope de registros: faltarían datos. Divide la caja en dos consultas.');
  }

  const desconocidos = new Set();
  const nombre = (campo, codigo) => {
    if (codigo === null || codigo === undefined || codigo === '') return null;
    const n = dic[campo][codigo];
    if (!n) desconocidos.add(`${campo}=${codigo}`);
    return n || null;
  };

  const vistos = new Set();
  const features = [];
  for (const f of crudos) {
    const a = f.attributes || {};
    const g = f.geometry;
    if (vistos.has(a.OBJECTID) || !g || typeof g.x !== 'number' || typeof g.y !== 'number') continue;
    vistos.add(a.OBJECTID);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [redondear(g.x), redondear(g.y)] },
      properties: {
        id: a.OBJECTID,
        tipo: nombre('TIP_PELIGRO', a.TIP_PELIGRO),
        subtipo: nombre('NOM_PELIGRO', a.NOM_PELIGRO),
        distrito: a.NM_DIST ?? null,
        sector: a.NM_SECTOR ?? null,
        anio: typeof a.FECHA === 'number' ? new Date(a.FECHA).getUTCFullYear() : null,
        fuente: a.FUENTE ? a.FUENTE.split(',').map((c) => nombre('FUENTE', c.trim())).filter(Boolean).join(', ') : null,
      },
    });
  }
  if (desconocidos.size) {
    console.warn(`Aviso: códigos que el diccionario oficial no define; quedan como «sin clasificar»: ${[...desconocidos].join(', ')}`);
  }

  const anios = features.map((f) => f.properties.anio).filter(Boolean).sort();
  const salida = {
    type: 'FeatureCollection',
    metadata: {
      fuente: 'Inventario de peligros geológicos, GEOCATMIN (INGEMMET)',
      capa: SERVICIO,
      caja: CAJA,
      descargado: new Date().toISOString(),
      registros: features.length,
      anioDesde: anios[0] ?? null,
      anioHasta: anios[anios.length - 1] ?? null,
      codigosSinDefinir: [...desconocidos].sort(),
    },
    features,
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida));

  const cuenta = (campo) => {
    const m = {};
    features.forEach(({ properties: p }) => { m[p[campo] ?? '(sin dato)'] = (m[p[campo] ?? '(sin dato)'] || 0) + 1; });
    return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]));
  };
  console.log(`\nGuardado en ${SALIDA}`);
  console.log(`Años de registro: ${salida.metadata.anioDesde} a ${salida.metadata.anioHasta}`);
  console.log('Por tipo:', cuenta('tipo'));
  console.log('Por fuente:', cuenta('fuente'));
}

main().catch((err) => {
  console.error(`\nNo se pudo completar la descarga: ${err.message}`);
  process.exit(1);
});
