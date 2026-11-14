/**
 * smartbus.js — Núcleo puro (sin red ni archivos) del recolector de rutas y paradas de SmartBus Arequipa. Adaptado de
 * scripts/descargar-rutas-smartbus.mjs (retirado en el commit cca7fa4). Lo usan scripts/lib/smartbus/recolector.js y
 * scripts/recolectar-smartbus.mjs; lo prueba test/smartbus-datos.spec.ts.
 *
 * Fuente (sin autenticación; las mismas llamadas que hace el mapa público https://smartbus.app/pe/arequipa/c2):
 *   GET https://smartbus.app/smartbus/pe/arequipa/routes        → { ok, data: [{ id, shortName, longName, agency, color, stopsCount }] }
 *   GET https://smartbus.app/smartbus/pe/arequipa/routes/{id}   → { ok, data: { …, stops: [{ id, name, lat, lng, sequence }], geometry: [[lat, lng], …] } }
 * La API da [lat, lng]; GeoJSON pide [lng, lat]: se invierte en `tramos` y en las paradas.
 *
 * USO: SmartBus no publica licencia ni términos. Estos datos son de uso local de análisis y no se redistribuyen: no se
 * escriben en public/, dist/ ni api/, no se conectan a la aplicación y el archivo lleva ese aviso en su bloque `metadata`.
 *
 * Decisiones heredadas del script anterior:
 *  - Cada «ruta» de SmartBus es un recorrido en un sentido. agency.name trae «C2 - Cono Norte» → línea C2, empresa Cono Norte;
 *    Albotran y Chiguata no tienen código: la línea es su nombre.
 *  - La geometría es una lista de tramos pegados con saltos ocasionales. Un salto de más de 300 m NO se dibuja como calle: la
 *    ruta se parte ahí (MultiLineString).
 *  - Las paradas tienen nombres numerados («Cettar - 12»); `orden` es su posición en el recorrido (sequence + 1; se asume que
 *    sequence empieza en 0, como en la ruta 17664795 comprobada).
 */
const Salida = require('../avisos/salida.js');

const ORIGEN = 'https://smartbus.app';
const CIUDAD = 'pe/arequipa';
const URL_LISTA = `${ORIGEN}/smartbus/${CIUDAD}/routes`;
const urlDetalle = (id) => `${URL_LISTA}/${encodeURIComponent(id)}`;
const SALTO_MAX_M = 300;
const CAJA_AQP = { oeste: -71.8, sur: -16.7, este: -71.2, norte: -16.1 };
const MIN_RUTAS = 200; // la lista completa trae 241
const MIN_LINEAS = 10;
const USO = 'uso local de análisis; sin licencia; no redistribuir';

const RAD = Math.PI / 180;
function distM(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}
const redondear = (n) => Math.round(n * 1e6) / 1e6; // 6 decimales ≈ 0,1 m

/** [[lat, lng], …] → lista de tramos de [lng, lat], partidos donde hay un salto mayor a SALTO_MAX_M. */
function tramos(geometry) {
  const salida = [];
  let actual = [];
  (geometry || []).forEach((p, i) => {
    if (i > 0 && distM(geometry[i - 1], p) > SALTO_MAX_M) {
      if (actual.length >= 2) salida.push(actual);
      actual = [];
    }
    actual.push([redondear(p[1]), redondear(p[0])]);
  });
  if (actual.length >= 2) salida.push(actual);
  return salida;
}

/** «C2 - Cono Norte» → { linea: 'C2', empresa: 'Cono Norte' }; «Albotran» → { linea: 'Albotran', empresa: 'Albotran' }. */
function lineaYEmpresa(agencia) {
  const m = /^(C\d+)\s*-\s*(.+)$/.exec(String(agencia).trim());
  return m ? { linea: m[1], empresa: m[2].trim() } : { linea: String(agencia).trim(), empresa: String(agencia).trim() };
}

/** «Cettar : Ciudad Municipal → Terminal Terrestre» → «Ciudad Municipal → Terminal Terrestre». */
function sentidoDe(ruta) {
  const prefijo = `${ruta.shortName} : `;
  const t = String(ruta.longName || '').trim();
  return t.startsWith(prefijo) ? t.slice(prefijo.length).trim() : t;
}

const enCaja = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lng >= CAJA_AQP.oeste && lng <= CAJA_AQP.este && lat >= CAJA_AQP.sur && lat <= CAJA_AQP.norte;

