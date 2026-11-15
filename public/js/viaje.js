/**
 * viaje.js — «¿Qué combi o bus me lleva de este punto a mi trabajo?» (sin DOM, sin red, sin estado).
 *
 * Con los trazados de las rutas de OpenStreetMap (rutas_osm.geojson, la única fuente) busca las rutas DIRECTAS entre un origen y un destino:
 * las que pasan a `caminarM` metros o menos (en línea recta, 400 m por omisión: la distancia al paradero de CONFIG.umbrales.transporte) de los dos puntos
 * y en las que el origen queda ANTES que el destino a lo largo del recorrido. Cada relación de OSM es UN sentido de un ramal;
 * una ruta que pasa por los dos puntos pero en el orden contrario se devuelve aparte («al revés»): sirve en el otro sentido, que suele ser otra relación.
 *
 * Lo que mide y lo que no: distancias en línea recta (plano local, como el resto de la herramienta) del punto al trazado, medidas a vértices densificados cada
 * 15 m (error de unos 7 m); el recorrido en vehículo es la distancia a lo largo del trazado. NO dice dónde se puede subir o bajar (las paradas de OSM son parciales y
 * no se usan para esto), ni si la ruta opera hoy, ni su frecuencia real: solo que el trazado mapeado pasa ahí y en ese orden.
 *
 *   desdeOsm(fc)                            → rutas con la forma { id, fuente, linea, ramal, nombre, desde, hasta, operador, duracionMin, intervaloMin, … , partes }
 *   rutasDirectas(origen, destino, rutas, { caminarM, linea, texto }) → { directas, alReves, evaluadas }
 *   unir(resultados)                        → la misma ruta (línea + ramal + de + hasta) que OSM dibuja en más de una relación sale una vez
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

  // ------------------------------------------------------------ Adaptador de las rutas de OpenStreetMap

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

  /** Las paradas de OpenStreetMap ligadas a rutas (public/data/rutas_osm.geojson), para el trasbordo: [{ osm, nombre, lat, lon, rutas: [id de relación] }]. */
  function paradasDeOsm(fc) {
    return ((fc && fc.features) || []).filter((f) => f && f.properties && f.properties.tipo === 'parada' && f.geometry && f.geometry.type === 'Point').map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return { osm: f.properties.osm, nombre: f.properties.nombre ?? null, lat, lon, rutas: Array.isArray(f.properties.rutas) ? f.properties.rutas : [] };
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
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
   *   busMin       la duración que OSM etiqueta para toda la ruta × (distancia recorrida / longitud de la ruta); null si la ruta no la trae
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

  // ------------------------------------------------------------ Un trasbordo

  /**
   * Distancia a pie máxima entre dos rutas para hacer trasbordo (m). SUPUESTO del proyecto, no una norma: se tomó la mitad de los 400 m del acceso al paradero
   * (el estándar de área de captación de transporte público más citado en planificación) porque ninguna guía encontrada fija una distancia para el trasbordo.
   * CONFIG.viaje.trasbordoM la fija en la aplicación.
   */
  const TRASBORDO_M = 200;
  const MAX_TRASBORDOS = 5;
  const PASO_GRUESO = 4; // 4 vértices de 15 m = ≈ 60 m en la búsqueda gruesa del trasbordo

  /**
   * Viajes con UN trasbordo A → B del origen al destino, para cuando ninguna ruta va directo. La ruta A se aborda a `caminarM` o menos del origen, la B se deja a `caminarM`
   * o menos del destino y en el trasbordo las dos pasan a `trasbordoM` o menos una de otra. Respeta el sentido de cada relación (se sube a A antes del punto de trasbordo y se
   * baja de B después del suyo) y no usa relaciones en sentido contrario. Elige, para cada par de rutas, el trasbordo de menor tiempo aproximado (o, sin la duración que
   * etiqueta OSM o sin velocidad a pie, el de menor caminata y luego menos km en vehículo), deja una sola combinación por par de LÍNEAS y devuelve las `max` mejores.
   *   opciones: { caminarM = 400, trasbordoM = 200, max = 5, tiempo (CONFIG.viaje.tiempo), paradas: [{ lat, lon, nombre, rutas: [id de relación] }], linea, texto }
   *   → { trasbordos: [{ rutaA, rutaB, caminarOrigenM, caminarTrasbordoM, caminarDestinoM, caminarTotalM, viajeAM, viajeBM, viajeM, longitudAM, longitudBM,
   *        subida, bajadaA, subidaB, bajada, trasbordo: { lat, lon }, parada: { nombre, lat, lon, distanciaM } | null, segmentoA, segmentoB }], candidatasA, candidatasB }
   */
  /**
   * Lo que solo depende del destino, para no repetirlo en cada consulta (la cobertura de toda la ciudad y la búsqueda de zonas preguntan miles de veces por el mismo destino):
   * las rutas B candidatas (pasan a ≤ caminarM del destino), con el mejor punto de bajada desde cada vértice, y la rejilla de sus vértices (uno de cada PASO_GRUESO).
   */
  function prepararDestinoTrasbordo(destino, rutas, opciones = {}) {
    const max = opciones.caminarM ?? CAMINAR_M;
    const trasM = opciones.trasbordoM ?? TRASBORDO_M;
    const lista = filtrar(rutas, opciones);
    const kx = Math.cos((destino.lat * Math.PI) / 180) * M_POR_GRADO;
    const celda = Math.max(trasM, 1);
    const kD = kx;
    const mLatD = max / M_POR_GRADO;
    const mLonD = mLatD / Math.max(0.2, Math.cos((destino.lat * Math.PI) / 180));
    const B = [];
    lista.forEach((r) => {
      const t = densificar(r);
      const b = t.bbox;
      if (destino.lon < b[0] - mLonD || destino.lon > b[2] + mLonD || destino.lat < b[1] - mLatD || destino.lat > b[3] + mLatD) return;
      const n = t.lat.length;
      const d = new Float64Array(n);
      const mejor = new Int32Array(n);
      let m = -1;
      let md = Infinity;
      for (let k = n - 1; k >= 0; k--) {
        d[k] = Math.hypot((t.lon[k] - destino.lon) * kD, (t.lat[k] - destino.lat) * M_POR_GRADO);
        if (d[k] <= max && d[k] < md) { md = d[k]; m = k; }
        mejor[k] = m;
      }
      if (m >= 0) B.push({ r, t, d, mejor, n, clave: claveRuta(r) });
    });
    const clave = (ci, cj) => (ci + 100000) * 1000000 + (cj + 100000);
    const rejilla = new Map();
    B.forEach((b, bi) => {
      for (let k = 0; k < b.n; k += PASO_GRUESO) {
        if (b.mejor[k] < 0) continue; // desde este vértice ya no hay dónde bajar cerca del destino
        const c = clave(Math.floor((b.t.lon[k] * kx) / celda), Math.floor((b.t.lat[k] * M_POR_GRADO) / celda));
        let l = rejilla.get(c);
        if (!l) { l = []; rejilla.set(c, l); }
        l.push(bi, k);
      }
    });
    return { destino, max, trasM, kx, celda, clave, B, rejilla, lista };
  }

  function rutasConTrasbordo(origen, destino, rutas, opciones = {}) {
    const vacio = { trasbordos: [], candidatasA: 0, candidatasB: 0 };
    if (!esPunto(origen) || !esPunto(destino)) return vacio;
    const prep = opciones.preparado && opciones.preparado.destino === destino ? opciones.preparado : prepararDestinoTrasbordo(destino, rutas, opciones);
    const { max, trasM, kx, celda, clave, B, rejilla, lista } = prep;
    const tope = opciones.max ?? MAX_TRASBORDOS;
    const tiempo = opciones.tiempo || {};
    const v = Number.isFinite(tiempo.velocidadPieMs) && tiempo.velocidadPieMs > 0 ? tiempo.velocidadPieMs : null;
    const rodeo = Number.isFinite(tiempo.factorRodeo) && tiempo.factorRodeo > 0 ? tiempo.factorRodeo : 1;
    if (lista.length === 0) return vacio;
    const kO = Math.cos((origen.lat * Math.PI) / 180) * M_POR_GRADO;
    const mLatO = max / M_POR_GRADO;
    const mLonO = mLatO / Math.max(0.2, Math.cos((origen.lat * Math.PI) / 180));
    // Candidatas A: pasan a ≤ caminarM del origen; de cada una se guarda, para cada vértice, el mejor punto de subida (el más cercano al origen entre los anteriores).
    const A = [];
    lista.forEach((r) => {
      const t = densificar(r);
      if (origen.lon < t.bbox[0] - mLonO || origen.lon > t.bbox[2] + mLonO || origen.lat < t.bbox[1] - mLatO || origen.lat > t.bbox[3] + mLatO) return;
      const n = t.lat.length;
      const d = new Float64Array(n);
      const mejor = new Int32Array(n);
      let m = -1;
      let md = Infinity;
      for (let k = 0; k < n; k++) {
        d[k] = Math.hypot((t.lon[k] - origen.lon) * kO, (t.lat[k] - origen.lat) * M_POR_GRADO);
        if (d[k] <= max && d[k] < md) { md = d[k]; m = k; }
        mejor[k] = m;
      }
      if (m >= 0) A.push({ r, t, d, mejor, n, clave: claveRuta(r) });
    });
    const out = { trasbordos: [], candidatasA: A.length, candidatasB: B.length };
    if (!A.length || !B.length) return out;

    // Búsqueda gruesa y afinada. Los vértices están cada ≤ 15 m: se busca el trasbordo con uno de cada PASO_GRUESO (≈ 60 m) en la rejilla que reúne los vértices de TODAS las B
    // candidatas (una sola pasada por los de cada A, sin comparar rutas de dos en dos), y luego se afina con todos los vértices cerca del mejor par de cada combinación de rutas.
    const metrica = (caminarM, kmA, kmB, a, b) => {
      const dA = a.r.duracionMin;
      const dB = b.r.duracionMin;
      if (v !== null && Number.isFinite(dA) && dA > 0 && Number.isFinite(dB) && dB > 0 && a.t.s[a.n - 1] > 0 && b.t.s[b.n - 1] > 0) {
        return (caminarM * rodeo) / v / 60 + (dA * kmA) / a.t.s[a.n - 1] + (dB * kmB) / b.t.s[b.n - 1];
      }
      return caminarM * 1e4 + kmA + kmB; // sin tiempo: gana la menor caminata, y a igual caminata, los menores km en vehículo
    };
    const evaluar = (a, b, j, k) => {
      const i = a.mejor[j];
      const m = b.mejor[k];
      if (i < 0 || m < 0) return null;
      const dt = Math.hypot((b.t.lon[k] - a.t.lon[j]) * kx, (b.t.lat[k] - a.t.lat[j]) * M_POR_GRADO);
      if (dt > trasM) return null;
      const kmA = a.t.s[j] - a.t.s[i];
      const kmB = b.t.s[m] - b.t.s[k];
      if (kmA <= 0 || kmB <= 0) return null; // sin recorrido útil en alguna de las dos
      const walk = a.d[i] + dt + b.d[m];
      return { val: metrica(walk, kmA, kmB, a, b), i, j, k, m, dt, kmA, kmB, walk };
    };

    const gruesos = new Map(); // índice de A × B → mejor par grueso
    A.forEach((a, ai) => {
      a.clave = claveRuta(a.r);
      for (let j = 0; j < a.n; j += PASO_GRUESO) {
        if (a.mejor[j] < 0) continue;
        const ci = Math.floor((a.t.lon[j] * kx) / celda);
        const cj = Math.floor((a.t.lat[j] * M_POR_GRADO) / celda);
        for (let p = -1; p <= 1; p++) {
          for (let q = -1; q <= 1; q++) {
            const l = rejilla.get(clave(ci + p, cj + q));
            if (!l) continue;
            for (let z = 0; z < l.length; z += 2) {
              const bi = l[z];
              const b = B[bi];
              if (a.r === b.r || a.clave === b.clave) continue;
              const e = evaluar(a, b, j, l[z + 1]);
              if (!e) continue;
              const id = ai * B.length + bi;
              const previo = gruesos.get(id);
              if (!previo || e.val < previo.val) gruesos.set(id, e);
            }
          }
        }
      }
    });

    const porPar = new Map(); // línea A | línea B → la mejor combinación
    gruesos.forEach((g, id) => {
      const a = A[Math.floor(id / B.length)];
      const b = B[id % B.length];
      let mejor = g;
      for (let j = Math.max(0, g.j - PASO_GRUESO); j <= Math.min(a.n - 1, g.j + PASO_GRUESO); j++) {
        for (let k = Math.max(0, g.k - PASO_GRUESO); k <= Math.min(b.n - 1, g.k + PASO_GRUESO); k++) {
          const e = evaluar(a, b, j, k);
          if (e && e.val < mejor.val) mejor = e;
        }
      }
      const par = `${codigoLinea(a.r.linea)}|${codigoLinea(b.r.linea)}`;
      const previo = porPar.get(par);
      if (!previo || mejor.val < previo.val) porPar.set(par, { ...mejor, a, b });
    });

    const paradas = Array.isArray(opciones.paradas) ? opciones.paradas : [];
    const items = [...porPar.values()].sort((x, y) => x.val - y.val).slice(0, tope).map(({ a, b, i, j, k, m, dt, kmA, kmB, walk }) => {
      const trazo = (t, de, hasta) => { const c = []; for (let q = de; q <= hasta; q++) c.push([t.lon[q], t.lat[q]]); return c; };
      const bajadaA = { lat: a.t.lat[j], lon: a.t.lon[j] };
      const subidaB = { lat: b.t.lat[k], lon: b.t.lon[k] };
      const medio = { lat: (bajadaA.lat + subidaB.lat) / 2, lon: (bajadaA.lon + subidaB.lon) / 2 };
      let parada = null;
      paradas.forEach((s) => {
        if (!esPunto(s) || !Array.isArray(s.rutas) || !(s.rutas.includes(a.r.id) || s.rutas.includes(b.r.id))) return;
        const d = C.haversine(medio.lat, medio.lon, s.lat, s.lon);
        if (d <= trasM && (!parada || d < parada.distanciaM)) parada = { nombre: s.nombre ?? null, lat: s.lat, lon: s.lon, distanciaM: d };
      });
      return {
        rutaA: a.r, rutaB: b.r,
        caminarOrigenM: a.d[i], caminarTrasbordoM: dt, caminarDestinoM: b.d[m], caminarTotalM: walk,
        viajeAM: kmA, viajeBM: kmB, viajeM: kmA + kmB, longitudAM: a.t.s[a.n - 1], longitudBM: b.t.s[b.n - 1],
        subida: { lat: a.t.lat[i], lon: a.t.lon[i] }, bajadaA, subidaB, bajada: { lat: b.t.lat[m], lon: b.t.lon[m] }, trasbordo: medio, parada,
        segmentoA: trazo(a.t, i, j), segmentoB: trazo(b.t, k, m),
      };
    });
    out.trasbordos = items;
    return out;
  }

  /**
   * Tiempo APROXIMADO de un viaje con trasbordo (de rutasConTrasbordo), con los mismos supuestos y reglas que estimarTiempo: caminata de los tres tramos a la velocidad a pie;
   * en vehículo, la duración que OSM etiqueta para cada ruta prorrateada por la distancia recorrida en ella; las DOS esperas (la mitad del intervalo de cada ruta) aparte y sin
   * sumar. Si falta la duración de alguna de las dos rutas no hay tiempo en vehículo ni total, y si falta el intervalo de alguna no hay espera: no se inventan.
   */
  function estimarTiempoTrasbordo(item, tiempo) {
    const t = tiempo || {};
    const rodeo = Number.isFinite(t.factorRodeo) && t.factorRodeo > 0 ? t.factorRodeo : 1;
    const caminarMin = Number.isFinite(t.velocidadPieMs) && t.velocidadPieMs > 0 ? (item.caminarTotalM * rodeo) / t.velocidadPieMs / 60 : null;
    const a = item.rutaA || {};
    const b = item.rutaB || {};
    const ok = (x) => Number.isFinite(x) && x > 0;
    const busMin = ok(a.duracionMin) && ok(b.duracionMin) && item.longitudAM > 0 && item.longitudBM > 0 ? (a.duracionMin * item.viajeAM) / item.longitudAM + (b.duracionMin * item.viajeBM) / item.longitudBM : null;
    return {
      caminarMin,
      busMin,
      totalSinEsperaMin: caminarMin !== null && busMin !== null ? caminarMin + busMin : null,
      esperaMediaMin: ok(a.intervaloMin) && ok(b.intervaloMin) ? (a.intervaloMin + b.intervaloMin) / 2 : null,
      fuenteBus: busMin !== null ? 'duración que etiqueta OpenStreetMap en cada ruta, prorrateada por la distancia recorrida' : null,
    };
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

  /**
   * Como indiceDestino, pero para llegar con UN trasbordo: de cada ruta A solo se guardan los puntos ANTERIORES al último en el que se puede hacer trasbordo a una ruta B que baja a
   * `caminarM` o menos del destino (B distinta de A y con recorrido útil hasta ese punto). Se consulta con `alcanza`, igual que el índice de las directas.
   */
  function indiceDestinoTrasbordo(destino, rutas, opciones = {}) {
    const prep = opciones.preparado && opciones.preparado.destino === destino ? opciones.preparado : prepararDestinoTrasbordo(destino, rutas, opciones);
    const { max, trasM, kx, celda, clave, B, rejilla, lista } = prep;
    const bLat = max / M_POR_GRADO;
    const bLon = bLat / Math.max(0.2, Math.cos((destino.lat * Math.PI) / 180));
    const casillas = new Map();
    const usadas = [];
    lista.forEach((r) => {
      const t = densificar(r);
      const cl = claveRuta(r);
      const n = t.lat.length;
      let jMax = -1;
      for (let j = Math.floor((n - 1) / PASO_GRUESO) * PASO_GRUESO; j >= 0 && jMax < 0; j -= PASO_GRUESO) {
        const ci = Math.floor((t.lon[j] * kx) / celda);
        const cj = Math.floor((t.lat[j] * M_POR_GRADO) / celda);
        for (let p = -1; p <= 1 && jMax < 0; p++) {
          for (let q = -1; q <= 1 && jMax < 0; q++) {
            const l = rejilla.get(clave(ci + p, cj + q));
            if (!l) continue;
            for (let z = 0; z < l.length; z += 2) {
              const b = B[l[z]];
              if (b.r === r || b.clave === cl) continue;
              const kk = l[z + 1];
              if (Math.hypot((b.t.lon[kk] - t.lon[j]) * kx, (b.t.lat[kk] - t.lat[j]) * M_POR_GRADO) > trasM) continue;
              if (b.t.s[b.mejor[kk]] - b.t.s[kk] <= 0) continue;
              jMax = j;
              break;
            }
          }
        }
      }
      if (jMax <= 0) return;
      const idx = usadas.push(r) - 1;
      for (let i = 0; i < jMax; i++) {
        const c = `${Math.floor(t.lat[i] / bLat)},${Math.floor(t.lon[i] / bLon)}`;
        let l = casillas.get(c);
        if (!l) { l = []; casillas.set(c, l); }
        l.push(idx, t.lat[i], t.lon[i]);
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
    const idxT = opciones.trasbordo ? indiceDestinoTrasbordo(destino, rutas, opciones) : null; // opt-in: también con un trasbordo
    const out = [];
    (celdas || []).forEach((celda) => {
      const a = alcanza(idx, celda);
      if (a.cumple) { out.push({ celda, caminarM: a.caminarM, ruta: a.ruta, n: a.n, tipo: 'directa' }); return; }
      if (!idxT) return;
      const t = alcanza(idxT, celda);
      if (t.cumple) out.push({ celda, caminarM: t.caminarM, ruta: t.ruta, n: t.n, tipo: 'trasbordo' });
    });
    return out;
  }

  /** La misma ruta (línea + ramal + de + hasta) que OpenStreetMap dibuja en más de una relación sale una vez, con la de menor caminata; los datos que falten (duración, intervalo…) se toman de las otras. */
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
      const fuentes = [...new Set(g.map((x) => x.ruta.fuente))];
      const mejor = [...g].sort((a, b) => a.caminarTotalM - b.caminarTotalM)[0];
      const ruta = { ...mejor.ruta };
      g.forEach((x) => {
        Object.entries(x.ruta).forEach(([k, v]) => { if (ruta[k] === null || ruta[k] === undefined) ruta[k] = v; });
      });
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

  return { CAMINAR_M, PASO_M, TRASBORDO_M, MAX_TRASBORDOS, desdeOsm, paradasDeOsm, rutasDirectas, rutasConTrasbordo, prepararDestinoTrasbordo, estimarTiempoTrasbordo, estimarTiempo, cercanas, indiceDestino, indiceDestinoTrasbordo, alcanza, zonasConRutaDirecta, unir, resolverDestino, textoRuta, codigoLinea, metros };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Viaje;
