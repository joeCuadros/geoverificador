/**
 * cli.js — Argumentos y ayuda de scripts/recolectar-smartbus.mjs (puro). Lo prueba test/smartbus-recolector.spec.ts.
 */
class ErrorDeUso extends Error {}

const CON_VALOR = new Set(['linea', 'max-rutas', 'formato', 'salida']);
const SIN_VALOR = new Set(['refrescar']);
const MAX_RUTAS = 1000;

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

  let linea = 'todas';
  if (crudo.linea !== undefined) {
    const t = crudo.linea.trim();
    if (!t) throw new ErrorDeUso('La bandera --linea necesita un valor (p. ej. C2, Albotran o todas).');
    linea = t.toLowerCase() === 'todas' ? 'todas' : /^c\d+$/i.test(t) ? t.toUpperCase() : t;
  }

  let maxRutas = null;
  if (crudo['max-rutas'] !== undefined) {
    maxRutas = /^\d+$/.test(crudo['max-rutas']) ? Number(crudo['max-rutas']) : NaN;
    if (!Number.isInteger(maxRutas) || maxRutas < 1 || maxRutas > MAX_RUTAS) throw new ErrorDeUso(`--max-rutas debe ser un entero entre 1 y ${MAX_RUTAS} (recibido: «${crudo['max-rutas']}»).`);
  }

  let formato = 'geojson';
  if (crudo.formato !== undefined) {
    formato = crudo.formato.trim().toLowerCase();
    if (!['geojson', 'json', 'csv'].includes(formato)) throw new ErrorDeUso(`Formato no válido: «${crudo.formato}». Valores: geojson, json, csv.`);
  }

  return { ayuda, linea, maxRutas, formato, salida: crudo.salida !== undefined ? crudo.salida : null, refrescar: crudo.refrescar === true };
}

function textoAyuda() {
  return `recolectar-smartbus — Descarga las rutas y paradas de SmartBus Arequipa (smartbus.app) para análisis LOCAL.

USO RESTRINGIDO: SmartBus no publica licencia ni términos de uso. Estos datos son de uso local de análisis; sin licencia; no redistribuir.
Se guardan solo en datos-crudos/smartbus/ (ignorada por git) y el programa se niega a escribir en public/, dist/ o api/. No se conectan
a la aplicación, a la compilación ni a datos:verificar.

Uso:
  pnpm datos:smartbus -- [opciones]
  node scripts/recolectar-smartbus.mjs [opciones]

Opciones:
  --linea <C2|…|todas>     Solo esa línea (C2, C10, Albotran, Chiguata…). Por defecto: todas.
  --max-rutas <n>          Máximo de rutas a descargar (1 a ${MAX_RUTAS}), tras filtrar por línea. Por defecto: todas.
                           Conviene probar primero con --max-rutas 3.
  --formato <f>            geojson (rutas como líneas y paradas como puntos), json o csv (una fila por parada, más un archivo
                           .metadata.json al lado). Por defecto: geojson.
  --salida <ruta>          Archivo de salida. Por defecto: datos-crudos/smartbus/smartbus-aqp.<formato>
  --refrescar              Ignora la caché de respuestas crudas (datos-crudos/smartbus/cache/) y vuelve a pedirlas.
  --ayuda, -h              Muestra esta ayuda.

Reglas que el programa cumple siempre:
  - Vuelve a leer robots.txt de smartbus.app en cada ejecución y se detiene si deja de permitir la lectura.
  - Una solicitud a la vez, con al menos 1,1 s entre solicitudes, y un User-Agent propio que no afirma ningún permiso.
  - Si el sitio responde 401, 403, 407 o 429, redirige o muestra una verificación anti-bot, se detiene sin insistir ni saltarlo.
  - Valida todo antes de escribir y nunca reemplaza un archivo bueno con una corrida fallida.
`;
}

module.exports = { ErrorDeUso, MAX_RUTAS, parsearArgumentos, textoAyuda };
