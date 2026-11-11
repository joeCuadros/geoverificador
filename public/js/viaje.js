/**
 * viaje.js — «¿Qué combi o bus me lleva de este punto a mi trabajo?» (sin DOM, sin red, sin estado).
 *
 * Con los trazados de las rutas (OpenStreetMap, rutas_osm.geojson, y SmartBus, rutas_smartbus.geojson) busca las rutas DIRECTAS entre un origen y un destino:
 * las que pasan a `caminarM` metros o menos (en línea recta, 400 m por omisión: la distancia al paradero de CONFIG.umbrales.transporte) de los dos puntos
 * y en las que el origen queda ANTES que el destino a lo largo del recorrido. Cada relación de OSM y cada recorrido de SmartBus es UN sentido de un ramal;
 * una ruta que pasa por los dos puntos pero en el orden contrario se devuelve aparte («al revés»): sirve en el otro sentido, que suele ser otra relación.
 *
 * Lo que mide y lo que no: distancias en línea recta (plano local, como el resto de la herramienta) del punto al trazado, medidas a vértices densificados cada
 * 15 m (error de unos 7 m); el recorrido en vehículo es la distancia a lo largo del trazado. NO dice dónde se puede subir o bajar (OSM no trae paradas y las de
 * SmartBus son numeradas), ni si la ruta opera hoy, ni su frecuencia real: solo que el trazado publicado pasa ahí y en ese orden.
 *
 *   desdeOsm(fc) / desdeSmartbus(indice)    → rutas con una misma forma { id, fuente, linea, ramal, nombre, desde, hasta, operador, duracionMin, intervaloMin, … , partes }
 *   rutasDirectas(origen, destino, rutas, { caminarM, linea, texto }) → { directas, alReves, evaluadas }
 *   unir(resultados)                        → la misma ruta de OSM y de SmartBus sale una vez, con sus fuentes
 *   resolverDestino(texto, destinos)        → el destino de la lista cuyo nombre o alias aparece primero en la frase
 *   textoRuta(r)                            → «C10 · A: Ciudad Blanca → La Mansión del Fundador (MegaBus)»
 *
 * Se carga como script del navegador (define `Viaje`) y también como módulo CommonJS para las pruebas y verificar-datos.
 */
