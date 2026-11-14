/**
 * recolectar-smartbus.mjs — Descarga las rutas y paradas de SmartBus Arequipa (smartbus.app) para análisis LOCAL.
 *
 * USO RESTRINGIDO. SmartBus no publica licencia ni términos de uso. Estos datos son de uso local de análisis; sin licencia; no
 * redistribuir. Por defecto se guardan solo en datos-crudos/smartbus/ (ignorada por git); el programa se niega a escribir en
 * public/, dist/ o api/. Este script NO está conectado a la aplicación, a la compilación ni a datos:verificar, y no vuelve a
 * generar public/data/rutas_smartbus.geojson (retirado en el commit cca7fa4 porque solo había permiso verbal).
 *
 * Uso:   pnpm datos:smartbus -- --max-rutas 3          (primero una prueba pequeña)
 *        pnpm datos:smartbus                           (todas las rutas: ≈ 242 solicitudes, ≥ 1,1 s entre cada una)
 * Sale:  datos-crudos/smartbus/smartbus-aqp.geojson (o .json / .csv); respuestas crudas en datos-crudos/smartbus/cache/.
 *
 * Fuente (sin autenticación; las mismas llamadas del mapa público): GET /smartbus/pe/arequipa/routes y …/routes/{id}.
 * Adaptado de scripts/descargar-rutas-smartbus.mjs; la lógica está en scripts/lib/smartbus/ y reutiliza el cliente cortés y la
 * lectura de robots.txt de scripts/lib/avisos/. Reglas: robots.txt en cada corrida; una solicitud a la vez; ≥ 1,1 s entre
 * solicitudes; se detiene (sin insistir ni saltar nada) ante 401/403/407/429, redirecciones o verificación anti-bot; valida antes
 * de escribir; nunca reemplaza un archivo bueno con una corrida fallida.
 *
 * Código de salida: 0 bien; 1 detenido o con error (no se escribió nada); 2 argumentos no válidos.
 */
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const Cli = require('./lib/smartbus/cli.js');
const Http = require('./lib/avisos/http.js');
const Recolector = require('./lib/smartbus/recolector.js');
const Salida = require('./lib/smartbus/salida.js');
const S = require('./lib/smartbus/smartbus.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
// Honesto: dice quién es y para qué, y NO afirma ningún permiso.
const USER_AGENT = 'GeoVerificador-smartbus/1.0 (recoleccion para analisis local de transporte en Arequipa; respeta robots.txt)';
const ESPERA_MS = 1100; // ≥ 1,1 s entre solicitudes al mismo sitio

async function main() {
  let opciones;
  let ruta;
  try {
    opciones = Cli.parsearArgumentos(process.argv.slice(2));
    if (!opciones.ayuda) ruta = Salida.rutaSalida({ salida: opciones.salida, formato: opciones.formato, raiz: RAIZ });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
    return;
  }
  if (opciones.ayuda) {
    console.log(Cli.textoAyuda());
    return;
  }

  const ahora = new Date();
  const cliente = Http.crearCliente({ userAgent: USER_AGENT, esperaMs: ESPERA_MS, seguirRedirecciones: false });
  const cache = Salida.crearCacheDisco(Salida.carpetaCache(RAIZ));
  console.log(`SmartBus Arequipa | línea: ${opciones.linea} | máx. rutas: ${opciones.maxRutas ?? 'todas'} | formato: ${opciones.formato}`);
  console.log('Uso local de análisis; sin licencia; no redistribuir.');

  let resultado;
  try {
    resultado = await Recolector.recolectarSmartbus({ cliente, linea: opciones.linea, maxRutas: opciones.maxRutas, cache, refrescar: opciones.refrescar, ahora, userAgent: USER_AGENT, log: (m) => console.log(m) });
  } catch (err) {
    console.error(`\n${err instanceof Recolector.Detenido ? 'DETENIDO' : 'ERROR'}: ${err.message}`);
    console.error('No se escribió nada; un archivo de salida existente (si lo hay) no se modificó.');
    console.error(`Solicitudes HTTP hechas: ${cliente.solicitudes}`);
    process.exitCode = 1;
    return;
  }

  for (const { sufijo, contenido } of S.serializar(opciones.formato, resultado)) await Salida.escribirAtomico(ruta + sufijo, contenido);
  const c = resultado.metadata.conteos;
  console.log(`\nGuardado en ${relative(process.cwd(), ruta) || ruta}`);
  console.log(`Líneas: ${c.lineas} | empresas: ${c.empresas} | ramales: ${c.ramales} | rutas (un sentido): ${c.rutas}`);
  console.log(`Paradas (registros): ${c.paradas} | posiciones de parada distintas: ${c.posiciones_de_parada_distintas} | vértices: ${c.vertices}`);
  console.log(`Solicitudes HTTP hechas: ${cliente.solicitudes}`);
}

// Solo corre al ejecutarlo como script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nNo se pudo completar la recolección: ${err.message}`);
    process.exitCode = 1;
  });
}
