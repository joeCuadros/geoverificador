/**
 * validacion-oficial.js — Lógica pura (sin red ni archivos) para contrastar el equipamiento de OpenStreetMap con los registros
 * oficiales: RENIPRESS (establecimientos de salud) y el padrón de ESCALE (locales educativos). Protocolo: docs/INVESTIGACION-VARIABLES.md §5.1.
 * La usan scripts/validar-osm-oficial.mjs y test/validar-osm-oficial.spec.ts.
 *
 *   parsearCsv(texto)                         → { columnas, filas } (delimitador detectado; comillas, BOM)
 *   leerRenipress(texto, opciones)            → { registros, descartados, columnas }
 *   leerEscale(texto, opciones)               → { locales, iies, descartados, columnas }   (un local por código de local)
 *   leerEscaleFilas({ columnas, filas }, ...) → lo mismo desde filas ya leídas (CSV o DBF); nivelDeCodigo(NIV_MOD) → nivel de la EBR
 *   normalizarNombre(n) / similitud(a, b)     → nombre sin tildes ni palabras vacías / parecido de 0 a 1
 *   emparejar(oficiales, osm, opciones)       → { pares, ... } uno a uno por nombre (>= 0,9) y distancia (radio)
 *   metricas(oficiales, osm, radiosM, ...)    → exhaustividad, precisión y desfase por radio
 *   impacto(puntos, osm, oficiales, umbralM)  → cuántos puntos cambian de CUMPLE a NO CUMPLE o al revés
 *   validar(entrada)                          → todo junto; informe(resultado) → texto
 *
 * Todos los parámetros (0,9; 50, 100 y 200 m) son hipótesis a barrer, no normas: el informe los muestra.
 */
const Calculos = require('../../public/js/calculos.js');

// ------------------------------------------------------------------------------ CSV

const sinTildes = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Delimitador más probable según la primera línea (coma, punto y coma, tabulador o barra vertical). */
function detectarDelimitador(texto) {
  const linea = String(texto).split(/\r?\n/, 1)[0] || '';
  const cuentas = [',', ';', '\t', '|'].map((d) => [d, linea.split(d).length - 1]);
  cuentas.sort((a, b) => b[1] - a[1]);
  return cuentas[0][1] > 0 ? cuentas[0][0] : ',';
}

/** CSV con comillas (RFC 4180). Devuelve las filas como objetos con la clave normalizada de cada columna. */
function parsearCsv(texto, delimitador = null) {
  const t = String(texto == null ? '' : texto).replace(/^﻿/, '');
  const d = delimitador || detectarDelimitador(t);
  const filas = [];
  let campo = '';
  let fila = [];
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === d) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); if (fila.some((x) => x.trim() !== '')) filas.push(fila); }
  if (filas.length === 0) return { columnas: [], filas: [] };
  const columnas = filas[0].map((h) => clave(h));
  return { columnas, filas: filas.slice(1).map((f) => Object.fromEntries(columnas.map((c, k) => [c, (f[k] ?? '').trim()]))) };
}

