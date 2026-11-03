/**
 * descargar-quebradas.mjs — Descarga los cauces (ríos y quebradas) de Arequipa metropolitana de TRES fuentes y los une en un
 * solo GeoJSON, con la fuente de cada tramo.
 *
 *  1. ANA (Autoridad Nacional del Agua), servicio ws_Rios_Quebradas, capa 37 «Cuerpos de Agua»: red hidrográfica Pfafstetter de
 *     enero de 2018, de ESCALA NACIONAL (ríos y quebradas principales; no todas las quebradas urbanas). Los tramos se guardan
 *     completos (no se recortan) porque sirven para medir distancias.
 *  2. IGP (Instituto Geofísico del Perú, CENVUL), servicio monitoreocenvul/ArequipaMisti: capa 2 «Quebrada» (quebradas del Misti
 *     y de la ciudad) y capa 3 «RiosArequipa» (recortada a la caja de Arequipa metropolitana). Sin metadatos de fecha ni de
 *     licencia en el servicio; se atribuye al IGP.
 *  3. OpenStreetMap (ODbL), consulta Overpass de waterway=river|stream en la misma caja. Solo se guardan los cauces con nombre y
 *     los ríos: los cientos de arroyos sin nombre se descartan (el conteo queda en los metadatos).
 *
 * Ninguna de las fuentes es un mapa de peligro de huaico ni de inundación, y ninguna delimita la faja marginal.
 *
 * Uso:   node scripts/descargar-quebradas.mjs [--forzar] [--osm-json=ruta]
 *         --osm-json reutiliza una respuesta de Overpass ya guardada (para no repetir la consulta si Overpass falla).
 * Sale:  public/data/quebradas_aqp.geojson
 *
 * Decisiones:
 *  - Duplicados entre fuentes: ver scripts/lib/cauces.js (prioridad ANA, IGP quebradas, IGP ríos, OSM; 70 % de la línea a 30 m).
 *  - Solicitudes sencillas, con un User-Agent que dice quién pide; una sola consulta a Overpass. No se evade ninguna protección.
 *  - Si CUALQUIERA de las fuentes falla, no se escribe nada y se conserva el archivo congelado anterior.
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { recortarGeometria } = require('./lib/geometria.js');
const { unirCauces } = require('./lib/cauces.js');

// ------------------------------------------------------------------ CONFIGURACIÓN
const ANA_URL = process.env.QUEBRADAS_URL || 'https://geosnirh.ana.gob.pe/server/rest/services/ws_Rios_Quebradas/MapServer/37';
const IGP_BASE = 'https://ide.igp.gob.pe/arcgis/rest/services/monitoreocenvul/ArequipaMisti/MapServer';
const IGP_QUEBRADA = `${IGP_BASE}/2`;
const IGP_RIOS = `${IGP_BASE}/3`;
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'geoverificador-datos/1.0 (proyecto academico de verificacion de predios en Arequipa; descarga unica de datos publicos)';

// Misma caja que CONFIG.viewbox en public/js/config.js (oeste, sur, este, norte).
const CAJA = [-71.75, -16.6, -71.35, -16.2];
const DECIMALES = 5;
const PAGINA = 500;
const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'quebradas_aqp.geojson');
const CAMPOS_ANA = ['OBJECTID_1', 'CODIGO_CA', 'NOMBRE_CA', 'CATEGORIA', 'TIPO_CA', 'LONG_KM', 'NOMBRE_UH'];

// ------------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const redondear = (n) => Math.round(n * 10 ** DECIMALES) / 10 ** DECIMALES;

async function pedir(url, params) {
  const destino = `${url}?${new URLSearchParams({ f: 'json', ...params })}`;
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(destino, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`el servicio respondió ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (err) {
      if (intento >= 3) {
        const causa = String((err.cause && err.cause.message) || '');
        throw new Error(`Falló la consulta tras 3 intentos (${err.message}${causa ? `: ${causa}` : ''}).\nURL: ${destino}`);
      }
      await esperar(2000 * intento);
    }
  }
}

/** Todos los registros de una capa de ArcGIS que tocan la caja, con su geometría en 4326. */
async function consultarCapa(url, campos) {
  const crudos = [];
  for (let desde = 0; ; desde += PAGINA) {
    const data = await pedir(`${url}/query`, {
      where: '1=1',
      geometry: CAJA.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: campos,
      returnGeometry: 'true',
      outSR: '4326',
      resultOffset: String(desde),
      resultRecordCount: String(PAGINA),
    });
    crudos.push(...(data.features || []));
    if (!data.exceededTransferLimit) break;
    await esperar(500);
  }
  return crudos;
}

/** Un curso de agua de ArcGIS (`paths`) como geometría GeoJSON. Descarta tramos de un solo punto. */
function aGeometria(geometry) {
  const lineas = ((geometry && geometry.paths) || [])
    .map((p) => p.map(([x, y]) => [redondear(x), redondear(y)]))
    .filter((p) => p.length >= 2);
  if (lineas.length === 0) return null;
  return lineas.length === 1 ? { type: 'LineString', coordinates: lineas[0] } : { type: 'MultiLineString', coordinates: lineas };
}

