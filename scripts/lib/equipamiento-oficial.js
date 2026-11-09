/**
 * equipamiento-oficial.js — Lógica pura (sin red) para armar el equipamiento de salud y de educación con los registros oficiales
 * como fuente primaria y OpenStreetMap como respaldo. La usan scripts/descargar-equipamiento-oficial.mjs y
 * test/equipamiento-oficial.spec.ts. La lectura de los CSV, la deduplicación por local, el filtro de estado y el emparejamiento
 * por nombre y distancia son los de la validación K2 (scripts/lib/validacion-oficial.js): aquí no se repiten, se reutilizan.
 *
 *   leerDbf(buffer) / leerDbfArchivo(ruta, opciones)          → { campos, filas } (DBF de ESCALE, CP850)
 *   listarEntradasZip(buffer) / extraerEntradaZip(zip, nombre, salida)
 *   ultimaEdicionRenipress(html) / ultimoPadronEscale(html)   → la edición más reciente publicada
 *   clasificarSalud(registro) / seleccionarSalud(csv, opciones) → establecimientos de salud que atienden a una persona
 *   seleccionarEscale({ columnas, filas }, opciones) / seleccionarEscaleDbf(ruta, opciones)  → locales de educación básica regular
 *   featureSalud(r) / featureEscale(l)                         → Feature GeoJSON con la fuente y el código oficial
 *   fusionarSalud(oficiales, osm, { radioM }) / fusionarEducacion(...) → oficiales + respaldo de OSM + conteos
 *   procedencia({ ... })                                       → bloque `metadata` con fuentes, fechas, licencias y la regla
 *
 * Regla de salud (documentada en docs/METODOLOGIA.md): cuenta un registro de RENIPRESS ACTIVO, de la provincia de Arequipa, con
 * coordenadas dentro de los distritos, cuyo tipo de establecimiento sea «con internamiento» o «sin internamiento» y cuya categoría
 * sea de I-1 a III-E (norma técnica de categorías del MINSA, NTS 021-MINSA/DGSP-V.03). No cuenta el «servicio médico de apoyo»
 * (laboratorios, diagnóstico por imágenes, hemodiálisis, ópticas, traslado de pacientes: categoría 0) ni el centro odontológico
 * (una sola especialidad; OpenStreetMap también excluye al dentista, ver Calculos.FILTROS). El consultorio médico (I-1, I-2) sí cuenta.
 */
const fs = require('fs');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const V = require('./validacion-oficial.js');
const Calculos = require('../../public/js/calculos.js');

// ------------------------------------------------------------------------------ DBF

// Segunda mitad (0x80 a 0xFF) de la página de códigos 850 (DOS multilingüe), la que declara el padrón de ESCALE.
const CP850_ALTO =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

/** Texto de un trozo de buffer en CP850 (los bytes por debajo de 0x80 son ASCII). */
function decodificarCp850(buf, ini = 0, fin = buf.length) {
  let alto = false;
  for (let i = ini; i < fin; i++) if (buf[i] >= 0x80) { alto = true; break; }
  if (!alto) return buf.toString('latin1', ini, fin);
  let s = '';
  for (let i = ini; i < fin; i++) s += buf[i] < 0x80 ? String.fromCharCode(buf[i]) : CP850_ALTO[buf[i] - 0x80];
  return s;
}

/** Cabecera de un DBF: cuántos registros, dónde empiezan, cuánto mide cada uno y qué campos tiene. */
function cabeceraDbf(buf) {
  if (buf.length < 33) throw new Error('El archivo no es un DBF válido: es demasiado corto.');
  const registros = buf.readUInt32LE(4);
  const inicio = buf.readUInt16LE(8);
  const largoRegistro = buf.readUInt16LE(10);
  const campos = [];
  let desplazamiento = 1; // el primer byte de cada registro marca si está borrado
  let p = 32;
  while (p + 32 <= buf.length && p < inicio && buf[p] !== 0x0d) {
    const nombre = buf.toString('latin1', p, p + 11).replace(/\0.*$/, '').toLowerCase();
    const largo = buf[p + 16];
    campos.push({ nombre, tipo: String.fromCharCode(buf[p + 11]), largo, desplazamiento });
    desplazamiento += largo;
    p += 32;
  }
  if (campos.length === 0 || desplazamiento !== largoRegistro || inicio < p) {
    throw new Error('El archivo no es un DBF válido: la cabecera no describe sus campos.');
  }
  return { registros, inicio, largoRegistro, campos };
}

