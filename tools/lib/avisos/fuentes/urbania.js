/**
 * urbania.js — Fuente: https://urbania.pe (avisos de venta en Arequipa). Misma plataforma que Adondevivir (ver navent.js).
 *
 * Direcciones (verificadas el 2026-11-12 con solicitudes de lectura):
 *   lista por tipo de toda Arequipa   /buscar/venta-de-departamentos-en-arequipa--arequipa   (también casas, terrenos, locales-comerciales)
 *   página N                          …?page=N
 *   distrito                          /buscar/venta-de-departamentos-en-cayma--arequipa--arequipa
 * El robots.txt del sitio solo permite ?page=2 a 5; la sexta se omite y se informa.
 * Urbania usa Cloudflare: si respondiera con un desafío anti-bot o un 403, el cliente lo detecta y esta fuente devuelve
 * «bloqueado» sin insistir (el 2026-11-12 respondió 200 desde la máquina de desarrollo con un User-Agent honesto).
 */
const Navent = require('./navent.js');

const NOMBRE = 'urbania';
const BASE = 'https://urbania.pe';
const TIPOS = { departamento: 'departamentos', casa: 'casas', terreno: 'terrenos', local: 'locales-comerciales' };
const DISTRITOS = {
  CAYMA: 'cayma',
  YANAHUARA: 'yanahuara',
  'CERRO COLORADO': 'cerro-colorado',
  SACHACA: 'sachaca',
  'ALTO SELVA ALEGRE': 'alto-selva-alegre',
  AREQUIPA: 'arequipa',
};

/** URL de la lista de ese tipo (y distrito, si tiene página propia); null si la fuente no tiene el tipo. */
function construirUrl({ tipo, distrito = null, pagina = 1 }) {
  const t = TIPOS[tipo];
  if (!t) return null;
  const lugar = distrito && DISTRITOS[distrito] ? `${DISTRITOS[distrito]}--arequipa--arequipa` : 'arequipa--arequipa';
  return `${BASE}/buscar/venta-de-${t}-en-${lugar}${pagina > 1 ? `?page=${pagina}` : ''}`;
}

const buscar = (filtros, ctx) => Navent.buscarNavent({ nombre: NOMBRE, base: BASE, construirUrl }, filtros, ctx);
const parsear = (html, ctx) => Navent.parsearPagina(html, { fuente: NOMBRE, base: BASE, ...ctx });

module.exports = {
  nombre: NOMBRE,
  descripcion: 'Urbania (urbania.pe): avisos de venta, hasta 5 páginas por tipo (límite de su robots.txt)',
  tipos: Object.keys(TIPOS),
  requiereNavegador: false,
  construirUrl,
  buscar,
  parsear,
};
