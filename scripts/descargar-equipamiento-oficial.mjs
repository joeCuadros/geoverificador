/**
 * descargar-equipamiento-oficial.mjs — Arma el equipamiento de SALUD, de CONSULTORIOS
 * MÉDICOS y de EDUCACIÓN con los registros oficiales como fuente primaria y OpenStreetMap como respaldo, y lo escribe en los
 * mismos archivos que lee la aplicación:
 *   public/data/equipamiento/salud.geojson         RENIPRESS (SUSALUD), datosabiertos.gob.pe: establecimientos de salud (hospitales, clínicas, centros y puestos…)
 *   public/data/equipamiento/consultorios.geojson  RENIPRESS (SUSALUD): consultorios médicos, categoría aparte (informativa, sin umbral)
 *   public/data/equipamiento/educacion.geojson     Padrón de instituciones educativas de ESCALE (MINEDU)
 *
 * Uso:   node scripts/descargar-equipamiento-oficial.mjs      (o: pnpm datos:oficial)
 * Opciones:
 *   --refrescar            vuelve a descargar aunque la edición ya esté en la caché
 *   --radio=200            radio (m) de la deduplicación con OpenStreetMap (por omisión 200)
 *   --renipress=ruta.csv   usa ese CSV en vez de descargarlo (con --fecha-renipress=AAAA-MM-DD si el nombre no la trae)
 *   --escale=ruta.zip|dbf  usa ese archivo en vez de descargarlo (con --fecha-escale=AAAA-MM-DD si el nombre no la trae)
 *
 * Requiere la copia de OpenStreetMap de salud y educación (public/data/equipamiento/osm, de `pnpm datos:extraer`): es el respaldo.
 * Si existe osm/consultorios.geojson se suma a osm/salud.geojson y el conjunto se reparte con Calculos.categoriaSalud (así sirve
 * también la copia anterior, que traía los consultorios dentro de la salud).
 *
 * Qué hace (reglas en docs/METODOLOGIA.md §3.2 y §3.3):
 *  - Descarga con cortesía: una solicitud a la vez, con pausa entre solicitudes, identificándose, con reintentos de espera
 *    creciente. Las descargas quedan en la caché local .cache-equipamiento-oficial/ (no se sube al repositorio).
 *  - Salud: del CSV de RENIPRESS deja los establecimientos ACTIVOS de la provincia de Arequipa con coordenadas (NORTE = latitud
 *    y ESTE = longitud, en grados decimales) dentro de los polígonos de los distritos, de tipo «con internamiento» o «sin
 *    internamiento» y categoría I-1 a III-E. Excluye el servicio médico de apoyo y el centro odontológico. Lo que queda se
 *    reparte en dos categorías: «consultorio» (la clasificación de RENIPRESS dice CONSULTORIO) y «salud» (todo lo demás).
 *  - Educación: del Padron_web.dbf de ESCALE deja los locales ACTIVOS de la provincia de Arequipa con coordenadas, de educación
 *    básica regular (inicial, primaria, secundaria), públicos y privados, uno por código de local.
 *  - Fusión por categoría: entra todo punto oficial; de OpenStreetMap, solo lo que ningún punto oficial de la MISMA categoría (salud,
 *    consultorio o, en educación, nivel) cubre a `radio` m.
 *  - Cada elemento lleva `fuente` (RENIPRESS | ESCALE | OSM) y su código oficial; el bloque `metadata` lleva las direcciones,
 *    fechas y licencias de cada fuente, los conteos por fuente y la regla de deduplicación.
 *  - Si algo falla (red, formato, archivo vacío) NO se escribe nada y se sale con código 1, diciendo el error exacto.
 *    Nunca se inventan ni se rellenan datos.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const E = require('./lib/equipamiento-oficial.js');
const Calculos = require('../public/js/calculos.js');

// ------------------------------------------------------------------ CONFIGURACIÓN
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATOS = join(RAIZ, 'public', 'data');
const SALIDA = join(DATOS, 'equipamiento');
const CACHE = join(RAIZ, '.cache-equipamiento-oficial');
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico)';
const PAUSA_MS = 2000; // espera entre solicitudes al mismo servicio
const REINTENTOS = 3;
const TIMEOUT_MS = 600000;

const PAGINA_RENIPRESS = 'https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress';
const PAGINA_ESCALE = 'https://escale.minedu.gob.pe/padron-de-iiee';
const BIBLIOTECA_ESCALE = 'https://escale.minedu.gob.pe/uee/-/document_library_display/GMv7/view/958881';
const ENTRADA_DBF = 'Padron_web.dbf';

const REGLA_SALUD =
  'Registros de RENIPRESS con ESTADO = ACTIVO, de la provincia de Arequipa, con NORTE (latitud) y ESTE (longitud) en grados decimales dentro de los polígonos de ' +
  'los distritos (public/data/distritos_aqp.geojson), de tipo de establecimiento «con internamiento» o «sin internamiento» y categoría I-1, I-2, I-3, I-4, II-1, II-2, ' +
  'II-E, III-1, III-2 o III-E (NTS 021-MINSA/DGSP-V.03). Se excluyen el servicio médico de apoyo (laboratorios, diagnóstico por imágenes, hemodiálisis, ópticas y ' +
  'traslado de pacientes; categoría 0) y el centro odontológico. Este archivo trae solo los establecimientos de salud: el consultorio médico (clasificación con la palabra ' +
  'CONSULTORIO) es otra categoría y está en consultorios.geojson.';
const REGLA_CONSULTORIOS =
  'Registros de RENIPRESS que pasan la misma selección que la salud (ESTADO = ACTIVO, provincia de Arequipa, coordenadas dentro de los distritos, con o sin internamiento, ' +
  'categoría I-1 a III-E, sin servicio médico de apoyo ni centro odontológico) y cuya clasificación contiene CONSULTORIO («CONSULTORIOS MEDICOS Y DE OTROS PROFESIONALES ' +
  'DE LA SALUD»); si el registro no trae clasificación, cuenta el nombre. La categoría I-n no decide: hay puestos de salud I-1 e I-2. Es una variable informativa: no tiene ' +
  'umbral ni entra en el puntaje.';
const REGLA_EDUCACION =
  'Instituciones del Padron_web.dbf con ESTADO = Activo, de la provincia de Arequipa, con NLAT_IE y NLONG_IE dentro de los polígonos de los distritos y de educación ' +
  'básica regular: NIV_MOD A1, A2 y A3 = inicial, B0 = primaria, F0 = secundaria (pares NIV_MOD / D_NIV_MOD observados en el propio padrón). Se excluyen A5 (programa ' +
  'no escolarizado), C0 y G0 (adultos), D0 a D2 (básica alternativa), E0 a E2 y K0 (básica especial), L* (técnico-productiva) y M0, P0, S0 y T0 (superior). Públicas y ' +
  'privadas. Una fila del padrón es una institución; se deduplican por código de local y cada local lista sus instituciones.';

// ------------------------------------------------------------------ ARGUMENTOS
function argumentos(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

// ------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let primeraSolicitud = true;

async function conReintentos(descripcion, url, accion) {
  const fallos = [];
  for (let intento = 1; intento <= REINTENTOS; intento++) {
    if (!primeraSolicitud) await esperar(PAUSA_MS * intento);
    primeraSolicitud = false;
    try {
      return await accion();
    } catch (err) {
      const causa = err?.cause?.code || err.message;
      fallos.push(`intento ${intento}: ${causa}`);
      console.warn(`  ${descripcion} falló (${causa})`);
    }
  }
  throw new Error(`${descripcion} falló tras ${REINTENTOS} intentos (${fallos.join('; ')}).\nURL: ${url}`);
}

async function descargarTexto(url) {
  return conReintentos('La consulta', url, async () => {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
}

async function descargarArchivo(url, destino) {
  await mkdir(dirname(destino), { recursive: true });
  return conReintentos('La descarga', url, async () => {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const esperado = Number(res.headers.get('content-length')) || null;
    const parcial = `${destino}.parcial`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(parcial));
    const real = statSync(parcial).size;
    if (esperado && real !== esperado) throw new Error(`se recibieron ${real} bytes de ${esperado}`);
    if (real === 0) throw new Error('el archivo llegó vacío');
    await rename(parcial, destino);
  });
}

// ------------------------------------------------------------------ OBTENER LOS ARCHIVOS
const fechaDeNombre = (nombre) => {
  const a = /(\d{2})-(\d{2})-(\d{4})/.exec(nombre);
  if (a) return `${a[3]}-${a[2]}-${a[1]}`;
  const b = /(\d{4})(\d{2})(\d{2})/.exec(nombre);
  return b ? `${b[1]}-${b[2]}-${b[3]}` : null;
};

async function obtenerRenipress(a) {
  if (a.renipress && a.renipress !== true) {
    const fecha = a['fecha-renipress'] || fechaDeNombre(basename(a.renipress));
    if (!fecha) throw new Error('Con --renipress=ruta indica la fecha de la edición: --fecha-renipress=AAAA-MM-DD.');
    return { ruta: a.renipress, fecha, url: null, nombre: basename(a.renipress) };
  }
  console.log(`RENIPRESS: buscando la edición más reciente en ${PAGINA_RENIPRESS}`);
  const ed = E.ultimaEdicionRenipress(await descargarTexto(PAGINA_RENIPRESS));
  const ruta = join(CACHE, ed.nombre);
  if (existsSync(ruta) && !a.refrescar) console.log(`  ${ed.nombre} ya está en la caché.`);
  else {
    console.log(`  descargando ${ed.url}`);
    await descargarArchivo(ed.url, ruta);
  }
  return { ruta, ...ed };
}

async function obtenerEscale(a) {
  if (a.escale && a.escale !== true) {
    const fecha = a['fecha-escale'] || fechaDeNombre(basename(a.escale));
    if (!fecha) throw new Error('Con --escale=ruta indica la fecha del padrón: --fecha-escale=AAAA-MM-DD.');
    let dbf = a.escale;
    if (/\.zip$/i.test(dbf)) dbf = await extraerDbf(dbf, join(CACHE, `${basename(dbf, '.zip')}-dbf`, ENTRADA_DBF), a.refrescar);
    return { ruta: dbf, fecha, url: null, nombre: basename(a.escale) };
  }
  console.log(`ESCALE: buscando el padrón más reciente en ${BIBLIOTECA_ESCALE}`);
  const ed = E.ultimoPadronEscale(await descargarTexto(BIBLIOTECA_ESCALE));
  const zip = join(CACHE, ed.nombre);
  if (existsSync(zip) && !a.refrescar) console.log(`  ${ed.nombre} ya está en la caché.`);
  else {
    console.log(`  descargando ${ed.url}`);
    await descargarArchivo(ed.url, zip);
  }
  const dbf = await extraerDbf(zip, join(CACHE, `${basename(zip, '.zip')}-dbf`, ENTRADA_DBF), a.refrescar);
  return { ruta: dbf, ...ed };
}

async function extraerDbf(zip, destino, refrescar) {
  if (existsSync(destino) && !refrescar) return destino;
  await mkdir(dirname(destino), { recursive: true });
  console.log(`  extrayendo ${ENTRADA_DBF} de ${basename(zip)}`);
  await E.extraerEntradaZip(zip, ENTRADA_DBF, destino);
  return destino;
}

// ------------------------------------------------------------------ GEOGRAFÍA Y OSM
/** `dentro(lat, lon)`: ¿el punto cae en algún polígono de los distritos de public/data/distritos_aqp.geojson? */
function dentroDeDistritos() {
  const fc = JSON.parse(readFileSync(join(DATOS, 'distritos_aqp.geojson'), 'utf8'));
  const zonas = fc.features.map((f) => {
    const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const pts = polis.flatMap((p) => p[0]);
    return { polis, caja: [Math.min(...pts.map((c) => c[0])), Math.min(...pts.map((c) => c[1])), Math.max(...pts.map((c) => c[0])), Math.max(...pts.map((c) => c[1]))] };
  });
  return (lat, lon) => zonas.some((z) => lon >= z.caja[0] && lon <= z.caja[2] && lat >= z.caja[1] && lat <= z.caja[3] && z.polis.some((anillos) => Calculos.puntoEnPoligono(lat, lon, anillos)));
}

