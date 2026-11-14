/**
 * navent.js — Lector común de Adondevivir y Urbania (ambos son del mismo grupo y usan la misma plataforma de listados).
 * Lo usan fuentes/adondevivir.js y fuentes/urbania.js y lo prueba test/avisos-navent.spec.ts.
 *
 * Dónde están los datos: cada página de resultados trae el estado de la aplicación como JSON en
 * `window.__PRELOADED_STATE__ = {...}`; los avisos están en `listStore.listPostings` y la paginación en `listStore.paging`.
 * No se usan selectores CSS. Si el sitio cambia ese formato, parsearPagina devuelve `error` y no inventa nada.
 *
 * Qué se guarda de cada aviso: tipo, precio (soles y dólares), áreas, dormitorios, baños, estacionamientos, ubicación
 * (distrito = el nivel «ZONA» de la jerarquía del portal; zona = el nivel inferior), coordenadas si las publican y la fecha de
 * última modificación. NO se guarda nada del anunciante (nombre, logo, teléfono, WhatsApp, enlace a su perfil), ni el
 * texto de la descripción, ni la URL del mapa estático (lleva una clave de API).
 */
const E = require('../esquema.js');

const MARCA = 'window.__PRELOADED_STATE__ = ';
const TIPOS_FUENTE = ['departamento', 'casa', 'terreno', 'local'];
const TIPOS_TODOS = ['departamento', 'casa', 'terreno'];