/** Un registro del buffer como objeto (campo → texto sin espacios sobrantes), o null si está marcado como borrado. */
function registroDbf(buf, base, cab) {
  if (buf[base] === 0x2a) return null;
  const fila = {};
  for (const c of cab.campos) {
    const ini = base + c.desplazamiento;
    fila[c.nombre] = decodificarCp850(buf, ini, ini + c.largo).trim();
  }
  return fila;
}

/** DBF completo en memoria (para archivos pequeños y pruebas). */
function leerDbf(buf) {
  const cab = cabeceraDbf(buf);
  const filas = [];
  for (let i = 0; i < cab.registros; i++) {
    const base = cab.inicio + i * cab.largoRegistro;
    if (base + cab.largoRegistro > buf.length) break;
    const f = registroDbf(buf, base, cab);
    if (f) filas.push(f);
  }
  return { campos: cab.campos, filas };
}

/**
 * DBF grande leído por bloques (el padrón de ESCALE pesa unos 290 MB): solo se guardan las filas que pasan `filtro`.
 * Devuelve { campos, filas, total } con `total` = registros leídos.
 */
function leerDbfArchivo(ruta, { filtro = null, registrosPorBloque = 20000 } = {}) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const cabecera = Buffer.alloc(65536);
    const leidos = fs.readSync(fd, cabecera, 0, cabecera.length, 0);
    const cab = cabeceraDbf(cabecera.subarray(0, leidos));
    const filas = [];
    let total = 0;
    const bloque = Buffer.alloc(registrosPorBloque * cab.largoRegistro);
    for (let i = 0; i < cab.registros; i += registrosPorBloque) {
      const n = Math.min(registrosPorBloque, cab.registros - i);
      const bytes = fs.readSync(fd, bloque, 0, n * cab.largoRegistro, cab.inicio + i * cab.largoRegistro);
      for (let k = 0; k < Math.floor(bytes / cab.largoRegistro); k++) {
        total++;
        const f = registroDbf(bloque, k * cab.largoRegistro, cab);
        if (f && (!filtro || filtro(f))) filas.push(f);
      }
    }
    return { campos: cab.campos, filas, total };
  } finally {
    fs.closeSync(fd);
  }
}

// ------------------------------------------------------------------------------ ZIP

