/**
 * generar-dominio.mjs — Genera packages/dominio/src/nucleo/*.js (módulos ES) a partir de las bibliotecas puras de public/js.
 *
 * Tarea 5.2 del plan (docs/plan-producto.html) y ADR 0007. Mientras la aplicación vieja siga publicada, public/js es la fuente y el paquete se
 * genera; así no hay dos copias que mantener a mano.
 *
 *   pnpm dominio:generar     escribe el paquete
 *   pnpm dominio:verificar   falla si el paquete no coincide con lo que se generaría (se usa en CI)
 *
 * Qué cambia en cada archivo, y nada más:
 *   - `typeof X !== 'undefined' ? X : require('./x.js')`  →  `X`, con `import X from './x.js'` arriba (sin carga doble).
 *   - `if (typeof module …) module.exports = X;`          →  `export default X;` (sin variable global).
 *   - `CONFIG` y `Services`, que en el navegador eran globales, se importan de ./entorno.js, que los recibe con `configurar()`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN = path.join(RAIZ, 'public', 'js');
const DESTINO = path.join(RAIZ, 'packages', 'dominio', 'src', 'nucleo');
const CJS = path.join(RAIZ, 'packages', 'dominio', 'cjs');

const CARGA_DOBLE = /typeof (\w+) !== 'undefined' \? \1 : require\('\.\/([\w-]+)\.js'\)/g;
const EXPORTACION = /^if \(typeof module !== 'undefined' && module\.exports\) module\.exports = (\w+);\s*$/m;
const SIN_COMENTARIOS = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DEL_ENTORNO = ['CONFIG', 'Services', 'Calculos', 'Rutas'];

const AVISO = (origen) =>
  `// GENERADO por scripts/generar-dominio.mjs a partir de public/js/${origen}. No editar: cambie el original y corra \`pnpm dominio:generar\`.\n`;

/** Nombres de las bibliotecas puras: las que exportan con module.exports. */
function bibliotecasPuras() {
  return fs
    .readdirSync(ORIGEN)
    .filter((f) => f.endsWith('.js') && EXPORTACION.test(fs.readFileSync(path.join(ORIGEN, f), 'utf8')))
    .sort();
}

/** Código de una biblioteca pura como módulo ES. */
function convertir(archivo) {
  let codigo = fs.readFileSync(path.join(ORIGEN, archivo), 'utf8').replace(/\r\n/g, '\n');
  const m = EXPORTACION.exec(codigo);
  const nombre = m[1];
  const importaciones = new Map();
  codigo = codigo.replace(CARGA_DOBLE, (_, global, modulo) => {
    importaciones.set(global, modulo);
    return global;
  });
  codigo = codigo.replace(EXPORTACION, `export default ${nombre};`);
  const limpio = SIN_COMENTARIOS(codigo);
  // Globales que el archivo usaba sin la carga doble (solo equipamiento.js lo hace con Calculos y Rutas): vienen del entorno.
  const delEntorno = DEL_ENTORNO.filter((g) => !importaciones.has(g) && g !== nombre && new RegExp(`(?<![\\w.$'"])${g}(\\.|\\b(?=\\s*[)\\]&|?;,]))`).test(limpio));
  // Las bibliotecas que leen archivos con fetch() pasan a tener una fábrica: crearX({ fetch }) entrega de dónde se leen los datos
  // (en el servidor, de la base) y cada llamada tiene su propia memoria. El export por omisión sigue usando el fetch del entorno.
  if (/(?<![\w.])fetch\(/.test(limpio) && !/typeof fetch/.test(limpio)) {
    const cierre = codigo.lastIndexOf(`})();\n\nexport default ${nombre};`);
    const inicio = codigo.indexOf(`const ${nombre} = (() => {`);
    if (cierre < 0 || inicio < 0) throw new Error(`${archivo}: no se pudo envolver en una fábrica.`);
    codigo =
      `${codigo.slice(0, inicio)}export function crear${nombre}(dependencias = {}) {\n  const fetch = dependencias.fetch || ((...a) => globalThis.fetch(...a));\n` +
      `${codigo.slice(inicio, cierre)}})();\n  return ${nombre};\n}\n\nconst ${nombre} = crear${nombre}();\nexport default ${nombre};${codigo.slice(cierre + `})();\n\nexport default ${nombre};`.length)}`;
  }
  if (/\brequire\(/.test(limpio)) throw new Error(`${archivo}: queda un require() que el generador no sabe convertir.`);
  const cabecera = [
    AVISO(archivo),
    ...[...importaciones].map(([global, modulo]) => `import ${global} from './${modulo}.js';`),
    delEntorno.length ? `import { ${delEntorno.join(', ')} } from './entorno.js';` : null,
  ].filter(Boolean);
  return { nombre, codigo: `${cabecera.join('\n')}\n${codigo}` };
}

