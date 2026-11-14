/**
 * cli.js — Argumentos y ayuda de scripts/recolectar-avisos.mjs (puro). Lo prueba test/avisos-cli.spec.ts.
 */
const E = require('./esquema.js');
const Precios = require('../../../public/js/precios.js');
const Apify = require('./apify.js');
const { FUENTES_APIFY } = require('./apify-fuentes.js');

const FUENTES_POR_DEFECTO = ['nexo', 'adondevivir', 'urbania'];
const NOMBRES_FUENTES = [...FUENTES_POR_DEFECTO, 'marketplace'];
const MAX_PAGINAS = 10;
const ESPERA_MINIMA_SEG = 2;
const ESPERA_POR_DEFECTO_SEG = 3;
const TOPE_USD_POR_DEFECTO = 0.5;
const MAX_ITEMS = 5000;
const FORMA_ACTOR = /^[A-Za-z0-9_.-]+[~/][A-Za-z0-9_.-]+$/;

class ErrorDeUso extends Error {}

const CON_VALOR = new Set(['fuente', 'distrito', 'tipo', 'paginas', 'salida', 'formato', 'espera', 'perfil', 'transporte', 'tope-usd', 'max-items', 'actor', 'url-marketplace']);
const SIN_VALOR = new Set(['con-detalles']);