/** Las entradas de un ZIP (directorio central). No admite ZIP64: el padrón de ESCALE pesa unos 15 MB. */
function listarEntradasZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un ZIP válido: no se encontró el fin del directorio central.');
  const cuenta = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const out = [];
  for (let k = 0; k < cuenta; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('El ZIP está dañado: el directorio central no es válido.');
    const largoNombre = buf.readUInt16LE(p + 28);
    const entrada = {
      nombre: buf.toString('utf8', p + 46, p + 46 + largoNombre),
      metodo: buf.readUInt16LE(p + 10),
      tamComprimido: buf.readUInt32LE(p + 20),
      tamano: buf.readUInt32LE(p + 24),
      desplazamiento: buf.readUInt32LE(p + 42),
    };
    if (entrada.tamano === 0xffffffff || entrada.desplazamiento === 0xffffffff) throw new Error('El ZIP usa ZIP64, que este lector no admite.');
    out.push(entrada);
    p += 46 + largoNombre + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

/** Extrae una entrada del ZIP a un archivo (descomprime por flujo, sin cargarla entera en memoria). */
async function extraerEntradaZip(rutaZip, nombre, rutaSalida) {
  const buf = await fs.promises.readFile(rutaZip);
  const entradas = listarEntradasZip(buf);
  const e = entradas.find((x) => x.nombre === nombre);
  if (!e) throw new Error(`No encontré «${nombre}» en el ZIP. Contiene: ${entradas.map((x) => x.nombre).join(', ') || 'nada'}.`);
  if (buf.readUInt32LE(e.desplazamiento) !== 0x04034b50) throw new Error('El ZIP está dañado: la cabecera local no es válida.');
  const ini = e.desplazamiento + 30 + buf.readUInt16LE(e.desplazamiento + 26) + buf.readUInt16LE(e.desplazamiento + 28);
  const datos = buf.subarray(ini, ini + e.tamComprimido);
  if (e.metodo !== 0 && e.metodo !== 8) throw new Error(`El ZIP usa un método de compresión (${e.metodo}) que este lector no admite.`);
  await pipeline(Readable.from([datos]), ...(e.metodo === 8 ? [zlib.createInflateRaw()] : []), fs.createWriteStream(rutaSalida));
}

// ------------------------------------------------------------ Ediciones publicadas

const URL_RENIPRESS_ARCHIVOS = 'https://www.datosabiertos.gob.pe/sites/default/files';
const URL_ESCALE_DOCUMENTOS = 'https://escale.minedu.gob.pe/documents/10156/958881';

/** El CSV de RENIPRESS con la fecha más reciente en su nombre (RENIPRESS_DD-MM-AAAA.csv) de la página del conjunto de datos. */
function ultimaEdicionRenipress(html) {
  const todas = [...String(html).matchAll(/RENIPRESS_(\d{2})-(\d{2})-(\d{4})\.csv/g)].map((m) => ({ nombre: m[0], fecha: `${m[3]}-${m[2]}-${m[1]}` }));
  if (todas.length === 0) throw new Error('La página de RENIPRESS no lista ningún archivo RENIPRESS_DD-MM-AAAA.csv.');
  todas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  const { nombre, fecha } = todas[0];
  return { url: `${URL_RENIPRESS_ARCHIVOS}/${nombre}`, fecha, nombre };
}

/** El ZIP del padrón de ESCALE con la fecha más reciente (Padron_web_AAAAMMDD.zip) de la biblioteca de documentos. */
function ultimoPadronEscale(html) {
  const todas = [...String(html).matchAll(/Padron_web_(\d{4})(\d{2})(\d{2})\.zip/g)].map((m) => ({ nombre: m[0], fecha: `${m[1]}-${m[2]}-${m[3]}` }));
  if (todas.length === 0) throw new Error('La biblioteca de ESCALE no lista ningún archivo Padron_web_AAAAMMDD.zip.');
  todas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  const { nombre, fecha } = todas[0];
  return { nombre, fecha, url: `${URL_ESCALE_DOCUMENTOS}/${nombre}` };
}

// ------------------------------------------------------------------------------ Salud

// Categorías de establecimientos de salud con atención (NTS 021-MINSA/DGSP-V.03): primer nivel I-1 a I-4, segundo nivel II-1, II-2 y II-E,
// tercer nivel III-1, III-2 y III-E. El «servicio médico de apoyo» no tiene categoría (RENIPRESS trae 0).
const CATEGORIAS_SALUD = /^(I-[1-4]|II-[12E]|III-[12E])$/;

/**
 * ¿Un registro de RENIPRESS es un establecimiento de salud para quien vive cerca? { incluir, motivo } con motivo
 * 'apoyo' | 'sinCategoria' | 'odontologico' cuando no.
 */
function clasificarSalud(r) {
  const tipo = V.sinTildes(r.tipoEstablecimiento || '').toUpperCase();
  if (tipo && !/(CON|SIN) INTERNAMIENTO/.test(tipo)) return { incluir: false, motivo: 'apoyo' };
  if (!CATEGORIAS_SALUD.test(String(r.categoria || '').trim().toUpperCase())) return { incluir: false, motivo: 'sinCategoria' };
  if (/ODONTOLOG/.test(V.sinTildes(r.tipo || '').toUpperCase())) return { incluir: false, motivo: 'odontologico' };
  return { incluir: true, motivo: null };
}

/**
 * Establecimientos de salud del CSV de RENIPRESS: activos, de la provincia de Arequipa, con coordenadas (NORTE y ESTE en grados
 * decimales) dentro de `dentro(lat, lon)` y de una categoría de atención (clasificarSalud). Devuelve { registros, descartados }.
 */
function seleccionarSalud(texto, { dentro = null, caja } = {}) {
  const r = V.leerRenipress(texto, { incluirConsultorios: true, dentro, ...(caja ? { caja } : {}) });
  const descartados = { ...r.descartados, apoyo: 0, sinCategoria: 0, odontologicos: 0 };
  const registros = [];
  for (const x of r.registros) {
    const c = clasificarSalud(x);
    if (c.incluir) registros.push(x);
    else if (c.motivo === 'apoyo') descartados.apoyo++;
    else if (c.motivo === 'sinCategoria') descartados.sinCategoria++;
    else descartados.odontologicos++;
  }
  return { registros, descartados, columnas: r.columnas };
}

// -------------------------------------------------------------------------- Educación

/** Locales de educación básica regular desde filas ya leídas ({ columnas, filas }); ver V.leerEscaleFilas. */
function seleccionarEscale(filas, opciones = {}) {
  return V.leerEscaleFilas(filas, opciones);
}

/**
 * Lo mismo directo del Padron_web.dbf: se leen por bloques los 180 mil registros del país y solo se conservan las filas de la
 * provincia de Arequipa. `totalPadron` es el número de registros del archivo.
 */
function seleccionarEscaleDbf(ruta, opciones = {}) {
  const enArequipa = (f) => V.sinTildes(f.d_dpto).toUpperCase() === 'AREQUIPA' && V.sinTildes(f.d_prov).toUpperCase() === 'AREQUIPA';
  const dbf = leerDbfArchivo(ruta, { filtro: enArequipa });
  const r = seleccionarEscale({ columnas: dbf.campos.map((c) => c.nombre), filas: dbf.filas }, opciones);
  return { ...r, totalPadron: dbf.total, filasProvincia: dbf.filas.length };
}

// ------------------------------------------------------------------------ Entidades

const redondear = (x) => Math.round(x * 1e5) / 1e5; // 5 decimales ≈ 1 m, como los archivos de OpenStreetMap

function featureSalud(r) {
  return {
    type: 'Feature',
    properties: { fuente: 'RENIPRESS', nombre: r.nombre, codigo_renipress: r.id, categoria: r.categoria, clasificacion: r.tipo, distrito: r.distrito },
    geometry: { type: 'Point', coordinates: [redondear(r.lon), redondear(r.lat)] },
  };
}

function featureEscale(l) {
  const instituciones = (l.instituciones || []).map((i) => ({ codigo_modular: i.codigoModular, nombre: i.nombre, nivel: i.nivel, gestion: i.gestion }));
  return {
    type: 'Feature',
    properties: {
      fuente: 'ESCALE',
      nombre: l.nombre,
      codigo_modular: instituciones.length ? instituciones[0].codigo_modular : null,
      codigo_local: l.codLocal,
      niveles: l.niveles,
      distrito: l.distrito,
      instituciones,
    },
    geometry: { type: 'Point', coordinates: [redondear(l.lon), redondear(l.lat)] },
  };
}

// -------------------------------------------------------------------------- Fusión

const esPunto = (f) => f && f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates);
const posicion = (f) => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] });
const porCodigo = (campo) => (a, b) => (a.properties[campo] < b.properties[campo] ? -1 : a.properties[campo] > b.properties[campo] ? 1 : 0);
const GRADOS_POR_M = 1 / 111195;

