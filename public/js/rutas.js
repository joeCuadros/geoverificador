/**
 * rutas.js — Líneas de transporte público que pasan cerca de un punto o por un distrito (sin DOM, sin red, sin estado).
 *
 * Fuente: public/data/rutas_osm.geojson, congelado con scripts/descargar-rutas-osm.mjs a partir de OpenStreetMap (© colaboradores, ODbL): la ÚNICA fuente de rutas y
 * paradas de la herramienta. Trae dos clases de elementos:
 *   - tipo «ruta»: LineString o MultiLineString [lon, lat] de UNA relación route=bus (un sentido de un ramal): linea, ramal, desde, hasta, operador, osm (id de la relación)…
 *   - tipo «parada»: Point de un objeto suelto de OSM (highway=bus_stop, public_transport=platform|stop_position) con `rutas` (osm de las relaciones a cuyo trazado
 *     pertenece, a ≤25 m y de su empresa) y `lineas`. Las relaciones de OSM no traen paradas: las que no tienen ninguna ligada quedan «paradas no mapeadas».
 *
 * Lo que mide: la distancia en línea recta del punto a la polilínea de cada recorrido (Calculos.distanciaAGeometriaLineaM, el
 * mismo plano local que usan los demás cálculos) y a la parada MAPEADA más cercana de la línea. NO dice si el servicio está operando,
 * ni su frecuencia u horario, ni dónde se puede subir (las paradas de OSM son parciales): solo que el trazado mapeado pasa a esa distancia.
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
  const FUENTE = 'OpenStreetMap (ODbL), relaciones route=bus de la red SIT y paradas de bus';
  const ATRIBUCION = '© colaboradores de OpenStreetMap (ODbL)';

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

  /** «C3 - Transcayma» → «Transcayma»; «Albotran» → «Albotran»; sin operador, el nombre de la línea. */
  const empresaDe = (operador, linea) => {
    const t = String(operador == null ? '' : operador).trim().replace(/^[A-Za-z]*\d*\s*-\s*/, '').trim();
    return t || linea;
  };

  /**
   * Ordena el GeoJSON para consultarlo. Devuelve { rutas, paradas, paradasDe, metadata, lineas }.
   *   rutas:    [{ props, partes, bbox }]   props = las etiquetas de OSM más `empresa` (del operador), `sentido` («desde → hasta») e `id_ruta` (el osm de la relación)
   *   paradas:  [{ lat, lon, props }]
   *   paradasDe: Map osm de la relación → las paradas ligadas a ella (vacío si no tiene: «paradas no mapeadas»)
   * Los elementos con geometría o tipo desconocidos se ignoran: nunca se inventa un recorrido ni una parada.
   */
  function indexar(fc) {
    const rutas = [];
    const paradas = [];
    const paradasDe = new Map();
    ((fc && fc.features) || []).forEach((f) => {
      const p = f.properties || {};
      if (p.tipo === 'ruta') {
        const partes = partesDe(f.geometry).filter((x) => Array.isArray(x) && x.length >= 2);
        if (!partes.length) return;
        const linea = p.linea || p.ramal || p.osm || 'Sin línea';
        const props = { ...p, linea, empresa: empresaDe(p.operador, linea), sentido: p.desde && p.hasta ? `${p.desde} → ${p.hasta}` : null, id_ruta: p.osm };
        rutas.push({ props, partes, bbox: bboxDe(partes) });
      } else if (p.tipo === 'parada' && f.geometry && f.geometry.type === 'Point') {
        const [lon, lat] = f.geometry.coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const parada = { lat, lon, props: { ...p, rutas: Array.isArray(p.rutas) ? p.rutas : [], lineas: Array.isArray(p.lineas) ? p.lineas : [] } };
        paradas.push(parada);
        parada.props.rutas.forEach((id) => { if (!paradasDe.has(id)) paradasDe.set(id, []); paradasDe.get(id).push(parada); });
      }
    });
    const lineas = [...new Set(rutas.map((r) => r.props.linea))];
    return { rutas, paradas, paradasDe, metadata: (fc && fc.metadata) || {}, lineas };
  }

  /** Las paradas ligadas a alguna de las relaciones de `ids` (cada una una vez). */
  function paradasDeRutas(indice, ids) {
    const vistas = new Set();
    const out = [];
    ids.forEach((id) => (indice.paradasDe.get(id) || []).forEach((s) => { if (!vistas.has(s)) { vistas.add(s); out.push(s); } }));
    return out;
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
   * Cada línea trae su distancia mínima, sus ramales (con el sentido), la parada MAPEADA más cercana al punto y cuántas paradas de OSM tiene ligadas (`paradasMapeadas`;
   * 0 = «paradas no mapeadas»: no se inventa una parada).
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
      const propias = paradasDeRutas(indice, l.ids);
      if (punto) {
        propias.forEach((s) => {
          const d = C.haversine(punto.lat, punto.lon, s.lat, s.lon);
          if (!parada || d < parada.distanciaM) parada = { nombre: s.props.nombre, clase: s.props.clase || null, osm: s.props.osm || null, lat: s.lat, lon: s.lon, distanciaM: d };
        });
      }
      return {
        linea: l.linea,
        empresas: [...l.empresas].sort((a, b) => a.localeCompare(b, 'es')),
        distanciaM: l.distanciaM,
        ramales: l.ramales.sort((a, b) => a.distanciaM - b.distanciaM),
        parada,
        paradasMapeadas: propias.length,
      };
    });
  }

  // De dónde salen los datos y bajo qué licencia (ODbL): acompaña a todo resultado para que se muestre junto a él.
  const citaDe = (indice) => ({
    fuente: indice.metadata.fuente || FUENTE,
    fecha: indice.metadata.fecha_extraccion || null,
    atribucion: ATRIBUCION,
  });

  /**
   * Líneas cuyo recorrido pasa a `distanciaM` metros o menos del punto.
   * Devuelve { distanciaM, lineas, rutas, fuente, fecha } con `lineas` ordenadas de la más cercana a la más lejana:
   *   [{ linea, empresas, distanciaM, ramales: [{ ramal, sentido, nombre, distanciaM }], parada: { nombre, distanciaM } | null, paradasMapeadas }]
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
    return { distanciaM, lineas, rutas: hits.length, ...citaDe(indice) };
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
    const out = { lineas: [], rutas: 0, ...citaDe(indice) };
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
      if (!dentro(s.lon, s.lat)) return;
      idsPorLinea.forEach((ids, linea) => { if (s.props.rutas.some((id) => ids.has(id))) porLinea.get(linea).paradas += 1; });
    });
    out.lineas = [...porLinea.values()]
      .map((l) => ({ ...l, empresas: [...l.empresas].sort((a, b) => a.localeCompare(b, 'es')) }))
      .sort((a, b) => compararLineas(a.linea, b.linea));
    return out;
  }

  // Un color por línea para dibujarlas en el mapa. Se asigna por la posición de la línea en el orden natural de TODAS las líneas del
  // archivo, así C2 es siempre del mismo color sin importar cuáles se pidan. Son distintos entre sí y de los verdes de los parques.
  const COLORES = ['#d62728', '#1f77b4', '#ff7f0e', '#9467bd', '#17becf', '#8c564b', '#e377c2', '#bcbd22', '#a6761d', '#6a3d9a', '#e7298a', '#005f73'];

  /** Color estable de una línea del archivo. */
  function colorDe(indice, linea) {
    const orden = [...indice.lineas].sort(compararLineas);
    const i = orden.indexOf(linea);
    return COLORES[(i < 0 ? 0 : i) % COLORES.length];
  }

  /**
   * Lo necesario para dibujar líneas en un mapa: el trazado de cada línea pedida (todos sus recorridos) con su color, y, si hay un
   * punto, la parada mapeada de OpenStreetMap más cercana a él de cada línea (si la línea no tiene paradas mapeadas, ninguna). Los nombres que no existen en el archivo se ignoran.
   * Devuelve { trazos, paradas, bbox } con
   *   trazos:  [{ linea, empresas, color, partes: [[[lon, lat], …]], ramales: [{ ramal, sentido, nombre }] }]  (orden natural)
   *   paradas: [{ linea, color, nombre, ramal, lat, lon, distanciaM }]
   */
  function paraMapa(indice, nombres, punto = null) {
    const pedidas = [...new Set(nombres || [])].filter((n) => indice.lineas.includes(n)).sort(compararLineas);
    const trazos = pedidas.map((linea) => {
      const recorridos = indice.rutas.filter((r) => r.props.linea === linea);
      return {
        linea,
        empresas: [...new Set(recorridos.map((r) => r.props.empresa))].sort((a, b) => a.localeCompare(b, 'es')),
        color: colorDe(indice, linea),
        partes: recorridos.flatMap((r) => r.partes),
        ramales: recorridos.map((r) => ({ ramal: r.props.ramal, sentido: r.props.sentido || null, nombre: r.props.nombre })),
        ids: new Set(recorridos.map((r) => r.props.id_ruta)),
      };
    });
    const paradas = [];
    if (punto) {
      trazos.forEach((t) => {
        let mejor = null;
        paradasDeRutas(indice, [...t.ids]).forEach((s) => {
          const d = C.haversine(punto.lat, punto.lon, s.lat, s.lon);
          if (!mejor || d < mejor.distanciaM) mejor = { linea: t.linea, color: t.color, nombre: s.props.nombre, lat: s.lat, lon: s.lon, distanciaM: d };
        });
        if (mejor) paradas.push(mejor);
      });
    }
    const bbox = bboxDe(trazos.flatMap((t) => t.partes));
    return { trazos: trazos.map(({ ids, ...resto }) => resto), paradas, bbox: Number.isFinite(bbox[0]) ? bbox : null };
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
    if (!res || !res.lineas.length) return `Ninguna línea mapeada en OpenStreetMap pasa a ≤${Math.round(res ? res.distanciaM : 0)} m`;
    return `Líneas que pasan a ≤${Math.round(res.distanciaM)} m: ${listaTexto(res.lineas, max)}`;
  }

  return { FUENTE, ATRIBUCION, indexar, cerca, cruzan, paraMapa, colorDe, COLORES, etiquetaLinea, listaTexto, resumen, compararLineas, fmtDist };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Rutas;