// ------------------------------------------------------------------------------ ANA
async function bajarANA() {
  const meta = await pedir(ANA_URL, {});
  const crudos = await consultarCapa(ANA_URL, CAMPOS_ANA.join(','));
  const vistos = new Set();
  const lista = [];
  for (const f of crudos) {
    const a = f.attributes || {};
    const geometry = aGeometria(f.geometry);
    if (vistos.has(a.OBJECTID_1) || !geometry) continue;
    vistos.add(a.OBJECTID_1);
    lista.push({
      fuente: 'ANA', capa: null, nombre: a.NOMBRE_CA ?? null, tipo: a.TIPO_CA ?? null, categoria: a.CATEGORIA ?? null,
      cuenca: a.NOMBRE_UH ?? null, longKm: typeof a.LONG_KM === 'number' ? Math.round(a.LONG_KM * 10) / 10 : null, geometry,
    });
  }
  return { lista, copyright: (meta.copyrightText || '').replace(/\s+/g, ' ').trim() };
}

// ------------------------------------------------------------------------------ IGP
async function bajarIGP(url, capa, tipo) {
  const crudos = await consultarCapa(url, 'objectid,nombre,tipo,codigo');
  const lista = [];
  for (const f of crudos) {
    const a = f.attributes || {};
    const g = aGeometria(f.geometry);
    const geometry = g ? recortarGeometria(g, CAJA, DECIMALES) : null;
    if (!geometry) continue;
    lista.push({ fuente: 'IGP', capa, nombre: a.nombre, tipo, categoria: null, cuenca: null, longKm: null, geometry });
  }
  return lista;
}

// ------------------------------------------------------------------------------ OSM
async function bajarOSM() {
  const [oeste, sur, este, norte] = CAJA;
  const consulta = `[out:json][timeout:120][maxsize:67108864];(way["waterway"~"^(river|stream)$"](${sur},${oeste},${norte},${este}););out geom tags;`;
  const guardada = process.argv.find((a) => a.startsWith('--osm-json='));
  let data = guardada ? JSON.parse(await readFile(guardada.slice('--osm-json='.length), 'utf8')) : null;
  for (let intento = 1; !data; intento++) {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: consulta }),
    });
    if (res.ok) data = await res.json();
    else if (intento >= 2) throw new Error(`Overpass respondió HTTP ${res.status}`);
    else await esperar(30000);
  }
  const base = data.osm3s && data.osm3s.timestamp_osm_base ? data.osm3s.timestamp_osm_base : null;
  const lista = [];
  let sinNombre = 0;
  for (const e of data.elements) {
    const t = e.tags || {};
    const geometry = Array.isArray(e.geometry) && e.geometry.length >= 2 ? { type: 'LineString', coordinates: e.geometry.map((p) => [redondear(p.lon), redondear(p.lat)]) } : null;
    if (!geometry) continue;
    if (!t.name && t.waterway !== 'river') { sinNombre++; continue; } // arroyos secos sin nombre: ruido para esta ficha
    const recortada = recortarGeometria(geometry, CAJA, DECIMALES);
    if (!recortada) continue;
    lista.push({
      fuente: 'OSM', capa: `way/${e.id}`, nombre: t.name || null, tipo: t.waterway === 'river' ? 'Río' : 'Quebrada o arroyo',
      categoria: null, cuenca: null, longKm: null, geometry: recortada,
    });
  }
  return { lista, base, total: data.elements.length, sinNombre };
}