function leerOsm(nombre) {
  const ruta = join(SALIDA, 'osm', `${nombre}.geojson`);
  if (!existsSync(ruta)) throw new Error(`Falta la copia de OpenStreetMap ${ruta}. Es el respaldo: córrela con «pnpm datos:extraer».`);
  const fc = JSON.parse(readFileSync(ruta, 'utf8'));
  if (!fc || !Array.isArray(fc.features)) throw new Error(`${ruta} no es un GeoJSON válido.`);
  return fc;
}

/**
 * La salud de OpenStreetMap, con los consultorios dentro: osm/salud.geojson y, si existe, osm/consultorios.geojson (sin repetir
 * por identificador de OSM). El reparto en las dos categorías lo hace Calculos.categoriaSalud al fusionar.
 */
function leerOsmSalud() {
  const salud = leerOsm('salud');
  const ruta = join(SALIDA, 'osm', 'consultorios.geojson');
  if (!existsSync(ruta)) return salud;
  const extra = JSON.parse(readFileSync(ruta, 'utf8'));
  if (!extra || !Array.isArray(extra.features)) throw new Error(`${ruta} no es un GeoJSON válido.`);
  const vistos = new Set(salud.features.map((f) => f.properties.osm));
  return { ...salud, features: [...salud.features, ...extra.features.filter((f) => !vistos.has(f.properties.osm))] };
}

