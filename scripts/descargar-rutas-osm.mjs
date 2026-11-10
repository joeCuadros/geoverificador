/**
 * descargar-rutas-osm.mjs — Congela las rutas de bus de la red SIT de Arequipa que OpenStreetMap tiene como relaciones route=bus en
 *   public/data/rutas_osm.geojson   (una LineString por relación = un sentido de un ramal, con su ref, de dónde a dónde, operador, duración, intervalo…)
 *
 * Uso:   node scripts/descargar-rutas-osm.mjs      (o: pnpm datos:rutas-osm)
 * Opciones:  --refrescar   vuelve a consultar Overpass aunque la respuesta esté en la caché (.cache-rutas-osm/)
 *
 * Qué hace: UNA consulta a Overpass para la caja de CONFIG.viewbox (relaciones route=bus|share_taxi|minibus|trolleybus con la geometría de sus vías), con tiempo
 * máximo, reintentos de espera creciente y espejo de respaldo (overpass.openstreetmap.fr, overpass-api.de, kumi.systems); ensambla las vías de cada relación en un
 * trazado ordenado (scripts/lib/rutas-osm.js) y escribe el archivo con su `metadata` (consulta, fecha, base de OSM, licencia ODbL, conteos, lo que no trae).
 * Si algo falla (red, formato, ninguna ruta) NO se escribe nada y se sale con código 1. Nunca se inventan trazados.
 * Los datos de OSM son © colaboradores de OpenStreetMap, licencia ODbL.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const R = require('./lib/rutas-osm.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'data', 'rutas_osm.geojson');
const CACHE = join(RAIZ, '.cache-rutas-osm');
const BBOX = [-16.6, -71.75, -16.2, -71.35]; // sur, oeste, norte, este (CONFIG.viewbox)
const SERVIDORES = [
  { etiqueta: 'overpass.openstreetmap.fr', url: 'https://overpass.openstreetmap.fr/api/interpreter', intentos: 2 },
  { etiqueta: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter', intentos: 2 },
  { etiqueta: 'overpass.kumi.systems', url: 'https://overpass.kumi.systems/api/interpreter', intentos: 1 },
];
const ESPERA_BASE_MS = 8000;
const TIMEOUT_MS = 300000;
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico)';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultar(url, consulta) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': USER_AGENT }, body: `data=${encodeURIComponent(consulta)}`, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(`Overpass reportó: ${data.remark}`);
  if (!Array.isArray(data.elements)) throw new Error('la respuesta no trae `elements`');
  return data;
}

async function obtener(consulta, refrescar) {
  const hash = createHash('sha1').update(consulta).digest('hex');
  const ruta = join(CACHE, 'overpass-rutas.json');
  if (existsSync(ruta) && !refrescar) {
    const g = JSON.parse(readFileSync(ruta, 'utf8'));
    if (g.hash === hash) { console.log(`Overpass: respuesta en la caché (${g.fecha_consulta}); usa --refrescar para volver a consultar.`); return g; }
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
        if (i < s.intentos) await esperar(ESPERA_BASE_MS * i);
      }
    }
  }
  throw new Error(`Overpass no respondió tras todos los intentos:\n  ${fallos.join('\n  ')}`);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const consulta = R.construirConsulta(BBOX);
  const osm = await obtener(consulta, process.argv.includes('--refrescar'));
  const relaciones = osm.elements.filter((e) => e.type === 'relation');
  const { features, descartadas, conSaltos } = R.convertir(relaciones);
  if (features.length === 0) throw new Error('Ninguna relación tiene vías con geometría. No se escribió nada.');
  if (descartadas.length) console.warn(`  descartadas: ${descartadas.map((d) => `${d.osm} (${d.motivo})`).join('; ')}`);
  const por = (k) => features.reduce((o, f) => { const v = f.properties[k] || '(sin dato)'; o[v] = (o[v] || 0) + 1; return o; }, {});
  const vertices = features.reduce((t, f) => t + (f.geometry.type === 'LineString' ? f.geometry.coordinates.length : f.geometry.coordinates.reduce((u, p) => u + p.length, 0)), 0);
  const metadata = {
    fuente: 'OpenStreetMap (ODbL), relaciones route=bus de la red SIT de Arequipa',
    fecha_extraccion: osm.fecha_consulta, osm_base: osm.osm_base, servidor: osm.servidor, consulta,
    caja: { sur: BBOX[0], oeste: BBOX[1], norte: BBOX[2], este: BBOX[3] },
    licencia: 'ODbL', url_licencia: 'https://www.openstreetmap.org/copyright', atribucion: '© colaboradores de OpenStreetMap',
    conteos: { rutas: features.length, lineas: por('linea'), vertices, con_saltos: conSaltos, descartadas: descartadas.length, con_duracion: features.filter((f) => f.properties.duracion_min !== null).length, con_intervalo: features.filter((f) => f.properties.intervalo_min !== null).length },
    nota: 'Cada ruta es UN sentido de un ramal, con el trazado como lo dibujó OpenStreetMap (sus vías ensambladas en el orden de la relación). No trae paradas. La duración y el intervalo (minutos), el horario y la tarifa son etiquetas de la comunidad de OSM, no datos oficiales. Sin garantía de que el servicio opere hoy.',
    generado: new Date().toISOString().slice(0, 10),
  };
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata }).slice(0, -1);
  await writeFile(SALIDA, `${cabecera},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`);
  console.log(`\nEscrito public/data/rutas_osm.geojson: ${features.length} rutas, ${vertices} vértices; con saltos: ${conSaltos}; líneas: ${JSON.stringify(por('linea'))}`);
}

main().catch((err) => { console.error(`\nERROR: ${err.message}`); process.exit(1); });
