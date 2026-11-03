/**
 * distritos.js — Distrito del punto y su zona sísmica según la Norma E.030.
 *
 * Fuentes (archivos locales):
 *   - data/distritos_aqp.geojson      → límites distritales (GEOCATMIN, con límites remitidos por el INEI),
 *                                       generado con scripts/descargar-distritos.mjs.
 *   - data/zonas_sismicas_e030.json   → Anexo II y Tabla N.° 1 de la Norma E.030 Diseño Sismorresistente 2026 (MVCS).
 *
 * La zona sísmica es regional (por distrito): no considera el suelo del predio. El efecto del suelo lo determina el
 * Estudio de Mecánica de Suelos que la propia E.030 exige a todo proyecto de edificación (Art. 16.1).
 * No hay datos simulados: si un archivo falta, se lanza un error con la causa.
 */
const Distritos = (() => {
  let ready = null;
  let index = []; // [{ props, bbox, polys }]
  let e030 = null;

  async function loadJson(url, nombre) {
    let res;
    try {
      res = await fetch(url);
    } catch (_) {
      throw new Error(`No se pudo leer ${nombre} (${url}).`);
    }
    if (!res.ok) throw new Error(`No se encontró ${nombre}: ${url} respondió HTTP ${res.status}.`);
    return res.json();
  }

  const polygonsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

  function bboxOf(polys) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    polys.forEach((rings) => (rings[0] || []).forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }));
    return b;
  }

  // Ray casting; dentro del anillo exterior y fuera de los huecos.
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inPolygon = (x, y, rings) => rings.length > 0 && inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));

  const indexar = (fc) => fc.features.map((f) => {
    const polys = polygonsOf(f.geometry);
    return { props: f.properties || {}, polys, bbox: bboxOf(polys), geometry: f.geometry };
  });

  /** Carga ambos archivos (una sola vez). Si falla, la siguiente llamada lo reintenta. */
  function load() {
    if (!ready) {
      ready = (async () => {
        const cfg = CONFIG.distritos;
        const [fc, tabla] = await Promise.all([loadJson(cfg.geojsonUrl, 'los límites distritales'), loadJson(cfg.e030Url, 'la tabla de la Norma E.030')]);
        if (!fc || !Array.isArray(fc.features)) throw new Error('El archivo de distritos no es un GeoJSON válido.');
        index = indexar(fc);
        e030 = tabla;
        return { distritos: index.length };
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  /**
   * Distrito y zona sísmica del punto, o null si cae fuera de los distritos descargados.
   * Devuelve { distrito, provincia, ubigeo, fuenteLimite, zona, z, norma, definicionZ }; zona es null si el distrito
   * no figura en la transcripción del Anexo II (no debería pasar: el script de descarga lo impide).
   */
  async function lookup(lat, lon) {
    await load();
    const hit = index.find((d) => {
      const b = d.bbox;
      return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && d.polys.some((rings) => inPolygon(lon, lat, rings));
    });
    if (!hit) return null;
    const p = hit.props;
    const zona = e030.anexo_ii?.[p.departamento]?.[p.provincia]?.[p.distrito] ?? null;
    return {
      distrito: p.distrito,
      provincia: p.provincia,
      ubigeo: p.ubigeo,
      fuenteLimite: p.fuente_limite,
      zona,
      z: zona ? e030.z[String(zona)] : null,
      norma: e030.norma,
      definicionZ: e030.definicion_z,
    };
  }

  /** Nombre del distrito que contiene el punto, sin esperar (hay que haber llamado antes a `load`). null si no hay. */
  function nombreDe(lat, lon) {
    const hit = index.find((d) => {
      const b = d.bbox;
      return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && d.polys.some((rings) => inPolygon(lon, lat, rings));
    });
    return hit ? hit.props.distrito : null;
  }

  // ------------------------------------------------------- Los distritos como concepto propio

  /** Distritos de la provincia de Arequipa que figuran en el Anexo II de la E.030 pero que NO están en el archivo de límites. */
  const SIN_DATOS = ['VITOR', 'SAN JUAN DE SIGUAS', 'SANTA ISABEL DE SIGUAS', 'SANTA RITA DE SIGUAS'];

  const BONITOS = {
    'JOSE LUIS BUSTAMANTE Y RIVERO': 'José Luis Bustamante y Rivero',
    SABANDIA: 'Sabandía',
    VITOR: 'Vítor',
    'LA JOYA': 'La Joya',
    'SAN JUAN DE TARUCANI': 'San Juan de Tarucani',
    'SAN JUAN DE SIGUAS': 'San Juan de Siguas',
    'SANTA ISABEL DE SIGUAS': 'Santa Isabel de Siguas',
    'SANTA RITA DE SIGUAS': 'Santa Rita de Siguas',
  };

  /** «PAUCARPATA» → «Paucarpata»; «JOSE LUIS BUSTAMANTE Y RIVERO» → «José Luis Bustamante y Rivero». */
  function titulo(nombre) {
    const n = String(nombre ?? '').toUpperCase();
    if (BONITOS[n]) return BONITOS[n];
    return n.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\b(Y|De|Del|La)\b/g, (m) => m.toLowerCase());
  }

  const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const compacto = (s) => sinTildes(s).replace(/[^a-z0-9]/g, '');

  // Nombres de la provincia (E.030, Anexo II). «Arequipa» a secas es la ciudad: el distrito se pide con «cercado» o «distrito de Arequipa».
  const NOMBRES = [
    'ALTO SELVA ALEGRE', 'CAYMA', 'CERRO COLORADO', 'CHARACATO', 'CHIGUATA', 'JACOBO HUNTER', 'JOSE LUIS BUSTAMANTE Y RIVERO',
    'MARIANO MELGAR', 'MIRAFLORES', 'MOLLEBAYA', 'PAUCARPATA', 'POCSI', 'QUEQUEÑA', 'SABANDIA', 'SACHACA', 'SAN JUAN DE TARUCANI',
    'SOCABAYA', 'TIABAYA', 'YANAHUARA', 'YURA', 'LA JOYA', 'POLOBAYA', 'UCHUMAYO', 'YARABAMBA', ...SIN_DATOS,
  ];
  // Apodos y siglas: solo coinciden tal cual (un error de tipeo en «cercado» lo confundiría con «cercano»).
  const ALIAS = {
    jlbyr: 'JOSE LUIS BUSTAMANTE Y RIVERO', jlb: 'JOSE LUIS BUSTAMANTE Y RIVERO', 'jose luis bustamante': 'JOSE LUIS BUSTAMANTE Y RIVERO',
    'bustamante y rivero': 'JOSE LUIS BUSTAMANTE Y RIVERO', 'selva alegre': 'ALTO SELVA ALEGRE', hunter: 'JACOBO HUNTER', melgar: 'MARIANO MELGAR',
    tarucani: 'SAN JUAN DE TARUCANI', cercado: 'AREQUIPA', 'cercado de arequipa': 'AREQUIPA', 'distrito de arequipa': 'AREQUIPA', 'distrito arequipa': 'AREQUIPA',
  };
  const ALIAS_APROX = { bustamante: 'JOSE LUIS BUSTAMANTE Y RIVERO' }; // largo y sin parecido con otras palabras: admite un tipeo

  function distanciaEdicion(a, b, tope) {
    if (Math.abs(a.length - b.length) > tope) return tope + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
      const cur = [i];
      let minimo = i;
      for (let j = 1; j <= b.length; j += 1) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < minimo) minimo = cur[j];
      }
      if (minimo > tope) return tope + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /** Errores de tipeo que se aceptan según el largo del nombre (los cortos exigen coincidencia exacta). */
  const toleranciaDe = (largo) => (largo <= 5 ? 0 : largo <= 8 ? 1 : largo <= 11 ? 2 : 3);

  function resultado(distrito, escrito) {
    const enDatos = index.length > 0 ? index.some((d) => d.props.distrito === distrito) : !SIN_DATOS.includes(distrito);
    return { distrito, enDatos, escrito };
  }

  /**
   * Busca un distrito de la provincia de Arequipa en un texto (un nombre suelto o una frase entera), sin importar tildes,
   * mayúsculas ni errores de tipeo razonables. Devuelve { distrito, enDatos, escrito } o null. `enDatos` es false si el
   * distrito existe en la provincia pero el archivo de límites no lo trae (Vítor y los de Siguas).
   *   opciones.admitirCiudad: acepta «Arequipa» sola como el distrito (para un nombre ya aislado, no para una frase).
   */
  function buscarNombre(texto, opciones = {}) {
    const palabras = sinTildes(texto).replace(/[^a-z0-9ñ]+/g, ' ').trim().split(' ').filter(Boolean);
    if (palabras.length === 0) return null;
    if (opciones.admitirCiudad && palabras.length === 1 && palabras[0] === 'arequipa') return resultado('AREQUIPA', 'arequipa');
    let mejor = null;
    const proponer = (n, d, inicio, largo) => {
      if (!mejor || inicio < mejor.inicio || (inicio === mejor.inicio && (d < mejor.d || (d === mejor.d && largo > mejor.largo)))) mejor = { n, d, inicio, largo };
    };
    for (let i = 0; i < palabras.length; i += 1) {
      for (let k = 1; k <= 4 && i + k <= palabras.length; k += 1) {
        const ventana = palabras.slice(i, i + k);
        const junto = ventana.join('');
        if (ALIAS[ventana.join(' ')]) proponer(ALIAS[ventana.join(' ')], 0, i, k);
        Object.entries(ALIAS_APROX).forEach(([alias, nombre]) => {
          const tol = toleranciaDe(alias.length);
          if (junto[0] !== alias[0]) return;
          const d = distanciaEdicion(junto, alias, tol);
          if (d <= tol) proponer(nombre, d, i, k);
        });
        NOMBRES.forEach((n) => {
          const c = compacto(n);
          const tol = toleranciaDe(c.length);
          if (junto[0] !== c[0]) return;
          const d = distanciaEdicion(junto, c, tol);
          if (d <= tol) proponer(n, d, i, k);
        });
      }
    }
    return mejor ? resultado(mejor.n, palabras.slice(mejor.inicio, mejor.inicio + mejor.largo).join(' ')) : null;
  }

  /** Distritos cargados: [{ nombre, titulo, ubigeo, bbox }]. Hay que haber llamado antes a `load`. */
  function lista() {
    return index.map((d) => ({ nombre: d.props.distrito, titulo: titulo(d.props.distrito), ubigeo: d.props.ubigeo || null, bbox: d.bbox }));
  }

  const porNombre = (nombre) => index.find((d) => d.props.distrito === String(nombre ?? '').toUpperCase()) || null;

  /** Polígonos del distrito (cada uno es una lista de anillos [lon, lat]); [] si no existe. */
  function poligonos(nombre) {
    const d = porNombre(nombre);
    return d ? d.polys : [];
  }

  /** El distrito como Feature de GeoJSON, o null. */
  function feature(nombre) {
    const d = porNombre(nombre);
    return d ? { type: 'Feature', properties: { ...d.props }, geometry: d.geometry } : null;
  }

  /** ¿El punto está dentro del distrito? */
  function contiene(nombre, lat, lon) {
    const d = porNombre(nombre);
    if (!d) return false;
    const b = d.bbox;
    return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && d.polys.some((rings) => inPolygon(lon, lat, rings));
  }

  /** Solo para pruebas: carga una colección de distritos sin leer archivos. */
  function cargarParaPruebas(fc) {
    index = indexar(fc);
  }

  /** Polígonos de un distrito por su nombre exacto (MultiPolygon GeoJSON), o null si no existe. */
  function geometriaDe(nombre) {
    const polys = index.filter((d) => d.props.distrito === nombre).flatMap((d) => d.polys);
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }

  return { load, lookup, nombreDe, lista, poligonos, feature, contiene, geometriaDe, buscarNombre, titulo, cargarParaPruebas, SIN_DATOS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Distritos;
