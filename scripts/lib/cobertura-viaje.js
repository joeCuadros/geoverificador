/**
 * cobertura-viaje.js — Cobertura del viaje en combi o bus sobre toda la ciudad (lógica pura, sin red ni archivos; la usan scripts/cobertura-viaje.mjs, scripts/verificar-datos.mjs
 * y test/cobertura-viaje.spec.ts).
 *
 *   celdasUrbanas({ zonas, reglas, distritos, pasoM, caja }) → [{ lat, lon, distrito }]  una rejilla (500 m por omisión) sobre el área urbana zonificada de los distritos
 *   clasificar(origen, destino, rutas, opciones)             → { estado: 'directa' | 'trasbordo' | 'ninguna', motivo }
 *   resumir(filas)                                           → conteos y porcentajes por estado, por distrito y por motivo
 *
 * «Área urbana zonificada»: los puntos de la rejilla que caen en una zona del plano del PDM cuya regla es edificable («si») o condicionada y dentro de un distrito de
 * distritos_aqp.geojson. Es un universo de ORÍGENES de prueba (dónde podría vivir alguien), no un padrón de viviendas.
 * Motivos de «ninguna»: sin_ruta_cerca_del_origen (ninguna ruta pasa a 400 m), sin_ruta_cerca_del_destino, trasbordo_mas_lejos (habría trasbordo con 400 m entre rutas en lugar de
 * 200) y sin_trasbordo (hay rutas cerca de los dos extremos pero ninguna combinación respeta el sentido, ni a 400 m).
 */
const Calculos = require('../../public/js/calculos.js');
const Viaje = require('../../public/js/viaje.js');

const M_POR_GRADO = (Math.PI / 180) * Calculos.RADIO_TIERRA_M;
const CAJA_ARequipa = { sur: -16.6, oeste: -71.75, norte: -16.2, este: -71.35 };

const poligonosDe = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
function bboxDe(polys) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  polys.forEach((anillos) => (anillos[0] || []).forEach(([x, y]) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }));
  return b;
}
const preparar = (features, nombre) => (features || []).map((f) => { const polys = poligonosDe(f.geometry); return { nombre: nombre(f), polys, bbox: bboxDe(polys) }; }).filter((x) => x.polys.length);
const dentro = (lat, lon, items) => items.find((it) => lon >= it.bbox[0] && lon <= it.bbox[2] && lat >= it.bbox[1] && lat <= it.bbox[3] && it.polys.some((a) => Calculos.puntoEnPoligono(lat, lon, a)));

function celdasUrbanas({ zonas, reglas, distritos, pasoM = 500, caja = CAJA_ARequipa }) {
  const edificables = preparar((zonas && zonas.features) || [], (f) => f.properties.codigo).filter((z) => reglas && reglas[z.nombre] && ['si', 'condicionado'].includes(reglas[z.nombre].edificable));
  const dis = preparar((distritos && distritos.features) || [], (f) => f.properties.distrito);
  const dLat = pasoM / M_POR_GRADO;
  const celdas = [];
  for (let lat = caja.sur + dLat / 2; lat < caja.norte; lat += dLat) {
    const dLon = pasoM / (M_POR_GRADO * Math.cos((lat * Math.PI) / 180));
    for (let lon = caja.oeste + dLon / 2; lon < caja.este; lon += dLon) {
      if (!dentro(lat, lon, edificables)) continue;
      const d = dentro(lat, lon, dis);
      if (d) celdas.push({ lat, lon, distrito: d.nombre });
    }
  }
  return celdas;
}

/** Clasifica un origen frente a un destino: directa, con un trasbordo o ninguna (con el motivo). `opciones`: las de Viaje.rutasDirectas y rutasConTrasbordo, más `preparado`. */
function clasificar(origen, destino, rutas, opciones = {}) {
  const caminarM = opciones.caminarM ?? Viaje.CAMINAR_M;
  const d = Viaje.rutasDirectas(origen, destino, rutas, { caminarM });
  if (d.directas.length) return { estado: 'directa', motivo: null };
  const t = Viaje.rutasConTrasbordo(origen, destino, rutas, { ...opciones, caminarM, max: 1 });
  if (t.trasbordos.length) return { estado: 'trasbordo', motivo: null };
  if (t.candidatasA === 0) return { estado: 'ninguna', motivo: 'sin_ruta_cerca_del_origen' };
  if (t.candidatasB === 0) return { estado: 'ninguna', motivo: 'sin_ruta_cerca_del_destino' };
  const holgado = Viaje.rutasConTrasbordo(origen, destino, rutas, { ...opciones, caminarM, max: 1, trasbordoM: 2 * (opciones.trasbordoM ?? Viaje.TRASBORDO_M), preparado: null });
  return { estado: 'ninguna', motivo: holgado.trasbordos.length ? 'trasbordo_mas_lejos' : 'sin_trasbordo' };
}

const pct = (n, t) => (t ? Math.round((100 * n) / t) : 0);

/** Conteos de filas [{ distrito, estado, motivo }]. */
function resumir(filas) {
  const out = { total: 0, directa: 0, trasbordo: 0, ninguna: 0, pctConSolucion: 0, porDistrito: {}, motivos: {} };
  (filas || []).forEach((f) => {
    out.total++;
    out[f.estado]++;
    const d = out.porDistrito[f.distrito] || (out.porDistrito[f.distrito] = { total: 0, directa: 0, trasbordo: 0, ninguna: 0, pctConSolucion: 0 });
    d.total++;
    d[f.estado]++;
    if (f.motivo) out.motivos[f.motivo] = (out.motivos[f.motivo] || 0) + 1;
  });
  out.pctConSolucion = pct(out.directa + out.trasbordo, out.total);
  Object.values(out.porDistrito).forEach((d) => { d.pctConSolucion = pct(d.directa + d.trasbordo, d.total); });
  return out;
}

module.exports = { celdasUrbanas, clasificar, resumir, CAJA_ARequipa };
