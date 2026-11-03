/**
 * descargar-rutas-smartbus.mjs — Congela las rutas de transporte público de Arequipa publicadas por SmartBus.
 *
 * PERMISO. Los datos se usan con autorización verbal de SmartBus (empresa privada de Arequipa); la confirmación escrita
 * está pendiente. Hasta tenerla, el archivo generado se trata como «datos con permiso verbal» y así se rotula en pantalla.
 *
 * FUENTE (sin autenticación, la misma que usa el mapa de https://smartbus.app/pe/arequipa/c2 para cualquier visitante):
 *   GET https://smartbus.app/smartbus/pe/arequipa/routes        → lista de rutas {id, shortName, longName, agency, color, stopsCount}
 *   GET https://smartbus.app/smartbus/pe/arequipa/routes/{id}   → detalle: stops [{id, name, lat, lng, sequence}] y geometry [[lat, lng], …]
 * (Los descubrió leyendo el JavaScript público de la página: funciones que llaman a `${"/smartbus"}/${país}/${ciudad}/routes…`.
 * También existe `/routes-geo` con todas las geometrías, pero no trae paradas, así que no se usa.)
 * robots.txt de smartbus.app declara `User-agent: * / Allow: /`; el script lo vuelve a leer en cada corrida y se detiene si dejara
 * de permitirlo.
 *
 * REGLAS DE LA DESCARGA (no negociables)
 *   - Solicitudes HTTP simples con un User-Agent honesto; nada de suplantar navegadores, saltar captchas ni usar tokens.
 *   - Al menos 1 s entre solicitudes a la red (las respuestas ya guardadas en caché no esperan).
 *   - Las respuestas crudas se guardan en .cache-smartbus/ (ignorada por git). Con la caché llena el script no toca la red;
 *     `--refrescar` la ignora.
 *   - Si algún endpoint pide inicio de sesión, responde 401/403/429 o bloquea, el script SE DETIENE sin insistir.
 *   - Si algo falla o la validación no pasa, el archivo existente NO se modifica.
 *
 * Uso:   node scripts/descargar-rutas-smartbus.mjs [--refrescar]      (pnpm datos:rutas)
 * Sale:  public/data/rutas_smartbus.geojson
 *
 * Decisiones:
 *  - Cada «ruta» de SmartBus es un recorrido en un sentido (p. ej. «Cettar : Ciudad Municipal → Terminal Terrestre»). El campo
 *    agency.name trae «C2 - Cono Norte»: de ahí salen `linea` (C2) y `empresa` (Cono Norte). Albotran y Chiguata no tienen código:
 *    la línea es su nombre.
 *  - La geometría que sirve SmartBus es una lista de tramos pegados, y a veces hay saltos entre tramos consecutivos. Un salto de
 *    más de 300 m (el 99,7 % de los segmentos mide menos) NO se dibuja como calle: la ruta se parte ahí y se guarda como
 *    MultiLineString. Así la distancia «punto → línea» nunca mide contra un tramo que no existe.
 *  - Las paradas se publican con nombres numerados («Cettar - 12»): se conservan tal cual y `orden` es su posición en el recorrido.
 */
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGEN = 'https://smartbus.app';
const CIUDAD = 'pe/arequipa';
const USER_AGENT = 'GeoVerificador/1.0 (datos con permiso de SmartBus)';
const ESPERA_MS = 1100; // ≥ 1 s entre solicitudes a la red
const SALTO_MAX_M = 300; // un segmento más largo se considera hueco entre tramos, no calle
const CAJA_AQP = { oeste: -71.8, sur: -16.7, este: -71.2, norte: -16.1 }; // holgada sobre CONFIG.viewbox
const MIN_RUTAS = 200; // la lista completa trae 241; menos que esto indica una respuesta parcial
const MIN_LINEAS = 10;

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(RAIZ, '.cache-smartbus');
const SALIDA = join(RAIZ, 'public', 'data', 'rutas_smartbus.geojson');
const REFRESCAR = process.argv.includes('--refrescar');

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let ultimaSolicitud = 0;

class Detenido extends Error {}

/** Pide una URL respetando la espera mínima. Devuelve el texto o lanza `Detenido` si el sitio exige parar. */
async function pedir(url) {
  for (let intento = 1; intento <= 3; intento++) {
    const espera = ultimaSolicitud + ESPERA_MS - Date.now();
    if (espera > 0) await dormir(espera);
    ultimaSolicitud = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*' }, redirect: 'manual' });
    } catch (e) {
      if (intento === 3) throw new Error(`Sin conexión con ${url}: ${e.message}`);
      continue;
    }
    if ([401, 403, 407, 429].includes(res.status) || (res.status >= 300 && res.status < 400)) {
      throw new Detenido(`${url} respondió HTTP ${res.status} (inicio de sesión, bloqueo o redirección). Me detengo sin insistir.`);
    }
    if (res.status >= 500 && intento < 3) continue;
    if (!res.ok) throw new Error(`${url} respondió HTTP ${res.status}`);
    const texto = await res.text();
    if (/captcha|cf-challenge|attention required/i.test(texto.slice(0, 2000))) {
      throw new Detenido(`${url} devolvió una página de verificación anti-bot. Me detengo sin intentar saltarla.`);
    }
    return texto;
  }
  throw new Error(`No se pudo obtener ${url}`);
}