/** config.js no es una biblioteca: es el objeto CONFIG. Se exporta tal cual. */
function convertirConfig() {
  const codigo = fs.readFileSync(path.join(ORIGEN, 'config.js'), 'utf8').replace(/\r\n/g, '\n');
  if (!/^const CONFIG = \{/m.test(codigo)) throw new Error('config.js: no se encontró «const CONFIG = {».');
  return `${AVISO('config.js')}${codigo.trimEnd()}\n\nexport default CONFIG;\n`;
}

const ENTORNO = `// GENERADO por scripts/generar-dominio.mjs. No editar.
/**
 * entorno.js — Lo que en el navegador eran variables globales (CONFIG, Services) y aquí se entrega una sola vez con configurar().
 * Mientras no se llame a configurar(), CONFIG y Services valen undefined, igual que cuando las bibliotecas se cargaban solas en una prueba.
 * Calculos y Rutas son los del paquete salvo que una prueba entregue un doble.
 */
import CalculosDelNucleo from './calculos.js';
import RutasDelNucleo from './rutas.js';

export let CONFIG;
export let Services;
export let Calculos = CalculosDelNucleo;
export let Rutas = RutasDelNucleo;

/** Entrega la configuración y los servicios de red a las bibliotecas del núcleo. Cada campo es opcional. */
export function configurar(entorno = {}) {
  if ('CONFIG' in entorno) CONFIG = entorno.CONFIG;
  if ('Services' in entorno) Services = entorno.Services;
  if ('Calculos' in entorno) Calculos = entorno.Calculos;
  if ('Rutas' in entorno) Rutas = entorno.Rutas;
}
`;

function generar() {
  const archivos = new Map();
  const puras = bibliotecasPuras();
  const nombres = {};
  for (const f of puras) {
    const { nombre, codigo } = convertir(f);
    nombres[f.replace(/\.js$/, '')] = nombre;
    archivos.set(path.join(DESTINO, f), codigo);
    // Puente CommonJS para correr las pruebas de test/ contra el paquete sin tocarlas (jest.dominio.config.ts).
    archivos.set(path.join(CJS, f), `// GENERADO por scripts/generar-dominio.mjs. No editar.\nmodule.exports = require('../src/nucleo/${f}').default;\n`);
  }
  archivos.set(path.join(DESTINO, 'config.js'), convertirConfig());
  archivos.set(path.join(DESTINO, 'entorno.js'), ENTORNO);
  const indice = [
    '// GENERADO por scripts/generar-dominio.mjs. No editar.',
    ...Object.entries(nombres).map(([modulo, nombre]) => `export { default as ${nombre} } from './${modulo}.js';`),
    "export { default as CONFIG } from './config.js';",
    "export { configurar } from './entorno.js';",
    '',
  ].join('\n');
  archivos.set(path.join(DESTINO, 'index.js'), indice);
  archivos.set(path.join(CJS, 'modulos.json'), `${JSON.stringify(Object.keys(nombres), null, 2)}\n`);
  return archivos;
}

const verificar = process.argv.includes('--verificar');
const archivos = generar();
let distintos = 0;
for (const [ruta, contenido] of archivos) {
  const actual = fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n') : null;
  if (actual === contenido) continue;
  distintos++;
  if (verificar) console.error(`DISTINTO  ${path.relative(RAIZ, ruta)}`);
  else {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, contenido, 'utf8');
  }
}
// Un archivo generado que ya no tiene original también es deriva.
for (const dir of [DESTINO, CJS]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const ruta = path.join(dir, f);
    if (archivos.has(ruta)) continue;
    distintos++;
    if (verificar) console.error(`SOBRA     ${path.relative(RAIZ, ruta)}`);
    else fs.rmSync(ruta);
  }
}
if (verificar) {
  if (distintos) {
    console.error(`\nEl paquete de dominio no coincide con public/js (${distintos} archivos). Corra: pnpm dominio:generar`);
    process.exit(1);
  }
  console.log(`Paquete de dominio al día: ${archivos.size} archivos.`);
} else {
  console.log(`Paquete de dominio: ${archivos.size} archivos, ${distintos} escritos.`);
}
