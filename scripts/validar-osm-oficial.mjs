/**
 * validar-osm-oficial.mjs — K2: contrasta el equipamiento de OpenStreetMap (ya congelado en public/data/equipamiento) con los
 * registros oficiales de salud (RENIPRESS) y de educación (padrón de ESCALE). NO descarga nada: los dos archivos CSV los
 * descarga la persona a mano (docs/VALIDACION.md dice dónde) y se pasan como argumentos.
 *
 * Uso:
 *   node scripts/validar-osm-oficial.mjs --escale=ruta/padron_escale.csv --renipress=ruta/renipress.csv [opciones]
 *   pnpm datos:validar-oficial -- --escale=... --renipress=...
 *
 * Opciones:
 *   --radios=50,100,200        radios (m) a barrer para emparejar por distancia (por defecto 50, 100 y 200)
 *   --umbral-nombre=0.9        parecido mínimo de nombres, de 0 a 1 (por defecto 0,9)
 *   --paso=500                 separación (m) de la malla de puntos para medir el cambio cumple / no cumple (por defecto 500)
 *   --incluir-consultorios     no excluir de RENIPRESS los consultorios (por defecto se excluyen)
 *   --fecha-renipress=TEXTO    edición del archivo de RENIPRESS (p. ej. 2026-09), para dejarla en el informe
 *   --fecha-escale=TEXTO       fecha del padrón de ESCALE
 *   --salida=ruta.json         además del informe en pantalla, guarda el resultado completo en JSON
 *   --min-exhaustividad=0.85 / --min-precision=0.85   criterios de aceptación fijados ANTES de medir (opcional): el informe dice si se cumplen
 *
 * Qué hace (docs/INVESTIGACION-VARIABLES.md §5.1): filtra Arequipa metropolitana, deduplica ESCALE por código de local, empareja con
 * OSM por parecido de nombre y distancia, y reporta exhaustividad, precisión, desfase posicional (mediana y percentil 90) y en
 * cuántos puntos de la malla cambia CUMPLE / NO CUMPLE con los umbrales de la ficha. Sale con código 1 si falta un argumento
 * o un archivo no tiene las columnas esperadas.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const V = require('./lib/validacion-oficial.js');
const Calculos = require('../public/js/calculos.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function argumentos(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
    else if (a !== '--') out._.push(a);
  }
  return out;
}

function uso(mensaje) {
  if (mensaje) console.error(`\n${mensaje}\n`);
  console.error('Uso: node scripts/validar-osm-oficial.mjs --escale=padron_escale.csv --renipress=renipress.csv [--radios=50,100,200] [--umbral-nombre=0.9] [--paso=500] [--salida=resultado.json]');
  console.error('Los CSV se descargan a mano; mira docs/VALIDACION.md para saber dónde.');
  process.exit(1);
}

/** Lee un CSV como texto: UTF-8 y, si trae caracteres de reemplazo (archivo en Latin-1), Latin-1. */
function leerTexto(ruta) {
  let buf;
  try { buf = readFileSync(ruta); } catch (err) { uso(`No pude leer «${ruta}»: ${err.message}`); }
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

const json = (ruta) => JSON.parse(readFileSync(join(RAIZ, ruta), 'utf8'));

function main() {
  const a = argumentos(process.argv.slice(2));
  const rutaEscale = a.escale || a._[0];
  const rutaRenipress = a.renipress || a._[1];
  if (!rutaEscale || !rutaRenipress) uso('Faltan los dos archivos: el padrón de ESCALE y el CSV de RENIPRESS.');
  const radiosM = a.radios ? String(a.radios).split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0) : [50, 100, 200];
  const umbralNombre = a['umbral-nombre'] ? Number(a['umbral-nombre']) : 0.9;
  const paso = a.paso ? Number(a.paso) : 500;
  if (!radiosM.length || !(umbralNombre > 0 && umbralNombre <= 1) || !(paso >= 50)) uso('Opciones inválidas: --radios (metros), --umbral-nombre (0 a 1) o --paso (50 o más).');

  // Los umbrales son los de la ficha (public/js/config.js).
  const ctx = vm.createContext({});
  vm.runInContext(`${readFileSync(join(RAIZ, 'js', 'config.js'), 'utf8')}\nglobalThis.__CONFIG = CONFIG;`, ctx, { filename: 'config.js' });
  const umbrales = ctx.__CONFIG.umbrales;

  let renipress;
  let escale;
  try {
    renipress = V.leerRenipress(leerTexto(rutaRenipress), { incluirConsultorios: Boolean(a['incluir-consultorios']) });
    escale = V.leerEscale(leerTexto(rutaEscale));
  } catch (err) {
    uso(err.message);
  }
  if (renipress.registros.length === 0 || escale.locales.length === 0) uso(`Después de filtrar Arequipa metropolitana quedaron ${renipress.registros.length} establecimientos de RENIPRESS y ${escale.locales.length} locales de ESCALE: revisa que sean los archivos correctos y que traigan latitud y longitud.`);

  // OpenStreetMap congelado: salud y colegios (con sus niveles, inferidos como en la ficha).
  const fcSalud = json('data/equipamiento/salud.geojson');
  const fcEdu = json('data/equipamiento/educacion.geojson');
  const puntoDe = (f) => (f.geometry && f.geometry.type === 'Point' ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] } : null);
  const osmSalud = fcSalud.features.map((f) => ({ f, p: puntoDe(f) })).filter((x) => x.p).map(({ f, p }) => ({ id: f.properties.osm, nombre: f.properties.nombre || '', ...p }));
  const osmEducacion = fcEdu.features.map((f) => ({ f, p: puntoDe(f) })).filter((x) => x.p)
    .map(({ f, p }) => ({ id: f.properties.osm, nombre: f.properties.nombre || '', niveles: Calculos.nivelesEducativos(f.properties.tags), ...p }))
    .filter((e) => e.niveles.length > 0);

  // Malla de puntos dentro del plano de zonificación (donde se usa la ficha).
  const zonas = json('data/zonas_aqp.geojson').features.map((f) => {
    const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const pts = polis.flatMap((p) => p[0]);
    return { polis, caja: [Math.min(...pts.map((c) => c[0])), Math.min(...pts.map((c) => c[1])), Math.max(...pts.map((c) => c[0])), Math.max(...pts.map((c) => c[1]))] };
  });
  const dentroDelPlano = (lat, lon) => zonas.some((z) => lon >= z.caja[0] && lon <= z.caja[2] && lat >= z.caja[1] && lat <= z.caja[3] && z.polis.some((anillos) => Calculos.puntoEnPoligono(lat, lon, anillos)));
  const puntos = V.malla(V.CAJA_AREQUIPA, paso, dentroDelPlano);

  const resultado = V.validar({ renipress, escale, osmSalud, osmEducacion, puntos, umbrales, radiosM, umbralNombre });
  const texto = V.informe(resultado, {
    renipress,
    escale,
    meta: {
      renipress: `${rutaRenipress}${a['fecha-renipress'] ? ` (edición ${a['fecha-renipress']})` : ' (anota la edición con --fecha-renipress)'}`,
      escale: `${rutaEscale}${a['fecha-escale'] ? ` (${a['fecha-escale']})` : ' (anota la fecha con --fecha-escale)'}`,
      osm: `copia congelada en public/data/equipamiento, extraída el ${fcSalud.metadata.fecha_extraccion} (base de OSM del ${String(fcSalud.metadata.osm_base).slice(0, 10)}); malla de ${puntos.length} puntos cada ${paso} m dentro del plano de zonificación`,
    },
  });
  console.log(texto);

  // Criterios de aceptación (opcionales): se fijan antes de medir.
  const minE = a['min-exhaustividad'] ? Number(a['min-exhaustividad']) : null;
  const minP = a['min-precision'] ? Number(a['min-precision']) : null;
  if (minE !== null || minP !== null) {
    const m = (x) => x.metricas[x.metricas.length - 1];
    const filas = [['Salud', m(resultado.salud)], ['Educación', m(resultado.educacion)]];
    console.log(`\nCriterios de aceptación fijados (radio de ${radiosM[radiosM.length - 1]} m):`);
    for (const [n, x] of filas) {
      const okE = minE === null || (x.exhaustividad !== null && x.exhaustividad >= minE);
      const okP = minP === null || (x.precision !== null && x.precision >= minP);
      console.log(`  ${n}: ${okE && okP ? 'CUMPLE' : 'NO CUMPLE'}${minE !== null ? ` · exhaustividad ${(100 * (x.exhaustividad ?? 0)).toFixed(1)} % frente a ${(100 * minE).toFixed(0)} %` : ''}${minP !== null ? ` · precisión ${(100 * (x.precision ?? 0)).toFixed(1)} % frente a ${(100 * minP).toFixed(0)} %` : ''}`);
    }
  }
  if (a.salida && a.salida !== true) {
    writeFileSync(String(a.salida), JSON.stringify({ generado: new Date().toISOString(), parametros: { radiosM, umbralNombre, paso }, resultado }, null, 2));
    console.log(`\nResultado completo guardado en ${a.salida}`);
  }
}

main();
