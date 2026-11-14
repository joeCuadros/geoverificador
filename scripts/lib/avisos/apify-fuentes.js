/**
 * apify-fuentes.js — Variantes de Urbania, Adondevivir y Facebook Marketplace que corren en Apify (plataforma de PAGO) en lugar de
 * pedir las páginas directamente. Solo se usan con `--transporte apify`; nunca como respaldo automático. Lo prueba
 * test/avisos-apify-fuentes.spec.ts (sin red; el cliente de Apify es un doble).
 *
 * - Los actores están en ACTORES_POR_DEFECTO y se pueden cambiar sin tocar código: bandera `--actor fuente=usuario/actor` o
 *   variable de entorno APIFY_ACTOR_URBANIA / APIFY_ACTOR_ADONDEVIVIR / APIFY_ACTOR_MARKETPLACE.
 * - Una ejecución por fuente. El gasto está acotado dos veces: `maxTotalChargeUsd` (tope en dólares, lo aplica Apify) y el máximo
 *   de ítems del input del actor (páginas × 30 avisos × tipos, o `--max-items`).
 * - Navent (Urbania, Adondevivir): las URL de inicio son las mismas que arman los adaptadores directos. Marketplace: la URL de inicio
 *   la da la persona (`--url-marketplace` o MARKETPLACE_URL); no se adivina ninguna ubicación de Facebook.
 * - Con Apify el CLI no hace ninguna solicitud a Facebook ni a los portales: la compuerta de robots.txt del transporte directo
 *   no aplica. Marketplace igualmente exige pedirse por nombre y no entra en `todas`.
 *
 * Los nombres de campo de los actores no están verificados (ver apify-mapeo.js).
 */
const Mapeo = require('./apify-mapeo.js');
const Adondevivir = require('./fuentes/adondevivir.js');
const Urbania = require('./fuentes/urbania.js');
const { TIPOS_TODOS } = require('./fuentes/navent.js');

const ACTORES_POR_DEFECTO = {
  urbania: 'scrapers_lat/urbania-scraper',
  adondevivir: 'scrapers_lat/adondevivir-scraper',
  marketplace: 'apify/facebook-marketplace-scraper',
};
const FUENTES_APIFY = Object.keys(ACTORES_POR_DEFECTO);
const AVISOS_POR_PAGINA = 30;
const FORMA_ACTOR = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VARIABLE_ACTOR = (fuente) => `APIFY_ACTOR_${fuente.toUpperCase()}`;

/** Actor de cada fuente: bandera > variable de entorno > valor por defecto. Lanza si algún identificador está mal formado. */
function resolverActores({ flags = {}, env = process.env } = {}) {
  const actores = {};
  for (const fuente of FUENTES_APIFY) {
    const deEnv = typeof env[VARIABLE_ACTOR(fuente)] === 'string' ? env[VARIABLE_ACTOR(fuente)].trim() : '';
    const valor = (flags[fuente] && String(flags[fuente]).trim().replace('~', '/')) || deEnv.replace('~', '/') || ACTORES_POR_DEFECTO[fuente];
    if (!FORMA_ACTOR.test(valor)) {
      const origen = flags[fuente] ? `la bandera --actor ${fuente}=` : `la variable ${VARIABLE_ACTOR(fuente)}=`;
      throw new Error(`Identificador de actor no válido en ${origen}«${valor}» (${fuente}). Debe tener la forma usuario/actor.`);
    }
    actores[fuente] = valor;
  }
  return actores;
}

const NAVENT = { urbania: Urbania, adondevivir: Adondevivir };
const BASES = { urbania: 'https://urbania.pe', adondevivir: 'https://www.adondevivir.com' };

const MENSAJE_URL_MARKETPLACE =
  'Marketplace con Apify necesita la URL de la búsqueda de inmuebles en venta de su ciudad. Ábrala en el navegador (ubicación y categoría ' +
  '«Propiedades en venta» ya elegidas, algo como https://www.facebook.com/marketplace/<ciudad>/propertyforsale) y pásela con ' +
  '--url-marketplace <url> o en la variable de entorno MARKETPLACE_URL. No se adivina ninguna ubicación.';

