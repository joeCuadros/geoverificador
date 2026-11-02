/**
 * descargar-sismos.mjs — Descarga los sismos reportados por el IGP alrededor de Arequipa como GeoJSON.
 *
 * Fuente: Instituto Geofísico del Perú (IGP), servicio monitoreocensis/SismosReportados, capa 0 «Sismos Reportados».
 * OJO con lo que contiene: el 2026-11-02 la capa tenía 765 sismos de todo el país entre el 1 de enero y el 2 de noviembre
 * de 2026, es decir, una ventana reciente de unos 10 meses. NO es el catálogo histórico 1960-2025 (ese se descarga como CSV
 * del repositorio del IGP). Sirve como contexto de actividad reciente, no como predicción ni como zona sísmica oficial
 * (la referencia normativa es la zona de la Norma E.030).
 *
 * Uso:   node scripts/descargar-sismos.mjs
 * Sale:  public/data/sismos_igp.geojson
 *
 * Decisiones:
 *  - Se guarda un recuadro de ~1,2° (≈ 133 km) alrededor de la Plaza de Armas, suficiente para radios de hasta 100 km.
 *  - Se guarda la ventana de fechas REAL del archivo (metadata.fechaDesde y fechaHasta): la vista la muestra, porque un
 *    conteo no se entiende sin su periodo.
 *  - Si la descarga falla, no se escribe nada y se conserva el archivo congelado anterior (si no existe, la variable muestra
 *    SIN DATO).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ CONFIGURACIÓN
const SERVICIO =
  process.env.SISMOS_URL ||
  'https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/SismosReportados/MapServer/0';

// Centro de Arequipa ±1,2° (oeste, sur, este, norte).
const CAJA = [-72.74, -17.6, -70.34, -15.2];
const DECIMALES = 3;
const PAGINA = 1000;
const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'sismos_igp.geojson');
const CAMPOS = ['objectid', 'fecha', 'lat', 'lon', 'prof', 'magnitud', 'ref'];

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
const dia = (ms) => new Date(ms).toISOString().slice(0, 10);

// ------------------------------------------------------------------------- PRINCIPAL
async function main() {
  console.log(`Capa: ${SERVICIO}\n`);
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
      returnGeometry: 'false',
      resultOffset: String(desde),
      resultRecordCount: String(PAGINA),
    });
    crudos.push(...(data.features || []));
    if (!data.exceededTransferLimit) break;
  }
  console.log(`Sismos recibidos en el recuadro: ${crudos.length}`);

  // La ventana de fechas de TODA la capa, para saber qué periodo cubre el conteo (aunque no haya sismos en el recuadro).
  const est = await pedir(`${SERVICIO}/query`, {
    where: '1=1',
    outStatistics: JSON.stringify([
      { statisticType: 'min', onStatisticField: 'fecha', outStatisticFieldName: 'desde' },
      { statisticType: 'max', onStatisticField: 'fecha', outStatisticFieldName: 'hasta' },
      { statisticType: 'count', onStatisticField: 'objectid', outStatisticFieldName: 'total' },
    ]),
  });
  const ventana = (est.features && est.features[0] && est.features[0].attributes) || null;
  if (!ventana || typeof ventana.desde !== 'number' || typeof ventana.hasta !== 'number') {
    throw new Error('No se pudo conocer el periodo que cubre la capa; sin él no se guarda el archivo.');
  }

  const vistos = new Set();
  const features = [];
  for (const f of crudos) {
    const a = f.attributes || {};
    if (vistos.has(a.objectid) || typeof a.lat !== 'number' || typeof a.lon !== 'number' || typeof a.fecha !== 'number') continue;
    vistos.add(a.objectid);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [redondear(a.lon), redondear(a.lat)] },
      properties: {
        id: a.objectid,
        fecha: dia(a.fecha),
        magnitud: typeof a.magnitud === 'number' ? a.magnitud : null,
        profundidadKm: typeof a.prof === 'number' ? a.prof : null,
        ref: a.ref ?? null,
      },
    });
  }

  // No pisar un archivo congelado con una respuesta que cubra menos (por ejemplo, un servicio reiniciado).
  const anterior = await readFile(SALIDA, 'utf8').then((s) => JSON.parse(s)).catch(() => null);
  const previos = anterior && anterior.metadata ? anterior.metadata.totalCapa : 0;
  if (previos > ventana.total && !process.argv.includes('--forzar')) {
    console.warn(`\nLa capa tiene ahora ${ventana.total} sismos y el archivo congelado se hizo con ${previos}. No se escribió nada (usa --forzar para guardar de todos modos).`);
    return;
  }

  const magnitudes = features.map((f) => f.properties.magnitud).filter((m) => m !== null);
  const salida = {
    type: 'FeatureCollection',
    metadata: {
      fuente: 'Sismos reportados, Instituto Geofísico del Perú (IGP)',
      capa: SERVICIO,
      caja: CAJA,
      descargado: new Date().toISOString(),
      fechaDesde: dia(ventana.desde),
      fechaHasta: dia(ventana.hasta),
      totalCapa: ventana.total,
      licencia: 'Open Data Commons Attribution (catálogo del IGP en datosabiertos.gob.pe); no se localizó la licencia de este servicio',
      alcance: 'Ventana reciente de la capa «Sismos Reportados», no el catálogo histórico; es contexto, no predicción',
      registros: features.length,
      magnitudMaxima: magnitudes.length ? Math.max(...magnitudes) : null,
    },
    features,
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida));
  console.log(`\nGuardado en ${SALIDA}`);
  console.log(`Periodo de la capa: ${salida.metadata.fechaDesde} a ${salida.metadata.fechaHasta} (${ventana.total} sismos en todo el país)`);
  console.log(`En el recuadro: ${features.length}; magnitud máxima ${salida.metadata.magnitudMaxima}`);
}

main().catch((err) => {
  console.error(`\nNo se pudo completar la descarga: ${err.message}`);
  console.error('Se conserva el archivo congelado anterior (public/data/sismos_igp.geojson), si existe; no se escribió nada.');
  process.exit(1);
});
