/**
 * censo.js — Lógica pura (sin red ni archivos) detrás de scripts/descargar-censo-servicios.mjs: los Censos Nacionales 2017 del INEI por MANZANA,
 * consultados en el sistema público REDATAM (https://censos2017.inei.gob.pe/), y su unión con el polígono de la manzana del INEI.
 * La usan ese script y test/censo.spec.ts.
 *
 *   seleccionDeDistrito(ubigeo)            → la selección de REDATAM de un distrito («sels\Distrito_040103.sel»)
 *   parametrosAreaList(opciones)           → URLSearchParams de una «lista por áreas» (una fila por manzana) de REDATAM
 *   leerTabla(html)                        → { titulo, area, cabecera, filas: [{ codigo, etiqueta, valores }], total }
 *   claveManzana(codigo)                   → idmanzana del polígono del INEI (ubigeo + zona + manzana), o null si es «fuera de manzana» (8888)
 *   construirRegistros(servicios, conteos) → { registros: Map id → { id, viv, hog, pers, ocup, luz, ad, af, sd, sf }, sinManzana, incoherentes }
 *
 * Qué es cada campo (viviendas particulares OCUPADAS CON PERSONAS PRESENTES, que es el universo del que el INEI saca estos porcentajes):
 *   viv  viviendas contadas en la manzana (todas, ocupadas o no)      hog  hogares      pers  personas censadas
 *   ocup viviendas ocupadas con personas presentes (suma «sí» y «no» de alumbrado)
 *   luz  con alumbrado eléctrico por red pública (C2P11)
 *   ad / af  agua por red pública dentro de la vivienda / fuera de la vivienda pero dentro de la edificación (C2P6)
 *   sd / sf  servicio higiénico (desagüe) por red pública dentro / fuera de la vivienda pero dentro de la edificación (C2P10)
 */

const BASE = 'CPV2017';
/** Universo de las preguntas de servicios: viviendas particulares ocupadas con personas presentes (C2P2 = 1). */
const FILTRO_OCUPADAS = 'Vivienda.C2P2=1';

function seleccionDeDistrito(ubigeo) {
  if (!/^\d{6}$/.test(String(ubigeo))) throw new Error(`El ubigeo debe tener 6 dígitos: «${ubigeo}».`);
  return `sels\\Distrito_${ubigeo}.sel`;
}

/** Los campos del formulario «Lista por áreas» de REDATAM (POST a RpWebStats.exe/AreaList): una fila por manzana del distrito. */
function parametrosAreaList({ item, variables, seleccion, filtro = '' }) {
  const p = new URLSearchParams();
  const campos = [['MAIN', 'WebServerMain.inl'], ['BASE', BASE], ['LANG', 'esp'], ['CODIGO', 'XXUSUARIOXX'], ['ITEM', item], ['MODE', 'RUN'], ['inputTitle', '']];
  campos.forEach(([k, v]) => p.append(k, v));
  variables.forEach((v) => p.append('VARIABLE', v));
  [['OUTPUT', 'Manzana'], ['SELECTION', seleccion], ['INLINESELECTION', ''], ['FORMAT', 'HTML'], ['TOTCOL', 'on'], ['UNIVERSE', ''], ['FILTER', filtro], ['TEXT_FILTER', '']].forEach(([k, v]) => p.append(k, v));
  return p;
}

// ------------------------------------------------------------------ Lectura de la tabla

