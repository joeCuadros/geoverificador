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
  const FILTROS = {
    salud: [
      { clave: 'amenity', valores: ['hospital', 'clinic', 'doctors'] },
      // healthcare=* salvo lo que no es un centro de atención general: farmacia, óptica, medicina alternativa, banco de
      // sangre, laboratorio y consultas de una sola especialidad paramédica u odontológica.
      {
        clave: 'healthcare',
        excluir: [
          'pharmacy', 'optometrist', 'alternative', 'blood_donation', 'laboratory', 'sample_collection', 'dentist',
          'physiotherapist', 'occupational_therapist', 'psychotherapist', 'speech_therapist', 'audiologist', 'podiatrist',
        ],
      },
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
    'amenity', 'healthcare', 'isced:level', 'school', 'leisure', 'landuse', 'highway', 'public_transport',
  ];

  function coincide(tags, filtro) {
    const v = tags[filtro.clave];
    if (v === undefined) return false;
    if (filtro.valores) return filtro.valores.includes(v);
    return !(filtro.excluir || []).includes(v);
  }

  /** Variables a las que pertenece un elemento según sus etiquetas ([] si a ninguna). */
  function categoriasDe(tags) {
    const t = tags || {};
    return Object.keys(FILTROS).filter((cat) => FILTROS[cat].some((f) => coincide(t, f)));
  }

  /** Selectores de Overpass QL de una variable, p. ej. ["amenity"~"^(hospital|clinic)$"]. */
  function selectoresOverpass(categoria) {
    return FILTROS[categoria].map((f) => {
      if (f.valores) return f.valores.length === 1 ? `["${f.clave}"="${f.valores[0]}"]` : `["${f.clave}"~"^(${f.valores.join('|')})$"]`;
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

  // ------------------------------------------------- Resultado de cada variable

  const SIN_NOMBRE = 'Sin nombre en OSM';

  /**
   * Establecimiento más cercano y veredicto contra el umbral (V2, V3 por nivel y V4).
   *   candidatos: [{ nombre, lat, lon, osm?, etiqueta? }]
   *   opciones:   { umbralM, fuente, fecha, metodo, alcanceM? }
   * Devuelve { estado, nombre, distanciaM, umbralM, fuente, fecha, metodo, lat, lon, osm, etiqueta }.
   *   CUMPLE      distancia ≤ umbral (inclusivo).
   *   NO CUMPLE   más lejos que el umbral; o, si la búsqueda cubrió un `alcanceM` mayor que el umbral y no halló nada,
   *               sin distancia (hay algo más allá del alcance, o nada).
   *   SIN DATO    no hay candidatos y no se sabe qué tanto se buscó.
   */
  function evaluarMasCercano(punto, candidatos, opciones) {
    const { umbralM, fuente, fecha, metodo, alcanceM } = opciones;
    const base = { umbralM, fuente, fecha, metodo };
    let mejor = null;
    let mejorD = Infinity;
    for (const c of candidatos || []) {
      if (!c || !esNumero(c.lat) || !esNumero(c.lon)) continue;
      const d = haversine(punto.lat, punto.lon, c.lat, c.lon);
      if (d < mejorD) { mejor = c; mejorD = d; }
    }
    if (!mejor) {
      const cubierto = esNumero(alcanceM) && alcanceM >= umbralM;
      return { estado: cubierto ? 'NO CUMPLE' : 'SIN DATO', nombre: null, distanciaM: null, ...base, lat: null, lon: null, osm: null, etiqueta: null };
    }
    return {
      estado: mejorD <= umbralM ? 'CUMPLE' : 'NO CUMPLE',
      nombre: mejor.nombre || SIN_NOMBRE,
      distanciaM: mejorD,
      ...base,
      lat: mejor.lat,
      lon: mejor.lon,
      osm: mejor.osm ?? null,
      etiqueta: mejor.etiqueta ?? null,
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
    areaAnilloM2,
    areaPoligonoM2,
    areaGeometriaM2,
    centroDe,
    categoriasDe,
    selectoresOverpass,
    nivelesEducativos,
    evaluarMasCercano,
    evaluarAreaVerde,
    alertaBorde,
    avisoPDMProyectado,
    modulosEfectivos,
    osmAFeatures,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Calculos;