/** Argumentos de la línea de comandos → opciones. Lanza ErrorDeUso con un mensaje en español si algo no es válido. */
function parsearArgumentos(argv) {
  const crudo = {};
  let ayuda = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // pnpm reenvía el «--» al script
    if (a === '-h' || a === '--ayuda' || a === '--help') {
      ayuda = true;
      continue;
    }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new ErrorDeUso(`Argumento no reconocido: ${a}. Use --ayuda para ver las opciones.`);
    const [, nombre, enLinea] = m;
    if (SIN_VALOR.has(nombre)) {
      if (enLinea !== undefined) throw new ErrorDeUso(`La bandera --${nombre} no lleva valor.`);
      crudo[nombre] = true;
      continue;
    }
    if (!CON_VALOR.has(nombre)) throw new ErrorDeUso(`Bandera desconocida: --${nombre}. Use --ayuda para ver las opciones.`);
    let valor = enLinea;
    if (valor === undefined) {
      const sig = argv[i + 1];
      if (sig === undefined || sig.startsWith('--')) throw new ErrorDeUso(`La bandera --${nombre} necesita un valor.`);
      valor = sig;
      i++;
    }
    crudo[nombre] = valor;
  }

  let fuentes = FUENTES_POR_DEFECTO;
  if (crudo.fuente !== undefined) {
    const pedidas = crudo.fuente.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const malas = pedidas.filter((f) => f !== 'todas' && !NOMBRES_FUENTES.includes(f));
    if (malas.length || pedidas.length === 0) throw new ErrorDeUso(`Fuente no válida: «${malas.join(', ') || crudo.fuente}». Valores: ${NOMBRES_FUENTES.join(', ')}, todas.`);
    fuentes = [...new Set(pedidas.flatMap((f) => (f === 'todas' ? FUENTES_POR_DEFECTO : [f])))];
  }

  let tipo = 'todos';
  if (crudo.tipo !== undefined) {
    const t = crudo.tipo.trim().toLowerCase();
    tipo = t === 'todos' || t === 'todo' ? 'todos' : E.normalizarTipo(t);
    if (!tipo) throw new ErrorDeUso(`Tipo no válido: «${crudo.tipo}». Valores: ${E.TIPOS.join(', ')}, todos.`);
  }

  let paginas = 2;
  if (crudo.paginas !== undefined) {
    paginas = /^\d+$/.test(crudo.paginas) ? Number(crudo.paginas) : NaN;
    if (!Number.isInteger(paginas) || paginas < 1 || paginas > MAX_PAGINAS) throw new ErrorDeUso(`El número de páginas debe ser un entero entre 1 y ${MAX_PAGINAS} (recibido: «${crudo.paginas}»).`);
  }

  let formato = 'json';
  if (crudo.formato !== undefined) {
    formato = crudo.formato.trim().toLowerCase();
    if (formato !== 'json' && formato !== 'csv') throw new ErrorDeUso(`Formato no válido: «${crudo.formato}». Valores: json, csv.`);
  }

  let esperaSeg = ESPERA_POR_DEFECTO_SEG;
  if (crudo.espera !== undefined) {
    esperaSeg = Number(crudo.espera);
    if (!Number.isFinite(esperaSeg) || esperaSeg < ESPERA_MINIMA_SEG) throw new ErrorDeUso(`La espera entre solicitudes al mismo sitio debe ser de al menos ${ESPERA_MINIMA_SEG} segundos (recibido: «${crudo.espera}»).`);
  }

  let transporte = 'directo';
  if (crudo.transporte !== undefined) {
    transporte = crudo.transporte.trim().toLowerCase();
    if (transporte !== 'directo' && transporte !== 'apify') throw new ErrorDeUso(`Transporte no válido: «${crudo.transporte}». Valores: directo, apify.`);
  }

  let topeUsd = TOPE_USD_POR_DEFECTO;
  if (crudo['tope-usd'] !== undefined) {
    topeUsd = crudo['tope-usd'].trim() === '' ? NaN : Number(crudo['tope-usd']);
    if (!Number.isFinite(topeUsd) || topeUsd <= 0) throw new ErrorDeUso(`El tope de gasto (--tope-usd) debe ser un número mayor que 0 (recibido: «${crudo['tope-usd']}»).`);
  }

  let maxItems = null;
  if (crudo['max-items'] !== undefined) {
    maxItems = /^\d+$/.test(crudo['max-items']) ? Number(crudo['max-items']) : NaN;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > MAX_ITEMS) throw new ErrorDeUso(`--max-items debe ser un entero entre 1 y ${MAX_ITEMS} (recibido: «${crudo['max-items']}»).`);
  }

  const actores = {};
  if (crudo.actor !== undefined) {
    for (const par of crudo.actor.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [fuente, actor] = par.split('=');
      if (!FUENTES_APIFY.includes(fuente) || !actor || !FORMA_ACTOR.test(actor)) throw new ErrorDeUso(`Actor no válido: «${par}». Use --actor fuente=usuario/actor con fuente en ${FUENTES_APIFY.join(', ')}.`);
      actores[fuente] = actor.replace('~', '/');
    }
  }

  return {
    ayuda,
    fuentes,
    distrito: crudo.distrito !== undefined ? crudo.distrito.trim() || null : null,
    tipo,
    paginas,
    salida: crudo.salida !== undefined ? crudo.salida : null,
    formato,
    esperaSeg,
    perfil: crudo.perfil !== undefined ? crudo.perfil : null,
    transporte,
    topeUsd,
    conDetalles: crudo['con-detalles'] === true,
    maxItems,
    actores,
    urlMarketplace: crudo['url-marketplace'] !== undefined ? crudo['url-marketplace'].trim() || null : null,
  };
}

/** Nombre del distrito según distritos_aqp.geojson para lo que escribió la persona; null si no pidió ninguno. */
function resolverDistritoPedido(nombre, conocidos) {
  if (nombre === null || nombre === undefined || nombre === '') return null;
  const k = Precios.claveDistrito(nombre);
  const hallado = conocidos.find((d) => Precios.claveDistrito(d) === k);
  if (!hallado) throw new ErrorDeUso(`Distrito no reconocido: «${nombre}». Distritos válidos: ${conocidos.join(', ')}.`);
  return hallado;
}

/**
 * Token de Apify si la ejecución lo necesita (transporte apify y alguna fuente con variante Apify). Lanza ErrorDeUso si falta.
 * Devuelve null si no hace falta.
 */
function exigirToken(opciones, env = process.env) {
  if (opciones.transporte !== 'apify' || !opciones.fuentes.some((f) => FUENTES_APIFY.includes(f))) return null;
  const token = Apify.leerToken(env);
  if (!token) throw new ErrorDeUso('El transporte apify necesita la variable de entorno APIFY_TOKEN (token de su cuenta de Apify). No se inició ninguna ejecución.');
  return token;
}

