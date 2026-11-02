/**
 * asistente.js — Lógica del asistente de chat (sin DOM, sin red, sin estado).
 *
 * El asistente NO usa un modelo de lenguaje: entiende frases en español con reglas explícitas y responde únicamente con
 * lo que ya calculan las 5 variables (zonificación, salud, educación, transporte y área verde) y con los mismos datos y
 * umbrales de CONFIG. Por eso funciona en el sitio estático, no necesita claves ni servidor y no puede inventar un dato:
 * si algo no está en los datos, lo dice.
 *
 *   interpretar(texto, ctx)   → intención { tipo, modo, criterios, radioGlobalM, lote, ... }
 *   responder(intencion, ctx) → { texto, sugerencias } sobre el punto ya consultado (ficha, zona, PDM, fuentes…)
 *   prepararDatos / generarCeldas / evaluarCelda / buscar → búsqueda de zonas por criterios y prioridades
 *   formatearBusqueda(resultado, meta) → { texto, filas, sugerencias } listo para mostrar
 *
 * Búsqueda: se arma una cuadrícula sobre las zonas construibles del plano y, en cada celda, se evalúa cada criterio con
 * Calculos (haversine y área de OpenStreetMap congelado). Luego se agrupa por distrito. Lo que se informa es el
 * PORCENTAJE del suelo habitable de cada distrito que cumple lo pedido; no es una probabilidad ni una recomendación.
 * Se carga como script del navegador (define `Asistente`) y también como módulo CommonJS para las pruebas.
 */
