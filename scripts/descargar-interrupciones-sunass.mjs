/**
 * descargar-interrupciones-sunass.mjs — Congela, por distrito de Arequipa metropolitana, cuántas interrupciones del servicio de agua potable reportó SEDAPAR a la
 * SUNASS y cuántas horas sumaron, por año, en
 *   public/data/agua/interrupciones_sedapar.json
 *
 * Fuente: «Registro de interrupciones del servicio de agua y alcantarillado imprevistas y programadas reportadas por las empresas prestadoras a la Sunass» (SUNASS),
 * datosabiertos.gob.pe, licencia Open Data Commons Attribution License (ODC-By):
 *   https://www.datosabiertos.gob.pe/dataset/registro-de-interrupciones-del-servicio-de-agua-y-alcantarillado-imprevistas-y-programadas
 *   https://www.datosabiertos.gob.pe/sites/default/files/Interrupciones_Dataset.csv
 *
 * Uso:   node scripts/descargar-interrupciones-sunass.mjs      (o: pnpm datos:interrupciones)
 * Opción:  --refrescar   vuelve a descargar el CSV aunque esté en la caché (.cache-sunass/)
 *
 * Qué hace: descarga el CSV (con tiempo máximo y reintentos de espera creciente), lo reduce con scripts/lib/interrupciones.js y escribe el JSON con `metadata`: fuente,
 * enlaces, licencia, fecha de descarga, huella SHA-256 del CSV, periodo, años completos y parciales, lo que se descartó y lo que el dato no dice.
 * Si el sitio no responde o el formato cambió NO escribe nada y sale con código 1: la aplicación sigue con el último archivo congelado y, si no hay ninguno, no muestra el dato.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const I = require('./lib/interrupciones.js');
const { parsearCsv } = require('./lib/csv.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'data', 'agua');
const CACHE = join(RAIZ, '.cache-sunass');
const PAGINA = 'https://www.datosabiertos.gob.pe/dataset/registro-de-interrupciones-del-servicio-de-agua-y-alcantarillado-imprevistas-y-programadas';
const CSV = 'https://www.datosabiertos.gob.pe/sites/default/files/Interrupciones_Dataset.csv';
const DICCIONARIO = 'https://www.datosabiertos.gob.pe/sites/default/files/Interrupciones_DiccionarioDatos.xlsx';
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico)';
const TIMEOUT_MS = 120000;
const REINTENTOS = 3;
const COLUMNAS = ['IDINTERRUPCION', 'EPS', 'SEDE', 'TIPOINTERRUPCION', 'TIPOSERVICIO', 'MOTIVOINTERRUPCION', 'FECHAINICIO', 'HORAINICIO', 'FECHAFIN', 'HORAFIN', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'NUMCONEXDOM', 'UNIDADESUSO', 'NUMCAMIONESPUNTOS'];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function obtenerCsv(refrescar) {
  mkdirSync(CACHE, { recursive: true });
  const ruta = join(CACHE, 'Interrupciones_Dataset.csv');
  if (existsSync(ruta) && !refrescar) {
    console.log('CSV: en la caché; usa --refrescar para volver a descargarlo.');
    return { buffer: readFileSync(ruta), fecha: null };
  }
  let ultimo = null;
  for (let i = 1; i <= REINTENTOS; i++) {
    try {
      console.log(`Descargando ${CSV} (intento ${i}/${REINTENTOS})…`);
      const res = await fetch(CSV, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFile(ruta, buffer);
      return { buffer, fecha: new Date().toISOString().slice(0, 10) };
    } catch (err) {
      ultimo = err?.cause?.code || err.message;
      console.warn(`  falló: ${ultimo}`);
      if (i < REINTENTOS) await esperar(5000 * i);
    }
  }
  throw new Error(`No se pudo descargar el CSV de la SUNASS tras ${REINTENTOS} intentos (${ultimo}). No se escribió nada.`);
}

function distritosDelProyecto() {
  const fc = JSON.parse(readFileSync(join(RAIZ, 'public', 'data', 'distritos_aqp.geojson'), 'utf8'));
  return fc.features.map((f) => f.properties.distrito);
}

async function main() {
  const { buffer, fecha } = await obtenerCsv(process.argv.includes('--refrescar'));
  const filas = parsearCsv(buffer.toString('utf8'));
  const faltan = COLUMNAS.filter((c) => !(filas[0] && c in filas[0]));
  if (filas.length === 0 || faltan.length) throw new Error(`El CSV cambió de formato (columnas que faltan: ${faltan.join(', ') || 'todas'}). Hay que revisar scripts/lib/interrupciones.js. No se escribió nada.`);
  const distritos = distritosDelProyecto();
  const r = I.agregar(filas, { distritos });
  if (!r.periodo || Object.keys(r.distritos).length === 0) throw new Error('Ninguna interrupción de SEDAPAR cayó en los distritos del proyecto: el formato cambió. No se escribió nada.');
  const total = Object.values(r.distritos).reduce((t, d) => t + d.total.n, 0);
  const metadata = {
    fuente: 'SUNASS (Superintendencia Nacional de Servicios de Saneamiento), Registro de interrupciones del servicio de agua y alcantarillado imprevistas y programadas, reportadas por las empresas prestadoras',
    empresa: 'SEDAPAR',
    servicio: 'AGUA POTABLE',
    url_pagina: PAGINA,
    url_csv: CSV,
    url_diccionario: DICCIONARIO,
    licencia: 'Open Data Commons Attribution License (ODC-By)',
    atribucion: 'SUNASS, vía datosabiertos.gob.pe',
    fecha_descarga: fecha || new Date().toISOString().slice(0, 10),
    sha256_csv: createHash('sha256').update(buffer).digest('hex'),
    filas_en_el_csv: filas.length,
    periodo: r.periodo,
    anios_completos: r.anios_completos,
    anios_parciales: r.anios_parciales,
    interrupciones_contadas: total,
    descartes: r.descartes,
    como_se_cuenta: 'Una interrupción (IDINTERRUPCION) cuenta una vez por distrito aunque tenga varias filas (sectores). Las horas son de la fecha y hora de inicio a las de fin de cada interrupción, sumadas; NO se multiplican por las conexiones afectadas. Cada una se asigna al año en que empezó. Solo agua potable (el alcantarillado tiene 7 filas) y solo los distritos de public/data/distritos_aqp.geojson.',
    informativo: 'Sin umbral: variable informativa, no entra en el puntaje ni en la búsqueda de zonas del asistente.',
    no_dice: 'Son interrupciones REPORTADAS por SEDAPAR a la SUNASS: no dice cuántas hubo en realidad, ni que un distrito con más registros tenga peor servicio (un distrito más grande tiene más conexiones y más interrupciones), ni cuántas viviendas afectó cada una, ni qué calle o urbanización, ni que ocurra hoy: el archivo termina en abril de 2024 y 2019 y 2024 son años parciales. No dice el estado del servicio de un predio en particular.',
    generado: new Date().toISOString().slice(0, 10),
  };
  const cuerpo = `${JSON.stringify({ metadata }).slice(0, -1)},"distritos":{\n${Object.entries(r.distritos).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')}\n}}\n`;
  await mkdir(SALIDA, { recursive: true });
  await writeFile(join(SALIDA, 'interrupciones_sedapar.json'), cuerpo);
  console.log(`\nEscrito public/data/agua/interrupciones_sedapar.json: ${total} interrupciones en ${Object.keys(r.distritos).length} distritos, periodo ${r.periodo.desde} a ${r.periodo.hasta} (años completos ${r.anios_completos.join(', ')}); descartes ${JSON.stringify(r.descartes)}`);
}

main().catch((err) => { console.error(`\nERROR: ${err.message}`); process.exit(1); });
