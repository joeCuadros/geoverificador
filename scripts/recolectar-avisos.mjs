/**
 * recolectar-avisos.mjs — Reúne avisos de VENTA de inmuebles de Arequipa desde varios portales y los normaliza a un esquema único.
 *
 * Fuentes: nexo (nexoinmobiliario.pe), adondevivir (adondevivir.com), urbania (urbania.pe) y, solo si se pide por nombre,
 * marketplace (Facebook Marketplace, con navegador y sesión iniciada a mano; hoy se omite porque el robots.txt de Facebook lo prohíbe).
 *
 * Uso:   pnpm datos:avisos -- [opciones]        (--ayuda lista las opciones)
 *        node scripts/recolectar-avisos.mjs --fuente nexo --paginas 1
 * Sale:  datos-crudos/avisos/avisos-AAAA-MM-DD.json (o .csv). Carpeta ignorada por git y fuera de public/.
 *
 * Reglas (detalle en scripts/lib/avisos/http.js): lee el robots.txt de cada sitio antes de pedirle algo y omite lo que prohíbe;
 * solicitudes una a una con al menos 2 s entre dos al mismo sitio; User-Agent propio; si un sitio responde 401/403/429 o muestra un
 * desafío anti-bot, se detiene en ese sitio y sigue con los demás, sin intentar saltarse nada. No se guardan vendedores, teléfonos
 * ni perfiles. Son datos de terceros para análisis interno: no se publican.
 *
 * Código de salida: 0 si al menos una fuente respondió; 1 si ninguna pudo aportar datos (no se escribe archivo); 2 si los argumentos no son válidos.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const Cli = require('./lib/avisos/cli.js');
const Apify = require('./lib/avisos/apify.js');
const ApifyFuentes = require('./lib/avisos/apify-fuentes.js');
const Http = require('./lib/avisos/http.js');
const Recolector = require('./lib/avisos/recolector.js');
const Salida = require('./lib/avisos/salida.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DISTRITOS = join(RAIZ, 'public', 'data', 'distritos_aqp.geojson');
const USER_AGENT = 'GeoVerificador-avisos/1.0 (recoleccion manual de avisos para analisis de vivienda en Arequipa; respeta robots.txt)';
const ESTADOS_SIN_DATOS = new Set(['bloqueado', 'robots', 'error', 'omitido', 'sin_navegador']);

const etiqueta = {
  ok: 'ok',
  parcial: 'parcial',
  bloqueado: 'BLOQUEADO por anti-bot',
  robots: 'omitida por robots.txt',
  error: 'ERROR',
  omitido: 'omitida (tipo no disponible)',
  sin_navegador: 'omitida (falta Playwright)',
};

async function main() {
  let opciones;
  try {
    opciones = Cli.parsearArgumentos(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof Cli.ErrorDeUso)) throw err;
    console.error(err.message);
    process.exitCode = 2;
    return;
  }
  if (opciones.ayuda) {
    console.log(Cli.textoAyuda());
    return;
  }

  const geojson = JSON.parse(await readFile(DISTRITOS, 'utf8'));
  const distritosConocidos = geojson.features.map((f) => f.properties.distrito);
  let distrito;
  try {
    distrito = Cli.resolverDistritoPedido(opciones.distrito, distritosConocidos);
  } catch (err) {
    if (!(err instanceof Cli.ErrorDeUso)) throw err;
    console.error(err.message);
    process.exitCode = 2;
    return;
  }

  // Apify (de pago) solo con --transporte apify. El token sale únicamente de APIFY_TOKEN y no se imprime en ningún lado.
  let apify = null;
  if (opciones.transporte === 'apify') {
    try {
      const token = Cli.exigirToken(opciones, process.env);
      if (token) {
        const segundos = Number(process.env.APIFY_TIMEOUT_SEG);
        apify = {
          cliente: Apify.crearClienteApify({ token, ...(Number.isFinite(segundos) && segundos > 0 ? { timeoutMs: segundos * 1000 } : {}) }),
          topeUsd: opciones.topeUsd,
          detalles: opciones.conDetalles,
          maxItems: opciones.maxItems,
          actores: ApifyFuentes.resolverActores({ flags: opciones.actores, env: process.env }),
          urlMarketplace: opciones.urlMarketplace || (process.env.MARKETPLACE_URL || '').trim() || null,
        };
      }
    } catch (err) {
      if (!(err instanceof Cli.ErrorDeUso) && !(err instanceof Apify.ErrorApify) && !/actor no válido/i.test(err.message)) throw err;
      console.error(err.message);
      process.exitCode = 2;
      return;
    }
  }

  const ahora = new Date();
  const ruta = Salida.rutaSalida({ salida: opciones.salida, formato: opciones.formato, ahora, raiz: RAIZ });
  const cliente = Http.crearCliente({ userAgent: USER_AGENT, esperaMs: opciones.esperaSeg * 1000 });
  const filtros = { distrito, tipo: opciones.tipo };

  console.log(`Transporte: ${opciones.transporte}${apify ? ` (Apify, de pago; tope ${opciones.topeUsd} USD por fuente)` : ''}`);
  console.log(`Fuentes: ${opciones.fuentes.join(', ')} | tipo: ${filtros.tipo} | distrito: ${distrito || 'todos'} | páginas por tipo: ${opciones.paginas} | espera: ${opciones.esperaSeg} s`);
  const { avisos, duplicados, resumen } = await Recolector.recolectar({
    fuentes: opciones.fuentes,
    filtros,
    paginas: opciones.paginas,
    cliente,
    distritosConocidos,
    ahora,
    perfil: opciones.perfil,
    transporte: opciones.transporte,
    apify,
    log: (m) => console.log(m),
  });

  console.log('\nResumen por fuente');
  for (const r of resumen) {
    console.log(`  ${r.fuente.padEnd(12)} ${(etiqueta[r.estado] || r.estado).padEnd(28)} vía: ${r.via}  páginas: ${r.paginas}  recolectados: ${r.recolectados}  aportados: ${r.finales}`);
    if (r.mensaje) console.log(`               ${r.mensaje}`);
  }
  console.log(`Solicitudes HTTP hechas: ${cliente.solicitudes} | duplicados quitados: ${duplicados}`);

  if (resumen.every((r) => ESTADOS_SIN_DATOS.has(r.estado))) {
    console.error('\nNinguna fuente pudo aportar datos. No se escribió ningún archivo.');
    process.exitCode = 1; // sin process.exit(): en Windows cortar con sockets abiertos puede terminar con un error de libuv
    return;
  }

  const contenido = opciones.formato === 'csv' ? Salida.aCsv(avisos) : Salida.aJson({ avisos, resumen, filtros, ahora });
  await Salida.escribir(ruta, contenido);

  const porDistrito = {};
  for (const a of avisos) porDistrito[a.distrito || '(sin distrito)'] = (porDistrito[a.distrito || '(sin distrito)'] || 0) + 1;
  console.log(`\n${avisos.length} avisos guardados en ${relative(process.cwd(), ruta) || ruta}`);
  console.log('Distritos vistos: ' + (Object.entries(porDistrito).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} (${n})`).join(', ') || 'ninguno'));
}

// Solo corre al ejecutarlo como script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nNo se pudo completar la recolección: ${err.message}`);
    process.exitCode = 1;
  });
}