const Asistente = (() => {
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef
  const M_POR_GRADO = (Math.PI / 180) * C.RADIO_TIERRA_M;
  const rad = (d) => (d * Math.PI) / 180;
  const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);

  // ------------------------------------------------------------------ Criterios

  /**
   * Lo que la persona puede pedir. `servicio`: sale de OpenStreetMap con los umbrales de CONFIG.umbrales.
   * `zona`: sale del plano de zonificación; `aproximado` marca lo que NO es un dato medido sino una aproximación con la
   * zonificación (no hay datos de ruido, de centros comerciales ni de barrios tradicionales).
   */
  const CRITERIOS = {
    salud: { etiqueta: 'Salud', tipo: 'servicio' },
    inicial: { etiqueta: 'Colegio inicial', tipo: 'servicio', nivel: 'inicial' },
    primaria: { etiqueta: 'Colegio primaria', tipo: 'servicio', nivel: 'primaria' },
    secundaria: { etiqueta: 'Colegio secundaria', tipo: 'servicio', nivel: 'secundaria' },
    // «Colegio» sin nivel = inicial o primaria. Secundaria no entra: su umbral (3 km) hace que casi toda la ciudad cumpla y
    // «cerca de un colegio» dejaría de distinguir zonas. Quien la quiere dice «secundaria».
    colegio: { etiqueta: 'Colegio (inicial o primaria)', tipo: 'servicio', niveles: ['inicial', 'primaria'] },
    transporte: { etiqueta: 'Transporte', tipo: 'servicio' },
    areaVerde: { etiqueta: 'Área verde', tipo: 'servicio' },
    residencial: { etiqueta: 'Zona residencial', tipo: 'zona', grupos: ['residencial'], umbralM: 0 },
    tranquilo: { etiqueta: 'Zona tranquila (residencial de densidad baja o media 1)', tipo: 'zona', codigos: ['RDB', 'RDM-1'], umbralM: 0, aproximado: true },
    campina: { etiqueta: 'Campiña (zona agrícola)', tipo: 'zona', codigos: ['ZA', 'ZRE-PA'], umbralClave: 'campina' },
    comercial: { etiqueta: 'Zona comercial', tipo: 'zona', grupos: ['comercial'], umbralClave: 'comercial', aproximado: true },
    historico: { etiqueta: 'Centro histórico', tipo: 'zona', codigos: ['ZRE-CH'], umbralClave: 'historico', aproximado: true },
  };

  // Cómo se reconoce cada criterio en el texto ya normalizado (sin tildes, en minúsculas). El orden importa.
  const PATRONES = [
    ['inicial', /\b(inicial(?:es)?|jardin(?:es)? de (?:ninos|infantes|infancia)|nido|cuna|kinder|parvulos?)\b/g],
    ['primaria', /\bprimaria\b/g],
    ['secundaria', /\bsecundaria\b/g],
    ['colegio', /\b(colegios?|escuelas?|cole|centros? educativos?|instituciones? educativas?|educacion)\b/g],
    ['salud', /\b(postas?|hospital(?:es)?|clinicas?|centros? de salud|consultorios?|salud|medic[oa]s?|doctor(?:es)?)\b/g],
    ['transporte', /\b(paraderos?|buses?|transporte|combis?|micros?|movilidad|paradas?)\b/g],
    ['areaVerde', /\b(areas? verdes?|parques?|espacios? verdes?|zonas? verdes?|jardin(?:es)?|verde)\b/g],
    ['campina', /\b(campina|campo|agricol\w*|chacras?|rural|sembrios?|cultivos?)\b/g],
    ['tranquilo', /\b(tranquil\w*|silenci\w*|calma|calmad\w*|sin ruido|poco ruido|paz)\b/g],
    ['comercial', /\b(malls?|centros? comerciales?|supermercados?|comercios?|tiendas|shopping|compras)\b/g],
    ['historico', /\b(tradicional(?:es)?|historic\w*|casco|barrios? antiguos?|sillar)\b/g],
    ['residencial', /\b(residencial(?:es)?|viviendas?|casas?)\b/g],
  ];

  const TEMAS_SIN_DATOS = [
    ['seguridad', /\b(segur\w*|inseguridad|delincuen\w*|robos?|crimen|asalt\w*|peligros\w*)\b/],
    ['precio', /\b(precios?|caro|cara|baratos?|baratas?|barato|costos?|cuanto cuesta|alquiler|presupuesto)\b/],
  ];

  const RE = {
    saludo: /^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|saludos)\b/,
    ayuda: /\b(ayuda|que puedes|que haces|que sabes|como funciona|como te uso|para que sirves|opciones|instrucciones)\b/,
    fuentes: /\b(fuentes?|de donde (?:salen|vienen|sacas|obtienes)|como se calcula|como calculas|metodolog\w*|metodo)\b/,
    pdm: /\b(pdm|plan de desarrollo|zonificacion proyectada|nuevo plan|va a cambiar|cambiara|cambiar[ai]?|futuro|aprobad[oa])\b/,
    construir: /\b(construir|edificar|pisos|altura|coeficiente|area libre|techad\w*|cuanto (?:puedo|se puede)|lote)\b/,
    zona: /\b(que zona|zonificacion|zona es|uso de suelo|que permite|tipo de zona|que se puede hacer)\b/,
    ficha: /\b(resumen|ficha|reporte|que hay cerca|que tengo cerca|analiza\w*|servicios cerca|que servicios)\b/,
    busqueda: /\b(busc\w*|quier\w*|encuentr\w*|recomi\w*|donde|zonas?|distritos?|lugar(?:es)?|sitios?|vivir|mudar\w*|comprar|sugier\w*|mejor(?:es)?|ubica\w*|necesit\w*|me gustaria)\b/,
    punto: /\b(mi punto|este punto|mi predio|este predio|este terreno|mi terreno|esta ubicacion|el punto|aqui|ahi)\b/,
    preguntaPunto: /^(hay|tiene|queda|esta|existe|cuanto|a cuanto|cuan)\b/,
    prioridad: /\b(prioriz\w*|lo mas importante|sobre todo|principalmente|mas que nada|prefiero|me importa mas|importa mas)\b/,
    agregar: /^(y |tambien |ademas )|\b(agrega\w*|anade\w*|suma\w*|incorpora\w*)\b/,
    quitar: /\b(quita\w*|elimina\w*|saca\w*|ya no|olvida\w*)\b/,
    condicional: /condicional/,
  };

  /** Texto en minúsculas, sin tildes ni signos de pregunta, para comparar sin depender de cómo se escribió. */
  function normalizar(texto) {
    return String(texto ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/²/g, '2')
      .replace(/[¿?¡!;:"()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const NUMEROS = [[/\bmedio kilometro\b/g, '0.5 km'], [/\bun kilometro\b/g, '1 km'], [/\bdos kilometros\b/g, '2 km'], [/\btres kilometros\b/g, '3 km']];
  const aNumero = (s) => Number(String(s).replace(',', '.'));

  /** Criterios que aparecen en una frase, sin repetir y respetando que un nivel explícito reemplaza a «colegio». */
  function criteriosEn(frase) {
    const ids = new Set();
    let resto = frase;
    PATRONES.forEach(([id, re]) => {
      if (new RegExp(re.source).test(resto)) {
        ids.add(id);
        resto = resto.replace(re, ' '); // «jardín de niños» se consume aquí y no cuenta además como área verde
      }
    });
    if (['inicial', 'primaria', 'secundaria'].some((n) => ids.has(n))) ids.delete('colegio');
    return [...ids];
  }

  /** Distancias en metros que aparecen en una frase. */
  function distanciasEn(frase) {
    const out = [];
    const re = /(\d+(?:[.,]\d+)?)\s*(km|kms|kilometros?|m|mts?|metros?)\b/g;
    let m;
    while ((m = re.exec(frase)) !== null) out.push(/^k/.test(m[2]) ? aNumero(m[1]) * 1000 : aNumero(m[1]));
    return out;
  }

  /**
   * Convierte lo escrito en una intención.
   *   ctx: { hayPunto?: boolean, ultimaBusqueda?: { criterios } }
   * tipo: saludo | ayuda | fuentes | pdm | construir | zona | ficha | servicio | buscar | no_soportado | desconocido
   * modo (solo en buscar): nuevo | agregar | quitar | priorizar
   */
  function interpretar(texto, ctx = {}) {
    const intencion = {
      tipo: 'desconocido', modo: 'nuevo', criterios: [], radioGlobalM: null, lote: null, incluirCondicional: false,
      temaNoSoportado: null, aproximados: [], limitarAlPunto: false,
    };
    let t = normalizar(texto);
    if (!t) return intencion;
    t = t.replace(/(\d),(\d)/g, '$1.$2'); // «1,5 km»: la coma decimal no debe partir la frase
    NUMEROS.forEach(([re, v]) => { t = t.replace(re, v); });

    intencion.incluirCondicional = RE.condicional.test(t);
    const tema = TEMAS_SIN_DATOS.find(([, re]) => re.test(t));
    intencion.temaNoSoportado = tema ? tema[0] : null;

    // El área del lote se saca primero para que sus «m²» no se lean como una distancia.
    const mLote = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|mt2|mts2|metros cuadrados|metro cuadrado)\b/);
    if (mLote) {
      intencion.lote = aNumero(mLote[1]);
      t = t.replace(mLote[0], ' ');
    }

    // Criterios, prioridades y distancias, frase por frase.
    const frases = t.split(/[,;]| y | e | pero /).map((f) => f.trim()).filter(Boolean);
    const porId = new Map();
    const distancias = []; // { m, ids }
    frases.forEach((f) => {
      const ids = criteriosEn(f);
      const prio = RE.prioridad.test(f) ? 2 : 1;
      ids.forEach((id) => { porId.set(id, { id, umbralM: null, prioridad: Math.max(prio, porId.get(id)?.prioridad ?? 1) }); });
      distanciasEn(f).forEach((m) => distancias.push({ m, ids }));
    });

    // Una sola distancia en el mensaje vale para todos los criterios («en un radio de 1 km»); varias, cada una para
    // los criterios de su frase («colegio a 500 m y parque a 300 m»).
    if (distancias.length === 1) intencion.radioGlobalM = distancias[0].m;
    else distancias.forEach(({ m, ids }) => {
      if (ids.length === 0) intencion.radioGlobalM = intencion.radioGlobalM ?? m;
      else ids.forEach((id) => { porId.get(id).umbralM = m; });
    });
    intencion.criterios = [...porId.values()];
    intencion.aproximados = intencion.criterios.filter((c) => CRITERIOS[c.id].aproximado).map((c) => c.id);

    const hayCriterios = intencion.criterios.length > 0;
    const ultima = ctx.ultimaBusqueda && ctx.ultimaBusqueda.criterios && ctx.ultimaBusqueda.criterios.length > 0;
    const punto = RE.punto.test(t);
    intencion.limitarAlPunto = punto && RE.busqueda.test(t);

    if (!hayCriterios && RE.saludo.test(t)) return { ...intencion, tipo: 'saludo' };
    if (RE.ayuda.test(t) && !hayCriterios) return { ...intencion, tipo: 'ayuda' };

    // Ajustes sobre la búsqueda anterior.
    if (ultima) {
      if (RE.quitar.test(t) && hayCriterios) return { ...intencion, tipo: 'buscar', modo: 'quitar' };
      if (RE.prioridad.test(t) && hayCriterios) {
        intencion.criterios.forEach((c) => { c.prioridad = 2; });
        return { ...intencion, tipo: 'buscar', modo: 'priorizar' };
      }
      if ((RE.agregar.test(t) && hayCriterios) || (intencion.incluirCondicional && !hayCriterios)) return { ...intencion, tipo: 'buscar', modo: 'agregar' };
    }

    if (!hayCriterios) {
      if (RE.fuentes.test(t)) return { ...intencion, tipo: 'fuentes' };
      if (RE.pdm.test(t)) return { ...intencion, tipo: 'pdm' };
      if (intencion.lote !== null || RE.construir.test(t)) return { ...intencion, tipo: 'construir' };
      if (RE.zona.test(t)) return { ...intencion, tipo: 'zona' };
      if (RE.ficha.test(t)) return { ...intencion, tipo: 'ficha' };
      if (intencion.temaNoSoportado) return { ...intencion, tipo: 'no_soportado' };
      return intencion;
    }

    if (RE.ficha.test(t) && !RE.busqueda.test(t)) return { ...intencion, tipo: 'ficha' };
    const sobrePunto = !RE.busqueda.test(t) && (punto || (ctx.hayPunto && RE.preguntaPunto.test(t)));
    return { ...intencion, tipo: sobrePunto ? 'servicio' : 'buscar' };
  }

  // ----------------------------------------------------------------- Formatos

  const fmtNum = (n) => Math.round(n).toLocaleString('es-PE');
  const fmtDist = (d) => {
    if (d < 1000) return `${Math.round(d)} m`;
    return `${(d / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',')} km`;
  };
  const fmtUmbral = (m) => `${Math.round(m)} m`; // los umbrales se dicen siempre en metros, como en la ficha
  const titulo = (t) => String(t).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\b(Y|De|Del|La)\b/g, (m) => m.toLowerCase());
  const pct = (n) => `${Math.round(n)} %`;
  const hay = (v) => v !== null && v !== undefined && v !== '';
  const baseMax = (a, b) => (hay(b) && b !== a ? `${a} (hasta ${b})` : `${a}`);

  // ------------------------------------------------------------ Datos de búsqueda

  const bboxDeAnillo = (anillo) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    anillo.forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    });
    return b;
  };
  const bboxDeGeometria = (g) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const polis = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    polis.forEach((anillos) => {
      const t = bboxDeAnillo(anillos[0] || []);
      b[0] = Math.min(b[0], t[0]); b[1] = Math.min(b[1], t[1]); b[2] = Math.max(b[2], t[2]); b[3] = Math.max(b[3], t[3]);
    });
    return b;
  };
  const puntoDe = (f) => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], nombre: f.properties.nombre || null });
  const esPunto = (f) => f && f.geometry && f.geometry.type === 'Point';

  /** ¿La zona cumple lo que pide el criterio de zona (por código o por grupo)? */
  const zonaCoincide = (def, codigo, grupo) => (def.codigos ? def.codigos.includes(codigo) : false) || (def.grupos ? def.grupos.includes(grupo) : false);

  /**
   * Ordena los datos de OpenStreetMap y de zonificación para evaluarlos rápido.
   *   entrada: { salud, educacion, transporte, areasVerdes } (listas de Feature, como los archivos congelados)
   *   zonas:   [{ codigo, bbox, polys, regla }] (Zonificacion.zonas)
   */
  function prepararDatos(entrada, zonas, umbrales) {
    const e = entrada || {};
    const areaMin = umbrales.areaVerde.areaMinM2;
    const colegios = { inicial: [], primaria: [], secundaria: [] };
    (e.educacion || []).filter(esPunto).forEach((f) => {
      C.nivelesEducativos(f.properties.tags).forEach((n) => colegios[n].push(puntoDe(f)));
    });
    const verdes = (e.areasVerdes || [])
      .map((f) => ({ geometry: f.geometry, areaM2: C.areaGeometriaM2(f.geometry), nombre: f.properties.nombre || null }))
      .filter((v) => v.areaM2 >= areaMin)
      .map((v) => ({ ...v, bbox: bboxDeGeometria(v.geometry) }));
    const zonasPorCriterio = {};
    Object.entries(CRITERIOS).filter(([, d]) => d.tipo === 'zona').forEach(([id, def]) => {
      zonasPorCriterio[id] = (zonas || [])
        .filter((z) => zonaCoincide(def, z.codigo, z.regla && z.regla.grupo))
        .map((z) => ({ bbox: z.bbox, geometry: { type: 'MultiPolygon', coordinates: z.polys } }));
    });
    return {
      salud: (e.salud || []).filter(esPunto).map(puntoDe),
      colegios,
      transporte: (e.transporte || []).filter(esPunto).map(puntoDe),
      verdes,
      zonasPorCriterio,
    };
  }

  const distanciaM = (a, b) => C.haversine(a.lat, a.lon, b.lat, b.lon);

  /** Cuadrícula de celdas de `pasoM` metros sobre las zonas construibles (y, si se pide, condicionadas) del plano. */
  function generarCeldas(zonas, opciones = {}) {
    const { pasoM = 250, incluirCondicional = false, centro = null, radioM = null } = opciones;
    const conBbox = (zonas || []).filter((z) => z.bbox);
    if (conBbox.length === 0) return [];
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    conBbox.forEach((z) => {
      b[0] = Math.min(b[0], z.bbox[0]); b[1] = Math.min(b[1], z.bbox[1]); b[2] = Math.max(b[2], z.bbox[2]); b[3] = Math.max(b[3], z.bbox[3]);
    });
    const dLat = pasoM / M_POR_GRADO;
    const celdas = [];
    for (let lat = b[1] + dLat / 2; lat < b[3]; lat += dLat) {
      const dLon = pasoM / (M_POR_GRADO * Math.cos(rad(lat)));
      for (let lon = b[0] + dLon / 2; lon < b[2]; lon += dLon) {
        if (centro && radioM !== null && distanciaM(centro, { lat, lon }) > radioM) continue;
        let hit = null; // gana la última zona que contiene el punto, como en el plano
        for (const z of conBbox) {
          if (lon < z.bbox[0] || lon > z.bbox[2] || lat < z.bbox[1] || lat > z.bbox[3]) continue;
          if (z.polys.some((anillos) => C.puntoEnPoligono(lat, lon, anillos))) hit = z;
        }
        if (!hit || !hit.regla) continue;
        const ed = hit.regla.edificable;
        if (ed === 'si' || (incluirCondicional && ed === 'condicionado')) celdas.push({ lat, lon, zona: hit.codigo, grupo: hit.regla.grupo });
      }
    }
    return celdas;
  }

  // -------------------------------------------------------------------- Evaluación

  /** Elemento más cercano de una lista de puntos. */
  function masCercano(lista, lat, lon) {
    let mejor = null;
    let mejorD = Infinity;
    for (const p of lista) {
      if (Math.abs(p.lat - lat) * M_POR_GRADO >= mejorD) continue; // ya hay uno más cerca que esta franja de latitud
      const d = C.haversine(lat, lon, p.lat, p.lon);
      if (d < mejorD) { mejor = p; mejorD = d; }
    }
    return { item: mejor, d: mejorD };
  }

  /** Distancia mínima a una lista de {bbox, geometry}, mirando solo las que caen dentro de `limiteM`. */
  function distanciaMinima(lista, lat, lon, limiteM) {
    const margenLat = limiteM / M_POR_GRADO;
    const margenLon = margenLat / Math.max(0.01, Math.cos(rad(lat)));
    let mejor = null;
    let mejorD = Infinity;
    for (const g of lista) {
      const b = g.bbox;
      if (lon < b[0] - margenLon || lon > b[2] + margenLon || lat < b[1] - margenLat || lat > b[3] + margenLat) continue;
      const d = C.distanciaAGeometriaM(lat, lon, g.geometry);
      if (d < mejorD) { mejor = g; mejorD = d; }
    }
    return { item: mejor, d: mejorD };
  }

  /** Umbral con el que se evalúa un criterio: el propio, o el radio global, o el de CONFIG. */
  function umbralDe(req, umbrales, radioGlobalM, nivel) {
    if (esNumero(req.umbralM)) return req.umbralM;
    const def = CRITERIOS[req.id];
    if (def.tipo === 'zona') {
      if (esNumero(def.umbralM)) return def.umbralM; // «residencial» y «tranquilo» se miden dentro de la zona
      return esNumero(radioGlobalM) ? radioGlobalM : umbrales.zona[def.umbralClave];
    }
    if (esNumero(radioGlobalM)) return radioGlobalM;
    if (nivel) return umbrales.educacion[nivel];
    if (req.id === 'areaVerde') return umbrales.areaVerde.distanciaM;
    return umbrales[req.id];
  }

  function evaluarServicio(req, celda, datos, umbrales, radioGlobalM) {
    const { lat, lon } = celda;
    if (req.id === 'areaVerde') {
      const u = umbralDe(req, umbrales, radioGlobalM);
      const r = distanciaMinima(datos.verdes, lat, lon, u);
      return { cumple: r.item !== null && r.d <= u, distanciaM: r.item ? r.d : null, nombre: r.item ? r.item.nombre : null, umbralM: u };
    }
    const niveles = CRITERIOS[req.id].niveles || (CRITERIOS[req.id].nivel ? [CRITERIOS[req.id].nivel] : null);
    if (niveles) {
      let mejor = null;
      niveles.forEach((n) => {
        const u = umbralDe(req, umbrales, radioGlobalM, n);
        const r = masCercano(datos.colegios[n], lat, lon);
        const ev = { cumple: r.item !== null && r.d <= u, distanciaM: r.item ? r.d : null, nombre: r.item ? r.item.nombre : null, umbralM: u, nivel: n };
        if (!mejor || (ev.cumple && !mejor.cumple) || (ev.cumple === mejor.cumple && (ev.distanciaM ?? Infinity) < (mejor.distanciaM ?? Infinity))) mejor = ev;
      });
      return mejor;
    }
    const lista = req.id === 'salud' ? datos.salud : datos.transporte;
    const u = umbralDe(req, umbrales, radioGlobalM);
    const r = masCercano(lista, lat, lon);
    return { cumple: r.item !== null && r.d <= u, distanciaM: r.item ? r.d : null, nombre: r.item ? r.item.nombre : null, umbralM: u };
  }

  function evaluarZona(req, celda, datos, umbrales, radioGlobalM) {
    const def = CRITERIOS[req.id];
    const u = umbralDe(req, umbrales, radioGlobalM);
    if (zonaCoincide(def, celda.zona, celda.grupo)) return { cumple: true, distanciaM: 0, nombre: celda.zona, umbralM: u };
    if (u <= 0) return { cumple: false, distanciaM: null, nombre: null, umbralM: u };
    const r = distanciaMinima(datos.zonasPorCriterio[req.id] || [], celda.lat, celda.lon, u);
    return { cumple: r.item !== null && r.d <= u, distanciaM: r.item ? r.d : null, nombre: null, umbralM: u };
  }

  /** Evalúa cada criterio en una celda. Devuelve { [id]: { cumple, distanciaM, nombre, umbralM } }. */
  function evaluarCelda(celda, datos, criterios, umbrales, radioGlobalM = null) {
    const out = {};
    criterios.forEach((req) => {
      out[req.id] = CRITERIOS[req.id].tipo === 'zona'
        ? evaluarZona(req, celda, datos, umbrales, radioGlobalM)
        : evaluarServicio(req, celda, datos, umbrales, radioGlobalM);
    });
    return out;
  }

  // ------------------------------------------------------------------- Búsqueda

  /**
   * Busca zonas que cumplen los criterios y las ordena por distrito.
   *   criterios: [{ id, umbralM, prioridad }]  (prioridad 2 pesa el doble: convención del asistente)
   *   Devuelve { criterios, totalCeldas, pasoM, areas, puntos }.
   *   areas:   por distrito, el % de celdas que cumplen todo (pctCumpleTodo) y el puntaje ponderado (puntajePct).
   *   puntos:  las mejores celdas, separadas entre sí, con el detalle de cada criterio.
   */
  function buscar(opciones) {
    const {
      criterios, zonas, datos, distritoDe, umbrales, pasoM = 250, minCeldas = 8, centro = null, radioM = null,
      incluirCondicional = false, radioGlobalM = null, maxPuntos = 5, separacionM = 600, celdas: celdasDadas = null,
    } = opciones;
    if (!criterios || criterios.length === 0) throw new Error('Falta al menos un criterio para buscar.');
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // La cuadrícula no depende de los criterios: quien llama puede pasar la ya calculada (generarCeldas con los mismos
    // `pasoM` e `incluirCondicional`) y así «agrega…», «quita…» o «prioriza…» no la rehacen. El radio se aplica aquí.
    const base = celdasDadas || generarCeldas(zonas, { pasoM, incluirCondicional });
    const celdas = centro && radioM !== null ? base.filter((c) => distanciaM(centro, c) <= radioM) : base;
    const pesoTotal = criterios.reduce((s, c) => s + (c.prioridad || 1), 0);
    // Qué tan holgado cumple una celda: suma de distancia/umbral (sin dato pesa 2). Menos es mejor; desempata el puntaje.
    const holgura = (e) => criterios.reduce((s, c) => s + (e.ev[c.id].distanciaM === null ? 2 : e.ev[c.id].distanciaM / (e.ev[c.id].umbralM || 1)), 0);
    const porArea = new Map();
    const evaluadas = [];

    celdas.forEach((celda) => {
      const ev = evaluarCelda(celda, datos, criterios, umbrales, radioGlobalM);
      let ponderado = 0;
      let todo = true;
      criterios.forEach((c) => {
        if (ev[c.id].cumple) ponderado += c.prioridad || 1;
        else todo = false;
      });
      const puntaje = (100 * ponderado) / pesoTotal;
      const nombre = (distritoDe && distritoDe(celda.lat, celda.lon)) || 'Sin distrito';
      const a = porArea.get(nombre) || { nombre, celdas: 0, todo: 0, suma: 0, por: {} };
      a.celdas += 1;
      a.suma += puntaje;
      if (todo) a.todo += 1;
      criterios.forEach((c) => { if (ev[c.id].cumple) a.por[c.id] = (a.por[c.id] || 0) + 1; });
      const reg = { celda, ev, puntaje, todo, distrito: nombre };
      if (!a.mejor || reg.puntaje > a.mejor.puntaje || (reg.puntaje === a.mejor.puntaje && holgura(reg) < holgura(a.mejor))) a.mejor = reg;
      porArea.set(nombre, a);
      evaluadas.push(reg);
    });

    const areas = [...porArea.values()]
      .filter((a) => a.celdas >= minCeldas)
      .map((a) => ({
        nombre: a.nombre,
        celdas: a.celdas,
        pctCumpleTodo: (100 * a.todo) / a.celdas,
        puntajePct: a.suma / a.celdas,
        mejor: { lat: a.mejor.celda.lat, lon: a.mejor.celda.lon, zona: a.mejor.celda.zona, puntajePct: a.mejor.puntaje, detalle: a.mejor.ev },
        porCriterio: Object.fromEntries(criterios.map((c) => [c.id, (100 * (a.por[c.id] || 0)) / a.celdas])),
      }))
      .sort((x, y) => y.puntajePct - x.puntajePct || y.pctCumpleTodo - x.pctCumpleTodo);

    // Mejores puntos: más puntaje primero y, a igual puntaje, los que cumplen con más holgura. Separados entre sí.
    const puntos = [];
    [...evaluadas].sort((x, y) => y.puntaje - x.puntaje || holgura(x) - holgura(y)).some((e) => {
      if (puntos.every((p) => distanciaM(p, e.celda) >= separacionM)) {
        puntos.push({
          lat: e.celda.lat, lon: e.celda.lon, distrito: e.distrito, zona: e.celda.zona, puntajePct: e.puntaje, cumpleTodo: e.todo, detalle: e.ev,
        });
      }
      return puntos.length >= maxPuntos;
    });

    const resueltos = criterios.map((c) => ({ ...c, umbralEfectivoM: CRITERIOS[c.id].tipo === 'zona' ? umbralDe(c, umbrales, radioGlobalM) : (CRITERIOS[c.id].niveles ? null : umbralDe(c, umbrales, radioGlobalM, CRITERIOS[c.id].nivel)) }));
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { criterios: resueltos, totalCeldas: celdas.length, pasoM, areas, puntos, tiempoMs: Math.round(t1 - t0) };
  }

  // ----------------------------------------------------------------- Respuestas

  const SUGERENCIAS_BASE = [
    'Busco una zona con colegio, posta y área verde',
    '¿Qué zona es mi punto?',
    'Dame un resumen de mi punto',
    '¿Cambiará la zonificación?',
  ];

  /** Cómo se dice un criterio, con su umbral, para repetirle a la persona lo que se entendió. */
  function describirCriterio(c, umbrales, radioGlobalM) {
    const def = CRITERIOS[c.id];
    const prio = c.prioridad > 1 ? ' (prioridad)' : '';
    if (def.tipo === 'zona') {
      const u = umbralDe(c, umbrales, radioGlobalM);
      return `${def.etiqueta}${u > 0 ? ` a ${fmtUmbral(u)} o menos` : ''}${prio}`;
    }
    if (def.niveles) {
      const partes = def.niveles.map((n) => `${n} ${fmtUmbral(umbralDe(c, umbrales, radioGlobalM, n))}`);
      return `${def.etiqueta}: ${partes.join(', ')}${prio}`;
    }
    const u = umbralDe(c, umbrales, radioGlobalM, def.nivel);
    return `${def.etiqueta} a ${fmtUmbral(u)} o menos${prio}`;
  }

  const ESTADO = { 'CUMPLE': 'cumple', 'NO CUMPLE': 'no cumple', 'SIN DATO': 'sin dato' };
  const linea = (etiqueta, r) => {
    if (!r) return `${etiqueta}: sin dato.`;
    if (r.estado === 'SIN DATO' || r.distanciaM === null) return `${etiqueta}: sin dato en los datos que tengo (no significa que no exista).`;
    const extra = r.areaM2 ? `, ${fmtNum(r.areaM2)} m²` : '';
    return `${etiqueta}: ${ESTADO[r.estado]} · ${r.nombre || 'sin nombre en OSM'} a ${fmtDist(r.distanciaM)} (referencia ${fmtUmbral(r.umbralM)}${extra}).`;
  };

  function lineasServicio(id, entorno) {
    if (id === 'salud') return [linea('Salud', entorno.salud)];
    if (id === 'transporte') return [linea('Transporte', entorno.transporte)];
    if (id === 'areaVerde') return [linea('Área verde', entorno.areaVerde)];
    // Para describir un punto se cuentan los tres niveles, aunque la búsqueda de «colegio» use solo inicial y primaria.
    const niveles = id === 'colegio' ? ['inicial', 'primaria', 'secundaria'] : [CRITERIOS[id].nivel];
    return niveles.map((n) => linea(`Colegio ${n}`, entorno.educacion[n]));
  }

  const EDIFICABLE = {
    si: 'es construible',
    condicionado: 'requiere consulta: lo que se puede construir depende de la zona vecina, de un plan específico o de una norma especial',
    no: 'no es construible',
  };
  const AVISO_REFERENCIAL = 'Es una consulta referencial: no reemplaza el Certificado de Parámetros Urbanísticos y Edificatorios ni el de Zonificación y Vías.';

  function sinPunto() {
    return { texto: 'Primero elige un punto en el mapa o escribe una dirección. Con el punto elegido puedo contarte su zona y los servicios cercanos. Mientras tanto puedo buscar zonas por lo que te importa, por ejemplo: «busco cerca de un colegio y un parque».', sugerencias: SUGERENCIAS_BASE };
  }

  function textoZona(zona) {
    const r = zona.regla;
    if (!r) return `La zona ${zona.codigo} no tiene reglas en la tabla del proyecto.`;
    const p = [];
    if (hay(r.pisos_base)) p.push(`pisos: ${baseMax(r.pisos_base, r.pisos_max)}`);
    if (hay(r.coef_base)) p.push(`coeficiente de edificación: ${baseMax(r.coef_base, r.coef_max)}`);
    if (hay(r.area_libre_pct)) p.push(`área libre mínima: ${r.area_libre_pct} %`);
    if (hay(r.lote_min_m2)) p.push(`lote mínimo: ${fmtNum(r.lote_min_m2)} m²`);
    if (hay(r.frente_min_m)) p.push(`frente mínimo: ${r.frente_min_m} m`);
    return [`La zona ${zona.codigo} (${r.nombre}) ${EDIFICABLE[r.edificable] || 'no tiene condición definida'}.`, p.length ? `Parámetros: ${p.join('; ')}.` : null, r.nota ? `Nota del reglamento: ${r.nota}.` : null]
      .filter(Boolean).join('\n');
  }

  function textoPDM(estado) {
    const aviso = C.avisoPDMProyectado(estado);
    if (!aviso) return 'No tengo un aviso con fuente y fecha sobre el PDM nuevo, así que no lo afirmo. Consulta al IMPLA.';
    return [
      `${aviso.texto}`,
      `Fuente: ${aviso.fuente} · Fecha: ${aviso.fecha}. Es una nota de prensa, no un documento oficial.`,
      'No hay mapa de la zonificación proyectada: el plano del PDM nuevo no es público hasta que se apruebe. Lo que uso es el plano del PDM 2016-2025.',
      'Para un trámite real, el Certificado de Parámetros Urbanísticos y Edificatorios tiene vigencia de 36 meses.',
    ].join('\n');
  }

  const TEXTO_FUENTES = [
    'De dónde sale cada cosa:',
    '• Zonificación: plano y reglamento del PDM Arequipa 2016-2025 (O.M. 961-MPA, con la zonificación restituida por la 975-MPA). Es referencial.',
    '• Salud, colegios, paraderos y áreas verdes: OpenStreetMap (ODbL), copia congelada con su fecha de extracción. Algo que falte en el mapa puede existir.',
    '• Umbrales: colegios 500 m inicial, 1500 m primaria y 3000 m secundaria (MINEDU); área verde ≥ 0,5 ha a 300 m (OMS Europa); salud 1000 m, paradero 400 m y borde de zona 20 m son convenciones del proyecto.',
    '• Distancias en línea recta, no recorrido a pie.',
    '• Las búsquedas de zonas son un cálculo sobre una cuadrícula de celdas; el porcentaje es la parte del suelo habitable que cumple, no una probabilidad.',
    'Nada de esto reemplaza el certificado municipal.',
  ].join('\n');

  // Por qué lo «aproximado» no es un dato medido (se dice solo de lo que la persona pidió).
  const MOTIVO_APROXIMADO = {
    tranquilo: 'no hay datos de ruido',
    comercial: 'no hay datos de centros comerciales',
    historico: 'no hay datos de barrios tradicionales',
  };

  const TEMAS = {
    seguridad: 'No evalúo seguridad ciudadana: el proyecto la dejó fuera de alcance, aunque los estudios muestran que pesa en la decisión de compra. No te doy una respuesta a medias.',
    precio: 'No tengo datos de precios ni de alquileres, así que no puedo decirte qué zona es más barata.',
  };

  /**
   * Responde lo que no es una búsqueda, usando solo lo ya calculado del punto.
   *   ctx: { punto, distrito, zona, entorno, estadoPDM, potencial }
   */
  function responder(intencion, ctx = {}) {
    const { tipo } = intencion;
    const c = ctx;
    const fin = (texto, sugerencias = SUGERENCIAS_BASE) => ({ texto, sugerencias });

    if (tipo === 'saludo') return fin('¡Hola! Soy el asistente de GeoVerificador. Puedo contarte lo que hay en tu punto (zona y servicios cercanos) o buscar zonas de Arequipa según lo que te importa: colegio, posta, área verde, transporte, campiña, zona residencial. Todo con los mismos datos de la ficha.');
    if (tipo === 'ayuda') return fin('Puedo:\n• Buscar zonas: «busco cerca de un colegio y un parque, lo más importante es el parque» o «posta y paradero en un radio de 1 km».\n• Contarte de tu punto: «¿qué zona es?», «¿hay un colegio cerca?», «dame un resumen».\n• Calcular: «¿cuánto puedo construir en un lote de 200 m²?».\n• Explicar el PDM nuevo y de dónde salen los datos.\nNo tengo datos de seguridad, precios ni ruido.');
    if (tipo === 'fuentes') return fin(TEXTO_FUENTES);
    if (tipo === 'no_soportado') return fin(`${TEMAS[intencion.temaNoSoportado] || 'Eso no está en los datos que uso.'}\nSí puedo ayudarte con la zonificación y con la cercanía a colegios, salud, transporte y áreas verdes.`);
    if (tipo === 'desconocido') return fin('No entendí eso. Puedes pedirme, por ejemplo:', SUGERENCIAS_BASE);
    if (tipo === 'pdm') return fin(textoPDM(c.estadoPDM));

    if (!c.punto) return sinPunto();

    if (tipo === 'zona') {
      if (!c.zona) return fin('Ese punto está fuera del área zonificada del plano, o todavía lo estoy calculando.');
      return fin(`${textoZona(c.zona)}\n${AVISO_REFERENCIAL}`);
    }

    if (tipo === 'construir') {
      if (!c.zona) return fin('Todavía no tengo la zona de tu punto; vuelve a intentarlo en unos segundos.');
      const r = c.zona.regla;
      if (!r || r.edificable === 'no') return fin(`La zona ${c.zona.codigo} no es construible, así que no calculo m².`);
      if (r.edificable === 'condicionado') return fin(`En la zona ${c.zona.codigo} lo que se puede construir depende de la zona vecina o de un plan específico; no calculo m². Consulta a la municipalidad.`);
      if (!hay(intencion.lote)) return fin('Dime el área del lote, por ejemplo «lote de 200 m²», y calculo cuánto se puede construir.');
      const pot = typeof c.potencial === 'function' ? c.potencial(r, intencion.lote) : null;
      if (!pot) return fin(`La zona ${c.zona.codigo} no fija un coeficiente: los parámetros dependen del proyecto.`);
      const [base, max] = pot.construible;
      const lineas = [`En un lote de ${fmtNum(intencion.lote)} m² de la zona ${c.zona.codigo} podrías techar hasta ${fmtNum(base)} m²${max > base ? ` (${fmtNum(max)} m² en el caso máximo del reglamento)` : ''}.`];
      if (pot.ocupable) lineas.push(`El primer piso puede ocupar entre ${fmtNum(pot.ocupable[0])} y ${fmtNum(pot.ocupable[1])} m².`);
      if (pot.bajoLoteMinimo) lineas.push(`Ojo: el lote es menor que el mínimo de la zona (${fmtNum(r.lote_min_m2)} m²).`);
      lineas.push('Es un máximo teórico: no considera retiros, estacionamientos ni la forma del lote.');
      return fin(lineas.join('\n'));
    }

    if (tipo === 'servicio' || tipo === 'ficha') {
      if (!c.entorno) return fin('Todavía estoy calculando los servicios cercanos a tu punto; vuelve a preguntar en unos segundos.');
      if (tipo === 'servicio') {
        const ids = intencion.criterios.filter((x) => CRITERIOS[x.id].tipo === 'servicio').map((x) => x.id);
        if (ids.length === 0) return fin('Eso lo uso para buscar zonas, no para describir un punto. Prueba: «busco una zona cerca de campiña y residencial».');
        return fin([...ids.flatMap((id) => lineasServicio(id, c.entorno)), 'Distancias en línea recta, con datos de OpenStreetMap.'].join('\n'));
      }
      const zonaTxt = c.zona ? `${c.zona.codigo} (${c.zona.regla ? c.zona.regla.nombre : 'sin reglas'}), ${c.zona.regla ? EDIFICABLE[c.zona.regla.edificable] : ''}` : 'fuera del área zonificada del plano';
      const e = c.entorno;
      const colegios = ['inicial', 'primaria', 'secundaria'].map((n) => {
        const r = e.educacion[n];
        return r.distanciaM === null ? `${n}: sin dato` : `${n} ${ESTADO[r.estado]} (${r.nombre || 'sin nombre'}, ${fmtDist(r.distanciaM)}; referencia ${fmtUmbral(r.umbralM)})`;
      }).join('; ');
      return fin([
        `Tu punto${c.distrito ? ` está en ${titulo(c.distrito)},` : ''} zona ${zonaTxt}.`,
        linea('Salud', e.salud),
        `Colegios: ${colegios}.`,
        linea('Transporte', e.transporte),
        linea('Área verde', e.areaVerde),
        c.estadoPDM ? 'Sobre el PDM nuevo, pregúntame «¿cambiará la zonificación?».' : null,
        AVISO_REFERENCIAL,
      ].filter(Boolean).join('\n'));
    }
    return fin('No entendí eso. Puedes pedirme, por ejemplo:');
  }

  // ------------------------------------------------------ Texto de una búsqueda

  /**
   * Presenta el resultado de `buscar`.
   *   meta: { aproximados, temaNoSoportado, radioGlobalM, incluirCondicional?, umbrales? }
   */
  function formatearBusqueda(resultado, meta = {}) {
    const lineas = [];
    const q = resultado.criterios.map((c) => {
      const def = CRITERIOS[c.id];
      const u = c.umbralEfectivoM;
      return `${def.etiqueta}${u ? ` a ${fmtUmbral(u)} o menos` : ''}${c.prioridad > 1 ? ' (prioridad)' : ''}`;
    });
    lineas.push(`Busqué zonas con: ${q.join('; ')}.`);
    if (hay(meta.radioGlobalM)) lineas.push(`Usé ${fmtUmbral(meta.radioGlobalM)} como distancia para todos los criterios (si quieres otra para uno solo, dime por ejemplo «colegio a 500 m»).`);
    lineas.push(`Revisé ${fmtNum(resultado.totalCeldas)} celdas de ${resultado.pasoM} m dentro de las zonas construibles del plano 2016-2025 y las agrupé por distrito.`);

    const sugerencias = [];
    const filas = resultado.areas.slice(0, 6).map((a, i) => {
      const por = resultado.criterios.map((c) => `${CRITERIOS[c.id].etiqueta.split(' (')[0]} ${pct(a.porCriterio[c.id] || 0)}`).join(' · ');
      return {
        titulo: titulo(a.nombre),
        distrito: a.nombre,
        orden: i + 1,
        detalle: `${pct(a.pctCumpleTodo)} del suelo habitable cumple todo · coincidencia ponderada ${pct(a.puntajePct)}`,
        nota: por,
      };
    });
    if (resultado.areas.length === 0) {
      lineas.push('No encontré ninguna zona con suficientes celdas que cumpla; los criterios juntos pueden ser demasiado exigentes.');
      sugerencias.push('Quita un criterio', 'Busca con un radio de 1,5 km', 'Incluye zonas condicionales');
    } else {
      lineas.push('Los porcentajes son la parte del suelo habitable de cada distrito que cumple lo que pediste. No son una probabilidad ni una recomendación.');
      sugerencias.push('Agrega transporte', 'Prioriza el área verde', 'Incluye zonas condicionales');
    }
    if (meta.aproximados && meta.aproximados.length) {
      const nombres = meta.aproximados.map((id) => CRITERIOS[id].etiqueta.split(' (')[0].toLowerCase());
      const varios = nombres.length > 1;
      const motivos = meta.aproximados.map((id) => MOTIVO_APROXIMADO[id]);
      lineas.push(`Ojo: ${nombres.join(' y ')} ${varios ? 'son aproximaciones' : 'es una aproximación'} con la zonificación (${motivos.join('; ')}), no ${varios ? 'datos medidos' : 'un dato medido'}.`);
    }
    if (meta.temaNoSoportado) lineas.push(`${TEMAS[meta.temaNoSoportado]}`);
    lineas.push(AVISO_REFERENCIAL.replace('Es una consulta referencial: no', 'Resultado referencial: no'));
    return { texto: lineas.join('\n'), filas, sugerencias };
  }

  /** Une la búsqueda anterior con un ajuste («agrega…», «quita…», «prioriza…»). */
  function combinarBusqueda(anterior, intencion) {
    const base = (anterior && anterior.criterios ? anterior.criterios : []).map((c) => ({ ...c }));
    if (intencion.modo === 'agregar') {
      intencion.criterios.forEach((n) => { if (!base.some((b) => b.id === n.id)) base.push({ ...n }); });
      return base;
    }
    if (intencion.modo === 'quitar') {
      const quitar = new Set(intencion.criterios.map((c) => c.id));
      return base.filter((b) => !quitar.has(b.id));
    }
    if (intencion.modo === 'priorizar') {
      const prio = new Set(intencion.criterios.map((c) => c.id));
      return base.map((b) => ({ ...b, prioridad: prio.has(b.id) ? 2 : 1 }));
    }
    return intencion.criterios;
  }

  return {
    CRITERIOS,
    SUGERENCIAS_BASE,
    normalizar,
    interpretar,
    responder,
    prepararDatos,
    generarCeldas,
    evaluarCelda,
    buscar,
    formatearBusqueda,
    combinarBusqueda,
    describirCriterio,
    distanciaM,
    titulo,
    fmtDist,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Asistente;
