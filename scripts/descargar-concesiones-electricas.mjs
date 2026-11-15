/**
 * descargar-concesiones-electricas.mjs — Descarga las concesiones de distribución eléctrica del MINEM (Dirección General de Electricidad)
 * que tocan Arequipa metropolitana y las congela en el archivo que lee la aplicación:
 *   public/data/electricidad/concesiones_distribucion.geojson
 *
 * Fuente: servicio ArcGIS REST del geoportal del MINEM, capa 0 «Concesiones de Distribución Eléctrica»
 *   https://geoportal.minem.gob.pe/minem/rest/services/WMS/DGE_DISTRIBUCION_ELECTRICA/MapServer/0
 * El mismo conjunto está descrito en datosabiertos.gob.pe («Concesiones de Distribución Eléctrica», MINEM-DGE, licencia ODC-By).
 *
 * Uso:   node scripts/descargar-concesiones-electricas.mjs      (o: pnpm datos:electricidad)
 * Opciones:
 *   --refrescar   vuelve a consultar el servicio aunque haya una respuesta en la caché
 *
 * Qué hace:
 *  - Lee primero la descripción de la capa (?f=json) y comprueba que sigan los campos que se usan y el límite de registros por página.
 *  - Consulta por páginas (resultOffset / resultRecordCount, con orden por OBJECTID) todo polígono que INTERSECA la caja de Arequipa metropolitana
 *    (la de CONFIG.viewbox). El servicio devuelve cada polígono ENTERO: no se recorta a la caja ni a los distritos y no se simplifica.
 *    Se conservan TODAS las concesiones que tocan la caja, no solo las de SEAL; cada una lleva su concesionaria.
 *  - Con tiempo máximo en cada solicitud, reintentos de espera creciente y un User-Agent propio. La respuesta queda en .cache-electricidad/
 *    (no se sube al repositorio).
 *  - El archivo lleva `metadata` con la fuente, los enlaces, la fecha de descarga, la licencia, las concesionarias, los expedientes, el
 *    conteo y lo que NO dice (una concesión no es una conexión).
 *  - Si algo falla (red, formato, campos distintos, ningún polígono, un polígono inválido) NO se escribe nada y se sale con código 1.
 *    Nunca se inventan ni se rellenan datos.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Concesiones = require('./lib/concesiones.js');

// ------------------------------------------------------------------ CONFIGURACIÓN
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'data', 'electricidad');
const CACHE = join(RAIZ, '.cache-electricidad');
const SERVICIO = 'https://geoportal.minem.gob.pe/minem/rest/services/WMS/DGE_DISTRIBUCION_ELECTRICA/MapServer/0';
const PAGINA_DATOS = 'https://www.datosabiertos.gob.pe/dataset/concesiones-de-distribuci%C3%B3n-el%C3%A9ctrica';
// Misma caja que CONFIG.viewbox (sur, oeste, norte, este).
const BBOX = [-16.6, -71.75, -16.2, -71.35];
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico)';
const TIMEOUT_MS = 60000;
const REINTENTOS = 3;
const ESPERA_BASE_MS = 4000;
const PAGINA = 200; // por debajo del maxRecordCount del servicio
const MAX_PAGINAS = 50;

const NO_DICE =
  'El área de concesión dice a qué empresa le corresponde dar el servicio de distribución en esa zona; NO dice que un predio esté conectado, que haya red en su calle ' +
  'ni que el suministro sea continuo. La cobertura real de conexión vendría de un censo (p. ej. el Censo de Población y Vivienda del INEI), que este proyecto no ' +
  'tiene todavía. Los polígonos son del registro de concesiones: no se corrigieron ni se recortaron.';

// ------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedirJson(url) {
  let ultimo = null;
  for (let i = 1; i <= REINTENTOS; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
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
  throw new Error(`El servicio del MINEM no respondió tras ${REINTENTOS} intentos (${ultimo}). No se escribió nada.`);
}

async function descripcionDeLaCapa() {
  const d = await pedirJson(`${SERVICIO}?f=json`);
  const nombres = (d.fields || []).map((f) => f.name);
  const faltan = Object.keys(Concesiones.CAMPOS).filter((c) => !nombres.includes(c));
  if (faltan.length) throw new Error(`La capa ya no trae los campos ${faltan.join(', ')} (trae: ${nombres.join(', ')}). Hay que revisar scripts/lib/concesiones.js.`);
  if (d.geometryType !== 'esriGeometryPolygon') throw new Error(`La capa ya no es de polígonos (${d.geometryType}).`);
  return d;
}

async function consultar(capa, refrescar) {
  const ruta = join(CACHE, 'consulta.json');
  const hash = createHash('sha1').update(`${SERVICIO}|${BBOX.join(',')}|${PAGINA}|${Object.keys(Concesiones.CAMPOS).join(',')}`).digest('hex');
  if (existsSync(ruta) && !refrescar) {
    const g = JSON.parse(readFileSync(ruta, 'utf8'));
    if (g.hash === hash) {
      console.log(`Consulta: respuesta en la caché (${g.fecha_descarga}); usa --refrescar para volver a consultar.`);
      return g;
    }
  }
  const crudas = [];
  for (let pag = 0; pag < MAX_PAGINAS; pag++) {
    const offset = pag * PAGINA;
    console.log(`Consultando el servicio (registros ${offset + 1} en adelante)…`);
    const data = await pedirJson(`${SERVICIO}/query?${Concesiones.parametrosConsulta(BBOX, offset, PAGINA)}`);
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('La respuesta no es un GeoJSON FeatureCollection.');
    crudas.push(...data.features);
    // GeoJSON de ArcGIS: `exceededTransferLimit` (a veces dentro de `properties`) avisa que hay más páginas.
    const hayMas = data.exceededTransferLimit === true || (data.properties && data.properties.exceededTransferLimit === true) || data.features.length === PAGINA;
    if (!hayMas) break;
    if (pag === MAX_PAGINAS - 1) throw new Error(`Más de ${MAX_PAGINAS * PAGINA} registros: algo no cuadra. No se escribió nada.`);
    await esperar(1000);
  }
  const guardado = { hash, fecha_descarga: new Date().toISOString().slice(0, 10), capa: { nombre: capa.name, maxRecordCount: capa.maxRecordCount }, features: crudas };
  await mkdir(CACHE, { recursive: true });
  await writeFile(ruta, JSON.stringify(guardado));
  return guardado;
}

// ------------------------------------------------------------------ PRINCIPAL
async function main() {
  const refrescar = process.argv.includes('--refrescar');
  mkdirSync(CACHE, { recursive: true });

  const capa = await descripcionDeLaCapa();
  console.log(`Capa «${capa.name}» (${capa.geometryType}); máximo ${capa.maxRecordCount} registros por solicitud.`);
  const crudo = await consultar(capa, refrescar);

  const { features, descartados } = Concesiones.convertir(crudo.features);
  if (descartados.length) throw new Error(`Hay polígonos inválidos y no se reparan: ${descartados.map((d) => `OBJECTID ${d.objectid} (${d.motivo})`).join('; ')}. No se escribió nada.`);
  if (features.length === 0) throw new Error('Ninguna concesión toca la caja de Arequipa: no puede ser. No se escribió nada.');
  const seal = features.filter((f) => f.properties.concesionaria === 'SEAL');
  if (seal.length === 0) throw new Error('No hay ninguna concesión de SEAL en Arequipa: no puede ser. No se escribió nada.');
  if (new Set(features.map((f) => f.properties.objectid)).size !== features.length) throw new Error('Hay OBJECTID repetidos. No se escribió nada.');

  const resumen = Concesiones.resumir(features);
  const metadata = {
    fuente: 'MINEM (Dirección General de Electricidad), Concesiones de Distribución Eléctrica',
    url_servicio: SERVICIO,
    url_datos_abiertos: PAGINA_DATOS,
    capa: crudo.capa.nombre,
    fecha_descarga: crudo.fecha_descarga,
    licencia: 'Open Data Commons Attribution License (ODC-By)',
    atribucion: 'Ministerio de Energía y Minas (MINEM), Dirección General de Electricidad',
    caja: { sur: BBOX[0], oeste: BBOX[1], norte: BBOX[2], este: BBOX[3] },
    filtro: 'Todo polígono que intersecta la caja; se guarda entero (sin recortar ni simplificar).',
    registros: resumen.total,
    conteo_por_concesionaria: resumen.por_concesionaria,
    expedientes: resumen.expedientes,
    concesionarias: [...new Set(features.map((f) => `${f.properties.concesionaria}: ${f.properties.empresa}`))].sort(),
    campos_del_servicio: Concesiones.CAMPOS,
    informativo: 'Sin umbral: variable informativa, no entra en el puntaje ni en la búsqueda de zonas del asistente.',
    no_dice: NO_DICE,
    generado: new Date().toISOString().slice(0, 10),
  };
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata }).slice(0, -1);
  const cuerpo = `${cabecera},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  await mkdir(SALIDA, { recursive: true });
  await writeFile(join(SALIDA, 'concesiones_distribucion.geojson'), cuerpo);

  console.log(`\nEscrito public/data/electricidad/concesiones_distribucion.geojson: ${features.length} concesiones, ${(Buffer.byteLength(cuerpo) / 1024).toFixed(0)} kB.`);
  features.forEach((f) => console.log(`  ${f.properties.concesionaria} · ${f.properties.nombre_zona} (${f.properties.concesion}; expediente ${f.properties.expediente}; ${f.properties.situacion})`));
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
