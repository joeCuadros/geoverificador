/**
 * marketplace.js — Fuente: Facebook Marketplace (inmuebles en venta, Arequipa). Solo se ejecuta si se pide por nombre
 * (`--fuente marketplace`); no entra en `--fuente todas`.
 *
 * Límites de diseño (no negociables):
 *  - Nunca se maneja ni se guarda una credencial y nunca se automatiza el formulario de inicio de sesión. Se usa un perfil
 *    de navegador local y persistente (`datos-crudos/perfil-marketplace/`, ignorado por git) donde la PERSONA inicia sesión a
 *    mano una vez; esta fuente solo lee los resultados de búsqueda, a bajo volumen (pocas pantallas, con esperas).
 *  - Antes de abrir nada se consulta el robots.txt de Facebook. El 2026-11-12 decía «User-agent: *  Disallow: /»: mientras
 *    sea así, esta fuente se OMITE (estado «robots») y no se abre el navegador. No hay opción para saltarse esa regla.
 *  - Sin evasión: no se usa ningún plugin de sigilo, ni se falsea la huella del navegador, ni se resuelven captchas.
 *  - El navegador (Playwright) NO es una dependencia del proyecto. Se carga con import() dinámico; si falta, se explica
 *    cómo instalarlo y se sigue con las demás fuentes.
 *
 * Estado de la verificación: `parsear` está probado solo con una estructura sintética (ver test/avisos-marketplace.spec.ts);
 * no hay una muestra real de Marketplace. La lectura con navegador (leerConNavegador) NO se ha ejecutado nunca.
 * De cada aviso se guardan id, título, precio y ciudad; se descarta todo lo del vendedor y las fotos.
 */
const E = require('../esquema.js');
const Precios = require('../../../../public/js/precios.js');

const NOMBRE = 'marketplace';
const URL_BUSQUEDA = 'https://www.facebook.com/marketplace/arequipa/propertyforsale';
const PERFIL_POR_DEFECTO = 'datos-crudos/perfil-marketplace';
const ESPERA_PANTALLA_MS = 4000;
const ESPERA_INICIO_SESION_MS = 5 * 60 * 1000;

/** { monto, moneda } desde el texto que muestra Marketplace («S/ 250,000», «US$45,000», «$ 120,500»). */
function parsearPrecio(texto) {
  if (typeof texto !== 'string') return { monto: null, moneda: null };
  const m = /(S\/\.?|US\$|\$)\s*([\d.,]+)/i.exec(texto);
  if (!m) return { monto: null, moneda: null };
  const monto = Number(m[2].replace(/,/g, ''));
  return { monto: Number.isFinite(monto) ? monto : null, moneda: E.normalizarMoneda(m[1]) };
}

/**
 * { distrito, zona } desde la ciudad que muestra Marketplace. Solo es distrito un nombre que coincide con uno conocido;
 * «Arequipa» es la ciudad, no necesariamente el distrito Cercado, así que no cuenta.
 */
function ubicarCiudad(ciudad, conocidos = []) {
  const clave = typeof ciudad === 'string' ? Precios.claveDistrito(ciudad) : '';
  const esDistrito = clave && clave !== 'AREQUIPA' && conocidos.some((d) => Precios.claveDistrito(d) === clave);
  return { distrito: esDistrito ? ciudad : null, zona: esDistrito ? null : (typeof ciudad === 'string' ? ciudad : null) };
}

/** Recorre cualquier estructura JSON y junta los objetos que parecen un aviso de Marketplace. */
function encontrarAvisos(nodo, salida, visitados = new Set(), profundidad = 0) {
  if (!nodo || typeof nodo !== 'object' || profundidad > 60 || visitados.has(nodo)) return salida;
  visitados.add(nodo);
  if (!Array.isArray(nodo) && nodo.id && typeof nodo.marketplace_listing_title === 'string') salida.push(nodo);
  for (const v of Array.isArray(nodo) ? nodo : Object.values(nodo)) encontrarAvisos(v, salida, visitados, profundidad + 1);
  return salida;
}

