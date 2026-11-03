/**
 * geometria.js — Utilidades geométricas puras para los scripts de descarga (sin red, sin DOM). CommonJS para que las
 * pruebas (test/*.spec.ts) y los scripts .mjs la usen igual.
 *
 *   simplificarLinea(coords, tol)   Douglas-Peucker (iterativo) sobre una lista de [lon, lat]; conserva los extremos.
 *   simplificarAnillo(anillo, tol)  lo mismo para un anillo cerrado; si queda con menos de 4 puntos devuelve null.
 *   recortarLinea(coords, caja)     recorta una línea a la caja [oeste, sur, este, norte]: devuelve una lista de tramos.
 *   recortarGeometria(geom, caja)   LineString/MultiLineString → geometría recortada o null si queda fuera.
 *   redondear(n, decimales)
 */

const redondear = (n, d = 5) => Math.round(n * 10 ** d) / 10 ** d;

/** Distancia (en grados, plano) de un punto a un segmento. Basta para simplificar: la tolerancia es de metros. */
function distSegmento(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker sin recursión (hay polígonos de más de un millón de vértices). */
function simplificarLinea(coords, tol) {
  const n = coords.length;
  if (n <= 2 || !(tol > 0)) return coords.slice();
  const mantener = new Uint8Array(n);
  mantener[0] = 1;
  mantener[n - 1] = 1;
  const pila = [[0, n - 1]];
  while (pila.length) {
    const [i, j] = pila.pop();
    let maxD = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distSegmento(coords[k], coords[i], coords[j]);
      if (d > maxD) { maxD = d; idx = k; }
    }
    if (idx !== -1 && maxD > tol) {
      mantener[idx] = 1;
      pila.push([i, idx], [idx, j]);
    }
  }
  return coords.filter((_, k) => mantener[k]);
}

/** Un anillo cerrado simplificado; null si degenera (menos de 4 puntos, con el cierre). */
function simplificarAnillo(anillo, tol) {
  if (!Array.isArray(anillo) || anillo.length < 4) return null;
  // El anillo cierra en su primer punto: se simplifica la cadena completa y se asegura el cierre.
  const s = simplificarLinea(anillo, tol);
  const a = s[0];
  const z = s[s.length - 1];
  if (a[0] !== z[0] || a[1] !== z[1]) s.push([a[0], a[1]]);
  return s.length >= 4 ? s : null;
}

/** Liang-Barsky: la parte del segmento p→q dentro de la caja, o null. */
function recortarSegmento(p, q, caja) {
  const [oeste, sur, este, norte] = caja;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  const pasos = [[-dx, p[0] - oeste], [dx, este - p[0]], [-dy, p[1] - sur], [dy, norte - p[1]]];
  for (const [pp, qq] of pasos) {
    if (pp === 0) { if (qq < 0) return null; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]];
}

/** Recorta una línea a la caja. Devuelve los tramos que quedan dentro (cada uno con al menos 2 puntos). */
function recortarLinea(coords, caja) {
  const tramos = [];
  let actual = null;
  for (let i = 0; i + 1 < coords.length; i++) {
    const seg = recortarSegmento(coords[i], coords[i + 1], caja);
    if (!seg) { if (actual && actual.length >= 2) tramos.push(actual); actual = null; continue; }
    const [a, b] = seg;
    const sigueContinuo = actual && actual[actual.length - 1][0] === a[0] && actual[actual.length - 1][1] === a[1];
    if (!sigueContinuo) { if (actual && actual.length >= 2) tramos.push(actual); actual = [a]; }
    actual.push(b);
  }
  if (actual && actual.length >= 2) tramos.push(actual);
  return tramos;
}

/** Recorta una geometría LineString o MultiLineString; null si nada queda dentro de la caja. */
function recortarGeometria(geom, caja, decimales = 5) {
  if (!geom) return null;
  const lineas = geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
  const tramos = lineas.flatMap((l) => recortarLinea(l, caja)).map((t) => t.map(([x, y]) => [redondear(x, decimales), redondear(y, decimales)]));
  if (tramos.length === 0) return null;
  return tramos.length === 1 ? { type: 'LineString', coordinates: tramos[0] } : { type: 'MultiLineString', coordinates: tramos };
}

module.exports = { redondear, simplificarLinea, simplificarAnillo, recortarSegmento, recortarLinea, recortarGeometria };