/** Texto de una URL, desde la caché local si existe. */
async function conCache(nombre, url) {
  const ruta = join(CACHE, nombre);
  if (!REFRESCAR) {
    try {
      await stat(ruta);
      return await readFile(ruta, 'utf8');
    } catch {
      /* no está en caché: se pide */
    }
  }
  const texto = await pedir(url);
  await writeFile(ruta, texto);
  return texto;
}

/** Comprueba en robots.txt que `path` esté permitido para `User-agent: *`. */
function robotsPermite(robots, path) {
  let aplica = false;
  const reglas = [];
  for (const cruda of robots.split(/\r?\n/)) {
    const l = cruda.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(l);
    if (!m) continue;
    const clave = m[1].toLowerCase();
    if (clave === 'user-agent') aplica = m[2].trim() === '*';
    else if (aplica && (clave === 'allow' || clave === 'disallow')) reglas.push([clave, m[2].trim()]);
  }
  let mejor = null;
  for (const [tipo, prefijo] of reglas) {
    if (prefijo === '' && tipo === 'disallow') continue;
    if (path.startsWith(prefijo) && (!mejor || prefijo.length >= mejor[1].length)) mejor = [tipo, prefijo];
  }
  return !mejor || mejor[0] === 'allow';
}

const RAD = Math.PI / 180;
function distM(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

const redondear = (n) => Math.round(n * 1e6) / 1e6; // 6 decimales ≈ 0,1 m

/** [[lat, lng], …] → lista de tramos de [lng, lat], partidos donde hay un salto mayor a SALTO_MAX_M. */
function tramos(geometry) {
  const salida = [];
  let actual = [];
  geometry.forEach((p, i) => {
    if (i > 0 && distM(geometry[i - 1], p) > SALTO_MAX_M) {
      if (actual.length >= 2) salida.push(actual);
      actual = [];
    }
    actual.push([redondear(p[1]), redondear(p[0])]);
  });
  if (actual.length >= 2) salida.push(actual);
  return salida;
}

/** «C2 - Cono Norte» → { linea: 'C2', empresa: 'Cono Norte' }; «Albotran» → { linea: 'Albotran', empresa: 'Albotran' }. */
function lineaYEmpresa(agencia) {
  const m = /^(C\d+)\s*-\s*(.+)$/.exec(agencia.trim());
  return m ? { linea: m[1], empresa: m[2].trim() } : { linea: agencia.trim(), empresa: agencia.trim() };
}

/** «Cettar : Ciudad Municipal → Terminal Terrestre» → «Ciudad Municipal → Terminal Terrestre». */
function sentidoDe(ruta) {
  const prefijo = `${ruta.shortName} : `;
  const t = String(ruta.longName || '').trim();
  return t.startsWith(prefijo) ? t.slice(prefijo.length).trim() : t;
}

const enCaja = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lng >= CAJA_AQP.oeste && lng <= CAJA_AQP.este && lat >= CAJA_AQP.sur && lat <= CAJA_AQP.norte;

function construir(lista, detalles) {
  const lineasFeatures = [];
  const paradasFeatures = [];
  const problemas = [];
  for (const r of lista) {
    const d = detalles.get(r.id);
    const { linea, empresa } = lineaYEmpresa(r.agency.name);
    const url = `${ORIGEN}/${CIUDAD}/${linea.toLowerCase()}`;
    const partes = tramos(d.geometry || []);
    if (!partes.length) {
      problemas.push(`${linea} ${r.longName}: geometría vacía`);
      continue;
    }
    for (const t of partes) for (const [lng, lat] of t) if (!enCaja(lat, lng)) problemas.push(`${linea} ${r.longName}: vértice fuera de Arequipa (${lat}, ${lng})`);
    lineasFeatures.push({
      type: 'Feature',
      geometry: partes.length === 1 ? { type: 'LineString', coordinates: partes[0] } : { type: 'MultiLineString', coordinates: partes },
      properties: {
        tipo: 'ruta',
        linea,
        empresa,
        ramal: r.shortName,
        nombre: r.longName,
        sentido: sentidoDe(r),
        id_ruta: r.id,
        color: r.color || null,
        paradas: (d.stops || []).length,
        fuente: 'SmartBus (smartbus.app)',
        url,
      },
    });
    for (const s of d.stops || []) {
      const lat = Number(s.lat);
      const lng = Number(s.lng);
      if (!enCaja(lat, lng)) {
        problemas.push(`${linea} ${r.longName}: parada «${s.name}» fuera de Arequipa o con coordenadas inválidas (${s.lat}, ${s.lng})`);
        continue;
      }
      paradasFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [redondear(lng), redondear(lat)] },
        properties: { tipo: 'parada', nombre: String(s.name), linea, ramal: r.shortName, orden: Number(s.sequence) + 1, id_ruta: r.id },
      });
    }
  }
  return { lineasFeatures, paradasFeatures, problemas };
}

