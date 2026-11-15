/**
 * rutas-osm.js — Lógica pura (sin red ni archivos) detrás de scripts/descargar-rutas-osm.mjs: las rutas de bus de la red SIT de Arequipa que
 * OpenStreetMap tiene como relaciones route=bus. La usan ese script y test/rutas-osm.spec.ts.
 *
 *   construirConsulta(caja)        → UNA consulta a Overpass con las relaciones y la geometría de sus vías (out geom)
 *   ensamblar(miembros, opciones)  → { partes, saltos }: las vías de la relación, en el orden de la relación y orientadas una tras otra
 *   convertir(relaciones)          → { features, descartadas, conSaltos }: una Feature por relación con sus etiquetas
 *   lineaDe(operador)              → «C3» de «C3 - Transcayma»
 *
 * Qué trae OSM aquí y qué no: cada relación es UN sentido de un ramal (ref), con de dónde a dónde (from / to), el operador, a veces la duración (minutos),
 * el intervalo (minutos), el horario y la tarifa. Las vías son el trazado: NO hay paradas en las relaciones (ningún miembro con rol stop o platform).
 */
const Calculos = require('../../public/js/calculos.js');

const TIPOS = 'bus|share_taxi|minibus|trolleybus';

function construirConsulta(caja, timeoutS = 240) {
  return [`[out:json][timeout:${timeoutS}][maxsize:1073741824];`, `relation["type"="route"]["route"~"^(${TIPOS})$"](${caja.join(',')});`, 'out geom;'].join('\n');
}

const lineasDe = (m) => (m.type === 'way' && Array.isArray(m.geometry) && m.geometry.length >= 2 ? m.geometry.map((p) => [p.lon, p.lat]) : null);
const dist = (a, b) => Calculos.haversine(a[1], a[0], b[1], b[0]);

/**
 * Las vías de una relación vienen en el orden de la relación pero cada una puede estar dibujada en cualquier sentido. Se encadenan: la primera se orienta
 * para que su final quede junto al comienzo de la segunda, y cada siguiente se orienta para empezar donde termina el trazado. Si una vía no conecta
 * (su extremo más cercano queda a más de `saltoMaxM`), se abre otra parte y se anota el salto: no se unen con una recta inventada.
 */
function ensamblar(miembros, { saltoMaxM = 300 } = {}) {
  const vias = (miembros || []).map(lineasDe).filter(Boolean);
  const partes = [];
  const saltos = [];
  if (vias.length === 0) return { partes, saltos };
  let actual = null;
  vias.forEach((v, i) => {
    if (!actual) {
      let ini = v;
      if (vias[i + 1]) {
        const sig = vias[i + 1];
        const extremos = [sig[0], sig[sig.length - 1]];
        const dFin = Math.min(...extremos.map((e) => dist(v[v.length - 1], e)));
        const dIni = Math.min(...extremos.map((e) => dist(v[0], e)));
        if (dIni < dFin) ini = [...v].reverse();
      }
      actual = [...ini];
      return;
    }
    const fin = actual[actual.length - 1];
    const dI = dist(fin, v[0]);
    const dF = dist(fin, v[v.length - 1]);
    const orientada = dF < dI ? [...v].reverse() : v;
    const d = Math.min(dI, dF);
    if (d > saltoMaxM) {
      partes.push(actual);
      saltos.push({ despuesDeVia: i, metros: Math.round(d) });
      actual = [...orientada];
    } else {
      actual.push(...(d < 0.5 ? orientada.slice(1) : orientada));
    }
  });
  partes.push(actual);
  return { partes, saltos };
}

/** «C3 - Transcayma» → «C3»; «Albotran» → «Albotran»; vacío → null. */
function lineaDe(operador) {
  const t = String(operador == null ? '' : operador).trim();
  if (!t) return null;
  const m = /^(C-?\d+)\b/i.exec(t);
  return m ? m[1].replace('-', '').toUpperCase() : t.split(/\s+-\s+/)[0].trim();
}

const entero = (v) => (/^\d+$/.test(String(v == null ? '' : v).trim()) ? Number(v) : null);

function convertir(relaciones) {
  const features = [];
  const descartadas = [];
  let conSaltos = 0;
  for (const r of relaciones || []) {
    const t = r.tags || {};
    const osm = `relation/${r.id}`;
    const { partes, saltos } = ensamblar(r.members);
    if (partes.length === 0) { descartadas.push({ osm, motivo: 'la relación no tiene vías con geometría' }); continue; }
    if (saltos.length) conSaltos++;
    features.push({
      type: 'Feature',
      properties: {
        tipo: 'ruta', fuente: 'OSM', osm, linea: lineaDe(t.operator), ramal: t.ref ?? null, nombre: t.name ?? null, desde: t.from ?? null, hasta: t.to ?? null,
        operador: t.operator ?? null, red: t.network ?? null, duracion_min: entero(t.duration), intervalo_min: entero(t.interval), horario: t.opening_hours ?? null,
        tarifa: t.charge ?? null, color: t.colour ?? null, verificado_el: t['survey:date'] ?? null,
      },
      geometry: partes.length === 1 ? { type: 'LineString', coordinates: partes[0] } : { type: 'MultiLineString', coordinates: partes },
    });
  }
  return { features, descartadas, conSaltos };
}

module.exports = { construirConsulta, ensamblar, convertir, lineaDe };
