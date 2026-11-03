/**
 * descargar-precios.mjs — Congela el precio de OFERTA por m² de departamentos por distrito de Arequipa.
 *
 * Fuente: Aptología, estudio «Vivienda en Arequipa: precio por m², arriendo, habitaciones y rentabilidad»
 * (Daniel Mauricio Pinzón Pineda). Datos abiertos, licencia CC BY 4.0, descarga HTTP simple sin registro ni llave.
 * Copia del CSV en Hugging Face (la fuente canónica del estudio está en el repositorio elbroker/aptologia-datos).
 *
 * Uso:   node scripts/descargar-precios.mjs
 * Sale:  public/data/precios_m2_distrito.json
 *
 * Decisiones:
 *  - Solo se acepta la descarga si la ficha del conjunto de datos declara `license: cc-by-4.0`. Si no, no se escribe nada.
 *  - Solo distritos que existen en public/data/distritos_aqp.geojson (el nombre se normaliza igual que en el navegador,
 *    con public/js/precios.js, y se guarda en MAYÚSCULAS como `distrito` del GeoJSON). Los que no calzan se avisan y se omiten.
 *  - Son precios PEDIDOS (avisos publicados), no de cierre. Aptología solo publica cifras con al menos 30 avisos,
 *    por eso hoy hay pocos distritos. No se completa ni se estima nada.
 *  - Si algo falla (red, formato, licencia), se conserva el archivo existente y se sale con código 1.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const Precios = createRequire(import.meta.url)('../public/js/precios.js');

// ------------------------------------------------------------------ CONFIGURACIÓN
const BASE = process.env.PRECIOS_BASE || 'https://huggingface.co/datasets/aptologia/vivienda-arequipa-por-distrito-2026/resolve/main';
const URL_CSV = `${BASE}/data/vivienda_arequipa_por_distrito_2026_datos.csv`;
const URL_FICHA = `${BASE}/README.md`;
const URL_ESTUDIO_MD = `${BASE}/vivienda-arequipa-por-distrito-2026.md`;
const URL_PAGINA = 'https://huggingface.co/datasets/aptologia/vivienda-arequipa-por-distrito-2026';
const URL_CANONICA = 'https://github.com/elbroker/aptologia-datos/tree/main/estudios/vivienda-arequipa-por-distrito-2026';
const URL_DATOS_ABIERTOS = 'https://www.aptologia.com/datos-abiertos';
// Texto que Aptología pide junto a cada cifra (https://www.aptologia.com/datos-abiertos, consultado el 2026-11-03):
// «Datos: Aptologia» con un enlace visible a la página de origen del dato.
const ATRIBUCION = 'Datos: Aptologia';
const CITA =
  'Pinzón Pineda, D. M. (2026). Vivienda en Arequipa: precio por m², arriendo, habitaciones y rentabilidad (octubre 2026). Aptología (aptologia.com).';
const MUESTRA_MINIMA = 30; // «cada cifra publicada se apoya en al menos 30 avisos» (metodología del estudio)

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const SALIDA = join(RAIZ, 'precios_m2_distrito.json');
const DISTRITOS = join(RAIZ, 'distritos_aqp.geojson');

// ------------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function descargarTexto(url) {
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'geoverificador-datos/1.0 (descarga de datos abiertos)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (intento >= 3) throw new Error(`Falló la descarga tras 3 intentos (${err.message}).\nURL: ${url}`);
      await esperar(2000 * intento);
    }
  }
}

// ------------------------------------------------------------------------ ANÁLISIS
/** CSV mínimo con comillas dobles. Devuelve filas como objetos según el encabezado. */
export function parsearCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  const t = texto.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo);
      campo = '';
      if (fila.some((x) => x !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); if (fila.some((x) => x !== '')) filas.push(fila); }
  const [encabezado, ...resto] = filas;
  if (!encabezado) return [];
  return resto.map((f) => Object.fromEntries(encabezado.map((h, i) => [h.trim(), (f[i] ?? '').trim()])));
}

const numero = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const iso = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Periodo desde la metodología del estudio: «vistos en línea entre el 11 y el 18 de octubre de 2026. Corte: 18 de octubre de 2026». */
export function parsearPeriodo(md, fechaFicha) {
  const mes = Object.keys(MESES).join('|');
  const rango = new RegExp(`entre el (\\d{1,2}) y el (\\d{1,2}) de (${mes}) de (\\d{4})`, 'i').exec(md);
  const corte = new RegExp(`Corte:\\s*(\\d{1,2}) de (${mes}) de (\\d{4})`, 'i').exec(md);
  const hasta = rango ? iso(rango[4], MESES[rango[3].toLowerCase()], rango[2]) : null;
  const desde = rango ? iso(rango[4], MESES[rango[3].toLowerCase()], rango[1]) : null;
  const cortePeriodo = corte ? iso(corte[3], MESES[corte[2].toLowerCase()], corte[1]) : fechaFicha || null;
  return { desde, hasta, corte: cortePeriodo };
}

