/**
 * rutas.js — Líneas de transporte público que pasan cerca de un punto o por un distrito (sin DOM, sin red, sin estado).
 *
 * Fuente: public/data/rutas_smartbus.geojson, congelado con scripts/descargar-rutas-smartbus.mjs a partir de los recorridos
 * que publica SmartBus (smartbus.app) con su permiso verbal. Trae dos clases de elementos:
 *   - tipo «ruta»: LineString o MultiLineString [lon, lat] de un recorrido en un sentido (props: linea, empresa, ramal, sentido…)
 *   - tipo «parada»: Point con el nombre numerado que publica SmartBus («Cettar - 12») y su `orden` en el recorrido.
 *
 * Lo que mide: la distancia en línea recta del punto a la polilínea de cada recorrido (Calculos.distanciaAGeometriaLineaM, el
 * mismo plano local que usan los demás cálculos) y a la parada más cercana de la línea. NO dice si el servicio está operando,
 * ni su frecuencia u horario, ni dónde se puede subir: solo que el trazado publicado pasa a esa distancia.
 *
 * Una línea cruza un distrito si algún vértice de su trazado (densificado a tramos de 100 m como máximo) cae dentro del
 * polígono del distrito. Es una aproximación de pocos metros: un trazado que solo roce una esquina podría no contarse.
 *
 * Se carga como script del navegador (define `Rutas`) y también como módulo CommonJS para las pruebas y verificar-datos.
 */
