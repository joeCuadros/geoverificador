/**
 * adondevivir.js — Fuente: https://www.adondevivir.com (avisos de venta en Arequipa).
 *
 * Direcciones (verificadas el 2026-11-12 con solicitudes de lectura):
 *   lista por tipo de toda Arequipa   /departamentos-en-venta-en-arequipa.html   (también casas-, terrenos-, locales-comerciales-)
 *   página N                          /departamentos-en-venta-en-arequipa-pagina-N.html
 *   distrito                          /departamentos-en-venta-en-cayma.html
 * El robots.txt del sitio solo permite las páginas 1 a 5 de cada lista; la sexta se omite y se informa.
 * Los datos están en window.__PRELOADED_STATE__ (ver navent.js).
 */
const Navent = require('./navent.js');

const NOMBRE = 'adondevivir';
const BASE = 'https://www.adondevivir.com';
const TIPOS = { departamento: 'departamentos', casa: 'casas', terreno: 'terrenos', local: 'locales-comerciales' };
// Distritos con página propia (los enlaces del propio sitio). El resto se obtiene de la lista de Arequipa y se filtra después.
const DISTRITOS = {
  CAYMA: 'cayma',
  YANAHUARA: 'yanahuara',
  'CERRO COLORADO': 'cerro-colorado',
  SACHACA: 'sachaca',
  'ALTO SELVA ALEGRE': 'alto-selva-alegre',
  AREQUIPA: 'arequipa-ciudad-de-arequipa',
};

/** URL de la lista de ese tipo (y distrito, si tiene página propia); null si la fuente no tiene el tipo. */
function construirUrl({ tipo, distrito = null, pagina = 1 }) {
  const t = TIPOS[tipo];
  if (!t) return null;
  const lugar = (distrito && DISTRITOS[distrito]) || 'arequipa';
  return `${BASE}/${t}-en-venta-en-${lugar}${pagina > 1 ? `-pagina-${pagina}` : ''}.html`;
}

const buscar = (filtros, ctx) => Navent.buscarNavent({ nombre: NOMBRE, base: BASE, construirUrl }, filtros, ctx);
const parsear = (html, ctx) => Navent.parsearPagina(html, { fuente: NOMBRE, base: BASE, ...ctx });

module.exports = {
  nombre: NOMBRE,
  descripcion: 'Adondevivir (adondevivir.com): avisos de venta, hasta 5 páginas por tipo (límite de su robots.txt)',
  tipos: Object.keys(TIPOS),
  requiereNavegador: false,
  construirUrl,
  buscar,
  parsear,
};