/** «Nombre del establecimiento» → «nombre_del_establecimiento». */
function clave(h) {
  return sinTildes(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Primer valor no vacío entre las columnas que tengan alguno de estos nombres (ya normalizados). */
function columna(fila, alias) {
  for (const a of alias) if (fila[a] !== undefined && fila[a] !== '') return fila[a];
  return '';
}
const tiene = (columnas, alias) => alias.some((a) => columnas.includes(a));

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const ALIAS = {
  lat: ['latitud', 'latitude', 'lat', 'nlat_ie', 'nlat', 'y', 'coord_y'],
  lon: ['longitud', 'longitude', 'lon', 'long', 'lng', 'nlong_ie', 'nlong', 'x', 'coord_x'],
  nombreSalud: ['nombre_del_establecimiento', 'nombre_establecimiento', 'establecimiento', 'nombre', 'razon_social'],
  nombreIE: ['cen_edu', 'nombre_ie', 'nombre_de_ie', 'nombre_de_la_ie', 'institucion_educativa', 'nombre', 'nom_ie'],
  // El texto («Activo») va antes que el código («1»): en el padrón de ESCALE conviven ESTADO (1 o 2) y D_ESTADO.
  estado: ['d_estado', 'estado', 'situacion', 'condicion', 'estado_ie'],
  clasificacion: ['clasificacion', 'tipo', 'tipo_de_establecimiento', 'clase'],
  tipoEstablecimiento: ['tipo_establecimiento', 'tipo_de_establecimiento', 'tipo'],
  categoria: ['categoria'],
  codigoSalud: ['codigo_unico', 'codigo_renipress', 'cod_ipress', 'codigo', 'cod_unico', 'renipress'],
  gestion: ['d_gestion', 'gestion'],
  departamento: ['departamento', 'dpto', 'd_dpto'],
  provincia: ['provincia', 'prov', 'd_prov'],
  distrito: ['distrito', 'dist', 'd_dist', 'd_distrito'],
  codLocal: ['cod_local', 'codigo_de_local', 'codigo_local', 'codlocal'],
  codMod: ['cod_mod', 'codigo_modular', 'codmod'],
  nivel: ['d_niv_mod', 'nivel_modalidad', 'nivel', 'niv_mod', 'nivel_educativo', 'd_forma'],
  nivelCodigo: ['niv_mod', 'codigo_nivel'],
};

const esActivo = (v) => {
  const t = sinTildes(v).toLowerCase();
  if (t === '') return null;
  if (/inactiv|cerrad|cierre|clausur|suspend|baja|cancelad|no activ|no funcion|^2$/.test(t)) return false;
  return /activ|funcion|abiert|operat|^1$|^si$/.test(t) ? true : null;
};

const dentroDeCaja = (lat, lon, caja) => lon >= caja[0] && lon <= caja[2] && lat >= caja[1] && lat <= caja[3];
// Caja de Arequipa metropolitana (oeste, sur, este, norte): la misma que CONFIG.viewbox.
const CAJA_AREQUIPA = [-71.75, -16.6, -71.35, -16.2];

function validarColumnas(columnas, requeridas, archivo) {
  const faltan = requeridas.filter(([, alias]) => !tiene(columnas, alias)).map(([nombre, alias]) => `${nombre} (${alias.slice(0, 3).join(', ')}…)`);
  if (faltan.length) throw new Error(`${archivo}: faltan columnas: ${faltan.join('; ')}. Columnas del archivo: ${columnas.join(', ')}.`);
}

// ------------------------------------------------------------------------ RENIPRESS

/**
 * Si el archivo no trae LATITUD y LONGITUD pero sí NORTE y ESTE (así viene el CSV de datosabiertos.gob.pe), se usan como latitud y
 * longitud SOLO si todos sus valores son grados decimales; si son metros (UTM) no sirven y se pide otra edición.
 */
function coordenadasNorteEste(columnas, filas) {
  if (tiene(columnas, ALIAS.lat) || tiene(columnas, ALIAS.lon) || !columnas.includes('norte') || !columnas.includes('este')) return false;
  return filas.every((f) => {
    const n = numero(f.norte);
    const e = numero(f.este);
    return (n === null || Math.abs(n) <= 90) && (e === null || Math.abs(e) <= 180);
  });
}

/**
 * Establecimientos de salud de RENIPRESS en Arequipa metropolitana. Filtra: con coordenadas, dentro de la caja (y, si el archivo
 * trae departamento y provincia, solo AREQUIPA/AREQUIPA), dentro de `dentro(lat, lon)` si se da (p. ej. los polígonos de los
 * distritos), en estado activo (si el archivo trae estado: solo lo claramente activo cuenta; «cierre temporal» o «baja» no) y,
 * salvo que se pida lo contrario, sin consultorios. Un archivo con solo coordenadas UTM (Norte, Este en metros) no sirve: se pide
 * una edición con latitud y longitud.
 */
function leerRenipress(texto, { incluirConsultorios = false, caja = CAJA_AREQUIPA, dentro = null } = {}) {
  const { columnas, filas } = parsearCsv(texto);
  const aLat = coordenadasNorteEste(columnas, filas) ? ['norte'] : ALIAS.lat;
  const aLon = aLat[0] === 'norte' ? ['este'] : ALIAS.lon;
  validarColumnas(columnas, [['nombre', ALIAS.nombreSalud], ['latitud', aLat], ['longitud', aLon]], 'RENIPRESS');
  const d = { total: filas.length, sinCoordenadas: 0, fueraDeZona: 0, fueraDeDistrito: 0, otraProvincia: 0, inactivos: 0, consultorios: 0, repetidos: 0 };
  const registros = [];
  const vistos = new Set();
  const hayUbicacion = tiene(columnas, ALIAS.departamento) && tiene(columnas, ALIAS.provincia);
  const hayEstado = tiene(columnas, ALIAS.estado);
  for (const f of filas) {
    const lat = numero(columna(f, aLat));
    const lon = numero(columna(f, aLon));
    if (lat === null || lon === null || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { d.sinCoordenadas++; continue; }
    if (hayUbicacion) {
      const dep = sinTildes(columna(f, ALIAS.departamento)).toUpperCase();
      const prov = sinTildes(columna(f, ALIAS.provincia)).toUpperCase();
      if (dep !== 'AREQUIPA' || prov !== 'AREQUIPA') { d.otraProvincia++; continue; }
    }
    if (!dentroDeCaja(lat, lon, caja)) { d.fueraDeZona++; continue; }
    if (dentro && !dentro(lat, lon)) { d.fueraDeDistrito++; continue; }
    if (hayEstado && esActivo(columna(f, ALIAS.estado)) !== true) { d.inactivos++; continue; }
    const clasif = sinTildes(columna(f, ALIAS.clasificacion)).toLowerCase();
    if (!incluirConsultorios && /consultorio/.test(clasif)) { d.consultorios++; continue; }
    const id = columna(f, ALIAS.codigoSalud) || `${lat},${lon}`;
    if (vistos.has(id)) { d.repetidos++; continue; }
    vistos.add(id);
    registros.push({
      id,
      nombre: columna(f, ALIAS.nombreSalud),
      lat,
      lon,
      distrito: sinTildes(columna(f, ALIAS.distrito)).toUpperCase() || null,
      tipo: columna(f, ALIAS.clasificacion) || null,
      tipoEstablecimiento: columna(f, ALIAS.tipoEstablecimiento) || null,
      categoria: columna(f, ALIAS.categoria) || null,
    });
  }
  return { registros, descartados: d, columnas };
}

// -------------------------------------------------------------------------- ESCALE

/**
 * Educación básica regular (EBR) en el padrón de ESCALE: código de nivel/modalidad (NIV_MOD) → nivel de la ficha. Los pares
 * código / texto (D_NIV_MOD) salen del propio Padron_web.dbf del 2026-10-30, y las tres filas de la EBR son las únicas que los
 * umbrales de la ficha (RVM 104-2019-MINEDU y 208-2019-MINEDU) cubren:
 *   A1 Inicial - Cuna · A2 Inicial - Jardín · A3 Inicial - Cuna-jardín  → inicial
 *   B0 Primaria  → primaria · F0 Secundaria  → secundaria
 * Quedan fuera, a propósito: A5 Inicial - Programa no escolarizado (PRONOEI, sin local propio), C0 y G0 (primaria y secundaria de
 * adultos), D0 D1 D2 (básica alternativa), E0 E1 E2 y K0 (básica especial), L* (técnico-productiva y ocupacional), M0 P0 S0 T0
 * (formación artística, pedagógica y tecnológica superior).
 */
const NIVELES_EBR = { A1: 'inicial', A2: 'inicial', A3: 'inicial', B0: 'primaria', F0: 'secundaria' };

/** El nivel de la ficha de un código NIV_MOD, o null si no es educación básica regular. */
function nivelDeCodigo(codigo) {
  return NIVELES_EBR[String(codigo == null ? '' : codigo).trim().toUpperCase()] || null;
}

// Texto del nivel que NO es educación básica regular, aunque contenga «inicial», «primaria» o «secundaria».
const NO_EBR = /no escolarizad|adulto|alternativ|especial|ocupacional|productiv|superior|tecnolog|pedagog|artistic/;

/**
 * Los niveles básicos (inicial, primaria, secundaria) de una fila del padrón. Con el código de nivel (NIV_MOD) manda el código;
 * sin código se lee el texto (D_NIV_MOD). En los dos casos lo que no es educación básica regular no cuenta.
 */
function nivelesDeFila(f) {
  const texto = sinTildes(columna(f, ['d_niv_mod', 'nivel_modalidad', 'nivel', 'nivel_educativo', 'd_forma']) || '').toLowerCase();
  const codigo = String(columna(f, ['niv_mod', 'codigo_nivel']) || '').trim().toUpperCase();
  const niveles = new Set();
  if (NO_EBR.test(texto)) return niveles;
  if (codigo) {
    const n = nivelDeCodigo(codigo);
    if (n) niveles.add(n);
    return niveles;
  }
  if (/inicial/.test(texto)) niveles.add('inicial');
  if (/primaria/.test(texto)) niveles.add('primaria');
  if (/secundaria/.test(texto)) niveles.add('secundaria');
  return niveles;
}

/** «Pública de gestión directa» y «Pública de gestión privada» son públicas; «Privada», privada; sin dato, null. */
function gestionDeFila(f) {
  const t = sinTildes(columna(f, ALIAS.gestion)).toLowerCase();
  if (/^publica/.test(t)) return 'Pública';
  if (/^privada/.test(t)) return 'Privada';
  return null;
}

/**
 * Locales educativos del padrón de ESCALE en Arequipa metropolitana, desde las filas ya leídas (`{ columnas, filas }`, sea de un CSV
 * o de un DBF). Una fila es una institución educativa (IIEE) y un local puede tener varias: se deduplica por CÓDIGO DE LOCAL (los
 * niveles se juntan; los nombres y las instituciones, con su código modular, nivel y gestión, se guardan todos). Solo educación
 * básica regular (inicial, primaria y secundaria), estado activo (si el archivo trae estado; solo lo claramente activo cuenta),
 * con coordenadas, dentro de la caja y de `dentro(lat, lon)` si se da.
 */
function leerEscaleFilas({ columnas, filas }, { caja = CAJA_AREQUIPA, dentro = null } = {}) {
  validarColumnas(columnas, [['código de local', ALIAS.codLocal], ['nombre', ALIAS.nombreIE], ['latitud', ALIAS.lat], ['longitud', ALIAS.lon]], 'ESCALE');
  const d = { total: filas.length, sinCoordenadas: 0, fueraDeZona: 0, fueraDeDistrito: 0, otraProvincia: 0, inactivas: 0, otroNivel: 0 };
  const porLocal = new Map();
  const hayUbicacion = tiene(columnas, ALIAS.departamento) && tiene(columnas, ALIAS.provincia);
  const hayEstado = tiene(columnas, ALIAS.estado);
  let iies = 0;
  for (const f of filas) {
    const lat = numero(columna(f, ALIAS.lat));
    const lon = numero(columna(f, ALIAS.lon));
    if (lat === null || lon === null || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { d.sinCoordenadas++; continue; }
    if (hayUbicacion) {
      const dep = sinTildes(columna(f, ALIAS.departamento)).toUpperCase();
      const prov = sinTildes(columna(f, ALIAS.provincia)).toUpperCase();
      if (dep !== 'AREQUIPA' || prov !== 'AREQUIPA') { d.otraProvincia++; continue; }
    }
    if (!dentroDeCaja(lat, lon, caja)) { d.fueraDeZona++; continue; }
    if (dentro && !dentro(lat, lon)) { d.fueraDeDistrito++; continue; }
    if (hayEstado && esActivo(columna(f, ALIAS.estado)) !== true) { d.inactivas++; continue; }
    const niveles = nivelesDeFila(f);
    if (niveles.size === 0) { d.otroNivel++; continue; }
    iies++;
    const cod = columna(f, ALIAS.codLocal);
    const local = porLocal.get(cod) || { codLocal: cod, nombres: [], niveles: new Set(), instituciones: [], lat, lon, distrito: sinTildes(columna(f, ALIAS.distrito)).toUpperCase() || null };
    const nombre = columna(f, ALIAS.nombreIE);
    if (nombre && !local.nombres.includes(nombre)) local.nombres.push(nombre);
    niveles.forEach((n) => local.niveles.add(n));
    local.instituciones.push({ codigoModular: columna(f, ALIAS.codMod) || null, nombre, nivel: [...niveles][0], gestion: gestionDeFila(f) });
    porLocal.set(cod, local);
  }
  const locales = [...porLocal.values()].map((l) => ({ ...l, nombre: l.nombres[0] || '', niveles: ['inicial', 'primaria', 'secundaria'].filter((n) => l.niveles.has(n)) }));
  return { locales, iies, descartados: { ...d, repetidosPorLocal: iies - locales.length }, columnas };
}

/** Lo mismo desde el texto de un CSV. */
function leerEscale(texto, opciones = {}) {
  return leerEscaleFilas(parsearCsv(texto), opciones);
}

// ---------------------------------------------------------------------- Nombres

// Palabras que no distinguen un establecimiento de otro: se quitan antes de comparar (Zhang y Pfoser quitan las palabras vacías).
const VACIAS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'ie', 'i', 'n', 'no', 'nro', 'numero', 'num',
  'institucion', 'educativa', 'inicial', 'primaria', 'secundaria', 'colegio', 'escuela', 'jardin', 'cei', 'ei', 'cebe', 'cetpro',
  'centro', 'puesto', 'posta', 'salud', 'clinica', 'hospital', 'policlinico', 'consultorio', 'medico', 'establecimiento', 'privado', 'nacional',
]);

/** Minúsculas, sin tildes ni signos, sin palabras vacías, con los números romanos y arábigos tal cual. */
function normalizarNombre(n) {
  const tokens = sinTildes(n).toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(Boolean);
  const utiles = tokens.filter((t) => !VACIAS.has(t));
  return (utiles.length ? utiles : tokens).join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Parecido de 0 a 1 entre dos nombres ya normalizados: el mejor entre el orden dado y las palabras ordenadas (1 − distancia / largo). */
function similitud(a, b) {
  const x = normalizarNombre(a);
  const y = normalizarNombre(b);
  if (!x || !y) return 0;
  const razon = (p, q) => 1 - levenshtein(p, q) / Math.max(p.length, q.length);
  const ordenado = (s) => s.split(' ').sort().join(' ');
  return Math.max(razon(x, y), razon(ordenado(x), ordenado(y)));
}

// ------------------------------------------------------------------ Emparejamiento

const dist = (a, b) => Calculos.haversine(a.lat, a.lon, b.lat, b.lon);

/**
 * Empareja registros oficiales con elementos de OSM, uno a uno: nombres con similitud >= umbralNombre y a `radioM` o menos.
 * Un oficial puede tener varios nombres (`nombres`): se usa el más parecido. Gana primero el par más parecido y, a igual parecido,
 * el más cercano. Los elementos de OSM sin nombre no se pueden emparejar por nombre: se cuentan aparte.
 *   oficiales: [{ id, nombre, nombres?, lat, lon }]; osm: [{ id, nombre, lat, lon }]
 */
function emparejar(oficiales, osm, { radioM = 100, umbralNombre = 0.9 } = {}) {
  const candidatos = [];
  const grados = radioM / 111195 * 1.5;
  oficiales.forEach((o, i) => {
    const nombres = o.nombres && o.nombres.length ? o.nombres : [o.nombre];
    osm.forEach((e, j) => {
      if (!e.nombre) return;
      if (Math.abs(e.lat - o.lat) > grados || Math.abs(e.lon - o.lon) > grados * 1.1) return;
      const d = dist(o, e);
      if (d > radioM) return;
      const s = Math.max(...nombres.map((n) => similitud(n, e.nombre)));
      if (s >= umbralNombre) candidatos.push({ i, j, d, s });
    });
  });
  candidatos.sort((a, b) => b.s - a.s || a.d - b.d);
  const usadosO = new Set();
  const usadosE = new Set();
  const pares = [];
  for (const c of candidatos) {
    if (usadosO.has(c.i) || usadosE.has(c.j)) continue;
    usadosO.add(c.i);
    usadosE.add(c.j);
    pares.push({ oficial: oficiales[c.i], osm: osm[c.j], distanciaM: c.d, similitud: c.s });
  }
  return { pares, oficialesSinPar: oficiales.length - pares.length, osmConNombre: osm.filter((e) => e.nombre).length, osmSinNombre: osm.filter((e) => !e.nombre).length };
}

function percentil(valores, p) {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const k = (v.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return v[lo] + (v[hi] - v[lo]) * (k - lo);
}

/**
 * Exhaustividad (qué parte de lo oficial aparece en OSM), precisión (qué parte de lo de OSM con nombre corresponde a un registro
 * oficial) y desfase (mediana y percentil 90 de la distancia entre pares), para cada radio.
 */
function metricas(oficiales, osm, radiosM = [50, 100, 200], opciones = {}) {
  return radiosM.map((radioM) => {
    const r = emparejar(oficiales, osm, { ...opciones, radioM });
    const d = r.pares.map((p) => p.distanciaM);
    return {
      radioM,
      oficiales: oficiales.length,
      osm: osm.length,
      osmConNombre: r.osmConNombre,
      osmSinNombre: r.osmSinNombre,
      emparejados: r.pares.length,
      exhaustividad: oficiales.length ? r.pares.length / oficiales.length : null,
      precision: r.osmConNombre ? r.pares.length / r.osmConNombre : null,
      desfaseMedianaM: percentil(d, 0.5),
      desfaseP90M: percentil(d, 0.9),
      pares: r.pares,
    };
  });
}

/** Exhaustividad por distrito del registro oficial (cuántos oficiales de cada distrito aparecen emparejados). */
function porDistrito(oficiales, pares) {
  const emparejados = new Set(pares.map((p) => p.oficial));
  const por = new Map();
  for (const o of oficiales) {
    const k = o.distrito || 'SIN DISTRITO';
    const x = por.get(k) || { distrito: k, oficiales: 0, emparejados: 0 };
    x.oficiales++;
    if (emparejados.has(o)) x.emparejados++;
    por.set(k, x);
  }
  return [...por.values()].map((x) => ({ ...x, exhaustividad: x.oficiales ? x.emparejados / x.oficiales : null })).sort((a, b) => b.oficiales - a.oficiales);
}

// ---------------------------------------------------- Impacto en la variable (cumple / no cumple)

/** Distancia al elemento más cercano (Infinity si no hay). */
function masCercano(punto, lista) {
  let min = Infinity;
  for (const e of lista) {
    if (Math.abs(e.lat - punto.lat) * 111195 > min) continue;
    const d = dist(punto, e);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Para una malla de puntos: la distancia al establecimiento más cercano con OSM y con el registro oficial, y en cuántos puntos
 * cambia la clasificación frente al umbral (cumple si está a `umbralM` o menos). Sin elementos, la distancia es infinita
 * (no cumple), como en la ficha.
 */
function impacto(puntos, osm, oficiales, umbralM) {
  let cambian = 0;
  let osmCumpleOficialNo = 0;
  let oficialCumpleOsmNo = 0;
  const difs = [];
  for (const p of puntos) {
    const dO = masCercano(p, osm);
    const dF = masCercano(p, oficiales);
    const cO = dO <= umbralM;
    const cF = dF <= umbralM;
    if (cO !== cF) { cambian++; if (cO) osmCumpleOficialNo++; else oficialCumpleOsmNo++; }
    if (Number.isFinite(dO) && Number.isFinite(dF)) difs.push(Math.abs(dO - dF));
  }
  return {
    umbralM, puntos: puntos.length, cambian, osmCumpleOficialNo, oficialCumpleOsmNo,
    porcentajeCambian: puntos.length ? cambian / puntos.length : null,
    diferenciaMedianaM: percentil(difs, 0.5), diferenciaP90M: percentil(difs, 0.9),
  };
}

/** Malla de puntos cada `pasoM` metros dentro de la caja, filtrada por `dentro(lat, lon)` si se da (p. ej. dentro de un distrito). */
function malla(caja, pasoM, dentro = null) {
  const out = [];
  const dLat = pasoM / 111195;
  for (let lat = caja[1] + dLat / 2; lat < caja[3]; lat += dLat) {
    const dLon = pasoM / (111195 * Math.cos((lat * Math.PI) / 180));
    for (let lon = caja[0] + dLon / 2; lon < caja[2]; lon += dLon) if (!dentro || dentro(lat, lon)) out.push({ lat, lon });
  }
  return out;
}

// --------------------------------------------------------------------- Todo junto

/**
 * Valida salud y educación.
 *   entrada: { renipress: leerRenipress(...), escale: leerEscale(...), osmSalud: [{id, nombre, lat, lon}], osmEducacion: [{id, nombre, lat, lon, niveles}],
 *              puntos: [{lat, lon}], umbrales: { salud, educacion: { inicial, primaria, secundaria } }, radiosM, umbralNombre }
 */
function validar({ renipress, escale, osmSalud, osmEducacion, puntos = [], umbrales, radiosM = [50, 100, 200], umbralNombre = 0.9 }) {
  const opciones = { umbralNombre };
  const res = { radiosM, umbralNombre, puntos: puntos.length };
  const mS = metricas(renipress.registros, osmSalud, radiosM, opciones);
  res.salud = {
    oficiales: renipress.registros.length, osm: osmSalud.length, metricas: mS.map(({ pares, ...x }) => x),
    porDistrito: porDistrito(renipress.registros, mS[mS.length - 1].pares),
    impacto: impacto(puntos, osmSalud, renipress.registros, umbrales.salud),
  };
  const locales = escale.locales;
  const mE = metricas(locales, osmEducacion, radiosM, opciones);
  res.educacion = {
    oficiales: locales.length, iies: escale.iies, osm: osmEducacion.length, metricas: mE.map(({ pares, ...x }) => x),
    porDistrito: porDistrito(locales, mE[mE.length - 1].pares),
    porNivel: {},
  };
  // Por nivel: los locales oficiales con ese nivel frente a los elementos de OSM que lo cubren (niveles inferidos de las etiquetas de OSM).
  for (const nivel of ['inicial', 'primaria', 'secundaria']) {
    const of = locales.filter((l) => l.niveles.includes(nivel));
    const os = osmEducacion.filter((e) => (e.niveles || []).includes(nivel));
    const m = metricas(of, os, radiosM, opciones);
    res.educacion.porNivel[nivel] = { oficiales: of.length, osm: os.length, metricas: m.map(({ pares, ...x }) => x), impacto: impacto(puntos, os, of, umbrales.educacion[nivel]) };
  }
  return res;
}

// ----------------------------------------------------------------------- Informe

const pc = (x) => (x === null || x === undefined ? 'sin dato' : `${(100 * x).toFixed(1).replace('.', ',')} %`);
const mt = (x) => (x === null || x === undefined ? 'sin dato' : `${Math.round(x)} m`);

function lineasMetricas(ms) {
  return ms.map((m) => `    ${String(m.radioM).padStart(3)} m: exhaustividad ${pc(m.exhaustividad)} (${m.emparejados} de ${m.oficiales}), precisión ${pc(m.precision)} (${m.emparejados} de ${m.osmConNombre} de OSM con nombre), desfase mediana ${mt(m.desfaseMedianaM)}, p90 ${mt(m.desfaseP90M)}`);
}

function lineaImpacto(i, etiqueta) {
  return `    ${etiqueta} (umbral ${i.umbralM} m, ${i.puntos} puntos): cambian ${i.cambian} (${pc(i.porcentajeCambian)}); OSM cumple y el oficial no: ${i.osmCumpleOficialNo}; el oficial cumple y OSM no: ${i.oficialCumpleOsmNo}; diferencia mediana de la distancia al más cercano ${mt(i.diferenciaMedianaM)}, p90 ${mt(i.diferenciaP90M)}`;
}

/** El informe en texto plano, con todo lo que pide el protocolo (docs/INVESTIGACION-VARIABLES.md §5.1). */
function informe(r, { renipress, escale, meta = {} } = {}) {
  const L = [];
  L.push('VALIDACIÓN DE OPENSTREETMAP CONTRA REGISTROS OFICIALES (K2)');
  L.push(`Zona: Arequipa metropolitana. Emparejamiento por nombre (similitud >= ${String(r.umbralNombre).replace('.', ',')}, sin palabras vacías) y distancia; radios barridos: ${r.radiosM.join(', ')} m. Los parámetros son hipótesis, no normas.`);
  if (meta.renipress) L.push(`RENIPRESS: ${meta.renipress}`);
  if (meta.escale) L.push(`ESCALE: ${meta.escale}`);
  if (meta.osm) L.push(`OpenStreetMap: ${meta.osm}`);
  if (renipress) L.push(`Filtros RENIPRESS: ${renipress.descartados.total} filas; descartadas: ${renipress.descartados.sinCoordenadas} sin coordenadas, ${renipress.descartados.otraProvincia} de otra provincia, ${renipress.descartados.fueraDeZona} fuera de la zona, ${renipress.descartados.inactivos} inactivas, ${renipress.descartados.consultorios} consultorios, ${renipress.descartados.repetidos} repetidas.`);
  if (escale) L.push(`Filtros ESCALE: ${escale.descartados.total} filas; descartadas: ${escale.descartados.sinCoordenadas} sin coordenadas, ${escale.descartados.otraProvincia} de otra provincia, ${escale.descartados.fueraDeZona} fuera de la zona, ${escale.descartados.inactivas} inactivas, ${escale.descartados.otroNivel} de otro nivel; ${escale.iies} IIEE en ${r.educacion.oficiales} locales (deduplicadas por código de local).`);
  L.push('');
  L.push(`SALUD (V2): ${r.salud.oficiales} establecimientos oficiales, ${r.salud.osm} en OpenStreetMap`);
  L.push(...lineasMetricas(r.salud.metricas));
  L.push(lineaImpacto(r.salud.impacto, 'Impacto en la variable'));
  L.push('');
  L.push(`EDUCACIÓN (V3): ${r.educacion.oficiales} locales oficiales, ${r.educacion.osm} colegios en OpenStreetMap`);
  L.push(...lineasMetricas(r.educacion.metricas));
  for (const [nivel, x] of Object.entries(r.educacion.porNivel)) {
    L.push(`  Nivel ${nivel}: ${x.oficiales} locales oficiales, ${x.osm} en OpenStreetMap`);
    L.push(...lineasMetricas(x.metricas));
    L.push(lineaImpacto(x.impacto, 'Impacto en la variable'));
  }
  L.push('');
  const filaDistrito = (x) => `    ${x.distrito}: ${x.emparejados} de ${x.oficiales} (${pc(x.exhaustividad)})`;
  L.push(`Exhaustividad por distrito (radio de ${r.radiosM[r.radiosM.length - 1]} m)`);
  L.push('  Salud:');
  r.salud.porDistrito.forEach((x) => L.push(filaDistrito(x)));
  L.push('  Educación:');
  r.educacion.porDistrito.forEach((x) => L.push(filaDistrito(x)));
  L.push('');
  L.push('Recuerda: fija los criterios de aceptación ANTES de mirar estos números (docs/VALIDACION.md). Si OSM no basta, la decisión posterior es usar RENIPRESS y ESCALE como fuente primaria.');
  return L.join('\n');
}

module.exports = {
  CAJA_AREQUIPA, parsearCsv, detectarDelimitador, leerRenipress, leerEscale, normalizarNombre, similitud, emparejar, metricas, porDistrito,
  impacto, malla, percentil, validar, informe, nivelesDeFila, nivelDeCodigo, leerEscaleFilas, NIVELES_EBR, clave, esActivo, sinTildes,
};