/** Los oficiales que están a `radioM` o menos de un punto (prefiltro por caja y luego haversine). */
function oficialesCerca(punto, oficiales, radioM) {
  const g = radioM * GRADOS_POR_M * 1.5;
  const out = [];
  for (const o of oficiales) {
    const q = posicion(o);
    if (Math.abs(q.lat - punto.lat) > g || Math.abs(q.lon - punto.lon) > g * 1.1) continue;
    if (Calculos.haversine(punto.lat, punto.lon, q.lat, q.lon) <= radioM) out.push(o);
  }
  return out;
}

/** ¿Algún oficial cercano tiene un nombre (o varios) parecido al de OSM? Es el emparejamiento por nombre de la validación K2. */
function mismoNombre(osmFeature, cercanos, umbralNombre) {
  const nombre = osmFeature.properties.nombre;
  if (!nombre) return false;
  return cercanos.some((o) => {
    const nombres = [o.properties.nombre, ...(o.properties.instituciones || []).map((i) => i.nombre)].filter(Boolean);
    return nombres.some((n) => V.similitud(n, nombre) >= umbralNombre);
  });
}

const featureOsm = (f, extra = {}) => ({
  type: 'Feature',
  properties: { fuente: 'OSM', osm: f.properties.osm, nombre: f.properties.nombre, tags: f.properties.tags, ...extra },
  geometry: f.geometry,
});

/**
 * Salud: todos los puntos de RENIPRESS y, de OpenStreetMap, solo los que no tienen un punto oficial a `radioM` o menos
 * (200 m por omisión: el radio con el que la validación K2 midió la exhaustividad). Devuelve { features, conteo, osm, sinPunto }:
 * `osm` dice cuántas se descartaron y cuántas de ellas coinciden también en el nombre (parecido >= `umbralNombre`).
 */
function fusionarSalud(oficiales, osm, { radioM = 200, umbralNombre = 0.9 } = {}) {
  const ofi = [...oficiales].sort(porCodigo('codigo_renipress'));
  const respaldo = [];
  const stats = { total: 0, conservadas: 0, descartadas: 0, porNombreYDistancia: 0, soloPorDistancia: 0 };
  let sinPunto = 0;
  for (const f of osm) {
    if (!esPunto(f)) { sinPunto++; continue; }
    stats.total++;
    const cercanos = oficialesCerca(posicion(f), ofi, radioM);
    if (cercanos.length === 0) { respaldo.push(featureOsm(f)); stats.conservadas++; continue; }
    stats.descartadas++;
    if (mismoNombre(f, cercanos, umbralNombre)) stats.porNombreYDistancia++;
    else stats.soloPorDistancia++;
  }
  return { features: [...ofi, ...respaldo], conteo: { RENIPRESS: ofi.length, OSM: respaldo.length }, osm: stats, sinPunto };
}

