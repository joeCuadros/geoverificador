/**
 * descargar-educacion-superior.mjs — Universidades e institutos de Arequipa (tarea 4.1 del plan).
 *
 *   pnpm datos:universidades              usa la respuesta en caché si la consulta no cambió
 *   pnpm datos:universidades --refrescar  vuelve a consultar Overpass
 *
 * Fuente de las sedes: OpenStreetMap (ODbL), amenity=university y amenity=college dentro de la caja de la ciudad y de los 25 distritos.
 * Contraste: lista de universidades licenciadas de SUNEDU con sede en Arequipa (scripts/fuentes/sunedu_licenciadas_arequipa.json).
 * Escribe public/data/equipamiento/educacion_superior.geojson. No inventa sedes: si una universidad de la lista no está mapeada, lo dice en los metadatos.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const L = require('./lib/educacion-superior.js');
const Calculos = require('../public/js/calculos.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'data', 'equipamiento', 'educacion_superior.geojson');
const CACHE = join(RAIZ, '.cache-educacion-superior');
const BBOX = [-16.6, -71.75, -16.2, -71.35]; // misma caja que CONFIG.viewbox (sur, oeste, norte, este)
const SERVIDORES = [
  { etiqueta: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter', intentos: 2 },
  { etiqueta: 'overpass.openstreetmap.fr (respaldo)', url: 'https://overpass.openstreetmap.fr/api/interpreter', intentos: 2 },
  { etiqueta: 'overpass.kumi.systems (respaldo)', url: 'https://overpass.kumi.systems/api/interpreter', intentos: 1 },
];
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico)';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultar(url, consulta) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': USER_AGENT },
    body: `data=${encodeURIComponent(consulta)}`,
    signal: AbortSignal.timeout(240000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(`Overpass reportó: ${data.remark}`);
  if (!Array.isArray(data.elements)) throw new Error('la respuesta no trae `elements`');
  return data;
}

async function obtener(consulta, refrescar) {
  const hash = createHash('sha1').update(consulta).digest('hex');
  const ruta = join(CACHE, 'overpass.json');
  if (existsSync(ruta) && !refrescar) {
    const guardado = JSON.parse(readFileSync(ruta, 'utf8'));
    if (guardado.hash === hash) {
      console.log(`Overpass: respuesta en la caché (${guardado.fecha_consulta}); usa --refrescar para volver a consultar.`);
      return guardado;
    }
  }
  const fallos = [];
  for (const s of SERVIDORES) {
    for (let i = 1; i <= s.intentos; i++) {
      try {
        console.log(`Consultando ${s.etiqueta} (intento ${i}/${s.intentos})…`);
        const data = await consultar(s.url, consulta);
        const guardado = { hash, fecha_consulta: new Date().toISOString().slice(0, 10), servidor: s.url, osm_base: data.osm3s?.timestamp_osm_base ?? null, elements: data.elements };
        await mkdir(CACHE, { recursive: true });
        await writeFile(ruta, JSON.stringify(guardado));
        return guardado;
      } catch (err) {
        const causa = err?.cause?.code || err.message;
        fallos.push(`${s.etiqueta} intento ${i}: ${causa}`);
        console.warn(`  falló: ${causa}`);
        if (i < s.intentos) await esperar(8000 * i);
      }
    }
  }
  throw new Error(`Overpass no respondió tras todos los intentos:\n  ${fallos.join('\n  ')}`);
}

async function main() {
  const refrescar = process.argv.includes('--refrescar');
  const consulta = L.construirConsulta(BBOX);
  const osm = await obtener(consulta, refrescar);
  const convertido = L.convertir(osm.elements);

  // Solo lo que cae dentro de los 25 distritos del producto.
  const distritos = JSON.parse(readFileSync(join(RAIZ, 'public', 'data', 'distritos_aqp.geojson'), 'utf8')).features;
  const distritoDe = (lat, lon) => {
    const d = distritos.find((x) => (x.geometry.type === 'Polygon' ? [x.geometry.coordinates] : x.geometry.coordinates).some((anillos) => Calculos.puntoEnPoligono(lat, lon, anillos)));
    return d ? d.properties.distrito : null;
  };
  const dentro = convertido.features
    .map((f) => ({ ...f, properties: { ...f.properties, distrito: distritoDe(f.geometry.coordinates[1], f.geometry.coordinates[0]) } }))
    .filter((f) => f.properties.distrito);
  const dedup = L.deduplicar(dentro);

  const sunedu = JSON.parse(readFileSync(join(RAIZ, 'scripts', 'fuentes', 'sunedu_licenciadas_arequipa.json'), 'utf8'));
  const cruce = L.cruzarSunedu(dedup.features, sunedu.universidades);
  const porTipo = (t) => cruce.features.filter((f) => f.properties.tipo === t).length;

  const metadata = {
    fuente: 'OpenStreetMap (ODbL), amenity=university y amenity=college; contrastado con la lista de universidades licenciadas de SUNEDU',
    licencia: 'ODbL',
    url_licencia: 'https://www.openstreetmap.org/copyright',
    atribucion: '© colaboradores de OpenStreetMap',
    fecha_extraccion: osm.fecha_consulta,
    osm_base: osm.osm_base,
    servidor: osm.servidor,
    consulta,
    caja: BBOX,
    sunedu: { fuente: sunedu.fuente, url: sunedu.url, fecha_consulta: sunedu.fecha_consulta, alcance: sunedu.alcance, universidades: sunedu.universidades.map((u) => u.nombre), sin_sede_en_el_mapa: cruce.sinSedeEnElMapa },
    conteo: { universidades: porTipo('universidad'), institutos: porTipo('instituto'), sedes_de_universidades_de_la_lista: cruce.features.filter((f) => f.properties.sunedu).length },
    descartados: { sin_nombre: convertido.sinNombre, sin_geometria: convertido.sinGeometria, fuera_de_los_distritos: convertido.features.length - dentro.length, repetidos: dedup.descartados },
    nota: 'Cada elemento es una sede mapeada en OpenStreetMap. `sunedu` es el nombre de la universidad licenciada con sede en Arequipa con la que coincide, o null (filial de otra región, instituto o nombre que no coincide): null no significa «no licenciada».',
  };
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata }).slice(0, -1);
  const cuerpo = `${cabecera},"features":[\n${cruce.features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  await writeFile(SALIDA, cuerpo);
  console.log(`educacion_superior.geojson: ${porTipo('universidad')} sedes de universidad y ${porTipo('instituto')} institutos (${(Buffer.byteLength(cuerpo) / 1024).toFixed(0)} kB).`);
  console.log(`Descartados: ${JSON.stringify(metadata.descartados)}`);
  if (cruce.sinSedeEnElMapa.length) console.warn(`De la lista de SUNEDU, sin sede en el mapa: ${cruce.sinSedeEnElMapa.join(', ')}`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