/** Avisos normalizados desde el JSON (objeto o texto) de una respuesta de búsqueda. Lista vacía si no hay nada legible. */
function parsear(datos, ctx = {}) {
  let raiz = datos;
  if (typeof datos === 'string') {
    try {
      raiz = JSON.parse(datos);
    } catch {
      return [];
    }
  }
  const conocidos = ctx.distritosConocidos || [];
  const vistos = new Set();
  const avisos = [];
  for (const n of encontrarAvisos(raiz, [])) {
    const id = String(n.id);
    if (vistos.has(id) || n.is_sold === true) continue;
    vistos.add(id);
    const precio = n.listing_price ? parsearPrecio(n.listing_price.formatted_amount) : { monto: null, moneda: null };
    const montoPublicado = n.listing_price && Number(n.listing_price.amount) > 0 ? Number(n.listing_price.amount) : precio.monto;
    const ciudad = n.location && n.location.reverse_geocode && typeof n.location.reverse_geocode.city === 'string' ? n.location.reverse_geocode.city : null;
    const { distrito, zona } = ubicarCiudad(ciudad, conocidos);
    const a = E.crearAviso(
      {
        fuente: NOMBRE,
        id_fuente: id,
        url: `https://www.facebook.com/marketplace/item/${id}/`,
        titulo: n.marketplace_listing_title,
        precio: montoPublicado,
        moneda: precio.moneda,
        distrito,
        zona,
      },
      { ahora: ctx.ahora, distritosConocidos: conocidos }
    );
    if (a) avisos.push(a);
  }
  return avisos;
}

/** Carga Playwright con import() dinámico. `importar` se inyecta en las pruebas. */
async function cargarNavegador(importar = (nombre) => import(nombre)) {
  try {
    return await importar('playwright');
  } catch (err) {
    if (err && (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(err.code) || /Cannot find (package|module)/i.test(String(err.message)))) {
      throw new Error(
        'Playwright no está instalado, así que no se puede leer Marketplace. Instálelo solo si decide usar esta fuente ' +
          '(`pnpm add -D playwright` y `pnpm exec playwright install chromium`). Las demás fuentes no lo necesitan.'
      );
    }
    throw err;
  }
}

/**
 * Lee las pantallas de resultados con el perfil persistente. NO ejecutada nunca (ver encabezado).
 * Un solo navegador visible, una pantalla cada ESPERA_PANTALLA_MS. Si hace falta iniciar sesión, espera a que la persona lo haga.
 */
async function leerConNavegador(pw, ctx) {
  const contexto = await pw.chromium.launchPersistentContext(ctx.perfil || PERFIL_POR_DEFECTO, { headless: false });
  try {
    const pagina = contexto.pages()[0] || (await contexto.newPage());
    await pagina.goto(URL_BUSQUEDA, { waitUntil: 'domcontentloaded' });
    const enLogin = () => /\/login|checkpoint/.test(pagina.url());
    if (enLogin()) {
      if (ctx.log) ctx.log('Marketplace: inicie sesión a mano en la ventana abierta (hasta 5 minutos). El programa no toca el formulario ni guarda credenciales.');
      await pagina.waitForURL((u) => !/\/login|checkpoint/.test(u.href), { timeout: ESPERA_INICIO_SESION_MS });
      await pagina.goto(URL_BUSQUEDA, { waitUntil: 'domcontentloaded' });
    }
    const avisos = [];
    for (let i = 0; i < ctx.paginas; i++) {
      await pagina.waitForTimeout(ESPERA_PANTALLA_MS);
      const bloques = await pagina.$$eval('script[type="application/json"]', (els) => els.map((e) => e.textContent));
      for (const b of bloques) avisos.push(...parsear(b, ctx));
      await pagina.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    }
    return avisos;
  } finally {
    await contexto.close();
  }
}

/** → { estado, mensaje, avisos, paginas }. Estados: ok | robots | bloqueado | error | sin_navegador. */
async function buscar(filtros, ctx) {
  const robots = await ctx.cliente.permitido(URL_BUSQUEDA);
  if (robots.estado === 'robots') {
    return { estado: 'robots', mensaje: `${robots.motivo}. Se omite Marketplace y no se abre el navegador.`, avisos: [], paginas: 0 };
  }
  if (robots.estado === 'bloqueado') return { estado: 'bloqueado', mensaje: `bloqueado por anti-bot o límite de solicitudes: ${robots.motivo}`, avisos: [], paginas: 0 };
  if (robots.estado !== 'ok') return { estado: 'error', mensaje: robots.motivo, avisos: [], paginas: 0 };

  let pw;
  try {
    pw = await (ctx.cargarNavegador || cargarNavegador)();
  } catch (err) {
    return { estado: 'sin_navegador', mensaje: err.message, avisos: [], paginas: 0 };
  }
  try {
    const avisos = await leerConNavegador(pw, ctx);
    return { estado: 'ok', mensaje: null, avisos, paginas: ctx.paginas };
  } catch (err) {
    return { estado: 'error', mensaje: `fallo al leer Marketplace con el navegador: ${err.message}`, avisos: [], paginas: 0 };
  }
}

module.exports = {
  nombre: NOMBRE,
  descripcion: 'Facebook Marketplace: requiere navegador con sesión iniciada a mano; se omite si robots.txt lo prohíbe (hoy lo prohíbe)',
  tipos: [],
  requiereNavegador: true,
  URL_BUSQUEDA,
  PERFIL_POR_DEFECTO,
  parsearPrecio,
  ubicarCiudad,
  parsear,
  cargarNavegador,
  buscar,
};