const NIVELES = ['inicial', 'primaria', 'secundaria'];

/**
 * Educación: todos los locales de ESCALE y, de OpenStreetMap, solo lo que aporta un nivel (inicial, primaria o secundaria, con
 * Calculos.nivelesEducativos) que ningún local oficial de ese nivel cubre a `radioM` o menos. Lo que se conserva lleva en
 * `niveles` solo esos niveles sin cubrir. Los elementos sin nivel básico (educación superior mal etiquetada) no se añaden.
 */
function fusionarEducacion(oficiales, osm, { radioM = 200, umbralNombre = 0.9 } = {}) {
  const ofi = [...oficiales].sort(porCodigo('codigo_local'));
  const respaldo = [];
  const stats = { total: 0, conservadas: 0, descartadas: 0, porNombreYDistancia: 0, soloPorDistancia: 0, sinNivelBasico: 0 };
  let sinPunto = 0;
  for (const f of osm) {
    if (!esPunto(f)) { sinPunto++; continue; }
    stats.total++;
    const niveles = Calculos.nivelesEducativos(f.properties.tags);
    if (niveles.length === 0) { stats.sinNivelBasico++; continue; }
    const cercanos = oficialesCerca(posicion(f), ofi, radioM);
    const sinCubrir = niveles.filter((n) => !cercanos.some((o) => o.properties.niveles.includes(n)));
    if (sinCubrir.length > 0) { respaldo.push(featureOsm(f, { niveles: sinCubrir })); stats.conservadas++; continue; }
    stats.descartadas++;
    if (mismoNombre(f, cercanos, umbralNombre)) stats.porNombreYDistancia++;
    else stats.soloPorDistancia++;
  }
  const cuenta = (lista) => Object.fromEntries(NIVELES.map((n) => [n, lista.filter((f) => f.properties.niveles.includes(n)).length]));
  return {
    features: [...ofi, ...respaldo],
    conteo: { ESCALE: ofi.length, OSM: respaldo.length },
    porNivel: { ESCALE: cuenta(ofi), OSM: cuenta(respaldo) },
    osm: stats,
    sinPunto,
  };
}

// ------------------------------------------------------------------------ Procedencia

/**
 * Bloque `metadata` de un archivo de equipamiento: de dónde sale cada fuente (dirección, fecha, licencia), cuántos elementos
 * hay de cada una y la regla con la que se eligió y se deduplicó. Se escribe junto a los datos para que el origen sea auditable.
 *   oficial: { id, nombre, url, pagina, fecha, licencia, terminos? }   osm: { fecha, osm_base }
 */
function procedencia({ categoria, oficial, osm, conteo, radioM, regla, descartes, osmDescartes, generado = new Date().toISOString().slice(0, 10) }) {
  return {
    fuente: `${oficial.nombre} (fuente primaria) y OpenStreetMap (ODbL, respaldo)`,
    categoria,
    fecha_extraccion: oficial.fecha,
    generado,
    osm_base: osm.osm_base ?? null,
    fuentes: [
      { rol: 'primaria', ...oficial },
      { rol: 'respaldo', id: 'OSM', nombre: 'OpenStreetMap', licencia: 'ODbL', atribucion: '© colaboradores de OpenStreetMap', ...osm },
    ],
    conteo_por_fuente: conteo,
    regla_seleccion: regla,
    descartes_oficial: descartes,
    deduplicacion: {
      radio_m: radioM,
      regla: `Se incluye todo punto oficial. Un elemento de OpenStreetMap se añade solo si ningún punto oficial de la misma categoría está a ${radioM} m o menos (distancia en línea recta, haversine, la de la validación K2).`,
      osm: osmDescartes,
    },
    registros: Object.values(conteo).reduce((s, n) => s + n, 0),
  };
}

module.exports = {
  CP850_ALTO, CATEGORIAS_SALUD,
  decodificarCp850, cabeceraDbf, leerDbf, leerDbfArchivo, listarEntradasZip, extraerEntradaZip,
  ultimaEdicionRenipress, ultimoPadronEscale,
  clasificarSalud, seleccionarSalud, seleccionarEscale, seleccionarEscaleDbf,
  featureSalud, featureEscale, fusionarSalud, fusionarEducacion, procedencia,
};