/** JSON de window.__PRELOADED_STATE__ (recorre las llaves respetando las comillas) o null si no está o está cortado. */
function extraerEstado(html) {
  const ini = String(html || '').indexOf(MARCA);
  if (ini < 0) return null;
  const desde = ini + MARCA.length;
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
    else if (c === '{') nivel++;
    else if (c === '}') {
      nivel--;
      if (nivel === 0) {
        try {
          return JSON.parse(html.slice(desde, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sup2: '²', sup3: '³', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', uuml: 'ü', deg: '°' };

/** Decodifica las entidades HTML que aparecen en los títulos («m&sup2;», «&amp;», «&#39;»). */
function decodificarEntidades(t) {
  if (typeof t !== 'string') return t;
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (todo, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : todo;
    }
    return Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? ENTIDADES[e] : todo;
  });
}

/** { distrito, zona } desde la jerarquía de ubicación del portal (SUBZONA < ZONA < CIUDAD < PROVINCIA < PAIS). */
function ubicacion(location) {
  const cadena = [];
  for (let n = location; n && cadena.length < 10; n = n.parent) cadena.push(n);
  const i = cadena.findIndex((n) => n.label === 'ZONA');
  if (i < 0) return { distrito: null, zona: null };
  return { distrito: cadena[i].name || null, zona: i > 0 ? cadena[i - 1].name || null : null };
}

const caracteristica = (mf, id) => (mf && typeof mf === 'object' && mf[id] ? mf[id].value : null);
const esVenta = (o) => String(o?.operationType?.operationTypeId) === '1' || /^venta$/i.test(o?.operationType?.name || '');

/** Aviso normalizado desde un elemento de listPostings; null si no es de venta o no se puede identificar. */
function convertirAviso(p, { fuente, base, distritosConocidos, ahora }) {
  if (!p || typeof p !== 'object' || !p.postingId || !p.url) return null;
  const operaciones = Array.isArray(p.priceOperationTypes) ? p.priceOperationTypes : [];
  const venta = operaciones.find(esVenta);
  if (operaciones.length > 0 && !venta) return null;
  const precios = (venta && Array.isArray(venta.prices) ? venta.prices : []).filter((x) => x && Number(x.amount) > 0);
  const mf = p.mainFeatures;
  const loc = p.postingLocation || {};
  const { distrito, zona } = ubicacion(loc.location);
  const geo = loc.postingGeolocation && loc.postingGeolocation.geolocation;
  return E.crearAviso(
    {
      fuente,
      id_fuente: p.postingId,
      url: /^https?:\/\//i.test(p.url) ? p.url : base + p.url,
      titulo: decodificarEntidades(p.title || p.generatedTitle),
      tipo_portal: p.realEstateType && p.realEstateType.name,
      es_proyecto: p.postingType === 'DEVELOPMENT',
      precio: precios[0] && precios[0].amount,
      moneda: precios[0] && precios[0].currency,
      precio_alterno: precios[1] && precios[1].amount,
      moneda_alterna: precios[1] && precios[1].currency,
      area_total_m2: caracteristica(mf, 'CFT100'),
      area_construida_m2: caracteristica(mf, 'CFT101'),
      dormitorios: caracteristica(mf, 'CFT2'),
      banos: caracteristica(mf, 'CFT3'),
      estacionamientos: caracteristica(mf, 'CFT7'),
      distrito,
      zona,
      direccion: loc.address && loc.address.name,
      lat: geo && geo.latitude,
      lon: geo && geo.longitude,
      fecha_actualizacion: p.modified_date,
    },
    { ahora, distritosConocidos }
  );
}

/**
 * Lee una página de resultados. → { avisos, paginacion: { total, paginaActual, totalPaginas } | null, error? }.
 * `opciones`: { fuente, base, distritosConocidos, ahora }.
 */
function parsearPagina(html, opciones) {
  const estado = extraerEstado(html);
  const lista = estado && estado.listStore && estado.listStore.listPostings;
  if (!Array.isArray(lista)) return { avisos: [], paginacion: null, error: 'formato inesperado: la página no trae window.__PRELOADED_STATE__.listStore.listPostings' };
  const pg = estado.listStore.paging;
  return {
    avisos: lista.map((p) => convertirAviso(p, opciones)).filter(Boolean),
    paginacion: pg ? { total: E.numero(pg.total), paginaActual: E.numero(pg.currentPage), totalPaginas: E.numero(pg.totalPages) } : null,
  };
}

/**
 * Recorre las páginas de cada tipo pedido. `config`: { nombre, base, construirUrl({ tipo, distrito, pagina }) }.
 * `ctx`: { cliente, paginas, distritosConocidos, ahora }. → { estado, mensaje, avisos, paginas }.
 * estado: 'ok' | 'parcial' (algo se recogió y algo falló) | 'bloqueado' | 'robots' | 'error' | 'omitido' (tipo que la fuente no tiene).
 */
async function buscarNavent(config, filtros, ctx) {
  const tipos = filtros.tipo === 'todos' || !filtros.tipo ? TIPOS_TODOS : [filtros.tipo];
  const avisos = [];
  const notas = [];
  let paginas = 0;
  let huboError = false;
  let robotsEnPrimera = false;
  let tiposProbados = 0;

  for (const tipo of tipos) {
    if (!config.construirUrl({ tipo, distrito: filtros.distrito, pagina: 1 })) {
      notas.push(`${config.nombre} no tiene el tipo «${tipo}»`);
      continue;
    }
    tiposProbados++;
    for (let pagina = 1; pagina <= ctx.paginas; pagina++) {
      const res = await ctx.cliente.obtener(config.construirUrl({ tipo, distrito: filtros.distrito, pagina }));
      if (res.estado === 'bloqueado') return { estado: 'bloqueado', mensaje: `bloqueado por anti-bot o límite de solicitudes: ${res.motivo}`, avisos, paginas };
      if (res.estado === 'robots') {
        if (pagina === 1) robotsEnPrimera = true;
        notas.push(`${tipo}: ${res.motivo}${pagina > 1 ? ` (se detiene en la página ${pagina - 1})` : ''}`);
        break;
      }
      if (res.estado !== 'ok') {
        huboError = true;
        notas.push(`${tipo} página ${pagina}: ${res.motivo}`);
        break;
      }
      const r = parsearPagina(res.texto, { fuente: config.nombre, base: config.base, distritosConocidos: ctx.distritosConocidos, ahora: ctx.ahora });
      if (r.error) {
        huboError = true;
        notas.push(`${tipo} página ${pagina}: ${r.error}`);
        break;
      }
      paginas++;
      avisos.push(...r.avisos);
      if (r.avisos.length === 0 || (r.paginacion && r.paginacion.totalPaginas !== null && pagina >= r.paginacion.totalPaginas)) break;
    }
  }

  let estado = 'ok';
  if (tiposProbados === 0) estado = 'omitido';
  else if (huboError) estado = avisos.length > 0 ? 'parcial' : 'error';
  else if (robotsEnPrimera && avisos.length === 0) estado = 'robots';
  return { estado, mensaje: notas.join('; ') || null, avisos, paginas };
}

module.exports = { TIPOS_FUENTE, TIPOS_TODOS, extraerEstado, decodificarEntidades, ubicacion, parsearPagina, buscarNavent };