// ------------------------------------------------------------------------- PRINCIPAL
async function main() {
  const hoy = new Date().toISOString();
  console.log('ANA…');
  const ana = await bajarANA();
  console.log(`  ${ana.lista.length} tramos`);
  console.log('IGP, capa Quebrada…');
  const igpQ = await bajarIGP(IGP_QUEBRADA, 'Quebrada', 'Quebrada');
  console.log(`  ${igpQ.length} tramos`);
  console.log('IGP, capa RiosArequipa (recortada a la caja)…');
  const igpR = await bajarIGP(IGP_RIOS, 'RiosArequipa', null);
  console.log(`  ${igpR.length} tramos`);
  console.log('OpenStreetMap (Overpass)…');
  const osm = await bajarOSM();
  console.log(`  ${osm.total} vías recibidas; ${osm.lista.length} con nombre o río; ${osm.sinNombre} arroyos sin nombre descartados`);

  const { features, resumen } = unirCauces([ana.lista, igpQ, igpR, osm.lista]);
  if (features.length === 0) throw new Error('No quedó ningún tramo: no se guarda un archivo vacío.');

  const de = (f, capa) => features.filter((x) => x.properties.fuente === f && (!capa || x.properties.capa === capa)).length;
  const dup = (f, capa) => (resumen.find((r) => r.fuente === f && (!capa || r.capa === capa)) || { duplicados: 0 }).duplicados;
  const nombres = [...new Set(features.flatMap((f) => [f.properties.nombre, ...(f.properties.alias || []).map((a) => a.nombre)]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

  const salida = {
    type: 'FeatureCollection',
    metadata: {
      descargado: hoy,
      caja: CAJA,
      registros: features.length,
      nombres,
      escala: 'Ninguna fuente es un mapa de peligro de huaico ni de inundación, y ninguna delimita la faja marginal. La ANA es una red nacional (ríos y quebradas principales); el IGP y OpenStreetMap suman quebradas urbanas, pero tampoco son completas.',
      deduplicacion: 'Un tramo de una fuente se descarta si al menos el 70 % de su longitud queda a 30 m o menos de tramos ya aceptados de una fuente de mayor prioridad (ANA, IGP Quebrada, IGP RiosArequipa, OSM). Si el tramo que gana no tiene nombre y el descartado sí, hereda el nombre.',
      fuentes: [
        {
          id: 'ANA',
          fuente: 'Red hidrográfica (capa «Cuerpos de Agua»), Autoridad Nacional del Agua (ANA)',
          capa: ANA_URL,
          descargado: hoy,
          elaboracion: 'Enero de 2018 (DCERH-ANA, según el servicio)',
          atribucion: ana.copyright || 'ANA, DCERH',
          licencia: 'No localizada en el servicio; se atribuye a la ANA',
          escala: 'Red hidrográfica nacional: ríos y quebradas principales; no incluye todas las quebradas urbanas',
          recibidos: ana.lista.length,
          registros: de('ANA'),
          duplicados: dup('ANA'),
        },
        {
          id: 'IGP',
          fuente: 'Quebradas y ríos de Arequipa (servicio monitoreocenvul/ArequipaMisti), Instituto Geofísico del Perú (IGP)',
          capas: [
            { nombre: 'Quebrada', url: IGP_QUEBRADA, recibidos: igpQ.length, registros: de('IGP', 'Quebrada'), duplicados: dup('IGP', 'Quebrada') },
            { nombre: 'RiosArequipa', url: IGP_RIOS, recibidos: igpR.length, registros: de('IGP', 'RiosArequipa'), duplicados: dup('IGP', 'RiosArequipa'), recorte: 'a la caja de Arequipa metropolitana' },
          ],
          descargado: hoy,
          elaboracion: 'Sin fecha de elaboración en el servicio',
          atribucion: 'Instituto Geofísico del Perú (IGP), Centro Nacional de Alerta Temprana (CENVUL); el servicio no declara texto de derechos',
          licencia: 'No declarada en el servicio; se atribuye al IGP',
          escala: 'Capas del proyecto Misti del IGP, sin metadatos de escala; los nombres vienen sin tildes («Qda. San Lazaro»)',
          recibidos: igpQ.length + igpR.length,
          registros: de('IGP'),
          duplicados: dup('IGP', 'Quebrada') + dup('IGP', 'RiosArequipa'),
        },
        {
          id: 'OSM',
          fuente: 'OpenStreetMap (waterway=river y waterway=stream)',
          capa: OVERPASS,
          descargado: hoy,
          elaboracion: osm.base ? `Base de OpenStreetMap del ${osm.base.slice(0, 10)}` : 'Sin fecha de la base',
          atribucion: '© colaboradores de OpenStreetMap',
          licencia: 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/)',
          escala: 'Mapeo colaborativo: puede faltar o estar desactualizado. Solo se guardan los cauces con nombre y los ríos',
          recibidos: osm.total,
          descartadosSinNombre: osm.sinNombre,
          registros: de('OSM'),
          duplicados: dup('OSM'),
        },
      ],
    },
    features,
  };

  // No pisar un archivo congelado más completo con una respuesta parcial.
  const anterior = await readFile(SALIDA, 'utf8').then((s) => JSON.parse(s)).catch(() => null);
  const previos = anterior && anterior.metadata ? anterior.metadata.registros : 0;
  if (previos > features.length && !process.argv.includes('--forzar')) {
    console.warn(`\nSe obtuvieron ${features.length} tramos y el archivo congelado tiene ${previos}. No se escribió nada (usa --forzar para guardar de todos modos).`);
    return;
  }
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida));
  console.log(`\nGuardado en ${SALIDA}`);
  console.log(`Tramos: ANA ${de('ANA')}, IGP ${de('IGP')}, OSM ${de('OSM')} (total ${features.length}); duplicados descartados: ${resumen.map((r) => `${r.fuente}${r.fuente === 'IGP' ? `/${r.capa}` : ''} ${r.duplicados}`).join(', ')}`);
  console.log(`Cursos con nombre (${nombres.length}): ${nombres.join(', ')}`);
  console.log(`¿Añashuayco? ${nombres.some((n) => /a[ñn]ashuayco/i.test(n)) ? 'sí' : 'no'}; ¿San Lázaro? ${nombres.some((n) => /san l[aá]zaro/i.test(n)) ? 'sí' : 'no'}`);
}

main().catch((err) => {
  console.error(`\nNo se pudo completar la descarga: ${err.message}`);
  console.error('Se conserva el archivo congelado anterior (public/data/quebradas_aqp.geojson), si existe; no se escribió nada.');
  process.exit(1);
});