async function main() {
  await mkdir(CACHE, { recursive: true });

  const robots = await conCache('robots.txt', `${ORIGEN}/robots.txt`);
  if (!robotsPermite(robots, `/smartbus/${CIUDAD}/routes`)) throw new Detenido('robots.txt de smartbus.app ya no permite leer /smartbus/. Me detengo.');

  const rutas = JSON.parse(await conCache('routes.json', `${ORIGEN}/smartbus/${CIUDAD}/routes`));
  if (!rutas.ok || !Array.isArray(rutas.data)) throw new Error('La lista de rutas no tiene la forma esperada {ok, data[]}.');
  const lista = rutas.data;
  const lineas = new Set(lista.map((r) => lineaYEmpresa(r.agency.name).linea));
  if (lista.length < MIN_RUTAS || lineas.size < MIN_LINEAS) throw new Error(`La lista parece parcial: ${lista.length} rutas y ${lineas.size} líneas.`);
  console.log(`Lista: ${lista.length} rutas en ${lineas.size} líneas`);

  const detalles = new Map();
  let i = 0;
  for (const r of lista) {
    const d = JSON.parse(await conCache(`ruta-${r.id}.json`, `${ORIGEN}/smartbus/${CIUDAD}/routes/${r.id}`));
    if (!d.ok || !d.data || !Array.isArray(d.data.geometry) || !Array.isArray(d.data.stops)) throw new Error(`El detalle de la ruta ${r.id} no tiene la forma esperada.`);
    detalles.set(r.id, d.data);
    if (++i % 25 === 0) console.log(`  ${i}/${lista.length} detalles`);
  }

  const { lineasFeatures, paradasFeatures, problemas } = construir(lista, detalles);
  if (problemas.length) throw new Error(`La validación falló, no se escribe nada:\n - ${problemas.slice(0, 20).join('\n - ')}${problemas.length > 20 ? `\n … y ${problemas.length - 20} más` : ''}`);
  if (lineasFeatures.length !== lista.length) throw new Error('Alguna ruta quedó sin geometría.');

  const ramales = new Set(lineasFeatures.map((f) => `${f.properties.linea}|${f.properties.ramal}`));
  const empresas = new Set(lineasFeatures.map((f) => f.properties.empresa));
  const vertices = lineasFeatures.reduce((n, f) => n + (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates).reduce((m, t) => m + t.length, 0), 0);
  const salida = {
    type: 'FeatureCollection',
    metadata: {
      fuente: 'SmartBus (smartbus.app)',
      permiso: 'autorización verbal de SmartBus; confirmación escrita pendiente',
      atribucion: 'Rutas: SmartBus (smartbus.app)',
      fecha_descarga: new Date().toISOString().slice(0, 10),
      endpoints: [`${ORIGEN}/smartbus/${CIUDAD}/routes`, `${ORIGEN}/smartbus/${CIUDAD}/routes/{id}`],
      user_agent: USER_AGENT,
      salto_maximo_m: SALTO_MAX_M,
      conteos: { lineas: lineas.size, empresas: empresas.size, ramales: ramales.size, rutas: lineasFeatures.length, paradas: paradasFeatures.length, vertices },
      lineas: [...lineas].sort((a, b) => (Number(a.slice(1)) || 99) - (Number(b.slice(1)) || 99) || a.localeCompare(b)),
      nota: 'Recorridos tal como los publica SmartBus en la fecha de descarga. Sin frecuencias ni horarios. Las paradas tienen nombres numerados («Cettar - 12»).',
    },
    features: [...lineasFeatures, ...paradasFeatures],
  };

  await mkdir(dirname(SALIDA), { recursive: true });
  const tmp = `${SALIDA}.tmp`;
  await writeFile(tmp, JSON.stringify(salida));
  await rename(tmp, SALIDA);
  console.log(`Guardado en ${SALIDA}`);
  console.log(JSON.stringify(salida.metadata.conteos));
}

main().catch((err) => {
  console.error(err instanceof Detenido ? `DETENIDO: ${err.message}` : `ERROR: ${err.message}`);
  console.error('El archivo existente (si lo hay) no se modificó.');
  process.exit(1);
});
