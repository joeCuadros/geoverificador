/**
 * descargar-servicios-osm.mjs — Congela tres necesidades INFORMATIVAS de la vida diaria de Arequipa metropolitana a partir de OpenStreetMap (sin umbral: no entran en el puntaje
 * ni en la búsqueda de zonas), en los archivos que lee la aplicación:
 *   public/data/equipamiento/finanzas.geojson       amenity=bank (bancos) y amenity=atm (cajeros automáticos)
 *   public/data/equipamiento/comida_fuera.geojson   amenity=restaurant (restaurantes) y amenity=cafe (cafés)
 *   public/data/equipamiento/recreacion.geojson     leisure=playground (áreas de juegos infantiles)
 * Los parques y jardines (leisure=park, garden) NO se descargan aquí: ya son el criterio «área verde» (areas_verdes.geojson) y repetirlos sería contarlos dos veces.
 *
 * Uso:   node scripts/descargar-servicios-osm.mjs      (o: pnpm datos:servicios)
 * Opciones:  --refrescar   vuelve a consultar Overpass aunque la respuesta esté en la caché (.cache-servicios/)
 *            --radio=150   radio (m) con el que se juntan los elementos del mismo tipo y nombre que son el mismo lugar (por omisión 150)
 *
 * Qué hace: UNA consulta a Overpass para toda la caja (la de CONFIG.viewbox), con tiempo máximo y reintentos de espera creciente; solo se conserva lo que cae dentro de los
 * distritos (public/data/distritos_aqp.geojson); el mismo lugar mapeado dos veces cuenta una, sin mezclar un banco con su cajero (scripts/lib/servicios-osm.js). Cada elemento
 * lleva `fuente` (OSM), `osm`, `nombre`, `tags` y `tipo`. `metadata` lleva la consulta, la fecha, la base de OSM, la licencia, los conteos y lo que el dato no dice.
 * Si algo falla (red, formato, necesidad vacía) NO se escribe nada y se sale con código 1. Nunca se inventan ni se rellenan datos.
 * Los datos de OpenStreetMap son © colaboradores de OpenStreetMap, licencia ODbL.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Calculos = require('../public/js/calculos.js');
const S = require('./lib/servicios-osm.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATOS = join(RAIZ, 'public', 'data');
const SALIDA = join(DATOS, 'equipamiento');
const CACHE = join(RAIZ, '.cache-servicios');
const BBOX = [-16.6, -71.75, -16.2, -71.35]; // sur, oeste, norte, este (CONFIG.viewbox)
const SERVIDORES = [
  { etiqueta: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter', intentos: 2 },
  { etiqueta: 'overpass.openstreetmap.fr (respaldo)', url: 'https://overpass.openstreetmap.fr/api/interpreter', intentos: 2 },
  { etiqueta: 'overpass.kumi.systems (respaldo)', url: 'https://overpass.kumi.systems/api/interpreter', intentos: 1 },
];
const ESPERA_BASE_MS = 8000;
const TIMEOUT_CLIENTE_MS = 300000;
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico)';

const REGLAS = {
  finanzas:
    'Elementos de OpenStreetMap con amenity=bank (bancos) o amenity=atm (cajeros automáticos), puntos y polígonos, dentro de los distritos (public/data/distritos_aqp.geojson). ' +
    'OSM no distingue una agencia de un cajero corresponsal o de un cajero dentro de una tienda. Un mismo lugar mapeado dos veces se cuenta una; un banco y un cajero con el mismo nombre son dos.',
  comida_fuera:
    'Elementos de OpenStreetMap con amenity=restaurant (restaurantes) o amenity=cafe (cafés), puntos y polígonos, dentro de los distritos. No incluye la comida al paso (amenity=fast_food) ni los bares. ' +
    'No dice la calidad, el precio ni el horario. Un mismo local mapeado dos veces se cuenta una.',
  recreacion:
    'Elementos de OpenStreetMap con leisure=playground (áreas de juegos infantiles), puntos y polígonos, dentro de los distritos. Los parques y jardines (leisure=park, garden) no se cuentan aquí: ' +
    'son el criterio «área verde». Un área de juegos suele estar dentro de un parque.',
};

function argumentos(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultarOverpass(url, consulta) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': USER_AGENT },
    body: `data=${encodeURIComponent(consulta)}`,
    signal: AbortSignal.timeout(TIMEOUT_CLIENTE_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(`Overpass reportó: ${data.remark}`);
  if (!Array.isArray(data.elements)) throw new Error('la respuesta no trae `elements`');
  return data;
}

async function obtenerOverpass(consulta, refrescar) {
  const hash = createHash('sha1').update(consulta).digest('hex');
  const ruta = join(CACHE, 'overpass-servicios.json');
  if (existsSync(ruta) && !refrescar) {
    const guardado = JSON.parse(readFileSync(ruta, 'utf8'));
    if (guardado.hash === hash) {
      console.log(`Overpass: respuesta en la caché (${guardado.fecha_consulta}); usa --refrescar para volver a consultar.`);
      return guardado;
    }
    console.log('Overpass: la consulta cambió; se vuelve a consultar.');
  }
  const fallos = [];
  for (const s of SERVIDORES) {
    for (let i = 1; i <= s.intentos; i++) {
      try {
        console.log(`Consultando ${s.etiqueta} (intento ${i}/${s.intentos})…`);
        const data = await consultarOverpass(s.url, consulta);
        const guardado = { hash, fecha_consulta: new Date().toISOString().slice(0, 10), servidor: s.url, osm_base: data.osm3s?.timestamp_osm_base ?? null, elements: data.elements };
        await mkdir(CACHE, { recursive: true });
        await writeFile(ruta, JSON.stringify(guardado));
        return guardado;
      } catch (err) {
        const causa = err?.cause?.code || err.message;
        fallos.push(`${s.etiqueta} intento ${i}: ${causa}`);
        console.warn(`  falló: ${causa}`);
        if (i < s.intentos) await esperar(ESPERA_BASE_MS * i);
      }
    }
  }
  throw new Error(`Overpass no respondió tras todos los intentos:\n  ${fallos.join('\n  ')}`);
}

function cargarDistritos() {
  const fc = JSON.parse(readFileSync(join(DATOS, 'distritos_aqp.geojson'), 'utf8'));
  const zonas = fc.features.map((f) => {
    const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const pts = polis.flatMap((p) => p[0]);
    return { polis, caja: [Math.min(...pts.map((c) => c[0])), Math.min(...pts.map((c) => c[1])), Math.max(...pts.map((c) => c[0])), Math.max(...pts.map((c) => c[1]))] };
  });
  return (lat, lon) => zonas.some((z) => lon >= z.caja[0] && lon <= z.caja[2] && lat >= z.caja[1] && lat <= z.caja[3] && z.polis.some((anillos) => Calculos.puntoEnPoligono(lat, lon, anillos)));
}

const comoSalida = (f) => {
  const { categoria: _c, ...props } = f.properties;
  return { type: 'Feature', properties: { fuente: 'OSM', ...props }, geometry: f.geometry };
};

async function guardar(nombre, features, metadata) {
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata }).slice(0, -1);
  const cuerpo = `${cabecera},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  await writeFile(join(SALIDA, `${nombre}.geojson`), cuerpo);
  console.log(`  ${nombre}.geojson: ${features.length} elementos, ${(Buffer.byteLength(cuerpo) / 1024).toFixed(0)} kB`);
}

async function main() {
  const a = argumentos(process.argv.slice(2));
  const radioM = a.radio ? Number(a.radio) : 150;
  if (!(radioM > 0)) throw new Error('--radio debe ser un número de metros mayor que 0.');
  mkdirSync(CACHE, { recursive: true });

  const consulta = S.construirConsulta(BBOX);
  const osm = await obtenerOverpass(consulta, a.refrescar);
  const dentroDeDistritos = cargarDistritos();

  const conv = S.convertir(osm.elements);
  console.log(`\nOSM: ${osm.elements.length} elementos; ${conv.features.length} clasificados; ${conv.sinGeometria} sin geometría utilizable (vías o relaciones sin cerrar); ${conv.sinCategoria} sin categoría.`);
  const dentro = S.enDistritos(conv.features, dentroDeDistritos);
  console.log(`  dentro de los distritos: ${dentro.length} (fuera de ellos: ${conv.features.length - dentro.length}).`);

  const por = {};
  for (const cat of S.CATEGORIAS) {
    const propios = dentro.filter((f) => f.properties.categoria === cat);
    const d = S.deduplicarPorTipo(propios, { radioM });
    por[cat] = { crudos: propios.length, ...d };
  }
  const vacias = S.CATEGORIAS.filter((c) => por[c].features.length === 0);
  if (vacias.length) throw new Error(`Sin resultados para: ${vacias.join(', ')}. No se escribió nada.`);

  const base = {
    fuente: 'OpenStreetMap (ODbL)',
    fecha_extraccion: osm.fecha_consulta,
    osm_base: osm.osm_base,
    servidor: osm.servidor,
    consulta,
    caja: { sur: BBOX[0], oeste: BBOX[1], norte: BBOX[2], este: BBOX[3] },
    licencia: 'ODbL',
    url_licencia: 'https://www.openstreetmap.org/copyright',
    atribucion: '© colaboradores de OpenStreetMap',
    informativo: 'Sin umbral: variable informativa, no entra en el puntaje ni en la búsqueda de zonas del asistente.',
    generado: new Date().toISOString().slice(0, 10),
    sin_geometria_utilizable: conv.sinGeometria,
  };
  await mkdir(SALIDA, { recursive: true });
  console.log('\nEscribiendo:');
  for (const cat of S.CATEGORIAS) {
    const feats = por[cat].features.map(comoSalida);
    const conteoTipos = feats.reduce((o, f) => { o[f.properties.tipo] = (o[f.properties.tipo] || 0) + 1; return o; }, {});
    await guardar(cat, feats, {
      ...base,
      categoria: cat,
      regla: REGLAS[cat],
      registros: feats.length,
      conteo_por_fuente: { OSM: feats.length },
      conteo_por_tipo: conteoTipos,
      conteo_por_geometria: { punto: feats.filter((f) => f.geometry.type === 'Point').length, poligono: feats.filter((f) => f.geometry.type !== 'Point').length },
      deduplicacion: { radio_m: radioM, elementos_antes: por[cat].crudos, descartados: por[cat].descartados },
    });
  }
  for (const cat of S.CATEGORIAS) console.log(`${cat}: ${por[cat].features.length} (de ${por[cat].crudos}; ${por[cat].descartados} repetidos)`);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