function esUrlFacebook(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)facebook\.com$/i.test(x.hostname) && x.pathname.startsWith('/marketplace');
  } catch {
    return false;
  }
}

/** → { estado, mensaje, avisos, paginas, via }. `ctx.apify`: { cliente, topeUsd, detalles, maxItems, actores, urlMarketplace }. */
async function buscar(nombre, filtros, ctx) {
  if (!FUENTES_APIFY.includes(nombre)) throw new Error(`La fuente «${nombre}» no tiene variante Apify (disponibles: ${FUENTES_APIFY.join(', ')}).`);
  const a = ctx.apify;
  const log = ctx.log || (() => {});
  const actor = a.actores[nombre];
  const resultado = (estado, mensaje, avisos = []) => ({ estado, mensaje, avisos, paginas: 0, via: 'apify' });

  let input;
  let maxItems;
  let tipoBusqueda = null; // tipo de la búsqueda, solo si todas las URL de inicio son del mismo tipo
  if (nombre === 'marketplace') {
    if (!a.urlMarketplace) return resultado('error', MENSAJE_URL_MARKETPLACE);
    if (!esUrlFacebook(a.urlMarketplace)) return resultado('error', `La URL de Marketplace no es válida: debe ser https://www.facebook.com/marketplace/… (recibida: «${a.urlMarketplace}»).`);
    maxItems = a.maxItems || ctx.paginas * AVISOS_POR_PAGINA;
    input = { startUrls: [{ url: a.urlMarketplace }], resultsLimit: maxItems, includeListingDetails: Boolean(a.detalles) };
  } else {
    const tipos = !filtros.tipo || filtros.tipo === 'todos' ? TIPOS_TODOS : [filtros.tipo];
    const urls = tipos.map((tipo) => NAVENT[nombre].construirUrl({ tipo, distrito: filtros.distrito, pagina: 1 })).filter(Boolean);
    if (urls.length === 0) return resultado('omitido', `${nombre} no tiene el tipo «${filtros.tipo}»`);
    maxItems = a.maxItems || ctx.paginas * AVISOS_POR_PAGINA * urls.length;
    if (tipos.length === 1) tipoBusqueda = tipos[0];
    input = { startUrls: urls.map((url) => ({ url })), maxListings: maxItems, withDetails: Boolean(a.detalles) };
  }

  log(`[${nombre}] Apify (de pago): actor ${actor} | máx. ${maxItems} ítems | tope ${a.topeUsd} USD`);
  let items;
  try {
    items = await a.cliente.ejecutar(actor, input, { topeUsd: a.topeUsd, maxItems });
  } catch (err) {
    return resultado('error', err.message);
  }

  const mapeado = Mapeo.mapearItems(items, nombre === 'marketplace' ? 'marketplace' : 'scrapers_lat', { fuente: nombre, base: BASES[nombre], actor, distritosConocidos: ctx.distritosConocidos, ahora: ctx.ahora, tipoBusqueda });
  const notas = [`ejecución de Apify: ${items.length} ítem(s) recibidos`];
  if (mapeado.descartados.no_venta) notas.push(`${mapeado.descartados.no_venta} no eran de venta y se descartaron`);
  if (mapeado.descartados.vendido) notas.push(`${mapeado.descartados.vendido} ya vendidos se descartaron`);
  if (mapeado.noMapeados) notas.push(`${mapeado.noMapeados} ítem(s) no se pudieron mapear`);
  if (items.length === 0) return resultado('ok', `el actor no devolvió ítems (${notas[0]})`);
  if (mapeado.avisos.length === 0 && mapeado.descartados.no_venta + mapeado.descartados.vendido < items.length) {
    return resultado('error', `formato inesperado: ningún ítem de ${actor} se pudo mapear (${notas.join('; ')}). Los nombres de campo del actor pueden haber cambiado.`);
  }
  return resultado(mapeado.noMapeados > 0 ? 'parcial' : 'ok', notas.join('; '), mapeado.avisos);
}

module.exports = { ACTORES_POR_DEFECTO, FUENTES_APIFY, AVISOS_POR_PAGINA, MENSAJE_URL_MARKETPLACE, resolverActores, buscar };
