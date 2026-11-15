/**
 * utm.js — UTM (Transversa de Mercator) a latitud y longitud WGS84, sin dependencias. Serie de Krüger en n (Karney, 2011), con la que el error dentro de la zona es de
 * milímetros. Se usa para pasar a WGS84 las coordenadas UTM zona 19 sur (EPSG:32719) del directorio de puntos de acopio de SEDAPAR. test/acopio.spec.ts la compara con PROJ.
 */
const A = 6378137; // semieje mayor WGS84 (m)
const F = 1 / 298.257223563; // aplanamiento WGS84
const K0 = 0.9996;
const E0 = 500000;
const N0_SUR = 10000000;

const n = F / (2 - F);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const RADIO = (A / (1 + n)) * (1 + n2 / 4 + n4 / 64);
const BETA = [
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440,
  (17 * n3) / 480 - (37 * n4) / 840,
  (4397 * n4) / 161280,
];
const DELTA = [
  2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45,
  (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45,
  (56 * n3) / 15 - (136 * n4) / 35,
  (4279 * n4) / 630,
];

/**
 * Pasa una coordenada UTM (norte y este en metros) a { lat, lon } en grados WGS84. `zona` (1 a 60; por omisión 19) y `sur` (hemisferio sur; por omisión true).
 * Lanza un error si el norte o el este no son números finitos: nunca devuelve un número inventado.
 */
function utmAWgs84(norte, este, { zona = 19, sur = true } = {}) {
  if (typeof norte !== 'number' || typeof este !== 'number' || !Number.isFinite(norte) || !Number.isFinite(este)) throw new Error('utmAWgs84: el norte y el este deben ser números finitos');
  const xi = (norte - (sur ? N0_SUR : 0)) / (K0 * RADIO);
  const eta = (este - E0) / (K0 * RADIO);
  let xi1 = xi;
  let eta1 = eta;
  BETA.forEach((b, i) => {
    const j = 2 * (i + 1);
    xi1 -= b * Math.sin(j * xi) * Math.cosh(j * eta);
    eta1 -= b * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let fi = chi;
  DELTA.forEach((d, i) => { fi += d * Math.sin(2 * (i + 1) * chi); });
  const lon0 = (zona * 6 - 183) * (Math.PI / 180);
  const lon = lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return { lat: (fi * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

module.exports = { utmAWgs84 };