/** La lista de rutas debe ser { ok: true, data: [{ id, agency: { name } }, …] }. Lanza Error si no. */
function validarLista(json) {
  const bien = json && json.ok === true && Array.isArray(json.data) && json.data.every((r) => r && r.id !== undefined && r.id !== null && r.agency && typeof r.agency.name === 'string');
  if (!bien) throw new Error('La lista de rutas no tiene la forma esperada {ok, data[]} con id y agency.name en cada ruta.');
}

function validarDetalle(json, id) {
  const d = json && json.ok === true ? json.data : null;
  if (!d || !Array.isArray(d.geometry) || !Array.isArray(d.stops)) throw new Error(`El detalle de la ruta ${id} no tiene la forma esperada {ok, data: {stops[], geometry[]}}.`);
}

/** Una corrida completa exige una lista completa; una corrida acotada (--linea o --max-rutas) no. */
function validarCompletitud(lista, { completa }) {
  if (!completa) return;
  const lineas = new Set(lista.map((r) => lineaYEmpresa(r.agency.name).linea));
  if (lista.length < MIN_RUTAS || lineas.size < MIN_LINEAS) throw new Error(`La lista parece parcial: ${lista.length} rutas y ${lineas.size} líneas (se esperan al menos ${MIN_RUTAS} y ${MIN_LINEAS}).`);
}

/** Rutas a descargar: filtra por línea («todas» o C2, Albotran…; sin distinguir mayúsculas) y luego recorta a `maxRutas`. */
function seleccionarRutas(lista, { linea, maxRutas }) {
  let sel = lista;
  if (linea && String(linea).toLowerCase() !== 'todas') {
    const k = String(linea).toLowerCase();
    sel = lista.filter((r) => lineaYEmpresa(r.agency.name).linea.toLowerCase() === k);
    if (sel.length === 0) {
      const disponibles = [...new Set(lista.map((r) => lineaYEmpresa(r.agency.name).linea))];
      throw new Error(`La línea «${linea}» no existe en la lista de SmartBus. Disponibles: ${disponibles.join(', ')}.`);
    }
  }
  return maxRutas ? sel.slice(0, maxRutas) : sel;
}

/** → { rutas (Features), paradas (Features Point), problemas[] }. `detalles`: Map id → data del detalle. */
function construir(lista, detalles) {
  const rutas = [];
  const paradas = [];
  const problemas = [];
  for (const r of lista) {
    const d = detalles.get(r.id);
    const { linea, empresa } = lineaYEmpresa(r.agency.name);
    const partes = tramos(d.geometry);
    if (!partes.length) {
      problemas.push(`${linea} ${r.longName}: geometría vacía`);
      continue;
    }
    for (const t of partes) for (const [lng, lat] of t) if (!enCaja(lat, lng)) problemas.push(`${linea} ${r.longName}: vértice fuera de Arequipa (${lat}, ${lng})`);
    rutas.push({
      type: 'Feature',
      geometry: partes.length === 1 ? { type: 'LineString', coordinates: partes[0] } : { type: 'MultiLineString', coordinates: partes },
      properties: {
        tipo: 'ruta',
        linea,
        empresa,
        ramal: r.shortName,
        nombre: r.longName,
        sentido: sentidoDe(r),
        id_ruta: r.id,
        color: r.color || null,
        paradas: d.stops.length,
        fuente: 'SmartBus (smartbus.app)',
      },
    });
    for (const s of d.stops) {
      const lat = Number(s.lat);
      const lng = Number(s.lng);
      if (!enCaja(lat, lng)) {
        problemas.push(`${linea} ${r.longName}: parada «${s.name}» fuera de Arequipa o con coordenadas inválidas (${s.lat}, ${s.lng})`);
        continue;
      }
      paradas.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [redondear(lng), redondear(lat)] },
        properties: { tipo: 'parada', nombre: String(s.name), linea, ramal: r.shortName, orden: Number(s.sequence) + 1, id_ruta: r.id, id_parada: s.id === undefined || s.id === null ? null : String(s.id) },
      });
    }
  }
  return { rutas, paradas, problemas };
}

const tramosDe = (g) => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);