const Rutas = (() => {
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef

  const M_POR_GRADO = (Math.PI / 180) * C.RADIO_TIERRA_M;
  const PASO_DENSIFICAR_M = 100;
  const FUENTE = 'SmartBus (smartbus.app)';
  const ATRIBUCION = 'Rutas: SmartBus (smartbus.app)';

  const partesDe = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

  function bboxDe(partes) {
    const b = [Infinity, Infinity, -Infinity, -Infinity]; // oeste, sur, este, norte
    partes.forEach((p) => p.forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }));
    return b;
  }

  /**
   * Ordena el GeoJSON para consultarlo. Devuelve { rutas, paradas, metadata, lineas }.
   *   rutas:   [{ props, partes, bbox }]
   *   paradas: [{ lat, lon, props }]
   * Los elementos con geometría o tipo desconocidos se ignoran: nunca se inventa un recorrido.
   */
  function indexar(fc) {
    const rutas = [];
    const paradas = [];
    ((fc && fc.features) || []).forEach((f) => {
      const props = f.properties || {};
      if (props.tipo === 'ruta') {
        const partes = partesDe(f.geometry).filter((p) => Array.isArray(p) && p.length >= 2);
        if (partes.length) rutas.push({ props, partes, bbox: bboxDe(partes) });
      } else if (props.tipo === 'parada' && f.geometry && f.geometry.type === 'Point') {
        const [lon, lat] = f.geometry.coordinates;
        if (Number.isFinite(lat) && Number.isFinite(lon)) paradas.push({ lat, lon, props });
      }
    });
    const lineas = [...new Set(rutas.map((r) => r.props.linea))];
    return { rutas, paradas, metadata: (fc && fc.metadata) || {}, lineas };
  }

  /** Orden natural de las líneas: C2, C3 … C10, C11 y después las que no llevan número (Albotran, Chiguata). */
  function compararLineas(a, b) {
    const na = /^C(\d+)$/.exec(a);
    const nb = /^C(\d+)$/.exec(b);
    if (na && nb) return Number(na[1]) - Number(nb[1]);
    if (na) return -1;
    if (nb) return 1;
    return a.localeCompare(b, 'es');
  }

  const nombreEmpresa = (lista) => [...new Set(lista)].sort((a, b) => a.localeCompare(b, 'es')).join(' / ');

  /** «C2 (Cono Norte)»; sin empresa distinta del nombre de la línea, solo «Albotran». */
  function etiquetaLinea(l) {
    const empresa = Array.isArray(l.empresas) ? nombreEmpresa(l.empresas) : l.empresa;
    return empresa && empresa !== l.linea ? `${l.linea} (${empresa})` : l.linea;
  }

  /**
   * Agrupa recorridos por línea. `hits` = [{ ruta, distanciaM }]; `paradasDe` devuelve las paradas candidatas de un recorrido.
   * Cada línea trae su distancia mínima, sus ramales (con el sentido) y la parada más cercana al punto.
   */
  function agruparPorLinea(hits, punto, indice) {
    const porLinea = new Map();
    hits.forEach(({ ruta, distanciaM }) => {
      const p = ruta.props;
      if (!porLinea.has(p.linea)) porLinea.set(p.linea, { linea: p.linea, empresas: new Set(), distanciaM: Infinity, ramales: [], ids: new Set() });
      const l = porLinea.get(p.linea);
      l.empresas.add(p.empresa);
      l.distanciaM = Math.min(l.distanciaM, distanciaM);
      l.ramales.push({ ramal: p.ramal, sentido: p.sentido || null, nombre: p.nombre, distanciaM, url: p.url || null });
      l.ids.add(p.id_ruta);
    });
    return [...porLinea.values()].map((l) => {
      let parada = null;
      if (punto) {
        indice.paradas.forEach((s) => {
          if (!l.ids.has(s.props.id_ruta)) return;
          const d = C.haversine(punto.lat, punto.lon, s.lat, s.lon);
          if (!parada || d < parada.distanciaM) parada = { nombre: s.props.nombre, ramal: s.props.ramal, orden: s.props.orden, lat: s.lat, lon: s.lon, distanciaM: d };
        });
      }
      return {
        linea: l.linea,
        empresas: [...l.empresas].sort((a, b) => a.localeCompare(b, 'es')),
        distanciaM: l.distanciaM,
        ramales: l.ramales.sort((a, b) => a.distanciaM - b.distanciaM),
        parada,
      };
    });
  }

  /**
   * Líneas cuyo recorrido pasa a `distanciaM` metros o menos del punto.
   * Devuelve { distanciaM, lineas, rutas, fuente, fecha } con `lineas` ordenadas de la más cercana a la más lejana:
   *   [{ linea, empresas, distanciaM, ramales: [{ ramal, sentido, nombre, distanciaM }], parada: { nombre, distanciaM } | null }]
   * `rutas` es el número de recorridos (un sentido cada uno) que cumplen. Lista vacía = ningún trazado publicado pasa tan cerca.
   */
  function cerca(indice, lat, lon, distanciaM) {
    const dLat = distanciaM / M_POR_GRADO;
    const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    const hits = [];
    indice.rutas.forEach((ruta) => {
      const b = ruta.bbox;
      if (lon < b[0] - dLon || lon > b[2] + dLon || lat < b[1] - dLat || lat > b[3] + dLat) return;
      const d = Math.min(...ruta.partes.map((p) => C.distanciaALineaM(lat, lon, p)));
      if (d <= distanciaM) hits.push({ ruta, distanciaM: d });
    });
    const lineas = agruparPorLinea(hits, { lat, lon }, indice).sort((a, b) => a.distanciaM - b.distanciaM || compararLineas(a.linea, b.linea));
    return { distanciaM, lineas, rutas: hits.length, fuente: indice.metadata.fuente || FUENTE, fecha: indice.metadata.fecha_descarga || null };
  }

  // Puntos de un trazado con tramos de a lo más PASO_DENSIFICAR_M, para no perder un distrito que cae entre dos vértices.
  function* puntosDensos(parte) {
    for (let i = 0; i < parte.length; i++) {
      yield parte[i];
      if (i + 1 >= parte.length) break;
      const [x0, y0] = parte[i];
      const [x1, y1] = parte[i + 1];
      const largo = Math.hypot((x1 - x0) * Math.cos((y0 * Math.PI) / 180), y1 - y0) * M_POR_GRADO;
      const n = Math.floor(largo / PASO_DENSIFICAR_M);
      for (let k = 1; k <= n; k++) yield [x0 + ((x1 - x0) * k) / (n + 1), y0 + ((y1 - y0) * k) / (n + 1)];
    }
  }

  const poligonosDe = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

  function bboxDePoligonos(polys) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    polys.forEach((anillos) => (anillos[0] || []).forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }));
    return b;
  }

  /**
   * Líneas que cruzan el polígono (Polygon o MultiPolygon, coordenadas GeoJSON [lon, lat]).
   * Devuelve { lineas, rutas, fuente, fecha } con
   *   lineas: [{ linea, empresas, ramales: [{ ramal, sentido, nombre }], paradas }]   (orden natural: C2, C3 … C11, Albotran…)
   * `paradas` = paradas de esa línea que caen dentro del polígono (0 si el trazado cruza el distrito sin parada dentro).
   */
  function cruzan(indice, geometria) {
    const polys = poligonosDe(geometria);
    const out = { lineas: [], rutas: 0, fuente: indice.metadata.fuente || FUENTE, fecha: indice.metadata.fecha_descarga || null };
    if (!polys.length) return out;
    const bb = bboxDePoligonos(polys);
    const dentroBbox = (x, y) => x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3];
    const dentro = (x, y) => dentroBbox(x, y) && polys.some((anillos) => C.puntoEnPoligono(y, x, anillos));

    const porLinea = new Map();
    const idsPorLinea = new Map();
    indice.rutas.forEach((ruta) => {
      const b = ruta.bbox;
      if (b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]) return;
      let cruza = false;
      for (const parte of ruta.partes) {
        for (const [x, y] of puntosDensos(parte)) {
          if (dentro(x, y)) { cruza = true; break; }
        }
        if (cruza) break;
      }
      if (!cruza) return;
      const p = ruta.props;
      if (!porLinea.has(p.linea)) porLinea.set(p.linea, { linea: p.linea, empresas: new Set(), ramales: [], paradas: 0 });
      const l = porLinea.get(p.linea);
      l.empresas.add(p.empresa);
      l.ramales.push({ ramal: p.ramal, sentido: p.sentido || null, nombre: p.nombre });
      if (!idsPorLinea.has(p.linea)) idsPorLinea.set(p.linea, new Set());
      idsPorLinea.get(p.linea).add(p.id_ruta);
      out.rutas += 1;
    });
    indice.paradas.forEach((s) => {
      const ids = idsPorLinea.get(s.props.linea);
      if (ids && ids.has(s.props.id_ruta) && dentro(s.lon, s.lat)) porLinea.get(s.props.linea).paradas += 1;
    });
    out.lineas = [...porLinea.values()]
      .map((l) => ({ ...l, empresas: [...l.empresas].sort((a, b) => a.localeCompare(b, 'es')) }))
      .sort((a, b) => compararLineas(a.linea, b.linea));
    return out;
  }

  const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  /**
   * Distrito al que se refiere un texto escrito por la persona («paucarpata», «cerro colorado», «bustamante»), entre
   * los nombres dados. Coincidencia exacta primero; si no, un único nombre que contenga el texto. Si hay duda, null.
   */
  function resolverDistrito(texto, nombres) {
    const t = sinTildes(texto).replace(/^(?:el |la )?(?:distrito |dist\. )?(?:de |del )?/, '');
    if (t.length < 3) return null;
    const lista = (nombres || []).map((n) => ({ n, k: sinTildes(n) }));
    const exacto = lista.find((x) => x.k === t);
    if (exacto) return exacto.n;
    const parcial = lista.filter((x) => x.k.includes(t) || (t.length >= 6 && t.includes(x.k)));
    return parcial.length === 1 ? parcial[0].n : null;
  }

  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

  /** «C2 (Cono Norte), C5 (EtraBus)»; con `max`, agrega «y N más». */
  function listaTexto(lineas, max = null) {
    const vistas = max && lineas.length > max ? lineas.slice(0, max) : lineas;
    const base = vistas.map(etiquetaLinea).join(', ');
    return vistas.length < lineas.length ? `${base} y ${lineas.length - vistas.length} más` : base;
  }

  /** Frase corta para la ficha: «Líneas que pasan a ≤400 m: C2 (Cono Norte), C5 (EtraBus)» o «Ninguna línea publicada pasa a ≤400 m». */
  function resumen(res, max = 8) {
    if (!res || !res.lineas.length) return `Ninguna línea publicada por SmartBus pasa a ≤${Math.round(res ? res.distanciaM : 0)} m`;
    return `Líneas que pasan a ≤${Math.round(res.distanciaM)} m: ${listaTexto(res.lineas, max)}`;
  }

  return { FUENTE, ATRIBUCION, indexar, cerca, cruzan, resolverDistrito, etiquetaLinea, listaTexto, resumen, compararLineas, fmtDist };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Rutas;