const ENTIDADES = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ' };
const decodificar = (s) => s.replace(/<[^>]+>/g, '').replace(/&(#\d+|[A-Za-z]+);/g, (m, e) => (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ENTIDADES[e] ?? m)).replace(/\s+/g, ' ').trim();

/** «23 866» → 23866 (REDATAM separa los miles con un espacio). NaN si no es un número. */
function numero(texto) {
  const t = String(texto == null ? '' : texto).replace(/\s+/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

function leerTabla(html) {
  const filas = [...String(html).matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decodificar(c[1])));
  const iCab = filas.findIndex((f) => f[1] === 'Código' && f[2] === 'Manzana');
  if (iCab < 0) throw new Error('La respuesta de REDATAM no trae la tabla por manzana (no se encontró la cabecera «Código / Manzana»).');
  const cabecera = filas[iCab].slice(3).filter((c) => c !== '');
  const valoresDe = (f) => f.slice(3, 3 + cabecera.length).map(numero);
  const datos = filas.filter((f) => /^\d{20}$/.test(f[1] || '')).map((f) => ({ codigo: f[1], etiqueta: f[2], valores: valoresDe(f) }));
  const total = filas.find((f) => f[1] === 'TOTAL');
  const iArea = filas.findIndex((f) => f[0] === 'Área Geográfica');
  const iTitulo = filas.findIndex((f) => f[0] === 'Título');
  return {
    titulo: iTitulo >= 0 && filas[iTitulo + 1] ? filas[iTitulo + 1][0] : null,
    area: iArea >= 0 && filas[iArea + 1] ? filas[iArea + 1][0] : null,
    cabecera,
    filas: datos,
    total: total ? valoresDe(total) : null,
  };
}

// ------------------------------------------------------------------ La llave de la manzana

/**
 * El código de REDATAM (20 caracteres: ubigeo 6 + centro poblado 4 + zona 5 + manzana 3 + sufijo 2) → el idmanzana del polígono del INEI
 * (ubigeo 6 + zona 5 + manzana 3 + letra del sufijo, si la hay: 01 = A, 06 = F, 10 = J…). El sufijo 88 (manzana 888 / 8888) son las viviendas que
 * el censo contó fuera de una manzana: no tienen polígono y devuelve null.
 */
function claveManzana(codigo) {
  const c = String(codigo);
  if (!/^\d{20}$/.test(c)) return null;
  const manz = c.slice(15, 18);
  const suf = Number(c.slice(18, 20));
  if (manz === '888' || suf === 88) return null;
  const letra = suf > 0 && suf <= 26 ? String.fromCharCode(64 + suf) : '';
  if (suf > 26) return null;
  return `${c.slice(0, 6)}${c.slice(10, 15)}${manz}${letra}`;
}

// ------------------------------------------------------------------ Registros

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ENCABEZADOS = {
  luzSi: 'si tiene alumbrado electrico',
  luzNo: 'no tiene alumbrado electrico',
  aguaDentro: 'red publica dentro de la vivienda',
  aguaFuera: 'red publica fuera de la vivienda, pero dentro de la edificacion',
  desDentro: 'red publica de desague dentro de la vivienda',
  desFuera: 'red publica de desague fuera de la vivienda, pero dentro de la edificacion',
};

/** Posición de cada columna que usamos, buscándola por su rótulo: si falta, está repetida o cambió, falla en vez de adivinar. */
function columnas(cabecera) {
  const n = cabecera.map(norm);
  const out = {};
  for (const [k, rotulo] of Object.entries(ENCABEZADOS)) {
    const idx = n.map((x, i) => (x === rotulo ? i : -1)).filter((i) => i >= 0);
    if (idx.length !== 1) throw new Error(`La cabecera de REDATAM ya no trae exactamente una columna «${rotulo}» (alumbrado, agua o desagüe): hay que revisar scripts/lib/censo.js. Trae: ${cabecera.join(' | ')}`);
    out[k] = idx[0];
  }
  return out;
}

/**
 * Une la tabla de servicios (alumbrado, agua y servicio higiénico por manzana) con la de conteos (viviendas, hogares y personas).
 * `incoherentes` cuenta las manzanas donde las categorías de agua no suman las viviendas ocupadas que dice el alumbrado.
 */
function construirRegistros(servicios, conteos) {
  const c = columnas(servicios.cabecera);
  const iViv = conteos.cabecera.map(norm).indexOf('vivienda');
  const iHog = conteos.cabecera.map(norm).indexOf('hogar');
  const iPer = conteos.cabecera.map(norm).indexOf('poblacion');
  if (iViv < 0 || iHog < 0 || iPer < 0) throw new Error(`La tabla de conteos ya no trae vivienda, hogar y población: ${conteos.cabecera.join(' | ')}`);
  const cont = new Map(conteos.filas.map((f) => [f.codigo, f.valores]));
  const registros = new Map();
  const sinManzana = { filas: 0, viviendas: 0, personas: 0 };
  let incoherentes = 0;
  for (const f of servicios.filas) {
    const v = f.valores;
    const k = cont.get(f.codigo) || [];
    const id = claveManzana(f.codigo);
    if (!id) {
      sinManzana.filas++;
      sinManzana.viviendas += k[iViv] || 0;
      sinManzana.personas += k[iPer] || 0;
      continue;
    }
    const ocup = v[c.luzSi] + v[c.luzNo];
    const sumaAgua = v.slice(c.aguaDentro, c.desDentro).reduce((t, x) => t + x, 0);
    if (sumaAgua !== ocup) incoherentes++;
    registros.set(id, { id, viv: k[iViv] ?? 0, hog: k[iHog] ?? 0, pers: k[iPer] ?? 0, ocup, luz: v[c.luzSi], ad: v[c.aguaDentro], af: v[c.aguaFuera], sd: v[c.desDentro], sf: v[c.desFuera] });
  }
  return { registros, sinManzana, incoherentes };
}

module.exports = { BASE, FILTRO_OCUPADAS, seleccionDeDistrito, parametrosAreaList, numero, leerTabla, claveManzana, construirRegistros };
