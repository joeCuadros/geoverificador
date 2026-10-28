/**
 * extraer-equipamiento.mjs — Extrae de OpenStreetMap el equipamiento de Arequipa metropolitana y lo congela en
 * archivos GeoJSON locales, para que las variables de salud, educación, transporte y área verde sean reproducibles:
 * la aplicación lee estos archivos y solo consulta Overpass en vivo si falta alguno.
 *
 * Uso:   node scripts/extraer-equipamiento.mjs      (o: pnpm datos:extraer)
 * Sale:  public/data/equipamiento/{salud,educacion,transporte,areas_verdes}.geojson
 *
 * Decisiones:
 *  - UNA sola consulta a Overpass para toda la caja (la de CONFIG.viewbox), no una por categoría: es lo que pide la
 *    política de uso del servicio público. Luego los elementos se reparten por variable con las mismas reglas que usa
 *    el navegador (Calculos.categoriasDe), así que consulta y clasificación nunca se desincronizan.
 *  - Las etiquetas que entran en cada variable están en Calculos.FILTROS (public/js/calculos.js).
 *  - Salud, educación y transporte se guardan como puntos (nodo, o el centro de la vía o relación); las áreas verdes
 *    como polígonos (ensamblando las relaciones multipolígono), porque de ellas se calcula el área y la distancia al borde.
 *  - Solo se conservan el nombre y las etiquetas necesarias, con 5 decimales (≈ 1 m): archivos pequeños.
 *  - Si el servidor falla, reintenta con espera creciente; si sigue fallando, prueba el espejo de respaldo.
 *    Si una categoría queda vacía el script falla en vez de guardar datos incompletos.
 *  - Los datos son © colaboradores de OpenStreetMap, licencia ODbL.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const Calculos = createRequire(import.meta.url)(join(raiz, 'public', 'js', 'calculos.js'));

// ------------------------------------------------------------------ CONFIGURACIÓN
// Misma caja que CONFIG.viewbox (oeste, norte, este, sur = -71.75,-16.20,-71.35,-16.60). Overpass pide sur, oeste, norte, este.
const BBOX = [-16.6, -71.75, -16.2, -71.35];
const SERVIDORES = [
  { etiqueta: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter', intentos: 4 },
  { etiqueta: 'overpass.kumi.systems (respaldo)', url: 'https://overpass.kumi.systems/api/interpreter', intentos: 3 },
];
const ESPERA_BASE_MS = 8000; // espera creciente entre intentos: 8 s, 16 s, 24 s…
const TIMEOUT_CLIENTE_MS = 300000;
const SALIDA = join(raiz, 'public', 'data', 'equipamiento');
const FUENTE = 'OpenStreetMap (ODbL)';

// ------------------------------------------------------------------ CONSULTA
function construirConsulta() {
  const caja = `(${BBOX.join(',')})`;
  const puntos = ['salud', 'educacion', 'transporte'].flatMap((cat) => Calculos.selectoresOverpass(cat).map((s) => `  nwr${s}${caja};`));
  const verdes = Calculos.selectoresOverpass('areasVerdes').flatMap((s) => [`  way${s}${caja};`, `  relation${s}${caja};`]);
  return [
    '[out:json][timeout:240][maxsize:1073741824];',
    '(',
    ...puntos,
    ')->.puntos;',
    '.puntos out center tags;',
    '(',
    ...verdes,
    ')->.verdes;',
    '.verdes out geom tags;',
  ].join('\n');
}

// ------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultar(url, consulta) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'geoverificador-extraer-equipamiento/1.0' },
    body: `data=${encodeURIComponent(consulta)}`,
    signal: AbortSignal.timeout(TIMEOUT_CLIENTE_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(`Overpass reportó: ${data.remark}`);
  if (!Array.isArray(data.elements)) throw new Error('la respuesta no trae `elements`');
  return data;
}

async function obtener(consulta) {
  const fallos = [];
  for (const s of SERVIDORES) {
    for (let i = 1; i <= s.intentos; i++) {
      try {
        console.log(`Consultando ${s.etiqueta} (intento ${i}/${s.intentos})…`);
        return { data: await consultar(s.url, consulta), servidor: s.url };
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

// ------------------------------------------------------------------ SALIDA
async function guardar(nombre, features, metadata) {
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata: { ...metadata, registros: features.length } }).slice(0, -1);
  const cuerpo = `${cabecera},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  await writeFile(join(SALIDA, `${nombre}.geojson`), cuerpo);
  console.log(`  ${nombre}.geojson: ${features.length} elementos, ${(Buffer.byteLength(cuerpo) / 1024).toFixed(0)} kB`);
}

async function main() {
  const consulta = construirConsulta();
  const { data, servidor } = await obtener(consulta);
  const fecha = new Date().toISOString().slice(0, 10);
  const metadata = {
    fuente: FUENTE,
    fecha_extraccion: fecha,
    consulta,
    osm_base: data.osm3s?.timestamp_osm_base ?? null,
    servidor,
    caja: { sur: BBOX[0], oeste: BBOX[1], norte: BBOX[2], este: BBOX[3] },
  };

  // Elementos de la primera salida (con `center`) y de la segunda (con `geometry`/`members`).
  const puntos = Calculos.osmAFeatures(data.elements.filter((e) => e.type === 'node' || e.center), 'puntos');
  const poligonos = Calculos.osmAFeatures(data.elements.filter((e) => e.type !== 'node' && (e.geometry || e.members)), 'poligonos')
    .filter((f) => Calculos.categoriasDe(f.properties.tags).includes('areasVerdes'));

  const porVariable = {
    salud: puntos.filter((f) => Calculos.categoriasDe(f.properties.tags).includes('salud')),
    educacion: puntos.filter((f) => Calculos.categoriasDe(f.properties.tags).includes('educacion')),
    transporte: puntos.filter((f) => Calculos.categoriasDe(f.properties.tags).includes('transporte')),
    areas_verdes: poligonos,
  };
  metadata.sin_geometria_utilizable = data.elements.length - puntos.length - poligonos.length;
  const vacias = Object.entries(porVariable).filter(([, f]) => f.length === 0).map(([n]) => n);
  if (vacias.length) throw new Error(`Sin resultados para: ${vacias.join(', ')}. No se guardó nada.`);

  await mkdir(SALIDA, { recursive: true });
  console.log(`\nDatos de OSM al ${metadata.osm_base ?? 's. d.'}; extracción del ${fecha}. Elementos sin geometría utilizable (p. ej. relaciones sin cerrar): ${metadata.sin_geometria_utilizable}.`);
  for (const [nombre, features] of Object.entries(porVariable)) await guardar(nombre, features, metadata);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
