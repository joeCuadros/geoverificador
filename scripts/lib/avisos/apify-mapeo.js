/**
 * apify-mapeo.js — Traduce la salida de los actores de Apify al esquema normalizado (puro, sin red). Lo prueba
 * test/avisos-apify-fuentes.spec.ts con archivos SINTÉTICOS.
 *
 * Los nombres de campo salen de las páginas públicas de los actores y NO están verificados contra una salida real, así que los
 * mapeadores son defensivos: toleran campos ausentes o con otro tipo, nunca lanzan por un ítem malo (se cuenta como «no mapeado»)
 * y leen SOLO una lista cerrada de campos del inmueble. Por eso nada del anunciante o vendedor (nombres, ids, teléfonos,
 * WhatsApp, publicador, enlaces a perfiles) ni descripciones libres (que suelen traer teléfonos) ni fotos pasan a la salida.
 *
 * Tipos de actor:
 *   'scrapers_lat'  actores scrapers_lat/urbania-scraper y scrapers_lat/adondevivir-scraper
 *   'marketplace'   apify/facebook-marketplace-scraper
 */
const E = require('./esquema.js');
const Precios = require('../../../public/js/precios.js');
const Marketplace = require('./fuentes/marketplace.js');

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Monto desde un número o un texto («120,000», «S/ 250,000», «120.000»); null si no es un monto positivo. */
function montoDe(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = /\d[\d.,]*/.exec(v);
  if (!m) return null;
  let t = m[0].replace(/,/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const monedaDeTexto = (v) => {
  if (typeof v !== 'string') return null;
  const m = /(S\/\.?|US\$|\$)/i.exec(v);
  return m ? E.normalizarMoneda(m[1]) : null;
};

/** Distrito conocido por el primer tramo de «location» («Cayma, Arequipa»); «Arequipa» solo es la ciudad y no cuenta. */
function distritoDeTexto(texto, conocidos) {
  if (typeof texto !== 'string') return null;
  for (const tramo of texto.split(/,|\||·|\s-\s/).map((s) => s.trim())) {
    const k = Precios.claveDistrito(tramo);
    if (k && k !== 'AREQUIPA' && conocidos.some((d) => Precios.claveDistrito(d) === k)) return tramo;
  }
  return null;
}

const TIPOS_EN = { apartment: 'departamento', flat: 'departamento', house: 'casa', land: 'terreno', lot: 'terreno', plot: 'terreno', commercial: 'local', 'commercial space': 'local', office: 'oficina' };
/** Pista de tipo en el título (solo se usa para proyectos cuando la búsqueda mezclaba varios tipos). */
function tipoDeTitulo(titulo) {
  if (typeof titulo !== 'string') return null;
  if (/\b(departamentos?|dptos?\.?|flats?|d[uú]plex)\b/i.test(titulo)) return 'departamento';
  if (/\bcasas?\b/i.test(titulo)) return 'casa';
  if (/\b(terrenos?|lotes?)\b/i.test(titulo)) return 'terreno';
  return null;
}
const tipoDe = (v) => (typeof v === 'string' ? E.normalizarTipo(v) || TIPOS_EN[v.trim().toLowerCase()] || null : null);

function coordenadas(item) {
  const c = esObjeto(item.coordinates) ? item.coordinates : esObjeto(item.coords) ? item.coords : item;
  return { lat: c.lat ?? c.latitude ?? null, lon: c.lng ?? c.lon ?? c.longitude ?? null };
}

/** Id: listingId, luego el número del final de la URL (el mismo que usa la lectura directa), luego postingCode. */
function idDe(item, url) {
  if (item.listingId !== undefined && item.listingId !== null && String(item.listingId).trim() !== '') return String(item.listingId).trim();
  const m = /(\d{5,})(?:\.html)?\/?(?:[?#].*)?$/.exec(url);
  if (m) return m[1];
  return typeof item.postingCode === 'string' && item.postingCode.trim() ? item.postingCode.trim() : null;
}

/** Un ítem de scrapers_lat. → { aviso } | { descarte } | null (no mapeable). */
function mapearScrapersLat(item, ctx) {
  if (!esObjeto(item)) return null;
  const op = typeof item.operationType === 'string' ? item.operationType.trim() : '';
  if (op && !/venta|sale|sell|compra|buy/i.test(op)) return { descarte: 'no_venta' };
  if (typeof item.url !== 'string' || !item.url.trim()) return null;
  const url = /^https?:\/\//i.test(item.url) ? item.url.trim() : ctx.base + (item.url.startsWith('/') ? '' : '/') + item.url.trim();
  const id = idDe(item, url);
  if (!id) return null;

  let precio = montoDe(item.price);
  let moneda = precio === null ? null : E.normalizarMoneda(item.currency) || monedaDeTexto(item.price);
  const pen = montoDe(item.pricePen);
  const usd = montoDe(item.priceUsd);
  if (precio === null || moneda === null) {
    if (pen !== null) [precio, moneda] = [pen, 'PEN'];
    else if (usd !== null) [precio, moneda] = [usd, 'USD'];
  }
  let alterno = null;
  let monedaAlterna = null;
  if (moneda === 'PEN' && usd !== null) [alterno, monedaAlterna] = [usd, 'USD'];
  else if (moneda === 'USD' && pen !== null) [alterno, monedaAlterna] = [pen, 'PEN'];

  // Proyectos («Desarrollo» en el modo lista real; isDevelopment en Adondevivir): no son un tipo de inmueble sino una obra con varias
  // unidades. El tipo sale del propertyType si lo da; si no, de la búsqueda que lo produjo (solo cuando era de un único tipo), luego del
  // título, y si no hay pista queda null. Como en Nexo, un proyecto no lleva precio por m².
  const esProyecto = item.isDevelopment === true || (typeof item.propertyType === 'string' && /desarrollo|proyecto|development/i.test(item.propertyType));
  const tipo = esProyecto ? tipoDe(item.propertyType) || ctx.tipoBusqueda || tipoDeTitulo(item.title) || null : tipoDe(item.propertyType);

  const { lat, lon } = coordenadas(item);
  const conocidos = ctx.distritosConocidos || [];
  const aviso = E.crearAviso(
    {
      fuente: ctx.fuente,
      id_fuente: id,
      url,
      titulo: item.title,
      tipo_portal: item.propertyType,
      tipo_inmueble: tipo,
      es_proyecto: esProyecto,
      precio,
      moneda,
      precio_alterno: alterno,
      moneda_alterna: monedaAlterna,
      area_total_m2: montoDe(item.totalAreaM2),
      area_construida_m2: montoDe(item.builtAreaM2),
      dormitorios: item.bedrooms,
      banos: item.bathrooms,
      estacionamientos: item.parkingSpaces,
      distrito: (typeof item.district === 'string' && item.district.trim()) || distritoDeTexto(item.location, conocidos),
      direccion: item.address,
      lat,
      lon,
      fecha_publicacion: item.publishedDate,
      via: 'apify',
      actor: ctx.actor,
    },
    { ahora: ctx.ahora, distritosConocidos: conocidos }
  );
  return aviso ? { aviso } : null;
}

/** «timestamp» de Marketplace (segundos, milisegundos o ISO) → texto ISO; null si no se entiende. */
function fechaDeMarca(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n < 1e11 ? n * 1000 : n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Un ítem de apify/facebook-marketplace-scraper. → { aviso } | { descarte } | null. */
function mapearMarketplace(item, ctx) {
  if (!esObjeto(item)) return null;
  const crudoId = item.id ?? item.listingId ?? item.listing_id;
  if (crudoId === undefined || crudoId === null || String(crudoId).trim() === '') return null;
  if (item.is_sold === true) return { descarte: 'vendido' };
  const id = String(crudoId).trim();
  const url = typeof item.listingUrl === 'string' && /^https?:\/\//i.test(item.listingUrl) ? item.listingUrl : `https://www.facebook.com/marketplace/item/${id}/`;

  const lp = item.listing_price ?? item.price;
  const texto = esObjeto(lp) ? lp.formatted_amount : lp;
  const parseado = Marketplace.parsearPrecio(typeof texto === 'string' ? texto : undefined);
  const precio = (esObjeto(lp) ? montoDe(lp.amount) : null) ?? parseado.monto;

  const rg = esObjeto(item.location) && esObjeto(item.location.reverse_geocode) ? item.location.reverse_geocode : null;
  const conocidos = ctx.distritosConocidos || [];
  const { distrito, zona } = Marketplace.ubicarCiudad(rg ? rg.city : null, conocidos);
  const { lat, lon } = coordenadas(item);
  const aviso = E.crearAviso(
    {
      fuente: ctx.fuente,
      id_fuente: id,
      url,
      titulo: item.marketplace_listing_title ?? item.title,
      precio,
      moneda: parseado.moneda,
      distrito,
      zona,
      lat,
      lon,
      fecha_publicacion: fechaDeMarca(item.timestamp),
      via: 'apify',
      actor: ctx.actor,
    },
    { ahora: ctx.ahora, distritosConocidos: conocidos }
  );
  return aviso ? { aviso } : null;
}

const MAPEADORES = { scrapers_lat: mapearScrapersLat, marketplace: mapearMarketplace };

/**
 * Mapea una lista de ítems. Un ítem que falla se cuenta y no detiene a los demás.
 * → { avisos, noMapeados, descartados: { no_venta, vendido } }. `ctx`: { fuente, base?, actor, distritosConocidos, ahora }.
 */
function mapearItems(items, tipo, ctx) {
  const salida = { avisos: [], noMapeados: 0, descartados: { no_venta: 0, vendido: 0 } };
  const mapear = MAPEADORES[tipo];
  if (!mapear) throw new Error(`Tipo de actor desconocido: ${tipo}`);
  if (!Array.isArray(items)) return salida;
  for (const item of items) {
    let r = null;
    try {
      r = mapear(item, ctx);
    } catch {
      r = null;
    }
    if (!r) salida.noMapeados++;
    else if (r.descarte) salida.descartados[r.descarte]++;
    else salida.avisos.push(r.aviso);
  }
  return salida;
}

module.exports = { montoDe, mapearScrapersLat, mapearMarketplace, mapearItems };
