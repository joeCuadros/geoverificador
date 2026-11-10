/**
 * calculos.js — Cálculos puros del alcance de 5 variables (sin DOM, sin red, sin estado).
 *
 *   V1a Zonificación vigente      → alertaBorde
 *   V1b Zonificación proyectada   → avisoPDMProyectado
 *   V2  Salud                     → evaluarMasCercano (umbral 1000 m)
 *   V3  Educación por nivel       → nivelesEducativos + evaluarMasCercano (500 / 1500 / 3000 m)
 *   V4  Transporte                → evaluarMasCercano (umbral 400 m)
 *   V5  Área verde                → evaluarAreaVerde (≥ 5000 m² a ≤ 300 m)
 *
 * Se carga como script del navegador (define `Calculos`) y también como módulo CommonJS: así las mismas funciones
 * se prueban con jest (test/calculos.spec.ts), se verifican en scripts/verificar-datos.mjs y las usa el script de
 * extracción de OpenStreetMap. Las coordenadas GeoJSON van como [longitud, latitud]; las funciones de punto reciben
 * (lat, lon) o { lat, lon }.
 */
const Calculos = (() => {
  const R = 6371008.8; // radio medio de la Tierra en metros
  const rad = (d) => (d * Math.PI) / 180;
  const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);

  // -------------------------------------------------------------- Distancias

  /** Distancia en línea recta sobre la esfera (fórmula del haversine), en metros. */
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Proyecta [lon, lat] a metros respecto al punto (lat0, lon0). A las escalas de este proyecto (< 50 km) el error
  // frente a la distancia geodésica es muy inferior al 1 %, y a 300 m es de milímetros.
  function aMetros(lat0, lon0, coord) {
    return { x: rad(coord[0] - lon0) * Math.cos(rad(lat0)) * R, y: rad(coord[1] - lat0) * R };
  }

  // Distancia del origen (0, 0) al segmento AB.
  function distOrigenASegmento(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(a.x * dx + a.y * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(a.x + t * dx, a.y + t * dy);
  }

  // ¿(lon, lat) está dentro del anillo? (ray casting)
  function dentroDeAnillo(lon, lat, anillo) {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i];
      const [xj, yj] = anillo[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  /** Dentro del anillo exterior y fuera de todos los huecos. `anillos` = [exterior, ...huecos]. */
  function puntoEnPoligono(lat, lon, anillos) {
    if (!anillos || !anillos.length || !dentroDeAnillo(lon, lat, anillos[0])) return false;
    for (let k = 1; k < anillos.length; k++) if (dentroDeAnillo(lon, lat, anillos[k])) return false;
    return true;
  }

  /** 0 si el punto está dentro del polígono; si no, distancia en metros al borde más cercano (exterior o huecos). */
  function distanciaAPoligonoM(lat, lon, anillos) {
    if (puntoEnPoligono(lat, lon, anillos)) return 0;
    let min = Infinity;
    for (const anillo of anillos || []) {
      let previo = null;
      for (const coord of anillo) {
        const p = aMetros(lat, lon, coord);
        if (previo) min = Math.min(min, distOrigenASegmento(previo, p));
        else min = Math.min(min, Math.hypot(p.x, p.y));
        previo = p;
      }
    }
    return min;
  }

  const poligonosDe = (geometria) => {
    if (!geometria) return [];
    if (geometria.type === 'Polygon') return [geometria.coordinates];
    if (geometria.type === 'MultiPolygon') return geometria.coordinates;
    return [];
  };

  /** Distancia a una geometría Polygon o MultiPolygon (0 si el punto cae dentro de alguno). Infinity si no es polígono. */
  function distanciaAGeometriaM(lat, lon, geometria) {
    let min = Infinity;
    for (const anillos of poligonosDe(geometria)) min = Math.min(min, distanciaAPoligonoM(lat, lon, anillos));
    return min;
  }

  /**
   * Distancia en metros de un punto a una polilínea `coords` = [[lon, lat], …]. Se proyecta cada tramo a un plano local
   * centrado en el punto (la misma proyección que usan los polígonos: a menos de 50 km difiere del haversine en menos del
   * 0,5 %) y se toma el tramo más cercano. Infinity si no hay ningún punto.
   */
  function distanciaALineaM(lat, lon, coords) {
    let min = Infinity;
    let previo = null;
    for (const coord of coords || []) {
      const p = aMetros(lat, lon, coord);
      min = Math.min(min, previo ? distOrigenASegmento(previo, p) : Math.hypot(p.x, p.y));
      previo = p;
    }
    return min;
  }

  /** Distancia a una geometría LineString o MultiLineString. Infinity para cualquier otra (no se inventa una distancia). */
  function distanciaAGeometriaLineaM(lat, lon, geometria) {
    if (!geometria) return Infinity;
    if (geometria.type === 'LineString') return distanciaALineaM(lat, lon, geometria.coordinates);
    if (geometria.type === 'MultiLineString') return Math.min(Infinity, ...geometria.coordinates.map((l) => distanciaALineaM(lat, lon, l)));
    return Infinity;
  }

  // -------------------------------------------------------------------- Área

  /**
   * Área geodésica de un anillo en m² sobre la esfera de radio R (fórmula de Chamberlain y Duquette,
   * la misma de turf.area y de la especificación de GeoJSON de Mapbox). No depende del sentido del anillo.
   */
  function areaAnilloM2(anillo) {
    if (!anillo || anillo.length < 4) return 0;
    let suma = 0;
    for (let i = 0; i < anillo.length - 1; i++) {
      const [lon1, lat1] = anillo[i];
      const [lon2, lat2] = anillo[i + 1];
      suma += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
    }
    return Math.abs((suma * R * R) / 2);
  }

  /** Área de un polígono con huecos: exterior menos los huecos. */
  function areaPoligonoM2(anillos) {
    if (!anillos || !anillos.length) return 0;
    const huecos = anillos.slice(1).reduce((t, h) => t + areaAnilloM2(h), 0);
    return Math.max(0, areaAnilloM2(anillos[0]) - huecos);
  }

  function areaGeometriaM2(geometria) {
    return poligonosDe(geometria).reduce((t, p) => t + areaPoligonoM2(p), 0);
  }

  // Centro de la caja envolvente del anillo exterior (solo para ubicar un marcador).
  function centroDe(geometria) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const anillos of poligonosDe(geometria)) {
      for (const [x, y] of anillos[0] || []) {
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
      }
    }
    return b[0] === Infinity ? null : { lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2 };
  }

  // --------------------------------------------- Etiquetas de OpenStreetMap

  /**
   * Qué etiquetas de OSM entran en cada variable. Es la ÚNICA definición: de aquí salen la consulta a Overpass
   * (scripts/extraer-equipamiento.mjs y el respaldo en vivo), la clasificación de los elementos y la lista que se
   * muestra en pantalla.
   *   valores  → la etiqueta debe valer alguno de ellos; sin `valores` basta con que exista.
   *   excluir  → valores que no son un establecimiento (p. ej. una farmacia no es un centro de atención).
   */
  // Nombres que hacen de un terreno o edificio comercial con nombre un mall (expresión regular sobre el nombre sin tildes): las palabras genéricas y los centros
  // comerciales conocidos de Arequipa, cuyo nombre no las trae (Real Plaza, OutletArauco que fue Parque Lambramani, Arequipa Center, Mall Aventura).
  const NOMBRE_MALL = 'mall|centro comercial|shopping|outlet|real plaza|open plaza|lambramani|arequipa center|aventura';

  const FILTROS = {
    // Establecimientos de salud (hospitales, clínicas, centros y puestos de salud, policlínicos…). El consultorio médico
    // (amenity=doctors, healthcare=doctor) es otra categoría: ver `consultorios`.
    salud: [
      { clave: 'amenity', valores: ['hospital', 'clinic'] },
      // healthcare=* salvo lo que no es un centro de atención general: farmacia, óptica, medicina alternativa, banco de
      // sangre, laboratorio, consultas de una sola especialidad paramédica u odontológica y el consultorio médico (doctor).
      {
        clave: 'healthcare',
        excluir: [
          'pharmacy', 'optometrist', 'alternative', 'blood_donation', 'laboratory', 'sample_collection', 'dentist',
          'physiotherapist', 'occupational_therapist', 'psychotherapist', 'speech_therapist', 'audiologist', 'podiatrist', 'doctor',
        ],
      },
    ],
    // Consultorios médicos: categoría APARTE de la salud. Son informativos (no tienen umbral; ver CONFIG.umbrales.consultorio).
    // Si un elemento es además hospital, clinic u otro healthcare=*, manda el establecimiento (ver categoriasDe).
    consultorios: [
      { clave: 'amenity', valores: ['doctors'] },
      { clave: 'healthcare', valores: ['doctor'] },
    ],
    // Comercio (mercados, supermercados y malls): categorías INFORMATIVAS, sin umbral (ver CONFIG.umbrales.mercado / supermercado / mall).
    // `nombre` (solo en landuse=retail y building=retail|commercial) es una expresión regular que debe cumplir el nombre: un terreno o edificio comercial sin nombre, o con otro nombre, no es un mall.
    mercados: [{ clave: 'amenity', valores: ['marketplace'] }],
    supermercados: [{ clave: 'shop', valores: ['supermarket'] }],
    malls: [
      { clave: 'shop', valores: ['mall'] },
      { clave: 'landuse', valores: ['retail'], nombre: NOMBRE_MALL },
      { clave: 'building', valores: ['retail', 'commercial'], nombre: NOMBRE_MALL },
    ],
    educacion: [{ clave: 'amenity', valores: ['school', 'kindergarten'] }],
    transporte: [
      { clave: 'highway', valores: ['bus_stop'] },
      { clave: 'public_transport', valores: ['platform', 'stop_position'] },
    ],
    areasVerdes: [
      { clave: 'leisure', valores: ['park', 'garden'] },
      { clave: 'landuse', valores: ['recreation_ground'] },
    ],
  };

  // Etiquetas que se conservan en los archivos congelados (el resto no hace falta y los haría pesar más).
  const ETIQUETAS_GUARDADAS = [
    'amenity', 'healthcare', 'healthcare:speciality', 'isced:level', 'school', 'leisure', 'landuse', 'highway', 'public_transport', 'shop', 'building',
  ];

  const sinTildes = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function coincide(tags, filtro, nombre) {
    const v = tags[filtro.clave];
    if (v === undefined) return false;
    if (filtro.nombre && !(nombre && new RegExp(filtro.nombre, 'i').test(sinTildes(nombre)))) return false;
    if (filtro.valores) return filtro.valores.includes(v);
    return !(filtro.excluir || []).includes(v);
  }

  /**
   * ¿Es un servicio odontológico? RENIPRESS ya deja fuera el centro odontológico; en OpenStreetMap un consultorio dental suele venir
   * como amenity=doctors, así que se reconoce por cualquiera de estas señales: amenity=dentist, healthcare=dentist, healthcare:speciality
   * con «dentistry» (o «dental…», p. ej. dental_oral_maxillo_facial_surgery) o un nombre con dental, odontolog… o dentist…
   * (sin distinguir mayúsculas ni tildes). Lo dental no es salud ni consultorio médico.
   */
  function esDental(tags, nombre) {
    const t = tags || {};
    if (t.amenity === 'dentist' || t.healthcare === 'dentist') return true;
    if (/dentistry|dental/.test(sinTildes(t['healthcare:speciality'] ?? ''))) return true;
    return nombre ? /dental|odontolog|dentist/.test(sinTildes(nombre)) : false;
  }

  /**
   * Variables a las que pertenece un elemento según sus etiquetas ([] si a ninguna). `nombre` (opcional) es el nombre en OSM:
   * sirve para reconocer lo dental (esDental), que se deja fuera de la salud y de los consultorios.
   */
  function categoriasDe(tags, nombre) {
    const t = tags || {};
    let cats = Object.keys(FILTROS).filter((cat) => FILTROS[cat].some((f) => coincide(t, f, nombre)));
    if (esDental(t, nombre)) cats = cats.filter((c) => c !== 'salud' && c !== 'consultorios');
    // Un elemento que es hospital, clinic u otro healthcare=* Y TAMBIÉN doctor es un establecimiento: no se cuenta dos veces.
    return cats.includes('salud') ? cats.filter((c) => c !== 'consultorios') : cats;
  }

  /**
   * Reparte la salud de OpenStreetMap en las dos categorías: 'salud' (establecimiento) o 'consultorio' (amenity=doctors,
   * healthcare=doctor); null si no es ninguna de las dos (ni lo dental). Es la misma regla de categoriasDe.
   */
  function categoriaSalud(tags, nombre) {
    const cats = categoriasDe(tags, nombre);
    if (cats.includes('salud')) return 'salud';
    return cats.includes('consultorios') ? 'consultorio' : null;
  }

  /** Etiqueta «clave=valor» con la que un elemento entra en la variable (la primera regla que coincide), o null. */
  function etiquetaDe(tags, categoria) {
    const t = tags || {};
    const f = (FILTROS[categoria] || []).find((x) => coincide(t, x));
    return f ? `${f.clave}=${t[f.clave]}` : null;
  }

  /** Selectores de Overpass QL de una variable, p. ej. ["amenity"~"^(hospital|clinic)$"]. */
  function selectoresOverpass(categoria) {
    return FILTROS[categoria].map((f) => {
      if (f.valores) {
        const valores = f.valores.length === 1 ? `["${f.clave}"="${f.valores[0]}"]` : `["${f.clave}"~"^(${f.valores.join('|')})$"]`;
        return f.nombre ? `${valores}["name"~"${f.nombre}",i]` : valores;
      }
      const excl = f.excluir && f.excluir.length ? `["${f.clave}"!~"^(${f.excluir.join('|')})$"]` : '';
      return `["${f.clave}"]${excl}`;
    });
  }

  /**
   * Niveles educativos que atiende un colegio según sus etiquetas de OSM.
   *
   * Regla (OSM casi no etiqueta el nivel en Arequipa, así que hay una regla por defecto):
   *   1. amenity=kindergarten → inicial.
   *   2. amenity=school con `isced:level` (0 = inicial, 1 = primaria, 2 y 3 = secundaria) o con
   *      `school=kindergarten|primary|secondary` → los niveles que declare.
   *   3. amenity=school SIN etiquetas de nivel (o con un valor no interpretable) → candidato a primaria y a
   *      secundaria. No se le asigna inicial: no hay base para suponerlo, y los jardines se mapean aparte como
   *      kindergarten. Si un colegio mixto no declara su nivel, esta regla puede sobrestimar la oferta.
   *   4. amenity=school etiquetado solo con niveles ISCED ≥ 4 (superior no universitaria o universitaria, mal
   *      etiquetada como colegio) → no es educación básica: no cuenta para ninguno de los tres niveles.
   */
  function nivelesEducativos(tags) {
    const t = tags || {};
    if (t.amenity === 'kindergarten') return ['inicial'];
    if (t.amenity !== 'school') return [];
    const niveles = new Set();
    let superior = false;
    String(t['isced:level'] ?? '').split(/[;,\s]+/).forEach((v) => {
      if (v === '0') niveles.add('inicial');
      else if (v === '1') niveles.add('primaria');
      else if (v === '2' || v === '3') niveles.add('secundaria');
      else if (/^[4-8]$/.test(v)) superior = true;
    });
    String(t.school ?? '').split(/[;,\s]+/).forEach((v) => {
      if (v === 'kindergarten') niveles.add('inicial');
      else if (v === 'primary') niveles.add('primaria');
      else if (v === 'secondary') niveles.add('secundaria');
    });
    if (niveles.size === 0) return superior ? [] : ['primaria', 'secundaria'];
    return ['inicial', 'primaria', 'secundaria'].filter((n) => niveles.has(n));
  }

  // --------------------------------- Fuente de cada establecimiento (salud y educación)

  /**
   * Los archivos de salud y de educación (scripts/descargar-equipamiento-oficial.mjs) juntan tres fuentes y cada elemento dice
   * la suya en `properties.fuente`: RENIPRESS (SUSALUD) y ESCALE (MINEDU) son la fuente primaria; OSM es el respaldo, solo donde
   * no hay un punto oficial cerca. Un archivo anterior, o la consulta en vivo a Overpass, no trae `fuente`: es OpenStreetMap.
   */
  const FUENTES_ELEMENTO = ['RENIPRESS', 'ESCALE', 'OSM'];
  const NOMBRE_FUENTE_ELEMENTO = { RENIPRESS: 'RENIPRESS (SUSALUD)', ESCALE: 'ESCALE (MINEDU)' };

  function fuenteDe(props) {
    const f = props && props.fuente;
    return FUENTES_ELEMENTO.includes(f) ? f : 'OSM';
  }

  /**
   * Niveles que atiende un colegio. Un local de ESCALE los trae (`niveles`); lo de OpenStreetMap que se conserva como respaldo
   * trae solo los que el registro oficial no cubre ahí; si no hay `niveles`, se infieren de las etiquetas de OSM (nivelesEducativos).
   */
  function nivelesDe(props) {
    const p = props || {};
    if (Array.isArray(p.niveles)) return ['inicial', 'primaria', 'secundaria'].filter((n) => p.niveles.includes(n));
    return nivelesEducativos(p.tags);
  }

  /**
   * De dónde sale un elemento y su código oficial: { fuente, codigo, categoria, gestion, nombre }. Para un local de ESCALE con
   * `nivel`, el código modular, el nombre y la gestión son los de la institución de ese nivel (un local puede tener varias).
   */
  function origenDe(props, nivel) {
    const p = props || {};
    const fuente = fuenteDe(p);
    const base = { fuente, codigo: null, categoria: null, gestion: null, nombre: p.nombre ?? null };
    if (fuente === 'RENIPRESS') return { ...base, codigo: p.codigo_renipress ?? null, categoria: p.categoria ?? null };
    if (fuente === 'ESCALE') {
      const ie = nivel ? (p.instituciones || []).find((i) => i.nivel === nivel) : null;
      return { ...base, codigo: (ie && ie.codigo_modular) || p.codigo_modular || null, gestion: (ie && ie.gestion) || null, nombre: (ie && ie.nombre) || base.nombre };
    }
    return base;
  }

  /** «amenity=clinic» para lo de OpenStreetMap; null para un punto oficial (no tiene etiquetas de OSM). */
  function etiquetaElemento(props, categoria) {
    return fuenteDe(props) === 'OSM' ? etiquetaDe(props && props.tags, categoria) : null;
  }

  /**
   * Una línea que dice de dónde sale el establecimiento más cercano de un resultado de evaluarMasCercano, con su código oficial:
   * «RENIPRESS (SUSALUD) · código 00001231 · categoría I-3». Vacía si el resultado no trae fuente (p. ej. un paradero).
   */
  function textoFuenteElemento(r) {
    const f = r && r.fuenteElemento;
    if (!f) return '';
    if (r.osmPrimaria) return textoFuenteComercio(r); // mercado, supermercado y mall: OpenStreetMap es la fuente, no un respaldo
    if (f === 'OSM') return `OpenStreetMap (respaldo: no hay un punto oficial cerca)${r.osm ? ` · ${r.osm}` : ''}`;
    const partes = [NOMBRE_FUENTE_ELEMENTO[f] || f];
    if (r.codigo) partes.push(f === 'ESCALE' ? `código modular ${r.codigo}` : `código ${r.codigo}`);
    if (r.categoria) partes.push(`categoría ${r.categoria}`);
    if (r.gestion) partes.push(String(r.gestion).toLowerCase());
    return partes.join(' · ');
  }

  // ---------------------------------------------------------- Consultorio médico

  /**
   * Una sola redacción de por qué el consultorio es informativo, para la ficha, el chat y el informe. No hay un umbral (decisión
   * pendiente): no se dice si el consultorio está cerca o lejos, no suma al puntaje y no cuenta como «salud cerca».
   */
  const NOTA_CONSULTORIO = 'Es informativo: el consultorio médico es una categoría aparte de los establecimientos de salud, no tiene una distancia de referencia (es una decisión pendiente), así que no se dice si está cerca o lejos, no suma al puntaje ni a la búsqueda de zonas y no cuenta como «salud cerca».';

  // ------------------------------------------------- Resultado de cada variable

  const SIN_NOMBRE = 'Sin nombre en OSM';

  /**
   * Establecimiento más cercano y veredicto contra el umbral (V2, V3 por nivel y V4).
   *   candidatos: [{ nombre, lat, lon, osm?, etiqueta?, fuente?, codigo?, categoria?, gestion? }]  (fuente = RENIPRESS | ESCALE | OSM, ver origenDe)
   *   opciones:   { umbralM, fuente, fecha, metodo, alcanceM? }
   * Devuelve { estado, nombre, distanciaM, umbralM, fuente, fecha, metodo, lat, lon, osm, etiqueta, fuenteElemento, codigo, categoria, gestion }
   * (`fuente` es la del archivo; `fuenteElemento` y `codigo`, la del establecimiento más cercano).
   *   CUMPLE      distancia ≤ umbral (inclusivo).
   *   NO CUMPLE   más lejos que el umbral; o, si la búsqueda cubrió un `alcanceM` mayor que el umbral y no halló nada,
   *               sin distancia (hay algo más allá del alcance, o nada).
   *   SIN DATO    no hay candidatos y no se sabe qué tanto se buscó.
   *   INFORMATIVO sin umbral (`umbralM` null): da el más cercano y su distancia, sin cumple / no cumple (p. ej. el consultorio médico).
   */
  function evaluarMasCercano(punto, candidatos, opciones) {
    const { fuente, fecha, metodo, alcanceM } = opciones;
    // Sin umbral (null) la variable es INFORMATIVA: se da el más cercano y su distancia, sin cumple / no cumple.
    const informativo = !esNumero(opciones.umbralM);
    const umbralM = informativo ? null : opciones.umbralM;
    const base = { umbralM, fuente, fecha, metodo };
    let mejor = null;
    let mejorD = Infinity;
    for (const c of candidatos || []) {
      if (!c || !esNumero(c.lat) || !esNumero(c.lon)) continue;
      const d = haversine(punto.lat, punto.lon, c.lat, c.lon);
      if (d < mejorD) { mejor = c; mejorD = d; }
    }
    if (!mejor) {
      const cubierto = !informativo && esNumero(alcanceM) && alcanceM >= umbralM;
      return { estado: cubierto ? 'NO CUMPLE' : 'SIN DATO', nombre: null, distanciaM: null, ...base, lat: null, lon: null, osm: null, etiqueta: null, fuenteElemento: null, codigo: null, categoria: null, gestion: null };
    }
    return {
      estado: informativo ? 'INFORMATIVO' : mejorD <= umbralM ? 'CUMPLE' : 'NO CUMPLE',
      nombre: mejor.nombre || SIN_NOMBRE,
      distanciaM: mejorD,
      ...base,
      lat: mejor.lat,
      lon: mejor.lon,
      osm: mejor.osm ?? null,
      etiqueta: mejor.etiqueta ?? null,
      fuenteElemento: mejor.fuente ?? null,
      codigo: mejor.codigo ?? null,
      categoria: mejor.categoria ?? null,
      gestion: mejor.gestion ?? null,
    };
  }

  // ----------------------------------------------- Comercio por NECESIDAD (mercados, supermercados y malls)

  /**
   * El comercio se organiza por lo que la persona necesita, no por la etiqueta de OpenStreetMap. Las tres necesidades son INFORMATIVAS (sin
   * umbral: ninguna norma peruana fija metros para un mercado o un mall) y no suman al puntaje ni a la búsqueda de zonas.
   *   abastecimiento   comida, a escala de barrio: mercados (amenity=marketplace) + supermercados (shop=supermarket). Un supermercado dentro del polígono
   *                    de un mall es el punto de abastecimiento; el mall, no.
   *   compras_ocio     compras y ocio, a escala metropolitana: SOLO los malls confirmados con su fuente (lista curada, propiedad `verificado`).
   *   comercio_barrio  el resto de lo que OSM etiqueta shop=mall (galerías y centros comerciales pequeños).
   * `capa` es el id de la capa del mapa; `capas`, los archivos de datos de donde sale.
   */
  const COMERCIO = {
    abastecimiento: {
      capa: 'abastecimiento', capas: ['mercados', 'supermercados'], escala: 'barrio', etiqueta: 'Abastecimiento (comida)',
      singular: 'punto de abastecimiento', plural: 'puntos de abastecimiento', corto: 'punto de abastecimiento', cortos: 'puntos de abastecimiento',
      alcance: 'Cuenta los mercados (amenity=marketplace) y los supermercados (shop=supermarket) de OpenStreetMap. Un supermercado dentro del polígono de un mall es el punto de abastecimiento: el mall no lo es.',
    },
    compras_ocio: {
      capa: 'compras_ocio', capas: ['malls'], escala: 'metropolitana', etiqueta: 'Compras y ocio',
      singular: 'mall confirmado', plural: 'malls confirmados', corto: 'mall', cortos: 'malls',
      alcance: 'Cuenta solo los malls confirmados con la fuente de cada uno (lista curada) y ubicados en OpenStreetMap; la distancia es al borde de su polígono. Un mall confirmado que OpenStreetMap no tiene no se mide.',
    },
    comercio_barrio: {
      capa: 'comercio_barrio', capas: ['malls'], escala: 'barrio', etiqueta: 'Comercio de barrio',
      singular: 'galería o centro comercial pequeño', plural: 'galerías y centros comerciales pequeños', corto: 'galería', cortos: 'galerías',
      alcance: 'Cuenta lo que OpenStreetMap etiqueta shop=mall (o terreno comercial con nombre de mall) y no está en la lista de malls confirmados: galerías y centros comerciales pequeños, que son comercio de barrio.',
    },
  };

  /** Las categorías de OSM de las que sale el comercio: nombre de cada una (el abastecimiento muestra el más cercano de mercado y de supermercado). */
  const COMERCIO_TIPO = {
    mercado: { capa: 'mercados', singular: 'mercado de abastos', plural: 'mercados de abastos', etiqueta: 'Mercado' },
    supermercado: { capa: 'supermercados', singular: 'supermercado', plural: 'supermercados', etiqueta: 'Supermercado' },
    mall: { capa: 'malls', singular: 'mall (centro comercial)', plural: 'malls (centros comerciales)', etiqueta: 'Mall' },
  };
  const TIPO_DE_CAPA = { mercados: 'mercado', supermercados: 'supermercado', malls: 'mall' };
  const CAPA_DE_TIPO = { mercado: 'mercados', supermercado: 'supermercados', mall: 'malls' };

  const NOTA_COMERCIO = 'Es informativo: el abastecimiento (mercados y supermercados), las compras y el ocio (malls) y el comercio de barrio (galerías) no tienen una distancia de referencia (es una decisión pendiente), así que no se dice si están cerca o lejos, no suman al puntaje ni a la búsqueda de zonas y no se elige un lugar por ellos.';

  /**
   * A qué necesidad pertenece un elemento de una capa de OSM (`capa`: mercados | supermercados | malls; `props`: sus propiedades): mercados y
   * supermercados son abastecimiento; un mall con `verificado` (lista curada, con su fuente) es compras_ocio y cualquier otro shop=mall, comercio_barrio.
   */
  function necesidadComercio(capa, props) {
    if (capa === 'mercados' || capa === 'supermercados') return 'abastecimiento';
    if (capa === 'malls') return props && props.verificado ? 'compras_ocio' : 'comercio_barrio';
    return null;
  }

  const posicionDe = (g) => (g.type === 'Point' ? { lat: g.coordinates[1], lon: g.coordinates[0] } : centroDe(g));

  /**
   * El mall (Feature con polígono) que contiene al punto { lat, lon }, o null. Un mall que es solo un punto no contiene nada. Si dos polígonos lo
   * contienen, gana el confirmado con su fuente.
   */
  function mallQueContiene(punto, malls) {
    let hallado = null;
    for (const m of malls || []) {
      const g = m && m.geometry;
      if (!g || g.type === 'Point' || !poligonosDe(g).some((anillos) => puntoEnPoligono(punto.lat, punto.lon, anillos))) continue;
      if (!hallado || (m.properties && m.properties.verificado && !(hallado.properties && hallado.properties.verificado))) hallado = m;
    }
    return hallado;
  }

  /**
   * Reparte los mercados, supermercados y malls (listas de Feature, como los archivos congelados) por necesidad: { abastecimiento, compras_ocio, comercio_barrio }.
   * Cada Feature conserva su geometría y sus propiedades (no se recorta ni se mueve nada) y suma `tipo` (mercado | supermercado | mall) y `necesidad`;
   * un supermercado suma además `dentro_de_mall`: { osm, nombre, verificado } del mall en cuyo polígono está su punto (el centro de la caja si es un
   * polígono), o null. Es la única definición del reparto: la usan la ficha, el mapa, el conteo por distrito, el chat y el informe.
   */
  function agruparComercio(entrada) {
    const e = entrada || {};
    const validos = (lista) => (lista || []).filter((f) => f && f.geometry);
    const malls = validos(e.malls);
    const grupos = { abastecimiento: [], compras_ocio: [], comercio_barrio: [] };
    for (const capa of ['mercados', 'supermercados', 'malls']) {
      for (const f of validos(e[capa])) {
        const necesidad = necesidadComercio(capa, f.properties);
        const extra = { tipo: TIPO_DE_CAPA[capa], necesidad };
        if (capa === 'supermercados') {
          const c = posicionDe(f.geometry);
          const m = c ? mallQueContiene(c, malls) : null;
          const mp = m && m.properties;
          extra.dentro_de_mall = m ? { osm: mp.osm ?? null, nombre: mp.nombre ?? null, verificado: Boolean(mp.verificado) } : null;
        }
        grupos[necesidad].push({ ...f, properties: { ...f.properties, ...extra } });
      }
    }
    return grupos;
  }

  /**
   * De dónde sale un mercado, supermercado o mall: OpenStreetMap es su fuente (no un respaldo) y, si el mall está en la lista curada,
   * la fuente que lo confirma. Acepta un resultado de evaluarMasCercanoForma o un elemento de las capas ({ osm, verificado }).
   */
  function textoFuenteComercio(r) {
    const partes = ['OpenStreetMap (ODbL)'];
    if (r && r.verificado) partes.push(`confirmado con ${r.verificado.nombre}: ${r.verificado.url}`);
    return partes.join(' · ');
  }

  /**
   * Como evaluarMasCercano, pero los candidatos son Features GeoJSON de punto o de polígono (Polygon / MultiPolygon): de un polígono
   * se mide la distancia al BORDE (0 si el punto está dentro), no al centro, para no «cortar» un mall o un mercado grande.
   *   features: [Feature { properties { nombre, osm?, fuente?, codigo?, verificado?, tags? }, geometry }]
   *   opciones: { umbralM, fuente, fecha, metodo, categoria? }   (sin umbral numérico → INFORMATIVO)
   * Devuelve { estado, nombre, distanciaM, umbralM, fuente, fecha, metodo, lat, lon, osm, etiqueta, fuenteElemento, codigo, forma, verificado, tipo, dentroDeMall }
   * (`lat` y `lon` ubican el marcador: el punto, o el centro de la caja del polígono; `forma` es el polígono, o null si es un punto;
   * `tipo` y `dentroDeMall` salen de agruparComercio: mercado | supermercado | mall, y el mall que contiene al supermercado).
   */
  function evaluarMasCercanoForma(punto, features, opciones) {
    const { fuente, fecha, metodo, categoria } = opciones;
    const informativo = !esNumero(opciones.umbralM);
    const umbralM = informativo ? null : opciones.umbralM;
    const base = { umbralM, fuente, fecha, metodo };
    let mejor = null;
    let mejorD = Infinity;
    for (const f of features || []) {
      const g = f && f.geometry;
      if (!g) continue;
      let d = Infinity;
      if (g.type === 'Point' && Array.isArray(g.coordinates) && esNumero(g.coordinates[0]) && esNumero(g.coordinates[1])) d = haversine(punto.lat, punto.lon, g.coordinates[1], g.coordinates[0]);
      else d = distanciaAGeometriaM(punto.lat, punto.lon, g);
      if (d < mejorD) { mejor = f; mejorD = d; }
    }
    if (!mejor) {
      return { estado: 'SIN DATO', nombre: null, distanciaM: null, ...base, lat: null, lon: null, osm: null, etiqueta: null, fuenteElemento: null, codigo: null, forma: null, verificado: null, tipo: null, dentroDeMall: null };
    }
    const p = mejor.properties || {};
    const g = mejor.geometry;
    const esPunto = g.type === 'Point';
    const c = esPunto ? { lat: g.coordinates[1], lon: g.coordinates[0] } : centroDe(g);
    return {
      estado: informativo ? 'INFORMATIVO' : mejorD <= umbralM ? 'CUMPLE' : 'NO CUMPLE',
      nombre: p.nombre || SIN_NOMBRE,
      distanciaM: mejorD,
      ...base,
      lat: c ? c.lat : null,
      lon: c ? c.lon : null,
      osm: p.osm ?? null,
      etiqueta: categoria || CAPA_DE_TIPO[p.tipo] ? etiquetaDe(p.tags, categoria || CAPA_DE_TIPO[p.tipo]) : null,
      fuenteElemento: p.fuente ?? null,
      osmPrimaria: p.fuente === 'OSM' || p.fuente === undefined,
      codigo: p.codigo ?? null,
      forma: esPunto ? null : g,
      verificado: p.verificado ?? null,
      tipo: p.tipo ?? null,
      dentroDeMall: p.dentro_de_mall ?? null,
    };
  }

  /**
   * V5 Área verde: CUMPLE si hay un polígono de ≥ areaMinM2 a ≤ distanciaMaxM del punto (0 si el punto está dentro).
   * Indicador básico de la OMS Europa (2016): un espacio verde de al menos 0,5 ha a 300 m.
   *   parques: [Feature con geometría Polygon/MultiPolygon y properties { nombre, osm?, tags? }]
   *   opciones: { areaMinM2, distanciaMaxM, areaGrandeM2, fuente, fecha, metodo }
   * Informa además, como sensibilidad, si hay uno de ≥ areaGrandeM2 (1 ha) dentro de la misma distancia.
   * Devuelve { estado, nombre, distanciaM, umbralM, areaM2, cumple1ha, nombre1ha, distancia1haM, fuente, fecha, metodo, lat, lon, forma }.
   */
  function evaluarAreaVerde(punto, parques, opciones) {
    const { areaMinM2, distanciaMaxM, areaGrandeM2, fuente, fecha, metodo } = opciones;
    const base = { umbralM: distanciaMaxM, fuente, fecha, metodo };
    const medidos = (parques || [])
      .map((f) => ({
        f,
        areaM2: areaGeometriaM2(f.geometry),
        distanciaM: distanciaAGeometriaM(punto.lat, punto.lon, f.geometry),
      }))
      .filter((m) => Number.isFinite(m.distanciaM));
    if (medidos.length === 0) {
      return { estado: 'SIN DATO', nombre: null, distanciaM: null, areaM2: null, cumple1ha: false, nombre1ha: null, distancia1haM: null, ...base, lat: null, lon: null, forma: null };
    }
    const masCercano = (lista) => lista.reduce((a, b) => (b.distanciaM < a.distanciaM ? b : a), lista[0]);
    const califican = medidos.filter((m) => m.areaM2 >= areaMinM2);
    const grandes = califican.filter((m) => m.areaM2 >= areaGrandeM2 && m.distanciaM <= distanciaMaxM);
    const g = grandes.length ? masCercano(grandes) : null;
    const sens = {
      cumple1ha: grandes.length > 0,
      nombre1ha: g ? g.f.properties?.nombre || SIN_NOMBRE : null,
      distancia1haM: g ? g.distanciaM : null,
    };
    if (califican.length === 0) {
      return { estado: 'NO CUMPLE', nombre: null, distanciaM: null, areaM2: null, ...sens, ...base, lat: null, lon: null, forma: null };
    }
    const dentro = califican.filter((m) => m.distanciaM <= distanciaMaxM);
    const elegido = masCercano(dentro.length ? dentro : califican);
    const c = centroDe(elegido.f.geometry);
    return {
      estado: dentro.length ? 'CUMPLE' : 'NO CUMPLE',
      nombre: elegido.f.properties?.nombre || SIN_NOMBRE,
      distanciaM: elegido.distanciaM,
      areaM2: elegido.areaM2,
      ...sens,
      ...base,
      lat: c ? c.lat : null,
      lon: c ? c.lon : null,
      osm: elegido.f.properties?.osm ?? null,
      forma: elegido.f.geometry,
    };
  }

  // ----------------------------------------------------------- Zonificación

  const M_POR_GRADO = (Math.PI / 180) * R;

  /**
   * V1a Alerta de borde: ¿hay un polígono de OTRA zona a ≤ umbralM del punto?
   *   zonas: [{ codigo, polys, bbox? }] con polys = lista de polígonos (cada uno, lista de anillos [lon, lat]).
   *   codigoActual: código de la zona que contiene al punto (null si cae fuera del plano → sin alerta).
   * Devuelve { alerta, codigo, distanciaM, umbralM } con la zona vecina más cercana si hay alerta.
   */
  function alertaBorde(punto, zonas, codigoActual, umbralM) {
    const sinAlerta = { alerta: false, codigo: null, distanciaM: null, umbralM };
    if (codigoActual === null || codigoActual === undefined) return sinAlerta;
    const margenLat = umbralM / M_POR_GRADO;
    const margenLon = margenLat / Math.max(0.01, Math.cos(rad(punto.lat)));
    let mejor = null;
    for (const z of zonas || []) {
      if (z.codigo === codigoActual) continue;
      if (z.bbox) {
        const b = z.bbox; // oeste, sur, este, norte
        if (punto.lon < b[0] - margenLon || punto.lon > b[2] + margenLon || punto.lat < b[1] - margenLat || punto.lat > b[3] + margenLat) continue;
      }
      for (const anillos of z.polys) {
        const d = distanciaAPoligonoM(punto.lat, punto.lon, anillos);
        if (d <= umbralM && (!mejor || d < mejor.distanciaM)) mejor = { alerta: true, codigo: z.codigo, distanciaM: d, umbralM };
      }
    }
    return mejor || sinAlerta;
  }

  /**
   * V1b Aviso del PDM proyectado: solo texto, y solo si CONFIG.estadoPDM trae fuente y fecha (sin ellas el aviso
   * no tendría con qué respaldarse y no se muestra). Devuelve { texto, fuente, fecha, url } o null.
   */
  function avisoPDMProyectado(estado) {
    if (!estado) return null;
    const lleno = (v) => typeof v === 'string' && v.trim() !== '';
    if (!lleno(estado.fuente) || !lleno(estado.fecha) || !lleno(estado.texto)) return null;
    return { texto: estado.texto, fuente: estado.fuente, fecha: estado.fecha, url: lleno(estado.url) ? estado.url : null };
  }

  // ----------------------------------------------- Quebradas y cauces (ANA)

  /**
   * Estado de la cercanía a un cauce. NO existe un umbral normativo para esta distancia: sin un umbral que la persona
   * fije, el estado es INFORMATIVO (solo se muestran la distancia y el nombre). Con su umbral (distancia MÍNIMA a la que
   * quiere estar de un cauce) pasa a CUMPLE o NO CUMPLE, y la vista lo rotula «según tu umbral».
   */
  function clasificarCauce(distanciaM, umbralUsuarioM) {
    if (!esNumero(distanciaM)) return 'SIN DATO';
    if (!esNumero(umbralUsuarioM) || umbralUsuarioM <= 0) return 'INFORMATIVO';
    return distanciaM >= umbralUsuarioM ? 'CUMPLE' : 'NO CUMPLE';
  }

  // Cómo se nombra cada fuente de cauces: «sin nombre en la ANA», y el nombre corto que acompaña a una cifra.
  const FUENTES_CAUCE = {
    ANA: { corta: 'ANA', sinNombre: 'Sin nombre en la ANA' },
    IGP: { corta: 'IGP', sinNombre: 'Sin nombre en el IGP' },
    OSM: { corta: 'OpenStreetMap', sinNombre: 'Sin nombre en OpenStreetMap' },
  };
  const fuenteCauce = (id) => FUENTES_CAUCE[id] || FUENTES_CAUCE.ANA;

  /**
   * Cauce más cercano al punto.
   *   cauces:   [{ nombre, tipo, categoria, fuente: 'ANA' | 'IGP' | 'OSM', alias?, geometry }]   (geometry LineString o MultiLineString)
   *   opciones: { umbralUsuarioM?, fuente, fecha, metodo }
   * Sin cauces (archivo ausente o vacío) devuelve SIN DATO: que no haya datos no significa que no haya cauce.
   * El resultado dice de qué fuente es el cauce (`fuenteId` y `fuenteCorta`): sin fuente, se supone la ANA.
   */
  function evaluarCauces(punto, cauces, opciones = {}) {
    const { umbralUsuarioM = null, fuente = null, fecha = null, metodo = null } = opciones;
    const umbral = esNumero(umbralUsuarioM) && umbralUsuarioM > 0 ? umbralUsuarioM : null;
    let mejor = null;
    let mejorD = Infinity;
    for (const c of cauces || []) {
      const d = c ? distanciaAGeometriaLineaM(punto.lat, punto.lon, c.geometry) : Infinity;
      if (d < mejorD) { mejor = c; mejorD = d; }
    }
    const base = { umbralM: umbral, segunUmbralUsuario: umbral !== null, fuente, fecha, metodo };
    if (!mejor) return { estado: 'SIN DATO', nombre: null, tipo: null, categoria: null, fuenteId: null, fuenteCorta: null, alias: [], distanciaM: null, ...base };
    const f = fuenteCauce(mejor.fuente);
    return {
      estado: clasificarCauce(mejorD, umbral),
      nombre: mejor.nombre || f.sinNombre,
      tipo: mejor.tipo || null,
      categoria: mejor.categoria || null,
      fuenteId: mejor.fuente || 'ANA',
      fuenteCorta: f.corta,
      alias: Array.isArray(mejor.alias) ? mejor.alias : [],
      distanciaM: mejorD,
      ...base,
    };
  }

  // Quebradas que se mencionan en los datos pero no figuran como cauce: se calculan, no se escriben a mano.
  const sinTildesQ = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const PALABRAS_VACIAS_Q = new Set(['quebrada', 'qda', 'torrentera', 'rio', 'av', 'cuesta', 'el', 'la', 'las', 'los', 'de', 'del']);
  const claveQuebrada = (n) => sinTildesQ(n).replace(/[^a-zñ ]/g, ' ').split(/\s+/).filter((w) => w && !PALABRAS_VACIAS_Q.has(w)).join(' ');
  const mayusculaInicial = (t) => t.replace(/(^|\s)(\S)/g, (_, e, c) => e + c.toUpperCase());

  /**
   * Quebradas nombradas en textos libres (el campo `sector` del inventario de INGEMMET: «Quebrada San Lazaro (margen
   * izquierda)», «TORRENTERA SAN LAZARO», «Qda. Matagente - Charcani»). Cuenta en cuántos textos aparece cada nombre y deja
   * los que aparecen en `minRegistros` o más. Devuelve [{ nombre, clave, registros }] de más a menos mencionadas.
   */
  function quebradasMencionadas(textos, { minRegistros = 2 } = {}) {
    const cuenta = new Map();
    const RX = /\b(?:quebrada|qda\.?|torrentera)\s+((?:(?:de|del|la|las|los|el)\s+)*[a-zñ]+(?:\s+(?!(?:margen|tramo|afluente|sector|zona|de|del|y)\b)[a-zñ]+)?)/gi;
    for (const t of textos || []) {
      if (typeof t !== 'string') continue;
      const norm = sinTildesQ(t);
      const vistos = new Set();
      let m;
      RX.lastIndex = 0;
      while ((m = RX.exec(norm))) {
        const original = t.slice(m.index + m[0].length - m[1].length, m.index + m[0].length).trim();
        const clave = claveQuebrada(original);
        if (clave.length < 4 || vistos.has(clave)) continue;
        vistos.add(clave);
        const previo = cuenta.get(clave) || { nombre: mayusculaInicial(original.toLowerCase()), clave, registros: 0 };
        previo.registros++;
        cuenta.set(clave, previo);
      }
    }
    return [...cuenta.values()].filter((x) => x.registros >= minRegistros).sort((a, b) => b.registros - a.registros || a.clave.localeCompare(b.clave));
  }

  /**
   * Cuáles de las quebradas conocidas NO figuran entre los nombres de los cauces (nombres y alias).
   *   mencionadas: de quebradasMencionadas; citadas: nombres que citan los informes (se suman, con registros 0 si no figuran).
   * Una quebrada figura si su clave coincide con la de algún cauce (o una contiene a la otra, si tiene 5 letras o más).
   * Devuelve { ausentes: [{ nombre, registros }], presentes: [nombre] }, ausentes de más a menos mencionadas.
   */
  function quebradasAusentes({ mencionadas = [], citadas = [], nombresCauces = [], maximo = 8 } = {}) {
    const claves = (nombresCauces || []).map(claveQuebrada).filter(Boolean);
    const figura = (clave) => claves.some((c) => c === clave || (clave.length >= 5 && (c.includes(clave) || (c.length >= 5 && clave.includes(c)))));
    const todas = new Map();
    for (const m of mencionadas) todas.set(m.clave || claveQuebrada(m.nombre), { nombre: m.nombre, registros: m.registros || 0 });
    for (const n of citadas) { const k = claveQuebrada(n); if (k && !todas.has(k)) todas.set(k, { nombre: n, registros: 0 }); }
    const presentes = [];
    const ausentes = [];
    for (const [k, v] of todas) (figura(k) ? presentes : ausentes).push(v);
    ausentes.sort((a, b) => b.registros - a.registros || a.nombre.localeCompare(b.nombre, 'es'));
    return { ausentes: ausentes.slice(0, maximo), presentes: presentes.map((v) => v.nombre), total: ausentes.length };
  }

  /** Nombre corto de una fuente de cauces (`{ id }` o el id): «ANA», «IGP», «OpenStreetMap». */
  function nombreFuenteCauce(f) {
    return fuenteCauce(f && typeof f === 'object' ? f.id : f).corta;
  }

  /** «ANA (14 tramos), IGP (231 tramos) y OpenStreetMap (20 tramos)»: de dónde salen los cauces del archivo. */
  function textoFuentesCauces(fuentes) {
    if (!Array.isArray(fuentes) || fuentes.length === 0) return 'la ANA';
    const partes = (fuentes || [])
      .filter((f) => f && esNumero(f.registros) && f.registros > 0)
      .map((f) => `${fuenteCauce(f.id).corta} (${f.registros} ${f.registros === 1 ? 'tramo' : 'tramos'})`);
    if (partes.length <= 1) return partes.join('');
    return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  }

  /**
   * Las quebradas conocidas que todavía no están en el archivo, para «Qué no cubre» (null si no hay ninguna que decir):
   * «Cabreria (10 registros de INGEMMET), Pajonal (4 registros de INGEMMET)».
   */
  function textoQuebradasAusentes(ausentes) {
    const lista = (ausentes || []).filter((a) => a && a.nombre);
    if (lista.length === 0) return null;
    return lista.map((a) => (a.registros > 0 ? `${a.nombre} (${a.registros} ${a.registros === 1 ? 'registro' : 'registros'} de INGEMMET)` : `${a.nombre} (la citan los informes de INGEMMET)`)).join(', ');
  }

  // ------------------------------------------------------ Contexto de riesgo

  /**
   * Cuántos elementos (con lat y lon) hay a `radioM` metros o menos del punto, y el más cercano de todos.
   * Devuelve { total, masCercano: { …elemento, distanciaM } | null }.
   */
  function resumirCercanos(punto, elementos, radioM) {
    let total = 0;
    let masCercano = null;
    for (const e of elementos || []) {
      if (!e || !esNumero(e.lat) || !esNumero(e.lon)) continue;
      const d = haversine(punto.lat, punto.lon, e.lat, e.lon);
      if (d <= radioM) total++;
      if (!masCercano || d < masCercano.distanciaM) masCercano = { ...e, distanciaM: d };
    }
    return { total, masCercano };
  }

  /**
   * Sismos reportados dentro de un radio: cuántos, magnitud máxima y fecha del más reciente (solo entre los del radio).
   * Es contexto de actividad reciente: ni predicción ni zona sísmica oficial.
   *   sismos: [{ lat, lon, magnitud, fecha: 'AAAA-MM-DD' }]
   */
  function resumirSismos(punto, sismos, { radioM = 0 } = {}) {
    let total = 0;
    let magnitudMaxima = null;
    let masReciente = null;
    let masCercano = null;
    for (const s of sismos || []) {
      if (!s || !esNumero(s.lat) || !esNumero(s.lon)) continue;
      const d = haversine(punto.lat, punto.lon, s.lat, s.lon);
      if (d > radioM) continue;
      total++;
      if (esNumero(s.magnitud) && (magnitudMaxima === null || s.magnitud > magnitudMaxima)) magnitudMaxima = s.magnitud;
      if (typeof s.fecha === 'string' && (masReciente === null || s.fecha > masReciente)) masReciente = s.fecha;
      if (!masCercano || d < masCercano.distanciaM) masCercano = { ...s, distanciaM: d };
    }
    return { total, magnitudMaxima, masReciente, masCercano };
  }

  // --------------------------------------------------- Módulos fuera de alcance

  const MODULOS_RECORTADOS = ['seguridad', 'desastre', 'riesgos', 'sismica'];

  /**
   * Módulos visibles: CONFIG.modulos (los recortados valen false si no se indican) y, con `?modulos=todos` en la URL,
   * todos. El código de los módulos recortados no se borra: solo se ocultan.
   */
  function modulosEfectivos(modulos, search) {
    const todos = new URLSearchParams(search || '').get('modulos') === 'todos';
    const out = {};
    MODULOS_RECORTADOS.forEach((m) => { out[m] = todos ? true : Boolean(modulos && modulos[m]); });
    return out;
  }

  // ------------------------------------------------------ Overpass → GeoJSON

  const redondear = (n, dec) => Math.round(n * 10 ** dec) / 10 ** dec;
  const par = (p, dec) => [redondear(p.lon, dec), redondear(p.lat, dec)];
  const llave = (c) => `${c[0]},${c[1]}`;

  // Une tramos (listas de coordenadas) extremo con extremo hasta cerrar anillos. Devuelve { anillos, abiertos }.
  function ensamblarAnillos(tramos) {
    const pendientes = tramos.filter((t) => t.length >= 2).map((t) => t.slice());
    const anillos = [];
    let abiertos = 0;
    while (pendientes.length) {
      let actual = pendientes.shift();
      let avanzo = true;
      while (avanzo && llave(actual[0]) !== llave(actual[actual.length - 1])) {
        avanzo = false;
        const fin = llave(actual[actual.length - 1]);
        for (let i = 0; i < pendientes.length; i++) {
          const t = pendientes[i];
          if (llave(t[0]) === fin) { actual = actual.concat(t.slice(1)); pendientes.splice(i, 1); avanzo = true; break; }
          if (llave(t[t.length - 1]) === fin) { actual = actual.concat(t.slice(0, -1).reverse()); pendientes.splice(i, 1); avanzo = true; break; }
        }
      }
      if (llave(actual[0]) === llave(actual[actual.length - 1]) && actual.length >= 4) anillos.push(actual);
      else abiertos++;
    }
    return { anillos, abiertos };
  }

  function geometriaDeRelacion(el, dec) {
    const tramos = (rol) => (el.members || [])
      .filter((m) => m.type === 'way' && Array.isArray(m.geometry) && (m.role === rol || (rol === 'outer' && m.role === '')))
      .map((m) => m.geometry.filter(Boolean).map((p) => par(p, dec)));
    const ext = ensamblarAnillos(tramos('outer'));
    const int = ensamblarAnillos(tramos('inner'));
    if (ext.abiertos > 0 || ext.anillos.length === 0) return null; // un exterior sin cerrar daría un área errónea
    const poligonos = ext.anillos.map((a) => [a]);
    int.anillos.forEach((h) => {
      const dueno = poligonos.find((p) => dentroDeAnillo(h[0][0], h[0][1], p[0]));
      if (dueno) dueno.push(h);
    });
    return poligonos.length === 1 ? { type: 'Polygon', coordinates: poligonos[0] } : { type: 'MultiPolygon', coordinates: poligonos };
  }

  /**
   * Convierte elementos de Overpass a Features de GeoJSON, conservando solo el nombre y las etiquetas necesarias.
   *   modo 'puntos':    nodo → su posición; vía o relación → su `center` (consulta con `out center`).
   *   modo 'poligonos': vía cerrada → Polygon; relación multipolígono → Polygon/MultiPolygon (consulta con `out geom`).
   * Los elementos sin geometría utilizable se omiten.
   */
  function osmAFeatures(elementos, modo, decimales = 5) {
    const out = [];
    for (const el of elementos || []) {
      if (!el.tags) continue;
      let geometry = null;
      if (modo === 'puntos') {
        const c = el.type === 'node' ? el : el.center;
        if (c && esNumero(c.lat) && esNumero(c.lon)) geometry = { type: 'Point', coordinates: par(c, decimales) };
      } else if (el.type === 'way' && Array.isArray(el.geometry)) {
        const anillo = el.geometry.filter(Boolean).map((p) => par(p, decimales));
        if (anillo.length >= 4 && llave(anillo[0]) === llave(anillo[anillo.length - 1])) geometry = { type: 'Polygon', coordinates: [anillo] };
      } else if (el.type === 'relation') {
        geometry = geometriaDeRelacion(el, decimales);
      }
      if (!geometry) continue;
      const tags = {};
      ETIQUETAS_GUARDADAS.forEach((k) => { if (el.tags[k] !== undefined) tags[k] = el.tags[k]; });
      out.push({
        type: 'Feature',
        properties: { osm: `${el.type}/${el.id}`, nombre: el.tags.name || el.tags['name:es'] || el.tags.official_name || null, tags },
        geometry,
      });
    }
    return out;
  }

  return {
    RADIO_TIERRA_M: R,
    FILTROS,
    haversine,
    puntoEnPoligono,
    distanciaAPoligonoM,
    distanciaAGeometriaM,
    distanciaALineaM,
    distanciaAGeometriaLineaM,
    clasificarCauce,
    evaluarCauces,
    quebradasMencionadas,
    quebradasAusentes,
    textoFuentesCauces,
    nombreFuenteCauce,
    textoQuebradasAusentes,
    resumirCercanos,
    resumirSismos,
    areaAnilloM2,
    areaPoligonoM2,
    areaGeometriaM2,
    centroDe,
    categoriasDe,
    categoriaSalud,
    etiquetaDe,
    selectoresOverpass,
    nivelesEducativos,
    evaluarMasCercano,
    evaluarAreaVerde,
    alertaBorde,
    avisoPDMProyectado,
    modulosEfectivos,
    osmAFeatures,
    esDental,
    FUENTES_ELEMENTO,
    fuenteDe,
    nivelesDe,
    origenDe,
    etiquetaElemento,
    textoFuenteElemento,
    NOTA_CONSULTORIO,
    NOTA_COMERCIO,
    COMERCIO,
    COMERCIO_TIPO,
    necesidadComercio,
    mallQueContiene,
    agruparComercio,
    textoFuenteComercio,
    evaluarMasCercanoForma,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Calculos;