/** Conteos del resultado. `posiciones_de_parada_distintas` cuenta coordenadas distintas (cada ruta repite sus paradas). */
function contar(rutas, paradas) {
  const vertices = rutas.reduce((n, f) => n + tramosDe(f.geometry).reduce((m, t) => m + t.length, 0), 0);
  return {
    lineas: new Set(rutas.map((f) => f.properties.linea)).size,
    empresas: new Set(rutas.map((f) => f.properties.empresa)).size,
    ramales: new Set(rutas.map((f) => `${f.properties.linea}|${f.properties.ramal}`)).size,
    rutas: rutas.length,
    paradas: paradas.length,
    posiciones_de_parada_distintas: new Set(paradas.map((p) => p.geometry.coordinates.join(','))).size,
    vertices,
  };
}

/** Bloque `metadata` de la salida: fuente, fecha de captura y la restricción de uso. */
function crearMetadata({ ahora, filtros, conteos, lineas, userAgent }) {
  return {
    fuente: 'SmartBus (smartbus.app)',
    url_fuente: URL_LISTA,
    endpoints: [URL_LISTA, `${URL_LISTA}/{id}`],
    fecha_captura: ahora.toISOString(),
    licencia: 'ninguna publicada por SmartBus (sin licencia ni términos de uso)',
    uso: USO,
    aviso: 'Datos de un tercero capturados de su mapa público. No se publican, no se sirven desde la aplicación y no se copian a public/, dist/ ni api/.',
    user_agent: userAgent,
    filtros,
    salto_maximo_m: SALTO_MAX_M,
    conteos,
    lineas,
    nota: 'Recorridos tal como los publica SmartBus en la fecha de captura. Sin frecuencias ni horarios. Las paradas tienen nombres numerados («Cettar - 12»). Coordenadas GeoJSON en orden [lng, lat].',
  };
}

const COLUMNAS_CSV = ['linea', 'empresa', 'ramal', 'id_ruta', 'nombre_ruta', 'sentido', 'orden', 'id_parada', 'nombre_parada', 'lat', 'lon'];

/** → [{ sufijo, contenido }]. csv devuelve además un archivo `.metadata.json` (el CSV no puede llevar el bloque). */
function serializar(formato, { rutas, paradas, metadata }) {
  if (formato === 'geojson') return [{ sufijo: '', contenido: `${JSON.stringify({ type: 'FeatureCollection', metadata, features: [...rutas, ...paradas] })}\n` }];
  if (formato === 'json') {
    const porRuta = new Map();
    for (const p of paradas) {
      const l = porRuta.get(p.properties.id_ruta) || [];
      l.push({ orden: p.properties.orden, id_parada: p.properties.id_parada, nombre: p.properties.nombre, lat: p.geometry.coordinates[1], lon: p.geometry.coordinates[0] });
      porRuta.set(p.properties.id_ruta, l);
    }
    const lista = rutas.map((f) => {
      const { tipo, ...props } = f.properties;
      void tipo;
      return { ...props, geometria: f.geometry, paradas: porRuta.get(f.properties.id_ruta) || [] };
    });
    return [{ sufijo: '', contenido: `${JSON.stringify({ metadata, rutas: lista }, null, 2)}\n` }];
  }
  if (formato === 'csv') {
    const rutaDe = new Map(rutas.map((f) => [f.properties.id_ruta, f.properties]));
    const filas = paradas.map((p) => {
      const r = rutaDe.get(p.properties.id_ruta) || {};
      const [lon, lat] = p.geometry.coordinates;
      return [p.properties.linea, r.empresa, p.properties.ramal, p.properties.id_ruta, r.nombre, r.sentido, p.properties.orden, p.properties.id_parada, p.properties.nombre, lat, lon].map(Salida.celda).join(',');
    });
    return [
      { sufijo: '', contenido: `﻿${[COLUMNAS_CSV.join(','), ...filas].join('\n')}\n` },
      { sufijo: '.metadata.json', contenido: `${JSON.stringify(metadata, null, 2)}\n` },
    ];
  }
  throw new Error(`Formato desconocido: ${formato}`);
}

module.exports = {
  ORIGEN,
  CIUDAD,
  URL_LISTA,
  USO,
  urlDetalle,
  tramos,
  lineaYEmpresa,
  sentidoDe,
  validarLista,
  validarDetalle,
  validarCompletitud,
  seleccionarRutas,
  construir,
  contar,
  crearMetadata,
  serializar,
};
