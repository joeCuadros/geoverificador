/**
 * descargar-distritos.mjs — Descarga los límites distritales de Arequipa metropolitana como GeoJSON.
 *
 * Fuente: capa «Distritos» del servicio SERV_CARTOGRAFIA_DEMARCACION_WGS84 de GEOCATMIN (INGEMMET). Cada distrito
 * trae su campo FUENTE (límites remitidos por el INEI); se conserva tal cual en el archivo de salida.
 * Se usan para saber en qué distrito cae un punto y, con él, su zona sísmica según la Norma E.030 (data/zonas_sismicas_e030.json).
 *
 * Uso:   node scripts/descargar-distritos.mjs
 * Sale:  public/data/distritos_aqp.geojson
 *
 * Decisiones:
 *  - Se consulta por la caja de Arequipa metropolitana (la misma de CONFIG.viewbox) y se guardan todos los distritos que la tocan.
 *  - El script falla si algún distrito de la provincia de Arequipa no aparece en el Anexo II de la E.030 transcrito:
 *    así nunca queda un distrito sin zona sísmica asignada por error.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPA = process.env.DISTRITOS_URL || 'https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CARTOGRAFIA_DEMARCACION_WGS84/MapServer/2';
const CAJA = [-71.75, -16.6, -71.35, -16.2]; // oeste, sur, este, norte (CONFIG.viewbox)
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'data', 'distritos_aqp.geojson');
const E030 = join(RAIZ, 'public', 'data', 'zonas_sismicas_e030.json');

const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, (m, i, t) => (t[i - 1] === 'N' && m === '̃' ? m : '')).normalize('NFC');

async function main() {
  const [oeste, sur, este, norte] = CAJA;
  const url = `${CAPA}/query?${new URLSearchParams({
    where: '1=1',
    geometry: `${oeste},${sur},${este},${norte}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'CD_DIST,NM_DIST,NM_PROV,NM_DEPA,FUENTE,FEC_ING',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar ${CAPA}`);
  const fc = await res.json();
  if (fc.error) throw new Error(`El servicio respondió ${fc.error.code}: ${fc.error.message}`);
  if (!Array.isArray(fc.features) || fc.features.length === 0) throw new Error('El servicio no devolvió distritos.');
  if (fc.exceededTransferLimit) throw new Error('El servicio llegó a su tope de registros: faltarían distritos.');

  const e030 = JSON.parse(await readFile(E030, 'utf8'));
  const features = fc.features.map((f) => {
    const p = f.properties || {};
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        ubigeo: p.CD_DIST,
        distrito: sinTildes(p.NM_DIST),
        provincia: sinTildes(p.NM_PROV),
        departamento: sinTildes(p.NM_DEPA),
        fuente_limite: p.FUENTE ?? null,
        fecha_ingreso: p.FEC_ING ?? null,
      },
    };
  });

  const sinZona = features
    .map((f) => f.properties)
    .filter((p) => !e030.anexo_ii?.[p.departamento]?.[p.provincia]?.[p.distrito]);
  if (sinZona.length) {
    throw new Error(`Distritos sin zona sísmica en la transcripción de la E.030: ${sinZona.map((p) => `${p.distrito} (${p.provincia})`).join(', ')}`);
  }

  const salida = {
    type: 'FeatureCollection',
    metadata: {
      fuente: 'Límites distritales, servicio SERV_CARTOGRAFIA_DEMARCACION_WGS84 de GEOCATMIN (INGEMMET); campo fuente_limite según el servicio',
      capa: CAPA,
      caja: CAJA,
      descargado: new Date().toISOString(),
      registros: features.length,
    },
    features,
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida));
  console.log(`Guardado en ${SALIDA}: ${features.length} distritos`);
  console.log(features.map((f) => `${f.properties.distrito} (${f.properties.provincia}) → zona ${e030.anexo_ii[f.properties.departamento][f.properties.provincia][f.properties.distrito]}`).join('\n'));
  console.log('Fuentes de los límites:', [...new Set(features.map((f) => f.properties.fuente_limite))].join(' | '));
}

main().catch((err) => {
  console.error(`\nNo se pudo completar la descarga: ${err.message}`);
  process.exit(1);
});
