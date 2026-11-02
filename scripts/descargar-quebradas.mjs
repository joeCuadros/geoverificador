/**
 * descargar-quebradas.mjs — Descarga la red hidrográfica (ríos y quebradas) de Arequipa metropolitana como GeoJSON.
 *
 * Fuente: Autoridad Nacional del Agua (ANA), servicio ws_Rios_Quebradas, capa 37 «Cuerpos de Agua»: red hidrográfica
 * codificada con el sistema Pfafstetter, elaborada en enero de 2018 por la DCERH-ANA. Es una red de ESCALA NACIONAL: trae
 * ríos y las quebradas principales, no todas las quebradas urbanas ni las torrenteras menores. NO es un mapa de peligro de
 * huaico ni de inundación, y NO delimita la faja marginal.
 *
 * Uso:   node scripts/descargar-quebradas.mjs
 * Sale:  public/data/quebradas_aqp.geojson
 *
 * Decisiones:
 *  - Se consulta por la caja de CONFIG.viewbox (Arequipa metropolitana). La consulta devuelve la línea completa de cada
 *    curso que toca la caja (una quebrada puede medir decenas de km): sirve para medir distancias y no se recorta.
 *  - Se pagina con resultOffset/resultRecordCount hasta que el servicio deja de avisar \`exceededTransferLimit\`.
 *  - Si la descarga falla, no se escribe nada y se conserva el archivo congelado anterior (la aplicación sigue con él;
 *    si no existe, la variable muestra SIN DATO).
 *  - Solo se guardan los campos necesarios para nombrar y describir el cauce.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ CONFIGURACIÓN
const SERVICIO =
  process.env.QUEBRADAS_URL ||
  'https://geosnirh.ana.gob.pe/server/rest/services/ws_Rios_Quebradas/MapServer/37';

// Misma caja que CONFIG.viewbox en public/js/config.js (oeste, sur, este, norte).
const CAJA = [-71.75, -16.6, -71.35, -16.2];
const DECIMALES = 5;
const PAGINA = 500;
const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'quebradas_aqp.geojson');
const CAMPOS = ['OBJECTID_1', 'CODIGO_CA', 'NOMBRE_CA', 'CATEGORIA', 'TIPO_CA', 'LONG_KM', 'NOMBRE_UH'];

// ------------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, params) {
  const destino = `${url}?${new URLSearchParams({ f: 'json', ...params })}`;
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(destino);
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

const redondear = (n) => Math.round(n * 10 ** DECIMALES) / 10 ** DECIMALES;

/** Un curso de agua de ArcGIS (`paths`) como geometría GeoJSON. Descarta tramos de un solo punto. */
function aGeometria(geometry) {
  const lineas = ((geometry && geometry.paths) || [])
    .map((p) => p.map(([x, y]) => [redondear(x), redondear(y)]))
    .filter((p) => p.length >= 2);
  if (lineas.length === 0) return null;
  return lineas.length === 1 ? { type: 'LineString', coordinates: lineas[0] } : { type: 'MultiLineString', coordinates: lineas };
}

// ------------------------------------------------------------------------- PRINCIPAL
async function main() {
  console.log(`Capa: ${SERVICIO}\n`);
  const meta = await pedir(SERVICIO, {});
  const [oeste, sur, este, norte] = CAJA;
  const crudos = [];
  for (let desde = 0; ; desde += PAGINA) {
    const data = await pedir(`${SERVICIO}/query`, {
      where: '1=1',
      geometry: `${oeste},${sur},${este},${norte}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: CAMPOS.join(','),
      returnGeometry: 'true',
      outSR: '4326',
      resultOffset: String(desde),
      resultRecordCount: String(PAGINA),
    });
    crudos.push(...(data.features || []));
    if (!data.exceededTransferLimit) break;
  }
  console.log(`Tramos recibidos: ${crudos.length}`);

  const vistos = new Set();
  const features = [];
  for (const f of crudos) {
    const a = f.attributes || {};
    const geometry = aGeometria(f.geometry);
    if (vistos.has(a.OBJECTID_1) || !geometry) continue;
    vistos.add(a.OBJECTID_1);
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        id: a.OBJECTID_1,
        codigo: a.CODIGO_CA ?? null,
        nombre: a.NOMBRE_CA ?? null,
        tipo: a.TIPO_CA ?? null,
        categoria: a.CATEGORIA ?? null,
        longKm: typeof a.LONG_KM === 'number' ? Math.round(a.LONG_KM * 10) / 10 : null,
        cuenca: a.NOMBRE_UH ?? null,
      },
    });
  }
  if (features.length === 0) throw new Error('La consulta no devolvió ningún tramo: no se guarda un archivo vacío.');

  // No pisar un archivo congelado más completo con una respuesta parcial.
  const anterior = await readFile(SALIDA, 'utf8').then((s) => JSON.parse(s)).catch(() => null);
  const previos = anterior && anterior.metadata ? anterior.metadata.registros : 0;
  if (previos > features.length && !process.argv.includes('--forzar')) {
    console.warn(`\nSe recibieron ${features.length} tramos y el archivo congelado tiene ${previos}. No se escribió nada (usa --forzar para guardar de todos modos).`);
    return;
  }

  const nombres = [...new Set(features.map((f) => f.properties.nombre).filter(Boolean))].sort();
  const salida = {
    type: 'FeatureCollection',
    metadata: {
      fuente: 'Red hidrográfica (capa «Cuerpos de Agua»), Autoridad Nacional del Agua (ANA)',
      capa: SERVICIO,
      caja: CAJA,
      descargado: new Date().toISOString(),
      elaboracion: 'Enero de 2018 (DCERH-ANA, según el servicio)',
      atribucion: (meta.copyrightText || '').replace(/\s+/g, ' ').trim() || 'ANA, DCERH',
      licencia: 'No localizada en el servicio; se atribuye a la ANA',
      escala: 'Red hidrográfica nacional: ríos y quebradas principales; no incluye todas las quebradas urbanas ni delimita la faja marginal',
      registros: features.length,
      nombres,
    },
    features,
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida));
  console.log(`\nGuardado en ${SALIDA}`);
  console.log(`Cursos distintos (${nombres.length}): ${nombres.join(', ')}`);
}

main().catch((err) => {
  console.error(`\nNo se pudo completar la descarga: ${err.message}`);
  console.error('Se conserva el archivo congelado anterior (public/data/quebradas_aqp.geojson), si existe; no se escribió nada.');
  process.exit(1);
});
