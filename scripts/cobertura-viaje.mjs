/**
 * cobertura-viaje.mjs — Cuánta de la ciudad tiene un viaje en combi o bus a un destino: directo, con un trasbordo o ninguno, y cuánto tarda la búsqueda desde cualquier origen.
 * Escribe docs/validacion/cobertura-viaje.json (línea base que comprueba `pnpm datos:verificar`) y imprime el informe.
 *
 * Uso:   node scripts/cobertura-viaje.mjs
 *
 * Qué hace: una rejilla de orígenes cada 500 m sobre el área urbana zonificada de los 25 distritos (scripts/lib/cobertura-viaje.js: puntos dentro de una zona edificable o
 * condicionada del plano del PDM y de un distrito), y para cada destino de CONFIG.destinos que se pide (Parque Industrial, Plaza de Armas, Real Plaza, Mall Aventura Plaza y la UNSA)
 * clasifica cada origen con las mismas funciones del navegador (Viaje.rutasDirectas y Viaje.rutasConTrasbordo, 400 m a pie y 200 m de trasbordo). Mide el tiempo de cada búsqueda
 * (con el destino ya preparado, como en el navegador cuando se repite el destino, y sin prepararlo) y lista dónde no hay solución y por qué.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(RAIZ, 'public');
const json = (r) => JSON.parse(readFileSync(join(PUBLIC, r), 'utf8'));

const ctx = vm.createContext({});
vm.runInContext(`${readFileSync(join(PUBLIC, 'js', 'config.js'), 'utf8')}\nglobalThis.__CONFIG = CONFIG;`, ctx);
const CONFIG = ctx.__CONFIG;
globalThis.Calculos = require('../public/js/calculos.js');
const Viaje = require('../public/js/viaje.js');
const Cob = require('./lib/cobertura-viaje.js');

const IDS = ['parque-industrial', 'plaza-de-armas', 'real-plaza', 'mall-aventura', 'unsa'];
const p95 = (v) => v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(0.95 * v.length))];
const redondear = (x) => Math.round(x * 100) / 100;

const rutas = Viaje.desdeOsm(json('data/rutas_osm.geojson'));
const celdas = Cob.celdasUrbanas({ zonas: json('data/zonas_aqp.geojson'), reglas: json('data/reglas_zonas.json'), distritos: json('data/distritos_aqp.geojson'), pasoM: 500 });
console.log(`Orígenes: ${celdas.length} puntos cada 500 m en zonas edificables o condicionadas de ${new Set(celdas.map((c) => c.distrito)).size} distritos; ${rutas.length} rutas.`);
Viaje.rutasDirectas({ lat: -16.4, lon: -71.5 }, { lat: -16.41, lon: -71.52 }, rutas, {}); // densifica todos los trazados una vez

const salida = { generado: new Date().toISOString().slice(0, 10), pasoM: 500, origenes: celdas.length, caminarM: CONFIG.viaje.caminarM, trasbordoM: CONFIG.viaje.trasbordoM, destinos: {} };
for (const id of IDS) {
  const d = CONFIG.destinos.find((x) => x.id === id);
  const destino = { lat: d.lat, lon: d.lon };
  const opciones = { caminarM: CONFIG.viaje.caminarM, trasbordoM: CONFIG.viaje.trasbordoM, tiempo: CONFIG.viaje.tiempo };
  const preparado = Viaje.prepararDestinoTrasbordo(destino, rutas, opciones);
  const tiempos = [];
  const filas = celdas.map((c) => {
    const t0 = performance.now();
    const r = Cob.clasificar({ lat: c.lat, lon: c.lon }, destino, rutas, { ...opciones, preparado });
    tiempos.push(performance.now() - t0);
    return { ...c, ...r };
  });
  // Tiempo de una búsqueda COMPLETA (los cinco mejores trasbordos, sin destino preparado) desde cada origen sin directa: lo que pasa la primera vez con un destino.
  const completos = [];
  filas.filter((f) => f.estado !== 'directa').slice(0, 400).forEach((f) => {
    const t0 = performance.now();
    Viaje.rutasConTrasbordo({ lat: f.lat, lon: f.lon }, destino, rutas, { ...opciones, max: 5 });
    completos.push(performance.now() - t0);
  });
  const r = Cob.resumir(filas);
  const sin = filas.filter((f) => f.estado === 'ninguna');
  const porMotivo = {};
  sin.forEach((f) => { const k = `${f.distrito}|${f.motivo}`; (porMotivo[k] = porMotivo[k] || []).push(f); });
  salida.destinos[id] = {
    nombre: d.nombre, directa: r.directa, trasbordo: r.trasbordo, ninguna: r.ninguna, pctDirecta: Math.round((100 * r.directa) / r.total), pctConSolucion: r.pctConSolucion,
    porDistrito: r.porDistrito, motivos: r.motivos,
    tiempoMs: { clasificar: { p95: redondear(p95(tiempos)), max: redondear(Math.max(...tiempos)), media: redondear(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) }, busquedaCompleta: { p95: redondear(p95(completos)), max: redondear(Math.max(...completos)), muestras: completos.length } },
    sinSolucion: Object.entries(porMotivo).map(([k, v]) => ({ distrito: k.split('|')[0], motivo: k.split('|')[1], celdas: v.length, ejemplo: { lat: redondear(v[0].lat * 1e3) / 1e3, lon: redondear(v[0].lon * 1e3) / 1e3 } })).sort((a, b) => b.celdas - a.celdas),
    peoresOrigenes: filas.map((f, i) => ({ lat: f.lat, lon: f.lon, ms: tiempos[i] })).sort((a, b) => b.ms - a.ms).slice(0, 3).map((x) => ({ lat: Number(x.lat.toFixed(5)), lon: Number(x.lon.toFixed(5)), ms: redondear(x.ms) })),
  };
  const s = salida.destinos[id];
  console.log(`\n## ${d.nombre}: directa ${s.directa} (${s.pctDirecta} %), con un trasbordo ${s.trasbordo}, ninguna ${s.ninguna}; con solución ${s.pctConSolucion} % | búsqueda p95 ${s.tiempoMs.clasificar.p95} ms, máx ${s.tiempoMs.clasificar.max} ms (clasificar); completa p95 ${s.tiempoMs.busquedaCompleta.p95} ms, máx ${s.tiempoMs.busquedaCompleta.max} ms`);
  console.log(`   motivos: ${JSON.stringify(s.motivos)}`);
}
mkdirSync(join(RAIZ, 'docs', 'validacion'), { recursive: true });
writeFileSync(join(RAIZ, 'docs', 'validacion', 'cobertura-viaje.json'), `${JSON.stringify(salida, null, 1)}\n`);
console.log('\nEscrito docs/validacion/cobertura-viaje.json');
