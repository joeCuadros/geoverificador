/**
 * descargar-censo-servicios.mjs — Arma, por MANZANA y por distrito, el alumbrado eléctrico, el agua y el desagüe por red pública, las viviendas y las
 * personas de los Censos Nacionales de Población y Vivienda 2017 del INEI, uniéndolos al polígono de cada manzana, y lo congela en:
 *   public/data/censo/index.json                 procedencia, año, licencia y un registro por distrito (caja, conteos, archivo, tamaño)
 *   public/data/censo/manzanas/<ubigeo>.json     GeoJSON de las manzanas del distrito, con sus conteos (una pieza por distrito: se carga solo la que hace falta)
 *
 * Fuentes (públicas, sin clave ni sesión):
 *  - Cifras: sistema REDATAM en línea de los Censos 2017 (https://censos2017.inei.gob.pe/), «Lista por áreas» al nivel manzana, la misma consulta que
 *    arma el menú «Lista de Áreas» de la página. Una solicitud para los servicios (alumbrado C2P11, agua C2P6, servicio higiénico C2P10, solo viviendas
 *    particulares ocupadas con personas presentes) y otra para los conteos (viviendas, hogares y personas), por distrito.
 *  - Polígonos: servicio WFS del INEI (https://geoespacial.inei.gob.pe/geoserver/Interoperabilidad, capa ig_manzana), enteros y sin recortar.
 *
 * Uso:   node scripts/descargar-censo-servicios.mjs      (o: pnpm datos:censo)
 * Opciones:
 *   --refrescar        vuelve a consultar aunque las respuestas estén en la caché (.cache-censo/)
 *   --distrito=040103  solo ese distrito (para probar)
 *
 * Cortesía: una solicitud a la vez, con 3 s de pausa entre solicitudes, identificándose con un User-Agent propio, con tiempo máximo y reintentos de
 * espera creciente. En total son unas 2 solicitudes a REDATAM y 1 al WFS por distrito (75 para los 25 distritos del proyecto). Ni REDATAM ni el WFS
 * tienen robots.txt ni condiciones de uso publicadas que lo prohíban; son agregados por manzana que el propio INEI publica.
 *
 * Reglas:
 *  - Las viviendas que el censo contó fuera de una manzana (manzana 8888) no tienen polígono: se cuentan aparte en el índice y no se reparten.
 *  - Una manzana del INEI que REDATAM no cuenta (sin viviendas censadas) queda en el archivo SIN cifras: no se rellena con ceros.
 *  - Los polígonos se guardan enteros (sin recortar a los distritos ni simplificar); las coordenadas se redondean a 6 decimales (~0,1 m).
 *  - Si algo falla (red, formato, cabecera distinta, un distrito sin manzanas) NO se escribe nada y se sale con código 1. Nunca se inventan datos.
 *  - El censo de 2025 está en REDATAM 2025 y en el geoservidor de resultados, pero ambos exigen iniciar sesión: no se usan (ver docs/METODOLOGIA.md §6.7).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Censo = require('./lib/censo.js');

// ------------------------------------------------------------------ CONFIGURACIÓN
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'data', 'censo');
const CACHE = join(RAIZ, '.cache-censo');
const REDATAM = 'https://censos2017.inei.gob.pe/bininei2/';
const WFS = 'https://geoespacial.inei.gob.pe/geoserver/Interoperabilidad/ows';
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico; consulta pública REDATAM y WFS del INEI)';
const PAUSA_MS = 3000;
const REINTENTOS = 3;
const ESPERA_BASE_MS = 8000;
const TIMEOUT_MS = 240000;
const DECIMALES = 6;
const PAGINA_URL = 'https://censos2017.inei.gob.pe/redatam/';

const argumentos = (argv) => Object.fromEntries(argv.map((a) => /^--([a-z-]+)(?:=(.*))?$/.exec(a)).filter(Boolean).map((m) => [m[1], m[2] === undefined ? true : m[2]]));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ SOLICITUDES
async function conReintentos(etiqueta, fn) {
  let ultimo = null;
  for (let i = 1; i <= REINTENTOS; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err?.cause?.code || err.message;
      console.warn(`  ${etiqueta} falló (intento ${i}/${REINTENTOS}): ${ultimo}`);
      if (i < REINTENTOS) await esperar(ESPERA_BASE_MS * i);
    }
  }
  throw new Error(`${etiqueta}: sin respuesta tras ${REINTENTOS} intentos (${ultimo}). No se escribió nada.`);
}

/** Una «lista por áreas» de REDATAM: la solicitud devuelve una página con la tabla en un iframe temporal, que se lee aparte. */
async function listaPorAreas(params) {
  const res = await fetch(`${REDATAM}RpWebStats.exe/AreaList`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT }, body: params, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const pagina = await res.text();
  const m = pagina.match(/<iframe src="([^"]+)"/);
  if (!m) throw new Error(`REDATAM no devolvió una tabla: ${pagina.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
  await esperar(1000);
  const t = await fetch(m[1].replace(/&amp;/g, '&'), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!t.ok) throw new Error(`HTTP ${t.status} al leer la tabla`);
  return t.text();
}

async function conCache(nombre, refrescar, fn) {
  const ruta = join(CACHE, nombre);
  if (!refrescar && existsSync(ruta)) return readFileSync(ruta, 'utf8');
  const texto = await fn();
  await mkdir(CACHE, { recursive: true });
  await writeFile(ruta, texto);
  await esperar(PAUSA_MS);
  return texto;
}

const poligonosDe = (ubigeo) => `${WFS}?service=WFS&version=1.0.0&request=GetFeature&typeName=Interoperabilidad:ig_manzana&outputFormat=application/json&CQL_FILTER=${encodeURIComponent(`ubigeo='${ubigeo}'`)}`;

// ------------------------------------------------------------------ GEOMETRÍA
const redondear = (n) => Number(n.toFixed(DECIMALES));
const redondearGeom = (g) => ({ type: g.type, coordinates: (function r(c) { return typeof c[0] === 'number' ? c.map(redondear) : c.map(r); })(g.coordinates) });
function cajaDe(features) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const visitar = (c) => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(visitar); };
  features.forEach((f) => visitar(f.geometry.coordinates));
  return b.map(redondear);
}

// ------------------------------------------------------------------ PRINCIPAL
async function main() {
  const a = argumentos(process.argv.slice(2));
  const distritos = JSON.parse(readFileSync(join(RAIZ, 'public', 'data', 'distritos_aqp.geojson'), 'utf8')).features
    .map((f) => ({ ubigeo: f.properties.ubigeo, nombre: f.properties.distrito }))
    .sort((x, y) => (x.ubigeo < y.ubigeo ? -1 : 1))
    .filter((d) => !a.distrito || d.ubigeo === a.distrito);
  if (distritos.length === 0) throw new Error(`Ningún distrito coincide con --distrito=${a.distrito}.`);

  const piezas = [];
  const omitidos = [];
  const fecha = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const d of distritos) {
    n++;
    console.log(`\n[${n}/${distritos.length}] ${d.nombre} (${d.ubigeo})`);
    const sel = Censo.seleccionDeDistrito(d.ubigeo);
    const htmlServ = await conReintentos('REDATAM servicios', () => conCache(`${d.ubigeo}-servicios.html`, a.refrescar, () => listaPorAreas(
      Censo.parametrosAreaList({ item: 'AREAVIV', variables: ['Vivienda.C2P11', 'Vivienda.C2P6', 'Vivienda.C2P10'], seleccion: sel, filtro: Censo.FILTRO_OCUPADAS }))));
    const htmlCont = await conReintentos('REDATAM conteos', () => conCache(`${d.ubigeo}-conteos.html`, a.refrescar, () => listaPorAreas(
      Censo.parametrosAreaList({ item: 'COUNTS', variables: ['Vivienda', 'Hogar', 'Poblacio'], seleccion: sel }))));
    const wfs = await conReintentos('WFS manzanas', () => conCache(`${d.ubigeo}-manzanas.json`, a.refrescar, async () => {
      const r = await fetch(poligonosDe(d.ubigeo), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    }));

    const serv = Censo.leerTabla(htmlServ);
    const cont = Censo.leerTabla(htmlCont);
    const { registros, sinManzana, incoherentes } = Censo.construirRegistros(serv, cont);
    const coleccion = JSON.parse(wfs);
    const poligonos = coleccion.features;
    if (Number.isFinite(coleccion.totalFeatures) && coleccion.totalFeatures !== poligonos.length) throw new Error(`El WFS devolvió ${poligonos.length} de ${coleccion.totalFeatures} manzanas de ${d.ubigeo}: la respuesta está cortada. No se escribió nada.`);
    if (poligonos.length === 0) {
      // Un distrito rural puede no tener manzanas (el censo por manzana es solo del área urbana): se anota y se sigue, sin inventar nada.
      console.log('  sin manzanas en el WFS (distrito sin área urbana censada): se omite.');
      omitidos.push({ ubigeo: d.ubigeo, distrito: d.nombre, motivo: 'El INEI no tiene manzanas en este distrito (sin área urbana censada).' });
      continue;
    }
    if (registros.size === 0) console.log('  REDATAM no contó viviendas en ninguna manzana de este distrito: las manzanas quedan sin cifras.');

    const ids = new Set();
    const features = poligonos.map((p) => {
      const id = p.properties.idmanzana;
      if (ids.has(id)) throw new Error(`idmanzana repetido en el WFS: ${id}.`);
      ids.add(id);
      const r = registros.get(id);
      const props = r ? { id, v: r.viv, h: r.hog, p: r.pers, o: r.ocup, l: r.luz, ad: r.ad, af: r.af, sd: r.sd, sf: r.sf } : { id };
      return { type: 'Feature', properties: props, geometry: redondearGeom(p.geometry) };
    });
    const sinPoligono = [...registros.keys()].filter((id) => !ids.has(id));
    const conDatos = features.filter((f) => f.properties.v !== undefined).length;
    const sumas = { viviendas: 0, ocupadas: 0, personas: 0 };
    registros.forEach((r) => { sumas.viviendas += r.viv; sumas.ocupadas += r.ocup; sumas.personas += r.pers; });
    // Control cruzado: las manzanas + lo contado fuera de manzana suman el TOTAL que REDATAM da para el distrito.
    const iViv = cont.cabecera.findIndex((c) => /^vivienda$/i.test(c));
    const iPer = cont.cabecera.findIndex((c) => /poblaci/i.test(c));
    const totalViv = cont.total ? cont.total[iViv] : null;
    const totalPer = cont.total ? cont.total[iPer] : null;
    const cuadra = totalViv === sumas.viviendas + sinManzana.viviendas && totalPer === sumas.personas + sinManzana.personas;
    console.log(`  ${features.length} manzanas (${conDatos} con cifras del censo; ${sinPoligono.length} de REDATAM sin polígono); fuera de manzana: ${sinManzana.viviendas} viviendas, ${sinManzana.personas} personas; ${cuadra ? 'los totales cuadran con REDATAM' : `LOS TOTALES NO CUADRAN (REDATAM ${totalViv} viviendas / ${totalPer} personas; aquí ${sumas.viviendas + sinManzana.viviendas} / ${sumas.personas + sinManzana.personas})`}; categorías de agua incoherentes: ${incoherentes}`);
    if (!cuadra) throw new Error(`Los totales de ${d.nombre} no cuadran con REDATAM. No se escribió nada.`);

    const cuerpo = `{"type":"FeatureCollection","metadata":${JSON.stringify({ ubigeo: d.ubigeo, distrito: d.nombre, anio: 2017, campos: 'Ver index.json', fecha_descarga: fecha })},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
    piezas.push({
      ubigeo: d.ubigeo, distrito: d.nombre, archivo: `manzanas/${d.ubigeo}.json`, caja: cajaDe(features), manzanas: features.length, con_datos: conDatos, sin_poligono_en_redatam: sinPoligono.length,
      viviendas: sumas.viviendas, ocupadas: sumas.ocupadas, personas: sumas.personas, fuera_de_manzana: sinManzana, categorias_incoherentes: incoherentes, bytes: Buffer.byteLength(cuerpo), cuerpo,
    });
  }

  await mkdir(join(SALIDA, 'manzanas'), { recursive: true });
  for (const p of piezas) await writeFile(join(SALIDA, p.archivo), p.cuerpo);
  const total = (k) => piezas.reduce((t, p) => t + p[k], 0);
  const indice = {
    anio_censo: 2017,
    fuente: 'INEI, Censos Nacionales 2017: XII de Población, VII de Vivienda y III de Comunidades Indígenas (REDATAM en línea), con los polígonos de manzana del INEI',
    url_redatam: PAGINA_URL,
    url_poligonos: `${WFS} (capa Interoperabilidad:ig_manzana)`,
    fecha_descarga: fecha,
    licencia: 'No localizada en el sitio de REDATAM ni del servicio WFS; se atribuye al INEI. Datos de acceso público.',
    atribucion: 'Instituto Nacional de Estadística e Informática (INEI), Censos Nacionales 2017',
    universo: 'Porcentajes sobre viviendas particulares ocupadas con personas presentes (pregunta C2P2 = 1); viviendas y personas son todo lo contado en la manzana.',
    campos: {
      id: 'idmanzana del INEI: ubigeo (6) + zona (5) + manzana (3 o 4)',
      v: 'viviendas contadas', h: 'hogares', p: 'personas censadas', o: 'viviendas ocupadas con personas presentes (universo de los porcentajes)',
      l: 'con alumbrado eléctrico por red pública (C2P11)',
      ad: 'agua por red pública dentro de la vivienda (C2P6)', af: 'agua por red pública fuera de la vivienda pero dentro de la edificación (C2P6)',
      sd: 'servicio higiénico conectado a la red pública de desagüe dentro de la vivienda (C2P10)', sf: 'ídem fuera de la vivienda pero dentro de la edificación (C2P10)',
    },
    cobertura_del_censo: 'Solo área urbana (REDATAM: «Información solo de área urbana»). Una manzana sin cifras no tuvo viviendas contadas en REDATAM; no es un cero. Las viviendas contadas fuera de una manzana (8888) no tienen polígono y no se reparten.',
    no_dice: 'Son cifras de 2017 de la manzana, no de un predio ni de hoy: el censo de 2025 (resultados publicados desde 2026) todavía no está abierto por manzana.',
    totales: { distritos: piezas.length, manzanas: total('manzanas'), con_datos: total('con_datos'), viviendas: total('viviendas'), ocupadas: total('ocupadas'), personas: total('personas'), bytes: total('bytes') },
    distritos: piezas.map(({ cuerpo: _c, ...resto }) => resto),
    distritos_sin_manzanas: omitidos,
    generado: fecha,
  };
  await writeFile(join(SALIDA, 'index.json'), `${JSON.stringify(indice, null, 1)}\n`);
  console.log(`\nEscrito public/data/censo/: ${piezas.length} distritos, ${indice.totales.manzanas} manzanas (${indice.totales.con_datos} con cifras), ${(indice.totales.bytes / 1048576).toFixed(1)} MB.`);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