function textoAyuda() {
  return `recolectar-avisos — Reúne avisos de VENTA de inmuebles de Arequipa desde varias fuentes y los guarda en un esquema común.

Uso:
  pnpm datos:avisos -- [opciones]
  node scripts/recolectar-avisos.mjs [opciones]

Opciones:
  --fuente <nombre|lista>   nexo, adondevivir, urbania, marketplace, o «todas» (nexo + adondevivir + urbania). Se admite una
                            lista separada por comas. Marketplace solo se usa si se pide por nombre. Por defecto: todas.
  --distrito <nombre>       Solo avisos de ese distrito de Arequipa (p. ej. «Cayma», «Cerro Colorado»). Por defecto: todos.
  --tipo <tipo>             departamento, casa, terreno, local, oficina o «todos». Por defecto: todos
                            (en Adondevivir y Urbania «todos» son departamento, casa y terreno).
  --paginas <n>             Máximo de páginas por fuente y tipo, de 1 a ${MAX_PAGINAS}. Por defecto: 2. Adondevivir y Urbania
                            solo permiten hasta 5 en su robots.txt.
  --salida <ruta>           Archivo de salida. Por defecto: datos-crudos/avisos/avisos-AAAA-MM-DD.<formato>
                            (carpeta ignorada por git y fuera de public/; no se acepta escribir dentro de public/).
  --formato <json|csv>      Formato de salida. Por defecto: json.
  --espera <segundos>       Espera entre solicitudes al mismo sitio, mínimo ${ESPERA_MINIMA_SEG}. Por defecto: ${ESPERA_POR_DEFECTO_SEG}.
  --perfil <carpeta>        Perfil de navegador para Marketplace. Por defecto: datos-crudos/perfil-marketplace
    --transporte <t>          directo (por defecto) o apify. «apify» corre Urbania, Adondevivir y Marketplace en Apify, una plataforma
                            de pago: CUESTA DINERO y necesita la variable de entorno APIFY_TOKEN. Nunca se usa solo ni como
                            respaldo de un bloqueo; Nexo siempre es directo. Con apify este programa no pide nada a esos sitios.
  --tope-usd <n>            Con apify: máximo en USD que Apify puede cobrar por la ejecución de CADA fuente. Por defecto: ${TOPE_USD_POR_DEFECTO}.
  --max-items <n>           Con apify: máximo de avisos por fuente (1 a ${MAX_ITEMS}). Por defecto: páginas × 30 × tipos.
  --con-detalles            Con apify: pide también el detalle de cada aviso (más lento y más caro). Por defecto no.
  --actor <fuente=u/actor>  Con apify: cambia el actor de una fuente (urbania, adondevivir, marketplace); varias separadas por coma.
                            También: APIFY_ACTOR_URBANIA, APIFY_ACTOR_ADONDEVIVIR, APIFY_ACTOR_MARKETPLACE.
  --url-marketplace <url>   Con apify: URL de la búsqueda de Marketplace de su ciudad (obligatoria para marketplace; también
                            MARKETPLACE_URL). No se adivina ninguna ubicación.
  --ayuda, -h               Muestra esta ayuda.

Reglas que el programa cumple siempre:
  - Lee el robots.txt de cada sitio antes de pedirle cualquier otra cosa y omite lo que prohíbe.
  - Solicitudes una a una, con User-Agent propio e identificable, sin cookies ni cabeceras de navegador.
  - Si un sitio responde 401, 403 o 429 o muestra un desafío anti-bot, deja de pedirle y sigue con las demás fuentes.
    No intenta saltarse ningún bloqueo.
  - No guarda nombres de vendedores, teléfonos ni enlaces a perfiles.
  - Son datos de terceros, solo para análisis interno: no se publican ni se copian a public/.
`;
}

module.exports = { exigirToken, TOPE_USD_POR_DEFECTO, ErrorDeUso, FUENTES_POR_DEFECTO, NOMBRES_FUENTES, MAX_PAGINAS, ESPERA_MINIMA_SEG, ESPERA_POR_DEFECTO_SEG, parsearArgumentos, resolverDistritoPedido, textoAyuda };
