/**
 * validar-zonificacion-osm.mjs — Validación externa de los polígonos de zonificación con lugares reales.
 *
 * Idea: el plano debe marcar con la zona correspondiente a los lugares cuyo uso se conoce. Se toman
 * hospitales, universidades, parques y aeropuertos de OpenStreetMap (fuente independiente del plano),
 * se ubica cada uno en el plano con el mismo código que usa la aplicación y se mide cuántos caen en la
 * zona que el Reglamento les asigna. Para saber si la tasa es alta o baja se compara con la «base»: la
 * probabilidad de que un punto cualquiera del plano caiga en esa misma zona.
 *
 * Expectativas (cada una sale del Título III del Reglamento del PDM):
 *   hospital     → H     (3.4 Servicios Públicos Complementarios: Salud H-1…H-4)
 *   universidad  → E     (3.4: Educación Superior Universitaria E-3)
 *   parque       → ZR    (3.6 Zonas de Recreación: plazas, parques, campos deportivos…)
 *   aeropuerto   → OU2   (3.5 Usos Especiales tipo 2: terminales terrestres, ferroviarios y aéreos)
 * Los cementerios no se usan: el Reglamento no les asigna una zona, y suponerla sería inventar la expectativa.
 *
 * Qué NO prueba: una discrepancia no siempre es un error del plano. Una clínica privada puede estar en zona
 * comercial, un parque pequeño puede no estar zonificado como ZR, y OpenStreetMap puede tener el lugar mal ubicado.
 * Por eso se reporta la tasa y su comparación con la base, no un aprobado o desaprobado.
 *
 * Uso:   node scripts/validar-zonificacion-osm.mjs [archivo-de-referencia.json]
 * Por defecto lee docs/validacion/osm_referencia.json (referencia guardada: reproducible sin internet).
 * Sale:  docs/validacion/resultado-osm.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(RAIZ, 'public');
const REF = process.argv[2] || join(RAIZ, 'docs', 'validacion', 'osm_referencia.json');
const SALIDA = join(RAIZ, 'docs', 'validacion', 'resultado-osm.json');

const EXPECTATIVAS = {
  hospital: { zonas: ['H'], regla: 'Reglamento 3.4: Salud (H-1 a H-4)' },
  universidad: { zonas: ['E'], regla: 'Reglamento 3.4: Educación Superior Universitaria (E-3)' },
  parque: {
    zonas: ['ZR'],
    regla: 'Reglamento 3.6: Zonas de Recreación (plazas, parques…)',
    // La expectativa se fijó antes de ver el resultado; la tasa salió muy baja y la explicación se encontró después.
    noConcluyente: 'El Reglamento (3.6) indica que las áreas agrícolas zonificadas como ZR mantienen su condición, así que ZR no equivale a «parque»; además OpenStreetMap incluye parques de barrio demasiado pequeños para el plano. Esta prueba no apoya ni contradice la exactitud del plano.',
  },
  aeropuerto: { zonas: ['OU2'], regla: 'Reglamento 3.5: Usos Especiales tipo 2 (terminales aéreos)' },
};

// Se carga el MISMO código del navegador, con un fetch que lee public/.
const ctx = vm.createContext({
  console,
  fetch: async (url) => {
    try {
      const texto = readFileSync(join(PUBLIC, url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(texto) };
    } catch (_) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  },
});
for (const f of ['js/config.js', 'js/geo.js', 'js/zonificacion.js']) vm.runInContext(readFileSync(join(PUBLIC, f), 'utf8'), ctx, { filename: f });
const Zon = vm.runInContext('Zonificacion', ctx);
const CONFIG = vm.runInContext('CONFIG', ctx);
const [oeste, norte, este, sur] = CONFIG.viewbox.split(',').map(Number);

// Distancia en metros de un punto al polígono más cercano de las zonas indicadas (0 si está dentro).
// Se usa para saber si una discrepancia es un punto junto al borde de la zona esperada.
const zonasGeo = JSON.parse(readFileSync(join(PUBLIC, CONFIG.zonificacion.geojsonUrl), 'utf8')).features;
function distanciaAZonas(lat, lon, codigos) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  let mejor = Infinity;
  for (const f of zonasGeo) {
    if (!codigos.includes(f.properties.codigo)) continue;
    const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const anillos of polis) {
      const r = anillos[0];
      for (let i = 0; i < r.length - 1; i++) {
        const ax = (r[i][0] - lon) * mLon, ay = (r[i][1] - lat) * mLat;
        const bx = (r[i + 1][0] - lon) * mLon, by = (r[i + 1][1] - lat) * mLat;
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
        mejor = Math.min(mejor, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return mejor;
}

const ref = JSON.parse(readFileSync(REF, 'utf8'));
console.log(`Referencia OpenStreetMap descargada el ${ref.descargado} (datos OSM al ${ref.baseOsm || 'sin dato'})\n`);

// Base: reparto de zonas para puntos al azar (semilla fija) que caen dentro del plano.
let semilla = 20260101;
const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
const base = {};
let dentroBase = 0;
for (let k = 0; k < 30000; k++) {
  const z = await Zon.lookup(sur + azar() * (norte - sur), oeste + azar() * (este - oeste));
  if (z) { base[z.codigo] = (base[z.codigo] || 0) + 1; dentroBase++; }
}
const probBase = (zonas) => zonas.reduce((t, c) => t + (base[c] || 0), 0) / dentroBase;

const resultado = { referencia: { descargado: ref.descargado, baseOsm: ref.baseOsm }, puntosBase: dentroBase, tipos: {} };
for (const [tipo, exp] of Object.entries(EXPECTATIVAS)) {
  const lista = (ref.tipos[tipo] || []).filter((e) => typeof e.lat === 'number' && typeof e.lon === 'number');
  if (!ref.tipos[tipo]) { console.log(`${tipo}: SIN DATOS en la referencia\n`); resultado.tipos[tipo] = { sinDatos: true }; continue; }
  let dentro = 0;
  let acierta = 0;
  const donde = {};
  const fallos = [];
  for (const e of lista) {
    const z = await Zon.lookup(e.lat, e.lon);
    if (!z) { donde['(fuera del plano)'] = (donde['(fuera del plano)'] || 0) + 1; continue; }
    dentro++;
    donde[z.codigo] = (donde[z.codigo] || 0) + 1;
    if (exp.zonas.includes(z.codigo)) acierta++;
    else fallos.push({ osm: e.id, nombre: e.nombre, lat: e.lat, lon: e.lon, zona: z.codigo, metrosALaZonaEsperada: Math.round(distanciaAZonas(e.lat, e.lon, exp.zonas)) });
  }
  const tasa = dentro ? acierta / dentro : null;
  const pBase = probBase(exp.zonas);
  resultado.tipos[tipo] = { esperado: exp.zonas, regla: exp.regla, noConcluyente: exp.noConcluyente || null, total: lista.length, dentroDelPlano: dentro, enZonaEsperada: acierta, tasa, tasaBase: pBase, veces: tasa !== null && pBase ? tasa / pBase : null, dondeCaen: donde, discrepancias: fallos };
  console.log(`${tipo} (esperado ${exp.zonas.join('/')}; ${exp.regla})`);
  console.log(`  ${lista.length} lugares en OSM, ${dentro} dentro del plano; ${acierta} en la zona esperada = ${tasa === null ? 'sin datos' : (100 * tasa).toFixed(0) + ' %'}`);
  console.log(`  base: ${(100 * pBase).toFixed(1)} % de los puntos del plano caen en ${exp.zonas.join('/')}${tasa !== null && pBase ? ` → el acierto es ${(tasa / pBase).toFixed(1)} veces la base` : ''}`);
  if (fallos.length) {
    const cerca = fallos.filter((f) => f.metrosALaZonaEsperada <= 50).length;
    console.log(`  discrepancias a ≤ 50 m de un polígono de la zona esperada: ${cerca} de ${fallos.length}`);
  }
  if (exp.noConcluyente) console.log(`  NO CONCLUYENTE: ${exp.noConcluyente}`);
  console.log(`  dónde caen: ${Object.entries(donde).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ')}\n`);
}
writeFileSync(SALIDA, JSON.stringify(resultado, null, 2));
console.log(`Resultado guardado en ${SALIDA}`);