// ------------------------------------------------------------------------- PRINCIPAL
async function main() {
  console.log(`CSV:   ${URL_CSV}\nFicha: ${URL_FICHA}\n`);
  const [ficha, csv, estudio, geojson] = await Promise.all([
    descargarTexto(URL_FICHA),
    descargarTexto(URL_CSV),
    descargarTexto(URL_ESTUDIO_MD),
    readFile(DISTRITOS, 'utf8').then(JSON.parse),
  ]);

  // 1. Licencia: sin CC BY no se usa el dato.
  const licenciaFicha = /^license:\s*(\S+)/im.exec(ficha)?.[1];
  if (!licenciaFicha || licenciaFicha.toLowerCase() !== 'cc-by-4.0') {
    throw new Error(`La ficha del conjunto de datos declara la licencia «${licenciaFicha || 'ninguna'}», no CC BY 4.0. No se descarga nada.`);
  }
  console.log(`Licencia declarada por la fuente: ${licenciaFicha}`);

  // 2. Periodo.
  const fechaFicha = /Fecha de actualizaci[oó]n:\*\*\s*(\d{4}-\d{2}-\d{2})/i.exec(ficha)?.[1] || null;
  const periodo = parsearPeriodo(estudio, fechaFicha);
  if (!periodo.corte) throw new Error('No se encontró la fecha de corte de los datos en la ficha ni en el estudio. No se escribe nada.');

  // 3. Filas del CSV → distritos del GeoJSON.
  const filas = parsearCsv(csv);
  const columnas = ['distrito', 'avisos_venta', 'venta_PEN_m2', 'avisos_arriendo', 'arriendo_PEN_mes'];
  if (filas.length === 0 || !columnas.every((c) => c in filas[0])) {
    throw new Error(`El CSV no tiene las columnas esperadas (${columnas.join(', ')}). Encabezado recibido: ${Object.keys(filas[0] || {}).join(', ') || 'vacío'}.`);
  }
  const porClave = new Map(geojson.features.map((f) => [Precios.claveDistrito(f.properties.distrito), f.properties.distrito]));
  const distritos = {};
  const omitidos = [];
  for (const f of filas) {
    const nombre = porClave.get(Precios.claveDistrito(f.distrito));
    if (!nombre) { omitidos.push(f.distrito); continue; }
    const venta = numero(f.venta_PEN_m2);
    const arriendo = numero(f.arriendo_PEN_mes);
    const avisosVenta = numero(f.avisos_venta);
    const avisosArriendo = numero(f.avisos_arriendo);
    if (venta === null && arriendo === null) continue;
    if (venta !== null && (venta <= 0 || venta > 100000)) throw new Error(`Precio por m² fuera de rango en ${f.distrito}: ${venta}.`);
    distritos[nombre] = {
      venta_m2: venta === null ? null : Math.round(venta),
      avisos_venta: venta === null ? null : avisosVenta,
      arriendo_mensual: arriendo === null ? null : Math.round(arriendo),
      avisos_arriendo: arriendo === null ? null : avisosArriendo,
    };
  }
  if (omitidos.length) console.warn(`Aviso: distritos del CSV que no están en distritos_aqp.geojson (omitidos): ${omitidos.join(', ')}`);
  if (Object.keys(distritos).length === 0) throw new Error('Ninguna fila del CSV calza con un distrito de Arequipa. No se escribe nada.');

  const nVenta = Object.values(distritos).reduce((t, d) => t + (d.avisos_venta || 0), 0);
  const nArriendo = Object.values(distritos).reduce((t, d) => t + (d.avisos_arriendo || 0), 0);
  const salida = {
    fuente: 'Aptología (aptologia.com), «Vivienda en Arequipa: precio por m², arriendo, habitaciones y rentabilidad (octubre 2026)»',
    url: URL_CANONICA,
    url_conjunto_de_datos: URL_PAGINA,
    url_descarga: URL_CSV,
    url_condiciones: URL_DATOS_ABIERTOS,
    licencia: 'CC BY 4.0',
    licencia_url: 'https://creativecommons.org/licenses/by/4.0/',
    atribucion: ATRIBUCION,
    cita: CITA,
    fecha_descarga: new Date().toISOString().slice(0, 10),
    periodo,
    tipo: 'precio de oferta (avisos), no de cierre',
    moneda: 'PEN',
    unidades: {
      venta_m2: 'soles (S/) por m², mediana de departamentos en venta',
      arriendo_mensual: 'soles (S/) por mes, mediana de departamentos en arriendo, sin administración ni gastos comunes',
    },
    estadistico: 'mediana',
    muestra_minima: MUESTRA_MINIMA,
    n_avisos: { venta: nVenta, arriendo: nArriendo },
    modificaciones: 'Se filtraron los distritos de Arequipa Metropolitana presentes en distritos_aqp.geojson, se normalizó el nombre del distrito y los valores se redondearon a soles enteros.',
    distritos,
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida, null, 2) + '\n');

  console.log(`\nGuardado en ${SALIDA}`);
  console.log(`Corte de los datos: ${periodo.corte}${periodo.desde ? ` (avisos vistos del ${periodo.desde} al ${periodo.hasta})` : ''}`);
  console.log(`Distritos con cifra (${Object.keys(distritos).length}):`);
  Object.entries(distritos).forEach(([n, d]) => console.log(`  ${n}: S/ ${d.venta_m2}/m² (${d.avisos_venta} avisos)`));
}

// Solo corre al ejecutarlo como script: así las pruebas pueden importar `parsearCsv` y `parsearPeriodo`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nNo se pudo completar la descarga: ${err.message}\nSe conserva el archivo existente (si lo había).`);
    process.exit(1);
  });
}
