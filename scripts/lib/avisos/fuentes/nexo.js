/**
 * nexo.js — Fuente: https://nexoinmobiliario.pe (portal de la CODIP; avisos de venta de proyectos inmobiliarios).
 *
 * Qué publica: PROYECTOS (edificios, condominios, lotizaciones) con rangos de precio, área, dormitorios y baños; no unidades
 * sueltas. Por eso cada aviso sale con `es_proyecto: true`, el precio mínimo en `precio` («desde») y el máximo en
 * `precio_max`, y sin precio por m² (el precio mínimo y el área mínima pueden no ser de la misma unidad).
 *
 * Dirección (verificada el 2026-11-12): /venta-de-inmuebles/arequipa → una sola página con los proyectos del departamento de
 * Arequipa (12 el 2026-11-12). Los datos están en la variable de página `const projects = [...]` (JSON); no se usan selectores.
 * robots.txt del sitio: «User-Agent: *  Disallow:» (permite todo).
 *
 * Campos del anunciante (contacto, correo, teléfono, WhatsApp, constructora) se descartan.
 * Detalles de los datos de Nexo:
 *  - `coin` es la moneda del precio mínimo («S/.» o «$»). `val_price1` y `val_price2` vienen siempre en soles (en proyectos en
 *    dólares son la conversión del portal): se usa val_price1 como equivalente (`precio_alterno`) y `precio_max` solo se llena
 *    cuando el precio está en soles, para no mezclar monedas.
 *  - `area_min` / `area_max` no dicen si son área total o techada; se guardan como área total publicada.
 *  - `parking_min/max` vienen en «0» aunque el proyecto no informe estacionamientos, así que 0 se trata como sin dato.
 *  - `date_creation` es la fecha de alta del proyecto en el portal (va a fecha_publicacion).
 */
const E = require('../esquema.js');

const NOMBRE = 'nexo';
const BASE = 'https://nexoinmobiliario.pe';
const URL_LISTA = `${BASE}/venta-de-inmuebles/arequipa`;
const TAMANO_PAGINA = 24; // proyectos por página observados en /venta-de-inmuebles

/** Arreglo JSON de `const projects = [...]` o null si no está o está cortado. */
function extraerProyectos(html) {
  const m = /const\s+projects\s*=\s*\[/.exec(String(html || ''));
  if (!m) return null;
  const desde = m.index + m[0].length - 1;
  let nivel = 0;
  let enTexto = false;
  let escape = false;
  for (let i = desde; i < html.length; i++) {
    const c = html[i];
    if (enTexto) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') enTexto = false;
    } else if (c === '"') enTexto = true;
    else if (c === '[') nivel++;
    else if (c === ']') {
      nivel--;
      if (nivel === 0) {
        try {
          const v = JSON.parse(html.slice(desde, i + 1));
          return Array.isArray(v) ? v : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const sinCero = (v) => {
  const n = E.numero(v);
  return n !== null && n > 0 ? n : null;
};

function convertirProyecto(p, { distritosConocidos, ahora }) {
  if (!p || typeof p !== 'object' || !/arequipa/i.test(String(p.dpto_project || ''))) return null;
  const moneda = E.normalizarMoneda(p.coin);
  return E.crearAviso(
    {
      fuente: NOMBRE,
      id_fuente: p.project_id,
      url: p.url,
      titulo: p.name,
      tipo_portal: p.category,
      es_proyecto: true,
      precio: p.min_price,
      moneda,
      precio_max: moneda === 'PEN' ? p.val_price2 : null,
      precio_alterno: moneda === 'USD' ? p.val_price1 : null,
      moneda_alterna: 'PEN',
      area_total_m2: p.area_min,
      area_total_max_m2: p.area_max,
      dormitorios: p.room_min,
      dormitorios_max: p.room_max,
      banos: p.bathroom_min,
      banos_max: p.bathroom_max,
      estacionamientos: sinCero(p.parking_min),
      distrito: p.distrito,
      direccion: p.direccion,
      lat: p.coord_lat,
      lon: p.long,
      fecha_publicacion: p.date_creation,
    },
    { ahora, distritosConocidos }
  );
}

/** Avisos normalizados de una página de la lista. Lista vacía si la página no trae `projects`. */
function parsear(html, ctx) {
  const proyectos = extraerProyectos(html) || [];
  return proyectos.map((p) => convertirProyecto(p, ctx)).filter(Boolean);
}

/** Pide la lista de Arequipa (una página) y la convierte. → { estado, mensaje, avisos, paginas }. */
async function buscar(filtros, ctx) {
  const res = await ctx.cliente.obtener(URL_LISTA);
  if (res.estado === 'bloqueado') return { estado: 'bloqueado', mensaje: `bloqueado por anti-bot o límite de solicitudes: ${res.motivo}`, avisos: [], paginas: 0 };
  if (res.estado === 'robots') return { estado: 'robots', mensaje: res.motivo, avisos: [], paginas: 0 };
  if (res.estado !== 'ok') return { estado: 'error', mensaje: res.motivo, avisos: [], paginas: 0 };
  const proyectos = extraerProyectos(res.texto);
  if (!proyectos) return { estado: 'error', mensaje: 'formato inesperado: la página no trae la variable «const projects = [...]»', avisos: [], paginas: 0 };
  const avisos = proyectos.map((p) => convertirProyecto(p, ctx)).filter(Boolean);
  const mensaje = proyectos.length >= TAMANO_PAGINA ? `la lista llegó a ${TAMANO_PAGINA} proyectos: puede haber más y el paginado de Nexo no está verificado` : null;
  return { estado: 'ok', mensaje, avisos, paginas: 1 };
}

module.exports = {
  nombre: NOMBRE,
  descripcion: 'Nexo Inmobiliario (nexoinmobiliario.pe): proyectos en venta del departamento de Arequipa, una página',
  tipos: ['departamento', 'casa', 'terreno', 'local', 'oficina'],
  requiereNavegador: false,
  URL_LISTA,
  extraerProyectos,
  buscar,
  parsear,
};
