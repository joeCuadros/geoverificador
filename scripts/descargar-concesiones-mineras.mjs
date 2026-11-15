/**
 * descargar-concesiones-mineras.mjs — Congela las concesiones y derechos mineros del Catastro Minero de INGEMMET (GEOCATMIN) que tocan Arequipa metropolitana en
 *   public/data/mineria/concesiones_mineras.geojson
 *
 * Fuente: servicio ArcGIS REST de INGEMMET, capa «Catastro Minero»
 *   https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CATASTRO_MINERO/MapServer/0
 * El propio servicio dice: «Catastro Minero Actualizado. La información que se muestra tiene carácter referencial y es solo de consulta» y que los derechos se actualizan a diario.
 *
 * Uso:   node --use-system-ca scripts/descargar-concesiones-mineras.mjs      (o: pnpm datos:mineria)
 *   `--use-system-ca`: el servidor de INGEMMET no envía su certificado intermedio y Node, sin ella, responde «unable to verify the first certificate»; no se desactiva la verificación TLS.
 * Opciones:  --refrescar   vuelve a consultar aunque la respuesta esté en la caché (.cache-mineria/)
 *
 * Qué hace: una consulta (el servicio no admite paginado y devuelve hasta 1000 registros; si llegan 1000 se detiene: la caja sería demasiado grande), con tiempo máximo y
 * reintentos de espera creciente, de todo polígono que INTERSECA la caja de Arequipa metropolitana; cada polígono se guarda ENTERO (sin recortar). NO se guarda el nombre del
 * titular. El archivo lleva `metadata` con la fuente, el enlace, la fecha, el aviso de INGEMMET, los conteos y lo que no dice. Si algo falla NO se escribe nada y se sale con código 1.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const M = require('./lib/mineras.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'data', 'mineria');
const CACHE = join(RAIZ, '.cache-mineria');
const SERVICIO = 'https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_CATASTRO_MINERO/MapServer/0';
const PORTAL = 'https://geocatmin.ingemmet.gob.pe/geocatmin/';
const BBOX = [-16.6, -71.75, -16.2, -71.35]; // sur, oeste, norte, este (CONFIG.viewbox)
const MAX_SERVICIO = 1000;
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico)';
const TIMEOUT_MS = 120000;
const REINTENTOS = 3;
const ESPERA_BASE_MS = 5000;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url) {
  let ultimo = null;
  for (let i = 1; i <= REINTENTOS; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.error) throw new Error(`el servicio respondió un error: ${JSON.stringify(data.error).slice(0, 200)}`);
      return data;
    } catch (err) {
      ultimo = err?.cause?.code || err.message;
      console.warn(`  falló (intento ${i}/${REINTENTOS}): ${ultimo}`);
      if (i < REINTENTOS) await esperar(ESPERA_BASE_MS * i);
    }
  }
  const pista = /CERT|certificate/i.test(String(ultimo)) ? ' Pista: ejecuta con `node --use-system-ca` (el servidor no envía su certificado intermedio).' : '';
  throw new Error(`El servicio de INGEMMET no respondió tras ${REINTENTOS} intentos (${ultimo}).${pista} No se escribió nada.`);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const capa = await pedir(`${SERVICIO}?f=json`);
  const faltan = M.CAMPOS.filter((c) => !(capa.fields || []).some((f) => f.name === c));
  if (faltan.length) throw new Error(`La capa ya no trae los campos ${faltan.join(', ')}. Hay que revisar scripts/lib/mineras.js.`);
  if (capa.geometryType !== 'esriGeometryPolygon') throw new Error(`La capa ya no es de polígonos (${capa.geometryType}).`);
  const ruta = join(CACHE, 'consulta.json');
  let crudo;
  if (existsSync(ruta) && !process.argv.includes('--refrescar')) {
    crudo = JSON.parse(readFileSync(ruta, 'utf8'));
    console.log(`Consulta: respuesta en la caché (${crudo.fecha_descarga}); usa --refrescar para volver a consultar.`);
  } else {
    console.log('Consultando el Catastro Minero de INGEMMET…');
    const data = await pedir(`${SERVICIO}/query?${M.parametrosConsulta(BBOX)}`);
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('La respuesta no es un GeoJSON FeatureCollection.');
    if (data.features.length >= MAX_SERVICIO) throw new Error(`El servicio devolvió ${data.features.length} registros (su máximo): la respuesta podría estar cortada. No se escribió nada.`);
    crudo = { fecha_descarga: new Date().toISOString().slice(0, 10), features: data.features };
    await writeFile(ruta, JSON.stringify(crudo));
  }
  const { features, descartados } = M.convertir(crudo.features);
  if (descartados.length) throw new Error(`Hay polígonos inválidos y no se reparan: ${descartados.map((d) => `${d.codigo} (${d.motivo})`).join('; ')}. No se escribió nada.`);
  if (features.length === 0) throw new Error('Ninguna concesión toca la caja: no puede ser. No se escribió nada.');
  if (new Set(features.map((f) => f.properties.codigo)).size !== features.length) throw new Error('Hay códigos de concesión repetidos. No se escribió nada.');
  const resumen = M.resumir(features);
  const metadata = {
    fuente: 'INGEMMET, Catastro Minero (GEOCATMIN)',
    url_servicio: SERVICIO,
    url_portal: PORTAL,
    capa: capa.name,
    fecha_descarga: crudo.fecha_descarga,
    ultima_actualizacion_en_los_datos: features.map((f) => f.properties.actualizado).filter(Boolean).sort().at(-1) || null,
    aviso_del_servicio: 'Catastro Minero Actualizado. La información que se muestra tiene carácter referencial y es solo de consulta. La actualización de derechos mineros es diaria.',
    licencia: 'No localizada en el servicio; se atribuye a INGEMMET. Datos de consulta pública del geoportal.',
    atribucion: 'Instituto Geológico, Minero y Metalúrgico (INGEMMET), GEOCATMIN',
    caja: { sur: BBOX[0], oeste: BBOX[1], norte: BBOX[2], este: BBOX[3] },
    filtro: 'Todo polígono que intersecta la caja; se guarda entero (sin recortar ni simplificar). Sin el nombre del titular.',
    registros: resumen.total,
    conteo_por_estado: resumen.por_estado,
    conteo_por_sustancia: resumen.por_sustancia,
    hectareas: resumen.hectareas,
    informativo: 'Sin umbral: variable informativa, no entra en el puntaje ni en la búsqueda de zonas del asistente.',
    no_dice: 'Una concesión minera es el derecho a explorar y explotar los minerales dentro de su perímetro (art. 9 del TUO de la Ley General de Minería, D. S. 014-92-EM); es un inmueble distinto y separado del predio. NO dice que haya minería en el lugar, que el predio no sea de otra persona ni que se pueda o no construir, y no reemplaza la consulta al INGEMMET ni a los Registros Públicos. El catastro es referencial.',
    generado: new Date().toISOString().slice(0, 10),
  };
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata }).slice(0, -1);
  const cuerpo = `${cabecera},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  await mkdir(SALIDA, { recursive: true });
  await writeFile(join(SALIDA, 'concesiones_mineras.geojson'), cuerpo);
  console.log(`\nEscrito public/data/mineria/concesiones_mineras.geojson: ${features.length} concesiones, ${resumen.hectareas} ha, ${(Buffer.byteLength(cuerpo) / 1024).toFixed(0)} kB; por estado ${JSON.stringify(resumen.por_estado)}; por sustancia ${JSON.stringify(resumen.por_sustancia)}`);
}

main().catch((err) => { console.error(`\nERROR: ${err.message}`); process.exit(1); });
