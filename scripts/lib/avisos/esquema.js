/**
 * esquema.js — Esquema normalizado de los avisos de VENTA de inmuebles (puro, sin red). Lo usan todas las fuentes de
 * scripts/lib/avisos/ y lo prueba test/avisos-esquema.spec.ts.
 *
 * Reglas:
 *  - Un valor que la fuente no publica es null. Nunca se adivina ni se completa.
 *  - Solo hay campos del inmueble. No se guarda nombre del vendedor, teléfono, correo ni enlace a perfiles.
 *  - El distrito se normaliza con el mismo helper que usa descargar-precios.mjs (public/js/precios.js): si coincide con un
 *    distrito de distritos_aqp.geojson se usa su nombre (MAYÚSCULAS, sin tildes salvo la Ñ); si no, el nombre normalizado.
 *  - precio_m2 = precio / área. Área construida en departamentos, casas, locales y oficinas (total si no hay construida);
 *    área total en terrenos. `precio_m2_base` dice cuál se usó. En proyectos (rangos «desde») no se calcula.
 */
const Precios = require('../../../public/js/precios.js');

const OPERACION = 'venta';
const TIPOS = ['departamento', 'casa', 'terreno', 'local', 'oficina'];

/** Columnas del esquema, en el orden en que salen en JSON y CSV. */
const COLUMNAS = [
  'fuente',
  'id_fuente',
  'url',
  'titulo',
  'tipo_inmueble',
  'tipo_portal',
  'operacion',
  'es_proyecto',
  'precio',
  'precio_max',
  'moneda',
  'precio_alterno',
  'moneda_alterna',
  'area_total_m2',
  'area_total_max_m2',
  'area_construida_m2',
  'precio_m2',
  'precio_m2_base',
  'dormitorios',
  'dormitorios_max',
  'banos',
  'banos_max',
  'estacionamientos',
  'distrito',
  'zona',
  'direccion',
  'lat',
  'lon',
  'fecha_publicacion',
  'fecha_actualizacion',
  'fecha_captura',
  'via',
  'actor',
];

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Texto limpio (espacios colapsados) o null si está vacío o no es texto. */
function texto(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/** Número finito desde un número o un texto numérico («534000.00»); null en cualquier otro caso. */
function numero(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

const positivo = (v) => {
  const n = numero(v);
  return n !== null && n > 0 ? n : null;
};

const entero = (v) => {
  const n = numero(v);
  return n !== null && n >= 0 ? Math.round(n) : null;
};

/** 'PEN' | 'USD' | null según cómo lo escriba el portal. */
function normalizarMoneda(v) {
  const t = texto(typeof v === 'string' ? v : '');
  if (!t) return null;
  const k = sinTildes(t).replace(/[\s.]/g, '');
  if (['s/', 's', 'pen', 'sol', 'soles', 'nuevosol', 'nuevossoles'].includes(k)) return 'PEN';
  if (['$', 'us$', 'usd', 'dolar', 'dolares', 'dolaresamericanos'].includes(k)) return 'USD';
  return null;
}

/** Tipo del esquema (departamento, casa, terreno, local, oficina) o null si el nombre del portal no se conoce. */
function normalizarTipo(v) {
  const t = texto(typeof v === 'string' ? v : '');
  if (!t) return null;
  const k = sinTildes(t);
  if (/^departamentos?$|^desarrollos? verticales?$/.test(k)) return 'departamento';
  if (/^casas?$/.test(k)) return 'casa';
  if (/^terrenos?(\s*[/-]?\s*lotes?)?$|^lotes?$/.test(k)) return 'terreno';
  if (/^locales? comerciales?$|^locales?$/.test(k)) return 'local';
  if (/^oficinas?$/.test(k)) return 'oficina';
  return null;
}

/**
 * Distrito normalizado. `conocidos` son los nombres de distritos_aqp.geojson. Coincidencia por la misma clave que
 * Precios.claveDistrito (sin tildes, mayúsculas, alias). Si no coincide, se devuelve el nombre normalizado tal cual.
 */
function resolverDistrito(nombre, conocidos = []) {
  if (typeof nombre !== 'string') return null;
  const k = Precios.claveDistrito(nombre);
  if (!k) return null;
  const hallado = conocidos.find((d) => Precios.claveDistrito(d) === k);
  return hallado || k;
}

/** Fecha de solo día (AAAA-MM-DD) desde un texto que empieza con una fecha ISO; null si no. */
function fechaDia(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  const [, a, mes, d] = m;
  const f = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (f.getUTCFullYear() !== Number(a) || f.getUTCMonth() !== Number(mes) - 1 || f.getUTCDate() !== Number(d)) return null;
  return `${a}-${mes}-${d}`;
}

/** { valor, base }: precio por m² redondeado a dos decimales y el área que se usó; { valor: null, base: null } si no se puede. */
function calcularPrecioM2({ precio, tipo, areaTotal, areaConstruida, esProyecto = false }) {
  const vacio = { valor: null, base: null };
  if (esProyecto) return vacio;
  const p = positivo(precio);
  if (p === null) return vacio;
  const total = positivo(areaTotal);
  const construida = positivo(areaConstruida);
  let area;
  let base;
  if (tipo === 'terreno') {
    area = total;
    base = 'total';
  } else if (construida !== null) {
    area = construida;
    base = 'construida';
  } else {
    area = total;
    base = 'total';
  }
  if (area === null) return vacio;
  return { valor: Math.round((p / area) * 100) / 100, base };
}

const coordenada = (v, limite) => {
  const n = numero(v);
  return n !== null && Math.abs(n) <= limite ? n : null;
};

/**
 * Aviso normalizado con todas las columnas de COLUMNAS. `p` trae los campos ya extraídos por la fuente (cualquier campo
 * que no sea del esquema se ignora). Devuelve null si falta el identificador o el enlace.
 * `contexto`: { ahora: Date, distritosConocidos: string[] }.
 */
function crearAviso(p, contexto = {}) {
  const ahora = contexto.ahora instanceof Date ? contexto.ahora : new Date();
  const id = p.id_fuente === null || p.id_fuente === undefined ? '' : String(p.id_fuente).trim();
  const url = texto(p.url);
  if (!id || !url || !texto(p.fuente)) return null;

  const tipo = p.tipo_inmueble !== undefined ? normalizarTipo(p.tipo_inmueble) : normalizarTipo(p.tipo_portal);
  const esProyecto = p.es_proyecto === true;
  const precio = positivo(p.precio);
  const moneda = precio === null ? null : normalizarMoneda(p.moneda);
  const precioAlterno = positivo(p.precio_alterno);
  const areaTotal = positivo(p.area_total_m2);
  const areaConstruida = positivo(p.area_construida_m2);
  const m2 = moneda === null ? { valor: null, base: null } : calcularPrecioM2({ precio, tipo, areaTotal, areaConstruida, esProyecto });

  return {
    fuente: texto(p.fuente),
    id_fuente: id,
    url,
    titulo: texto(p.titulo),
    tipo_inmueble: tipo,
    tipo_portal: texto(p.tipo_portal),
    operacion: OPERACION,
    es_proyecto: esProyecto,
    precio,
    precio_max: positivo(p.precio_max),
    moneda,
    precio_alterno: precioAlterno,
    moneda_alterna: precioAlterno === null ? null : normalizarMoneda(p.moneda_alterna),
    area_total_m2: areaTotal,
    area_total_max_m2: positivo(p.area_total_max_m2),
    area_construida_m2: areaConstruida,
    precio_m2: m2.valor,
    precio_m2_base: m2.base,
    dormitorios: entero(p.dormitorios),
    dormitorios_max: entero(p.dormitorios_max),
    banos: entero(p.banos),
    banos_max: entero(p.banos_max),
    estacionamientos: entero(p.estacionamientos),
    distrito: resolverDistrito(p.distrito, contexto.distritosConocidos || []),
    zona: texto(p.zona),
    direccion: texto(p.direccion),
    lat: coordenada(p.lat, 90),
    lon: coordenada(p.lon, 180),
    fecha_publicacion: fechaDia(p.fecha_publicacion),
    fecha_actualizacion: fechaDia(p.fecha_actualizacion),
    fecha_captura: ahora.toISOString(),
    via: p.via === 'apify' ? 'apify' : 'directo',
    actor: p.via === 'apify' ? texto(p.actor) : null,
  };
}

/** Clave de deduplicación: (fuente, id_fuente). No se intenta unir avisos de fuentes distintas. */
const claveAviso = (a) => `${a.fuente}\u0000${a.id_fuente}`;

/** Quita repetidos por (fuente, id_fuente) conservando el primero. → { avisos, duplicados }. */
function deduplicar(avisos) {
  const vistos = new Set();
  const salida = [];
  for (const a of avisos) {
    const k = claveAviso(a);
    if (vistos.has(k)) continue;
    vistos.add(k);
    salida.push(a);
  }
  return { avisos: salida, duplicados: avisos.length - salida.length };
}

module.exports = {
  OPERACION,
  TIPOS,
  COLUMNAS,
  texto,
  numero,
  normalizarMoneda,
  normalizarTipo,
  resolverDistrito,
  fechaDia,
  calcularPrecioM2,
  crearAviso,
  claveAviso,
  deduplicar,
};