const Viaje = (() => {
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef
  const M_POR_GRADO = (Math.PI / 180) * C.RADIO_TIERRA_M;
  const PASO_M = 15; // los trazados se densifican a tramos de este largo para medir distancias a puntos del recorrido
  const CAMINAR_M = 400;

  const sinTildes = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const norm = (s) => sinTildes(s).replace(/\s+/g, ' ').trim();
  /** «C-10», «c10» y «C10» son la misma línea. */
  const codigoLinea = (s) => sinTildes(s).replace(/[^a-z0-9]/g, '');
  const esPunto = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

  // ------------------------------------------------------------ Adaptadores de las dos fuentes

  const partesDe = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []).filter((p) => Array.isArray(p) && p.length >= 2);

  /** Rutas de OpenStreetMap (public/data/rutas_osm.geojson). */
  function desdeOsm(fc) {
    return ((fc && fc.features) || []).filter((f) => f && f.properties && f.properties.tipo === 'ruta').map((f) => {
      const p = f.properties;
      return {
        id: p.osm, fuente: 'OSM', linea: p.linea ?? null, ramal: p.ramal ?? null, nombre: p.nombre ?? null, desde: p.desde ?? null, hasta: p.hasta ?? null, operador: p.operador ?? null,
        duracionMin: p.duracion_min ?? null, intervaloMin: p.intervalo_min ?? null, horario: p.horario ?? null, tarifa: p.tarifa ?? null, color: p.color ?? null, url: null, partes: partesDe(f.geometry),
      };
    }).filter((r) => r.partes.length);
  }

  /** Rutas de SmartBus (el índice de Rutas.indexar). */
  function desdeSmartbus(indice) {
    return ((indice && indice.rutas) || []).map((r) => {
      const p = r.props || {};
      const [desde, hasta] = String(p.sentido || '').split(/\s*→\s*/);
      return {
        id: `smartbus/${p.id_ruta}`, fuente: 'SmartBus', linea: p.linea ?? null, ramal: p.ramal ?? null, nombre: p.nombre ?? null, desde: desde || null, hasta: hasta || null, operador: p.empresa ?? null,
        duracionMin: null, intervaloMin: null, horario: null, tarifa: null, color: p.color ?? null, url: p.url ?? null, partes: r.partes,
      };
    }).filter((r) => r.partes.length);
  }

  // ------------------------------------------------------------ Trazado densificado

  const cache = new WeakMap(); // ruta → { lat, lon, s, bbox }

  /** El trazado como puntos cada ≤ PASO_M m, con la distancia acumulada `s` desde el inicio. Entre dos partes (un salto del dato) se suma la recta, no se inventa un trazado. */
  function densificar(ruta) {
    let d = cache.get(ruta);
    if (d) return d;
    const lat = [];
    const lon = [];
    const s = [];
    let acum = 0;
    ruta.partes.forEach((parte) => {
      parte.forEach(([x, y], i) => {
        if (lat.length === 0) { lat.push(y); lon.push(x); s.push(0); return; }
        const y0 = lat[lat.length - 1];
        const x0 = lon[lon.length - 1];
        const largo = C.haversine(y0, x0, y, x);
        const n = i === 0 ? 1 : Math.max(1, Math.ceil(largo / PASO_M)); // el primer punto de una parte nueva une con el final de la anterior en recta
        for (let k = 1; k <= n; k++) {
          lat.push(y0 + ((y - y0) * k) / n);
          lon.push(x0 + ((x - x0) * k) / n);
          s.push(acum + (largo * k) / n);
        }
        acum += largo;
      });
    });
    const bbox = [Math.min(...lon), Math.min(...lat), Math.max(...lon), Math.max(...lat)];
    d = { lat, lon, s, bbox };
    cache.set(ruta, d);
    return d;
  }

  // ------------------------------------------------------------ Rutas directas

  /** Par (i, j) con i antes que j que minimiza la suma de las distancias, o null. `dA` y `dB` son las distancias de cada punto del trazado a A y a B. */
  function mejorPar(dA, dB, max) {
    let mejorA = { d: Infinity, i: -1 };
    let par = null;
    for (let k = 0; k < dA.length; k++) {
      if (dB[k] <= max && mejorA.i >= 0 && mejorA.d + dB[k] < (par ? par.suma : Infinity)) par = { i: mejorA.i, j: k, suma: mejorA.d + dB[k], dA: mejorA.d, dB: dB[k] };
      if (dA[k] <= max && dA[k] < mejorA.d) mejorA = { d: dA[k], i: k };
    }
    return par;
  }

  function evaluarRuta(ruta, origen, destino, max, mLat, mLon) {
    const t = densificar(ruta);
    const b = t.bbox;
    const fuera = (p) => p.lon < b[0] - mLon || p.lon > b[2] + mLon || p.lat < b[1] - mLat || p.lat > b[3] + mLat;
    if (fuera(origen) || fuera(destino)) return null;
    const n = t.lat.length;
    const kO = Math.cos((origen.lat * Math.PI) / 180) * M_POR_GRADO;
    const kD = Math.cos((destino.lat * Math.PI) / 180) * M_POR_GRADO;
    const dO = new Float64Array(n);
    const dD = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      dO[k] = Math.hypot((t.lon[k] - origen.lon) * kO, (t.lat[k] - origen.lat) * M_POR_GRADO);
      dD[k] = Math.hypot((t.lon[k] - destino.lon) * kD, (t.lat[k] - destino.lat) * M_POR_GRADO);
    }
    const arma = (par, delante) => {
      const i = delante ? par.i : par.j;
      const j = delante ? par.j : par.i;
      const coords = [];
      const a = Math.min(i, j);
      const z = Math.max(i, j);
      for (let k = a; k <= z; k++) coords.push([t.lon[k], t.lat[k]]);
      return {
        ruta,
        caminarOrigenM: delante ? par.dA : par.dB,
        caminarDestinoM: delante ? par.dB : par.dA,
        caminarTotalM: par.suma,
        viajeM: Math.abs(t.s[z] - t.s[a]),
        longitudM: t.s[n - 1],
        subida: { lat: t.lat[i], lon: t.lon[i] },
        bajada: { lat: t.lat[j], lon: t.lon[j] },
        segmento: delante ? coords : coords.reverse(),
      };
    };
    const directa = mejorPar(dO, dD, max); // el origen antes que el destino
    if (directa) return { tipo: 'directa', item: arma(directa, true) };
    const reves = mejorPar(dD, dO, max); // el destino antes que el origen
    return reves ? { tipo: 'reves', item: arma(reves, false) } : null;
  }

  /**
   * Rutas que llevan del origen al destino sin transbordo. `opciones`: { caminarM = 400, linea (p. ej. «C10»), texto (en el nombre, ramal, de, hasta u operador) }.
   * Devuelve { directas, alReves, evaluadas }, cada una ordenada por lo que se camina en total.
   */
  function rutasDirectas(origen, destino, rutas, opciones = {}) {
    const max = opciones.caminarM ?? CAMINAR_M;
    const vacio = { directas: [], alReves: [], evaluadas: 0 };
    if (!esPunto(origen) || !esPunto(destino)) return vacio;
    const mLat = max / M_POR_GRADO;
    const mLon = mLat / Math.max(0.2, Math.cos((origen.lat * Math.PI) / 180));
    const cod = opciones.linea ? codigoLinea(opciones.linea) : null;
    const texto = opciones.texto ? norm(opciones.texto) : null;
    const filtradas = (rutas || []).filter((r) => r && r.partes && r.partes.length
      && (!cod || codigoLinea(r.linea) === cod)
      && (!texto || norm([r.nombre, r.ramal, r.desde, r.hasta, r.operador, r.linea].filter(Boolean).join(' | ')).includes(texto)));
    const out = { directas: [], alReves: [], evaluadas: filtradas.length };
    filtradas.forEach((r) => {
      const e = evaluarRuta(r, origen, destino, max, mLat, mLon);
      if (e) (e.tipo === 'directa' ? out.directas : out.alReves).push(e.item);
    });
    const orden = (a, b) => a.caminarTotalM - b.caminarTotalM || a.viajeM - b.viajeM;
    out.directas.sort(orden);
    out.alReves.sort(orden);
    return out;
  }

  /**
   * Tiempo APROXIMADO de un resultado de rutasDirectas (o de unir), con los supuestos de CONFIG.viaje.tiempo ({ velocidadPieMs, factorRodeo }):
   *   caminarMin   (caminata de las dos puntas × factorRodeo, si hay) / velocidadPieMs; null sin velocidad
   *   busMin       la duración que OSM etiqueta para toda la ruta × (distancia recorrida / longitud de la ruta); null si la ruta no la trae (p. ej. solo SmartBus)
   *   totalSinEsperaMin  caminarMin + busMin; null si falta alguno (no se inventa)
   *   esperaMediaMin     la mitad del intervalo etiquetado (llegando sin mirar el horario); aparte, no se suma
   */
  function estimarTiempo(item, tiempo) {
    const t = tiempo || {};
    const rodeo = Number.isFinite(t.factorRodeo) && t.factorRodeo > 0 ? t.factorRodeo : 1;
    const caminarMin = Number.isFinite(t.velocidadPieMs) && t.velocidadPieMs > 0 ? ((item.caminarOrigenM + item.caminarDestinoM) * rodeo) / t.velocidadPieMs / 60 : null;
    const r = item.ruta || {};
    const busMin = Number.isFinite(r.duracionMin) && r.duracionMin > 0 && item.longitudM > 0 ? (r.duracionMin * item.viajeM) / item.longitudM : null;
    return {
      caminarMin,
      busMin,
      totalSinEsperaMin: caminarMin !== null && busMin !== null ? caminarMin + busMin : null,
      esperaMediaMin: Number.isFinite(r.intervaloMin) && r.intervaloMin > 0 ? r.intervaloMin / 2 : null,
      fuenteBus: busMin !== null ? 'duración que etiqueta OpenStreetMap, prorrateada por la distancia' : null,
    };
  }

  /** Las rutas que pasan a `caminarM` o menos de un punto, una por línea + ramal + sentido: [{ ruta, distanciaM }] (para decir «pasan N cerca del destino»). */
  function cercanas(punto, rutas, opciones = {}) {
    const max = opciones.caminarM ?? CAMINAR_M;
    if (!esPunto(punto)) return [];
    const k = Math.cos((punto.lat * Math.PI) / 180) * M_POR_GRADO;
    const mLat = max / M_POR_GRADO;
    const mLon = mLat / Math.max(0.2, Math.cos((punto.lat * Math.PI) / 180));
    const vistas = new Map();
    filtrar(rutas, opciones).forEach((r) => {
      const t = densificar(r);
      const b = t.bbox;
      if (punto.lon < b[0] - mLon || punto.lon > b[2] + mLon || punto.lat < b[1] - mLat || punto.lat > b[3] + mLat) return;
      let mejor = Infinity;
      for (let i = 0; i < t.lat.length; i++) mejor = Math.min(mejor, Math.hypot((t.lon[i] - punto.lon) * k, (t.lat[i] - punto.lat) * M_POR_GRADO));
      if (mejor <= max) {
        const clave = [codigoLinea(r.linea), norm(r.ramal), norm(r.desde), norm(r.hasta)].join('|');
        if (!vistas.has(clave) || mejor < vistas.get(clave).distanciaM) vistas.set(clave, { ruta: r, distanciaM: mejor });
      }
    });
    return [...vistas.values()].sort((a, b) => a.distanciaM - b.distanciaM);
  }

  // ------------------------------------------------------------ Búsqueda de zonas: desde dónde se llega a un destino

  const filtrar = (rutas, opciones) => {
    const cod = opciones.linea ? codigoLinea(opciones.linea) : null;
    const texto = opciones.texto ? norm(opciones.texto) : null;
    return (rutas || []).filter((r) => r && r.partes && r.partes.length
      && (!cod || codigoLinea(r.linea) === cod)
      && (!texto || norm([r.nombre, r.ramal, r.desde, r.hasta, r.operador, r.linea].filter(Boolean).join(' | ')).includes(texto)));
  };

  /**
   * Prepara un destino para preguntar muchas veces «¿desde este origen se llega sin transbordo?» (la búsqueda de zonas evalúa miles de celdas). De cada ruta que pasa a
   * `caminarM` o menos del destino guarda solo los puntos del recorrido ANTES del último punto cercano al destino, en una malla de casillas de `caminarM` metros: es
   * exactamente la condición de rutasDirectas (existe un punto cercano al origen que viene antes de uno cercano al destino).
   */
  function indiceDestino(destino, rutas, opciones = {}) {
    const max = opciones.caminarM ?? CAMINAR_M;
    const bLat = max / M_POR_GRADO;
    const bLon = bLat / Math.max(0.2, Math.cos((destino.lat * Math.PI) / 180));
    const k = Math.cos((destino.lat * Math.PI) / 180) * M_POR_GRADO;
    const casillas = new Map();
    const usadas = [];
    filtrar(rutas, opciones).forEach((r) => {
      const t = densificar(r);
      let jMax = -1;
      for (let i = 0; i < t.lat.length; i++) if (Math.hypot((t.lon[i] - destino.lon) * k, (t.lat[i] - destino.lat) * M_POR_GRADO) <= max) jMax = i;
      if (jMax <= 0) return;
      const n = usadas.push(r) - 1;
      for (let i = 0; i < jMax; i++) {
        const clave = `${Math.floor(t.lat[i] / bLat)},${Math.floor(t.lon[i] / bLon)}`;
        let c = casillas.get(clave);
        if (!c) { c = []; casillas.set(clave, c); }
        c.push(n, t.lat[i], t.lon[i]);
      }
    });
    return { destino, max, bLat, bLon, casillas, rutas: usadas };
  }

  const claveRuta = (r) => [codigoLinea(r.linea), norm(r.ramal), norm(r.desde), norm(r.hasta)].join('|');

  /** ¿Se llega al destino del índice desde `origen`? { cumple, caminarM (al punto más cercano de la mejor ruta), ruta, n (rutas distintas que sirven) }. */
  function alcanza(indice, origen) {
    const vacio = { cumple: false, caminarM: null, ruta: null, n: 0 };
    if (!esPunto(origen)) return vacio;
    const { max, bLat, bLon, casillas } = indice;
    const k = Math.cos((origen.lat * Math.PI) / 180) * M_POR_GRADO;
    const fi = Math.floor(origen.lat / bLat);
    const fj = Math.floor(origen.lon / bLon);
    const mejores = new Map(); // ruta del índice → distancia mínima
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const c = casillas.get(`${fi + a},${fj + b}`);
        if (!c) continue;
        for (let m = 0; m < c.length; m += 3) {
          const d = Math.hypot((c[m + 2] - origen.lon) * k, (c[m + 1] - origen.lat) * M_POR_GRADO);
          if (d <= max && d < (mejores.has(c[m]) ? mejores.get(c[m]) : Infinity)) mejores.set(c[m], d);
        }
      }
    }
    if (mejores.size === 0) return vacio;
    let mejor = null;
    mejores.forEach((d, n) => { if (!mejor || d < mejor.d) mejor = { d, n }; });
    const distintas = new Set([...mejores.keys()].map((n) => claveRuta(indice.rutas[n])));
    return { cumple: true, caminarM: mejor.d, ruta: indice.rutas[mejor.n], n: distintas.size };
  }

  /** De una lista de celdas { lat, lon, … } las que alcanzan el destino sin transbordo: [{ celda, caminarM, ruta, n }]. */
  function zonasConRutaDirecta(destino, rutas, celdas, opciones = {}) {
    const idx = indiceDestino(destino, rutas, opciones);
    const out = [];
    (celdas || []).forEach((celda) => {
      const a = alcanza(idx, celda);
      if (a.cumple) out.push({ celda, caminarM: a.caminarM, ruta: a.ruta, n: a.n });
    });
    return out;
  }

  /** La misma ruta (línea + ramal + de + hasta) en OpenStreetMap y en SmartBus sale una vez, con sus fuentes; los datos que solo trae OSM (duración, intervalo…) se conservan. */
  function unir(resultados) {
    const clave = (r) => [codigoLinea(r.linea), norm(r.ramal), norm(r.desde), norm(r.hasta)].join('|');
    const grupos = new Map();
    (resultados || []).forEach((x) => {
      const k = clave(x.ruta);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(x);
    });
    const out = [];
    grupos.forEach((g) => {
      const fuentes = [...new Set(g.map((x) => x.ruta.fuente))].sort((a, b) => (a === 'OSM' ? -1 : b === 'OSM' ? 1 : a < b ? -1 : 1));
      const mejor = [...g].sort((a, b) => a.caminarTotalM - b.caminarTotalM)[0];
      const ruta = { ...mejor.ruta };
      [...g].sort((a, b) => (a.ruta.fuente === 'OSM' ? -1 : b.ruta.fuente === 'OSM' ? 1 : 0)).forEach((x) => {
        Object.entries(x.ruta).forEach(([k, v]) => { if (ruta[k] === null || ruta[k] === undefined) ruta[k] = v; });
      });
      if (g.some((x) => x.ruta.fuente === 'OSM')) {
        const o = g.find((x) => x.ruta.fuente === 'OSM').ruta;
        ['duracionMin', 'intervaloMin', 'horario', 'tarifa'].forEach((k) => { if (o[k] !== null && o[k] !== undefined) ruta[k] = o[k]; });
      }
      out.push({ ...mejor, ruta, fuentes, ids: g.map((x) => x.ruta.id) });
    });
    return out.sort((a, b) => a.caminarTotalM - b.caminarTotalM || a.viajeM - b.viajeM);
  }

  // ------------------------------------------------------------ Destinos y textos

  /** El destino de la lista ({ nombre, alias[] }) cuyo nombre o alias aparece primero en la frase (sin tildes ni mayúsculas), o null. */
  function resolverDestino(texto, destinos) {
    const t = norm(texto);
    let mejor = null;
    (destinos || []).forEach((d) => {
      [d.nombre, ...(d.alias || [])].forEach((a) => {
        const i = t.search(new RegExp(`(^|[^a-z0-9])${norm(a).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`));
        if (i >= 0 && (mejor === null || i < mejor.i)) mejor = { i, d };
      });
    });
    return mejor ? mejor.d : null;
  }

  const metros = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

  /** «C10 · A: Ciudad Blanca → La Mansión del Fundador (MegaBus)». */
  function textoRuta(r) {
    const op = r.operador ? String(r.operador).replace(/^[A-Za-z]*\d*\s*-\s*/, '') : '';
    const ramal = r.ramal && r.ramal !== r.linea ? ` · ${r.ramal}` : '';
    const sentido = r.desde && r.hasta ? `: ${r.desde} → ${r.hasta}` : '';
    return `${r.linea || 'Ruta'}${ramal}${sentido}${op ? ` (${op})` : ''}`;
  }

  return { CAMINAR_M, PASO_M, desdeOsm, desdeSmartbus, rutasDirectas, estimarTiempo, cercanas, indiceDestino, alcanza, zonasConRutaDirecta, unir, resolverDestino, textoRuta, codigoLinea, metros };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Viaje;