function leerTexto(ruta) {
  const buf = readFileSync(ruta);
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

// ------------------------------------------------------------------ SALIDA
async function guardar(nombre, features, metadata) {
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata }).slice(0, -1);
  const cuerpo = `${cabecera},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  await writeFile(join(SALIDA, `${nombre}.geojson`), cuerpo);
  console.log(`  ${nombre}.geojson: ${features.length} elementos, ${(Buffer.byteLength(cuerpo) / 1024).toFixed(0)} kB`);
}

// ------------------------------------------------------------------ PRINCIPAL
async function main() {
  const a = argumentos(process.argv.slice(2));
  const radioM = a.radio ? Number(a.radio) : 200;
  if (!(radioM > 0)) throw new Error('--radio debe ser un número de metros mayor que 0.');
  mkdirSync(CACHE, { recursive: true });

  const osmSalud = leerOsmSalud();
  const osmEdu = leerOsm('educacion');
  const dentro = dentroDeDistritos();

  const ren = await obtenerRenipress(a);
  const esc = await obtenerEscale(a);

  console.log('\nLeyendo RENIPRESS…');
  const salud = E.seleccionarSalud(leerTexto(ren.ruta), { dentro });
  console.log(`  ${salud.descartados.total} filas; quedan ${salud.registros.length} establecimientos de salud y ${salud.consultorios.length} consultorios médicos.`);
  console.log('Leyendo el padrón de ESCALE (DBF de unos 290 MB, por bloques)…');
  const edu = E.seleccionarEscaleDbf(esc.ruta, { dentro });
  console.log(`  ${edu.totalPadron} registros del país, ${edu.filasProvincia} de la provincia; quedan ${edu.locales.length} locales (${edu.iies} instituciones).`);
  if (salud.registros.length === 0 || salud.consultorios.length === 0 || edu.locales.length === 0) {
    throw new Error(`Después de filtrar quedaron ${salud.registros.length} establecimientos de salud, ${salud.consultorios.length} consultorios y ${edu.locales.length} locales educativos: revisa los archivos. No se escribió nada.`);
  }

  const porGrupo = E.fusionarSaludPorGrupo(salud.registros.map(E.featureSalud), salud.consultorios.map(E.featureSalud), osmSalud.features, { radioM });
  const fSalud = porGrupo.salud;
  const fConsultorios = porGrupo.consultorios;
  const fEdu = E.fusionarEducacion(edu.locales.map(E.featureEscale), osmEdu.features, { radioM });

  const osmFuente = (fc) => ({ fecha: fc.metadata.fecha_extraccion, osm_base: fc.metadata.osm_base ?? null, url: fc.metadata.servidor ?? null, consulta: 'copia de public/data/equipamiento/osm' });
  const oficialRenipress = {
      id: 'RENIPRESS',
      nombre: 'RENIPRESS (SUSALUD)',
      entidad: 'Superintendencia Nacional de Salud - SUSALUD (publicado en datosabiertos.gob.pe)',
      url: ren.url,
      archivo: ren.nombre,
      pagina: PAGINA_RENIPRESS,
      fecha: ren.fecha,
      licencia: 'Open Data Commons Attribution License (ODC-By)',
      url_licencia: 'http://opendefinition.org/licenses/odc-by/',
      atribucion: 'Fuente: RENIPRESS, Superintendencia Nacional de Salud (SUSALUD), datosabiertos.gob.pe',
      filas_archivo: salud.descartados.total,
      coordenadas: 'columnas NORTE (latitud) y ESTE (longitud), grados decimales; alrededor del 42 % de los registros de Arequipa no las trae y no puede ubicarse',
  };
  const metaSalud = E.procedencia({
    categoria: 'salud',
    oficial: oficialRenipress,
    osm: osmFuente(osmSalud),
    conteo: fSalud.conteo,
    radioM,
    regla: REGLA_SALUD,
    descartes: salud.descartados,
    osmDescartes: fSalud.osm,
  });
  metaSalud.consultorios_aparte = { archivo: 'consultorios.geojson', registros: fConsultorios.features.length, osm_sin_categoria: porGrupo.sinCategoria };
  const metaConsultorios = E.procedencia({
    categoria: 'consultorios',
    oficial: oficialRenipress,
    osm: osmFuente(osmSalud),
    conteo: fConsultorios.conteo,
    radioM,
    regla: REGLA_CONSULTORIOS,
    descartes: salud.descartados,
    osmDescartes: fConsultorios.osm,
  });
  metaConsultorios.informativo = 'Sin umbral: variable informativa, no entra en el puntaje ni en la búsqueda de zonas del asistente.';
  const metaEdu = E.procedencia({
    categoria: 'educacion',
    oficial: {
      id: 'ESCALE',
      nombre: 'Padrón de instituciones educativas de ESCALE (MINEDU)',
      entidad: 'Ministerio de Educación, Unidad de Estadística (ESCALE)',
      url: esc.url,
      archivo: esc.nombre,
      pagina: PAGINA_ESCALE,
      fecha: esc.fecha,
      licencia: 'Sin licencia abierta declarada: ESCALE publica el padrón con un «Acuerdo de uso de datos» (no es ODC-By)',
      terminos:
        'Los datos de identificación y localización tienen como fuente el Padrón de Servicios Educativos y Programas de la Unidad de Estadística del MINEDU. La ubicación la ' +
        'proporcionan las DRE/GRE y las UGEL y corresponde al local educativo; los límites de referencia son los censales del INEI y no indican pertenencia a una jurisdicción ' +
        'político-administrativa determinada.',
      atribucion: 'Fuente: Padrón de Servicios Educativos, Unidad de Estadística del MINEDU (ESCALE)',
      filas_archivo: edu.totalPadron,
    },
    osm: osmFuente(osmEdu),
    conteo: fEdu.conteo,
    radioM,
    regla: REGLA_EDUCACION,
    descartes: { filas_padron: edu.totalPadron, filas_provincia_arequipa: edu.descartados.total, ...edu.descartados, total: undefined },
    osmDescartes: fEdu.osm,
  });
  metaEdu.conteo_por_nivel = fEdu.porNivel;
  metaEdu.instituciones_escale = edu.iies;

  await mkdir(SALIDA, { recursive: true });
  console.log('\nEscribiendo:');
  await guardar('salud', fSalud.features, metaSalud);
  await guardar('consultorios', fConsultorios.features, metaConsultorios);
  await guardar('educacion', fEdu.features, metaEdu);

  console.log(`\nSalud: ${fSalud.conteo.RENIPRESS} de RENIPRESS + ${fSalud.conteo.OSM} de OpenStreetMap (de ${fSalud.osm.total} de OSM: ${fSalud.osm.descartadas} descartadas a ${radioM} m, ${fSalud.osm.porNombreYDistancia} también por nombre).`);
  console.log(`Consultorios: ${fConsultorios.conteo.RENIPRESS} de RENIPRESS + ${fConsultorios.conteo.OSM} de OpenStreetMap (de ${fConsultorios.osm.total} de OSM: ${fConsultorios.osm.descartadas} descartadas a ${radioM} m, ${fConsultorios.osm.porNombreYDistancia} también por nombre). De OSM sin categoría de salud: ${porGrupo.sinCategoria}.`);
  console.log(`Educación: ${fEdu.conteo.ESCALE} locales de ESCALE + ${fEdu.conteo.OSM} de OpenStreetMap (de ${fEdu.osm.total} de OSM: ${fEdu.osm.descartadas} descartadas, ${fEdu.osm.sinNivelBasico} sin nivel básico).`);
  console.log('  Por nivel (ESCALE / OSM):', ['inicial', 'primaria', 'secundaria'].map((n) => `${n} ${fEdu.porNivel.ESCALE[n]} / ${fEdu.porNivel.OSM[n]}`).join(' · '));
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
