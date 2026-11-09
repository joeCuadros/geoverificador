/**
 * asistente.js — Lógica del asistente de chat (sin DOM, sin red, sin estado).
 *
 * Este motor entiende frases en español con reglas explícitas y responde únicamente con lo que ya calculan las 5 variables
 * (zonificación, salud, educación, transporte y área verde) y con los mismos datos y umbrales de CONFIG. Por eso
 * funciona en el sitio estático, sin claves ni servidor, y no puede inventar un dato: si algo no está en los datos, lo
 * dice. Encima de este motor puede haber un modelo (Gemini, asistente-llm.js) que solo interpreta la frase y redacta
 * la respuesta; en ese modo lo que la persona escribe SÍ se envía al proveedor del modelo, y la vista lo dice.
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
  const RT = typeof Rutas !== 'undefined' ? Rutas : require('./rutas.js'); // eslint-disable-line no-undef
  const P = typeof Precios !== 'undefined' ? Precios : require('./precios.js'); // eslint-disable-line no-undef
  const M_POR_GRADO = (Math.PI / 180) * C.RADIO_TIERRA_M;
  const rad = (d) => (d * Math.PI) / 180;
  const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);
  // Se resuelven al usarlos: en el navegador son globales y en las pruebas se cargan con require.
  const Dist = () => (typeof Distritos !== 'undefined' ? Distritos : require('./distritos.js')); // eslint-disable-line no-undef
  const Ent = () => (typeof Entidades !== 'undefined' ? Entidades : require('./entidades.js')); // eslint-disable-line no-undef
  const Vol = () => (typeof Volcan !== 'undefined' ? Volcan : require('./volcan.js')); // eslint-disable-line no-undef
  const Cen = () => (typeof Cenepred !== 'undefined' ? Cenepred : require('./cenepred.js')); // eslint-disable-line no-undef
  const Sect = () => (typeof Sectores !== 'undefined' ? Sectores : require('./sectores.js')); // eslint-disable-line no-undef

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
    // «Lejos de quebradas y ríos»: se cumple a una distancia MÍNIMA que fija la persona. No hay umbral por defecto porque
    // ninguna norma lo fija; sin esa distancia la búsqueda se la pide (ver criteriosSinUmbral).
    lejosQuebrada: { etiqueta: 'Lejos de quebradas y ríos', tipo: 'cauce' },
  };

  // Cómo se reconoce cada criterio en el texto ya normalizado (sin tildes, en minúsculas). El orden importa.
  const PATRONES = [
    ['lejosQuebrada', /\b(?:lejos|alejad\w*|evit\w*|sin|libre)\s+(?:de\s+)?(?:(?:las|los|el|la|un|una)\s+)?(?:quebradas?|torrenteras?|cauces?|rios?|huaycos?|huaicos?)\b/g],
    ['inicial', /\b(inicial(?:es)?|jardin(?:es)? de (?:ninos|infantes|infancia)|nido|cuna|kinder|parvulos?)\b/g],
    ['primaria', /\bprimaria\b/g],
    ['secundaria', /\bsecundaria\b/g],
    ['colegio', /\b(colegios?|escuelas?|cole|centros? educativos?|instituciones? educativas?|educacion)\b/g],
    ['salud', /\b(postas?|hospital(?:es)?|clinicas?|centros? de salud|consultorios?|salud|medic[oa]s?|doctor(?:es)?)\b/g],
    ['transporte', /\b(paraderos?|buses?|transporte|combis?|micros?|movilidad|paradas?)\b/g],
    ['areaVerde', /\b(areas? verdes?|parques?|espacios? verdes?|zonas? verdes?|jardin(?:es)?|verde)\b/g],
    ['campina', /\b(campina|campo|agricol\w*|chacras?|rural|sembrios?|cultivos?)\b/g],
    ['tranquilo', /\b(tranquil\w*|silenci\w*|calma|calmad\w*|sin ruido|poco ruido|paz)\b/g],
    ['comercial', /\b(malls?|centros? comercial(?:es)?|supermercados?|comercios?|tiendas|shopping|compras)\b/g],
    ['historico', /\b(tradicional(?:es)?|historic\w*|casco|barrios? antiguos?|sillar)\b/g],
    ['residencial', /\b(residencial(?:es)?|viviendas?|casas?)\b/g],
  ];

  const TEMAS_SIN_DATOS = [
    ['seguridad', /\b(segur\w*|inseguridad|delincuen\w*|robos?|crimen|asalt\w*|peligros[oa]s?)\b/],
    ['precio', /\b(precios?|caro|cara|baratos?|baratas?|barato|costos?|cuanto cuesta|cuanto vale|cuanto valdria|a cuanto (?:esta|sale|va|cuesta) (?:el )?(?:m2|metro cuadrado)|el m2|el metro cuadrado|por (?:m2|metro cuadrado)|tasaci\w*|tasar|valoriz\w*|avaluo|alquiler(?:es)?|alquilar|presupuesto)\b/],
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
    // Distritos: contar lo que hay, perfil de un distrito y «la mejor zona» sin saber qué importa.
    contar: /\b(cuant[oa]s?|numero de|cantidad de|total de|que cantidad)\b|^(hay|existen?|tiene|tienen)\b/,
    mejorZona: /\b(mejor(?:es)?\s+(?:zona|lugar|sitio|distrito|barrio|sector|opcion)|(?:zona|lugar|sitio|distrito|barrio)\s+ideal|que (?:zona|distrito|barrio|lugar) (?:me )?(?:recomiendas|conviene|sugieres|elegirias)|donde (?:es )?(?:mejor )?vivir|donde me conviene|(?:es )?mejor (?:vivir|comprar|mudarse))\b/,
    vivir: /\b(vivir|mudar\w*)\b/,
    // «¿Qué buses pasan por aquí?», «¿qué líneas pasan por Paucarpata?»: líneas de transporte, no «transporte» como criterio de búsqueda.
    rutasPregunta: /\b(?:que|cuales?|cual|cuantas?|cuantos?)\b[^.]*?\b(?:lineas?|rutas?|buses?|combis?|micros?|colectivos?)\b/,
    rutasVerbo: /\b(?:pasa\w*|cruza\w*|recorre\w*|llega\w*|sirve\w*|circula\w*|hay|existe\w*|tengo|tiene\w*|cerca)\b/,
    rutasLinea: /\b(?:lineas?|rutas?)\b[^.]*\b(?:pasa\w*|cruza\w*|recorre\w*|llega\w*|sirve\w*|circula\w*)\b/,
    rutasVehiculo: /\b(?:buses?|combis?|micros?|colectivos?)\b[^.]*\b(?:pasa\w*|cruza\w*|recorre\w*|circula\w*)\b/,
    rutasHay: /^(?:hay|existen?|tienen?)\b[^.]*\b(?:lineas?|rutas?|buses?|combis?|micros?|colectivos?)\b/,
    noRutas: /\b(?:busc\w*|recomi\w*|sugier\w*|vivir|mudar\w*|comprar)\b/,
    aqui: /\b(?:mi punto|este punto|mi predio|este predio|este terreno|mi terreno|esta ubicacion|el punto|aqui|ahi|aca|mi zona|esta zona|mi casa|este lugar|esta calle|mi calle|mi barrio|este barrio)\b/,
    // Precio de UN inmueble concreto o su valor: no hay dato (solo promedios de oferta por distrito).
    precioInmueble: /\b(?:esta|este|mi|la|el|una|un)\s+(?:casa|departamento|depa|inmueble|predio|terreno|propiedad|lote|vivienda)\b|\b(?:cuanto vale|cuanto valdria|vale la pena|tasaci\w*|tasar|valoriz\w*|avaluo|alquil\w*)\b/,
    // Precio de oferta por m² de un distrito (Aptología): el metro cuadrado, el distrito o la zona del punto.
    precioM2: /\b(?:m2|metros? cuadrados?|por metro|el metro|precio de oferta|precio promedio|promedio de precios?|mas caro|mas barato|mas economico|distritos?)\b/,
    precioTodos: /\b(?:distritos|todos|ranking|comparar?|mas caro|mas barato|mas economico|cada distrito)\b/,
    // Peligro volcánico del Misti (zonas del IGP, informativo): el volcán, los lahares, la ceniza, los flujos piroclásticos, la lava y las avalanchas.
    volcan: /\b(volcan(?:es|ico|ica|icos|icas)?|misti|lahar(?:es)?|cenizas?|erupci\w*|piroclastic\w*|avalanchas? de (?:escombros|detritos))\b/,
    // Qué fenómeno volcánico nombra la frase (puede ser más de uno); vacío = el volcán en general.
    volcanLahar: /\blahar(?:es)?\b/, volcanCeniza: /\bcenizas?\b/, volcanFlujo: /\b(?:piroclastic\w*|flujos? piroclastic\w*)/, volcanLava: /\blava\b/, volcanAvalancha: /\bavalanchas?\b/,
    // Escenario de riesgo del CENEPRED ante El Niño (por distrito, informativo): inundaciones y movimientos en masa. «Huaico», «aluvión», «deslizamiento»
    // y «derrumbe» solos siguen siendo quebradas o peligros del punto; con un distrito nombrado pasan al escenario del CENEPRED.
    cenepred: /\b(cenepred|sigrid|inunda\w*|desbord\w*|movimientos? en masa|fenomeno del nino|el nino|nino costero)\b/,
    cenepredAmbiguo: /\b(huaycos?|huaicos?|aluvion\w*|deslizamient\w*|derrumb\w*)\b/,
    cenepredCauce: /\b(quebradas?|torrenteras?|cauces?|rios?|rio chili)\b/,
    cenepredInundacion: /\b(inunda\w*|desbord\w*)\b/,
    cenepredMasa: /\b(movimientos? en masa|huaycos?|huaicos?|aluvion\w*|deslizamient\w*|derrumb\w*)\b/,
    cenepredMapa: /\b(mapa|muestra\w*|dibuja\w*|colorea\w*|pinta\w*|visualiza\w*)\b/,
    cenepredTodos: /\b(?:que|cuales|cuantos)\s+distritos\b|\btodos\s+los\s+distritos\b|\bcada\s+distrito\b|\bentre\s+los\s+distritos\b/,
    quebrada: /\b(quebradas?|torrenteras?|cauces?|huaycos?|huaicos?|aluvion\w*|rios?|rio chili)\b/,
    sismos: /\b(sismos?|sismic\w*|temblor\w*|terremoto\w*)\b/,
    peligros: /\b(peligros?|riesgos?|derrumbes?|deslizamientos?|caida de rocas|geologic\w*)\b/,
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

  // Palabras que no son un distrito aunque vengan después de «por» o «en».
  const NO_DISTRITO = /^(?:hoy|ahora|cerca|aqui|ahi|alla|la ciudad|arequipa ciudad|todas|todo|la zona|mi zona|esta zona|el centro|mi punto)$/;

  /**
   * Distrito que nombra una pregunta sobre líneas («que lineas pasan por cerro colorado» → «cerro colorado»), o null si
   * habla del punto elegido o no nombra ninguno. Se usa solo cuando el buscador de distritos (Distritos.buscarNombre) no
   * reconoció nada: así la respuesta puede decir «no reconozco X» en vez de adivinar.
   */
  function distritoEnRutas(t) {
    if (RE.aqui.test(t)) return null;
    const m = t.match(/\bdistrito\s+(?:de\s+)?([a-z ]+)$/)
      || t.match(/\b(?:pasa\w*|cruza\w*|recorre\w*|llega\w*|circula\w*|sirve\w*|hay|existe\w*)\s+(?:(?:lineas?|rutas?|buses?|combis?|micros?|colectivos?)\s+)?(?:(?:por|en|a|hacia|para)\s+)?(?:cerca\s+de\s+)?(?:el\s+|la\s+)?(?:distrito\s+(?:de\s+)?)?([a-z ]+)$/);
    if (!m) return null;
    const nombre = m[1].replace(/\s+(?:hoy|ahora|actualmente|por favor|gracias)$/, '').trim();
    if (!nombre || nombre.split(' ').length > 5 || NO_DISTRITO.test(nombre)) return null;
    return nombre;
  }

  const PALABRAS_VOLCAN = /\b(?:volcan\w*|misti|lahar\w*|ceniza\w*|erupci\w*|piroclastic\w*|avalancha\w*|lava|peligro\w*|riesgo\w*|zonas?|punto|mapa|flujos?)\b/;

  /**
   * Distrito que nombra una pregunta del volcán sin que el buscador de distritos lo reconozca («que lahares hay en zamacola»
   * → «zamacola»), o null. Solo mira lo que sigue a «distrito de», «en», «por», «de» o «para» al final de la frase y descarta
   * lo que son palabras del propio tema («por el volcán», «en peligro»).
   */
  function distritoEnVolcan(t) {
    if (RE.aqui.test(t)) return null;
    const m = t.match(/\bdistrito\s+(?:de\s+)?([a-z ]+)$/) || t.match(/\b(?:en|por|de|para)\s+(?:el\s+|la\s+)?([a-z ]+)$/);
    if (!m) return null;
    const nombre = m[1].replace(/\s+(?:hoy|ahora|actualmente|por favor|gracias)$/, '').trim();
    if (!nombre || nombre.split(' ').length > 4 || NO_DISTRITO.test(nombre) || PALABRAS_VOLCAN.test(nombre)) return null;
    return nombre;
  }

  const PALABRAS_CENEPRED = /\b(?:cenepred|sigrid|inunda\w*|desbord\w*|huaic\w*|huayc\w*|aluvion\w*|deslizamient\w*|derrumb\w*|movimientos?|masa|nino|riesgos?|peligros?|zonas?|punto|mapa|escenario|fenomeno|costero|que|dice|dicen|sabes|hay|existe|mucho|mucha)\b/;

  /**
   * Distrito que nombra una pregunta del escenario del CENEPRED sin que el buscador de distritos lo reconozca («riesgo de huaico en
   * zamacola» → «zamacola», «¿zamacola se inunda?»), o null. Descarta las palabras del propio tema.
   */
  function distritoEnCenepred(t) {
    if (RE.aqui.test(t)) return null;
    const m = t.match(/\bdistrito\s+(?:de\s+)?([a-z ]+)$/) || t.match(/^(?:se\s+)?(?:inunda\w*|desbord\w*)\s+(?:en\s+)?(?:el\s+|la\s+)?([a-z ]+)$/) || t.match(/^([a-z ]+?)\s+se\s+inunda\w*$/) || t.match(/.*\b(?:en|por|de|para)\s+(?:el\s+|la\s+)?([a-z ]+)$/); // la última preposición: «riesgo de huaico en zamacola» → «zamacola»
    if (!m) return null;
    const nombre = m[1].replace(/\s+(?:hoy|ahora|actualmente|por favor|gracias)$/, '').trim();
    if (!nombre || nombre.split(' ').length > 4 || NO_DISTRITO.test(nombre) || PALABRAS_CENEPRED.test(nombre)) return null;
    return nombre;
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
   * tipo: saludo | ayuda | fuentes | pdm | construir | zona | ficha | servicio | quebrada | sismos | peligros | volcan | cenepred | buscar | contar | perfil | mejor_zona | rutas | precio | no_soportado | desconocido
   * volcan: zonas de peligro volcánico del Misti en el punto o en un distrito (`volcanTipos`: los fenómenos que nombra la frase; vacío = todos)
   * cenepred: escenario de riesgo del CENEPRED ante El Niño en el distrito del punto o en un distrito (`cenepredFenomenos`: inundacion | movimientos_masa; vacío = los dos; `cenepredMapa`: pidió verlo en el mapa)
   * distrito: nombre del distrito nombrado en la frase (como en el archivo de límites) o null; distritoFuera: existe en la provincia pero no está en los datos
   * precio: precio de oferta por m² de un distrito (`distrito`, o el del punto; `todosPrecio` = lista de todos los que tienen cifra)
   * modo (solo en buscar): nuevo | agregar | quitar | priorizar
   */
  function interpretar(texto, ctx = {}) {
    const intencion = {
      tipo: 'desconocido', modo: 'nuevo', criterios: [], radioGlobalM: null, lote: null, incluirCondicional: false,
      temaNoSoportado: null, aproximados: [], limitarAlPunto: false, distrito: null, distritoFuera: false, distritoTexto: null, todosPrecio: false,
      volcanTipos: [], cenepredFenomenos: [], cenepredMapa: false, cenepredTodos: false,
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
      ids.forEach((id) => { porId.set(id, { id, umbralM: porId.get(id)?.umbralM ?? null, prioridad: Math.max(prio, porId.get(id)?.prioridad ?? 1) }); });
      const dist = distanciasEn(f);
      // «Lejos de quebradas a más de 200 m»: esa distancia es el mínimo de ESE criterio, no el radio global de la búsqueda.
      if (ids.includes('lejosQuebrada') && dist.length > 0) porId.get('lejosQuebrada').umbralM = dist[0];
      else dist.forEach((m) => distancias.push({ m, ids }));
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

    // Un distrito nombrado (con errores de tipeo, tildes o mayúsculas): el mismo buscador para contar, perfil, precio, líneas y búsquedas.
    const dis = Dist().buscarNombre(t);
    if (dis) { intencion.distrito = dis.distrito; intencion.distritoFuera = !dis.enDatos; }

    // Peligro volcánico del Misti: se atiende antes que perfil, líneas y quebradas («¿Paucarpata está en peligro por el Misti?» no es un perfil).
    // Con criterios de búsqueda («busco colegio lejos del Misti») no se puede: se dice, no se ignora.
    if (RE.volcan.test(t)) {
      if (hayCriterios) return { ...intencion, tipo: 'no_soportado', temaNoSoportado: 'volcan_busqueda', criterios: [], aproximados: [], limitarAlPunto: false };
      const volcanTipos = [['lahar', RE.volcanLahar], ['flujo_piroclastico', RE.volcanFlujo], ['lava', RE.volcanLava], ['avalancha', RE.volcanAvalancha], ['ceniza', RE.volcanCeniza]].filter(([, re]) => re.test(t)).map(([id]) => id);
      const volcan = { ...intencion, tipo: 'volcan', volcanTipos, criterios: [], aproximados: [], limitarAlPunto: false };
      if (dis) return volcan;
      const texto = distritoEnVolcan(t);
      return texto ? { ...volcan, tipo: 'distrito_desconocido', distritoTexto: texto } : volcan;
    }

    // Escenario de riesgo del CENEPRED ante El Niño (inundaciones y movimientos en masa, por distrito): antes que perfil, líneas y quebradas
    // («¿Paucarpata se inunda?» no es un perfil). Con criterios de búsqueda no se puede: se dice. «Fuentes» y «ayuda» siguen siendo suyas.
    // «Riesgo de huaico en Zamacola»: un lugar que no es un distrito de la provincia también es del escenario (para decir que no lo reconoce), salvo que hable de una quebrada o un río.
    const huaicoEnOtroLugar = !dis && RE.cenepredAmbiguo.test(t) && !RE.cenepredCauce.test(t) && distritoEnCenepred(t) !== null;
    if ((RE.cenepred.test(t) || (dis && RE.cenepredAmbiguo.test(t)) || huaicoEnOtroLugar) && !RE.fuentes.test(t)) {
      if (hayCriterios) return { ...intencion, tipo: 'no_soportado', temaNoSoportado: 'cenepred_busqueda', criterios: [], aproximados: [], limitarAlPunto: false };
      const cenepredFenomenos = [['inundacion', RE.cenepredInundacion], ['movimientos_masa', RE.cenepredMasa]].filter(([, re]) => re.test(t)).map(([id]) => id);
      const cen = { ...intencion, tipo: 'cenepred', cenepredFenomenos, cenepredMapa: RE.cenepredMapa.test(t), cenepredTodos: !dis && RE.cenepredTodos.test(t), criterios: [], aproximados: [], limitarAlPunto: false };
      if (dis || cen.cenepredTodos) return cen;
      const texto = distritoEnCenepred(t);
      return texto ? { ...cen, tipo: 'distrito_desconocido', distritoTexto: texto } : cen;
    }

    // Líneas de transporte (antes que los criterios y que «contar»: «buses» también es el criterio «transporte» de una búsqueda).
    const preguntaRutas = (RE.rutasPregunta.test(t) && RE.rutasVerbo.test(t)) || RE.rutasLinea.test(t) || RE.rutasVehiculo.test(t) || RE.rutasHay.test(t);
    if (preguntaRutas && !RE.noRutas.test(t)) {
      const rutas = { ...intencion, tipo: 'rutas', criterios: [], aproximados: [], limitarAlPunto: false };
      if (dis) return rutas;
      // Nombró algo que no es un distrito de la provincia («por Zamacola»): se dice, no se adivina.
      const texto = distritoEnRutas(t);
      return texto ? { ...rutas, tipo: 'distrito_desconocido', distritoTexto: texto } : rutas;
    }

    // Precio de oferta por m² de un distrito (Aptología): se atiende antes que las búsquedas, porque aquí «casa» o «vivienda»
    // no son un criterio. El precio de UN inmueble, un alquiler o una búsqueda de zonas «baratas» siguen sin dato.
    // El distrito sale del mismo buscador que usan contar, perfil y líneas (`dis`).
    if (intencion.temaNoSoportado === 'precio' && intencion.criterios.every((c) => c.id === 'residencial')) {
      if (RE.precioInmueble.test(t)) return { ...intencion, tipo: 'no_soportado', criterios: [], aproximados: [] };
      if (dis || RE.precioM2.test(t) || !RE.busqueda.test(t)) {
        return { ...intencion, tipo: 'precio', criterios: [], aproximados: [], todosPrecio: !dis && RE.precioTodos.test(t) };
      }
    }

    // «Cuántos colegios hay en X» es contar, aunque la frase empiece con «quiero vivir en X»; con criterios y un verbo de búsqueda
    // sigue siendo una búsqueda, ahora dentro del distrito.
    const servicios = intencion.criterios.filter((c) => CRITERIOS[c.id].tipo === 'servicio');
    if (dis && servicios.length > 0 && (RE.contar.test(t) || !RE.busqueda.test(t))) return { ...intencion, tipo: 'contar' };

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
      if (dis) return { ...intencion, tipo: 'perfil' };
      if (RE.mejorZona.test(t) && !intencion.temaNoSoportado) return { ...intencion, tipo: 'mejor_zona' };
      if (RE.quebrada.test(t)) return { ...intencion, tipo: 'quebrada' };
      if (RE.sismos.test(t)) return { ...intencion, tipo: 'sismos' };
      if (RE.peligros.test(t)) return { ...intencion, tipo: 'peligros' };
      if (intencion.lote !== null || RE.construir.test(t)) return { ...intencion, tipo: 'construir' };
      if (RE.zona.test(t)) return { ...intencion, tipo: 'zona' };
      if (RE.ficha.test(t)) return { ...intencion, tipo: 'ficha' };
      if (intencion.temaNoSoportado) return { ...intencion, tipo: 'no_soportado' };
      if (RE.vivir.test(t)) return { ...intencion, tipo: 'mejor_zona' };
      return intencion;
    }

    if (RE.ficha.test(t) && !RE.busqueda.test(t)) return { ...intencion, tipo: 'ficha' };
    const sobrePunto = !RE.busqueda.test(t) && (punto || (ctx.hayPunto && RE.preguntaPunto.test(t)));
    // «¿Estoy lejos de una quebrada?» sobre el punto es una pregunta, no una búsqueda.
    if (sobrePunto && intencion.criterios.every((c) => c.id === 'lejosQuebrada')) return { ...intencion, tipo: 'quebrada' };
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
  // Conserva `osm` y `tags`: el mapa por entidades y el conteo por distrito necesitan identificar y describir cada elemento.
  // También conserva de qué fuente es (RENIPRESS, ESCALE u OSM) y su código oficial; en un local de ESCALE, `nivel` elige la institución.
  const puntoDe = (f, nivel) => {
    const o = C.origenDe(f.properties, nivel);
    return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], nombre: o.nombre || null, osm: f.properties.osm || null, tags: f.properties.tags || {}, fuente: o.fuente, codigo: o.codigo, categoria: o.categoria, gestion: o.gestion };
  };
  const esPunto = (f) => f && f.geometry && f.geometry.type === 'Point';

  /** ¿La zona cumple lo que pide el criterio de zona (por código o por grupo)? */
  const zonaCoincide = (def, codigo, grupo) => (def.codigos ? def.codigos.includes(codigo) : false) || (def.grupos ? def.grupos.includes(grupo) : false);

  /**
   * Ordena los datos de OpenStreetMap y de zonificación para evaluarlos rápido.
   *   entrada: { salud, educacion, transporte, areasVerdes } (listas de Feature, como los archivos congelados)
   *            + cauces?: [{ nombre, geometry }] (líneas de la red hidrográfica de la ANA; solo para «lejos de quebradas»)
   *   zonas:   [{ codigo, bbox, polys, regla }] (Zonificacion.zonas)
   */
  const bboxDeLineas = (g) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const lineas = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    lineas.forEach((l) => {
      const t = bboxDeAnillo(l);
      b[0] = Math.min(b[0], t[0]); b[1] = Math.min(b[1], t[1]); b[2] = Math.max(b[2], t[2]); b[3] = Math.max(b[3], t[3]);
    });
    return b;
  };

  function prepararDatos(entrada, zonas, umbrales) {
    const e = entrada || {};
    const areaMin = umbrales.areaVerde.areaMinM2;
    const colegios = { inicial: [], primaria: [], secundaria: [] };
    const colegiosLista = []; // cada colegio una sola vez, con todos sus niveles
    (e.educacion || []).filter(esPunto).forEach((f) => {
      const niveles = C.nivelesDe(f.properties);
      niveles.forEach((n) => colegios[n].push(puntoDe(f, n)));
      if (niveles.length > 0) colegiosLista.push({ ...puntoDe(f, niveles[0]), niveles });
    });
    const verdesTodos = (e.areasVerdes || [])
      .filter((f) => f && f.geometry)
      .map((f) => ({ geometry: f.geometry, areaM2: C.areaGeometriaM2(f.geometry), nombre: f.properties.nombre || null, osm: f.properties.osm || null, tags: f.properties.tags || {} }))
      .map((v) => ({ ...v, bbox: bboxDeGeometria(v.geometry), centro: C.centroDe(v.geometry) }));
    const verdes = verdesTodos.filter((v) => v.areaM2 >= areaMin); // los criterios usan solo los de al menos 0,5 ha (OMS)
    const zonasPorCriterio = {};
    Object.entries(CRITERIOS).filter(([, d]) => d.tipo === 'zona').forEach(([id, def]) => {
      zonasPorCriterio[id] = (zonas || [])
        .filter((z) => zonaCoincide(def, z.codigo, z.regla && z.regla.grupo))
        .map((z) => ({ bbox: z.bbox, geometry: { type: 'MultiPolygon', coordinates: z.polys } }));
    });
    return {
      salud: (e.salud || []).filter(esPunto).map(puntoDe),
      colegios,
      colegiosLista,
      verdesTodos,
      transporte: (e.transporte || []).filter(esPunto).map(puntoDe),
      verdes,
      cauces: (e.cauces || [])
        .filter((c) => c && c.geometry && /LineString/.test(c.geometry.type))
        .map((c) => ({ nombre: c.nombre || null, geometry: c.geometry, bbox: bboxDeLineas(c.geometry) })),
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
    // `i` (fila) y `j` (columna) numeran las celdas: sirven para saber cuáles se tocan (sectores.js), no se muestran.
    for (let i = 0, lat = b[1] + dLat / 2; lat < b[3]; i += 1, lat = b[1] + dLat / 2 + i * dLat) {
      const dLon = pasoM / (M_POR_GRADO * Math.cos(rad(lat)));
      for (let j = 0, lon = b[0] + dLon / 2; lon < b[2]; j += 1, lon = b[0] + dLon / 2 + j * dLon) {
        if (centro && radioM !== null && distanciaM(centro, { lat, lon }) > radioM) continue;
        let hit = null; // gana la última zona que contiene el punto, como en el plano
        for (const z of conBbox) {
          if (lon < z.bbox[0] || lon > z.bbox[2] || lat < z.bbox[1] || lat > z.bbox[3]) continue;
          if (z.polys.some((anillos) => C.puntoEnPoligono(lat, lon, anillos))) hit = z;
        }
        if (!hit || !hit.regla) continue;
        const ed = hit.regla.edificable;
        if (ed === 'si' || (incluirCondicional && ed === 'condicionado')) celdas.push({ lat, lon, i, j, zona: hit.codigo, grupo: hit.regla.grupo });
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

  /** Como distanciaMinima, pero para líneas (cauces). */
  function distanciaMinimaLinea(lista, lat, lon, limiteM) {
    const margenLat = limiteM / M_POR_GRADO;
    const margenLon = margenLat / Math.max(0.01, Math.cos(rad(lat)));
    let mejor = null;
    let mejorD = Infinity;
    for (const g of lista) {
      const b = g.bbox;
      if (lon < b[0] - margenLon || lon > b[2] + margenLon || lat < b[1] - margenLat || lat > b[3] + margenLat) continue;
      const d = C.distanciaAGeometriaLineaM(lat, lon, g.geometry);
      if (d < mejorD) { mejor = g; mejorD = d; }
    }
    return { item: mejor, d: mejorD };
  }

  /** Umbral con el que se evalúa un criterio: el propio, o el radio global, o el de CONFIG. */
  function umbralDe(req, umbrales, radioGlobalM, nivel) {
    // «Lejos de quebradas» solo vale con la distancia que dio la persona: el radio global (un máximo) no aplica a un mínimo.
    if (CRITERIOS[req.id].tipo === 'cauce') return esNumero(req.umbralM) && req.umbralM > 0 ? req.umbralM : null;
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

  /**
   * «Lejos de quebradas y ríos»: cumple si ningún cauce de la red de la ANA está a menos de la distancia mínima que fijó la
   * persona. Sin cauces cargados NO cumple (`sinDato`): la ausencia de datos nunca se cuenta como «estás lejos».
   */
  function evaluarCauce(req, celda, datos) {
    const u = umbralDe(req, null, null);
    if (!datos.cauces || datos.cauces.length === 0 || u === null) return { cumple: false, distanciaM: null, nombre: null, umbralM: u, sinDato: true };
    const r = distanciaMinimaLinea(datos.cauces, celda.lat, celda.lon, u);
    return { cumple: !(r.item && r.d < u), distanciaM: r.item ? r.d : null, nombre: r.item ? r.item.nombre : null, umbralM: u };
  }

  /** Criterios que necesitan una distancia de la persona y no la traen (hoy, «lejos de quebradas»). */
  function criteriosSinUmbral(criterios) {
    return (criterios || []).filter((c) => CRITERIOS[c.id] && CRITERIOS[c.id].tipo === 'cauce' && !(esNumero(c.umbralM) && c.umbralM > 0)).map((c) => c.id);
  }

  /** Evalúa cada criterio en una celda. Devuelve { [id]: { cumple, distanciaM, nombre, umbralM } }. */
  function evaluarCelda(celda, datos, criterios, umbrales, radioGlobalM = null) {
    const out = {};
    criterios.forEach((req) => {
      const tipo = CRITERIOS[req.id].tipo;
      out[req.id] = tipo === 'zona'
        ? evaluarZona(req, celda, datos, umbrales, radioGlobalM)
        : tipo === 'cauce' ? evaluarCauce(req, celda, datos) : evaluarServicio(req, celda, datos, umbrales, radioGlobalM);
    });
    return out;
  }

  // ------------------------------------------------------------------- Búsqueda

  /**
   * Busca zonas que cumplen los criterios y las ordena por distrito.
   *   criterios: [{ id, umbralM, prioridad }]  (prioridad 2 pesa el doble: convención del asistente)
   *   Devuelve { criterios, totalCeldas, pasoM, areas, puntos, cumplen, cumplenPor }.
   *   distrito: si se da, solo se evalúan las celdas de ese distrito (nombre como en el archivo de límites).
   *   cumplen: las celdas donde se cumple todo a la vez (el andamio de los sectores); cumplenPor: cuántas cumplen cada criterio.
   *   areas:   por distrito, el % de celdas que cumplen todo (pctCumpleTodo) y el puntaje ponderado (puntajePct).
   *   puntos:  las mejores celdas, separadas entre sí, con el detalle de cada criterio.
   */
  function buscar(opciones) {
    const {
      criterios, zonas, datos, distritoDe, umbrales, pasoM = 250, minCeldas = 8, centro = null, radioM = null,
      incluirCondicional = false, radioGlobalM = null, maxPuntos = 5, separacionM = 600, celdas: celdasDadas = null, distrito = null,
    } = opciones;
    if (!criterios || criterios.length === 0) throw new Error('Falta al menos un criterio para buscar.');
    if (criteriosSinUmbral(criterios).length > 0) throw new Error('Falta la distancia mínima a las quebradas: dime, por ejemplo, «lejos de quebradas a más de 200 m».');
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // La cuadrícula no depende de los criterios: quien llama puede pasar la ya calculada (generarCeldas con los mismos
    // `pasoM` e `incluirCondicional`) y así «agrega…», «quita…» o «prioriza…» no la rehacen. El radio se aplica aquí.
    const base = celdasDadas || generarCeldas(zonas, { pasoM, incluirCondicional });
    const celdas = centro && radioM !== null ? base.filter((c) => distanciaM(centro, c) <= radioM) : base;
    const pesoTotal = criterios.reduce((s, c) => s + (c.prioridad || 1), 0);
    // Qué tan holgado cumple una celda: suma de distancia/umbral (sin dato pesa 2). Menos es mejor; desempata el puntaje.
    // Para «lejos de quebradas» (un mínimo) la holgura es al revés: más lejos del cauce es más holgado.
    const holgura = (e) => criterios.reduce((s, c) => {
      const v = e.ev[c.id];
      if (CRITERIOS[c.id].tipo === 'cauce') return s + (v.distanciaM === null ? 0 : (v.umbralM || 1) / Math.max(v.distanciaM, 1));
      return s + (v.distanciaM === null ? 2 : v.distanciaM / (v.umbralM || 1));
    }, 0);
    const porArea = new Map();
    const evaluadas = [];
    const cumplen = []; // las celdas donde se cumple todo a la vez: el andamio de los sectores (sectores.js)
    const cumplenPor = Object.fromEntries(criterios.map((c) => [c.id, 0]));
    let totalCeldas = 0;

    celdas.forEach((celda) => {
      const nombre = (distritoDe && distritoDe(celda.lat, celda.lon)) || 'Sin distrito';
      if (distrito && nombre !== distrito) return; // búsqueda dentro de un distrito: las demás celdas no se evalúan
      totalCeldas += 1;
      const ev = evaluarCelda(celda, datos, criterios, umbrales, radioGlobalM);
      let ponderado = 0;
      let todo = true;
      criterios.forEach((c) => {
        if (ev[c.id].cumple) ponderado += c.prioridad || 1;
        else todo = false;
      });
      const puntaje = (100 * ponderado) / pesoTotal;
      criterios.forEach((c) => { if (ev[c.id].cumple) cumplenPor[c.id] += 1; });
      if (todo) cumplen.push({ ...celda, distrito: nombre, detalle: ev });
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

    const porNivel = (c) => (CRITERIOS[c.id].niveles ? Object.fromEntries(CRITERIOS[c.id].niveles.map((n) => [n, umbralDe(c, umbrales, radioGlobalM, n)])) : null);
    const resueltos = criterios.map((c) => ({ ...c, umbralPorNivel: porNivel(c), umbralEfectivoM: CRITERIOS[c.id].tipo === 'zona' ? umbralDe(c, umbrales, radioGlobalM) : (CRITERIOS[c.id].niveles ? null : umbralDe(c, umbrales, radioGlobalM, CRITERIOS[c.id].nivel)) }));
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { criterios: resueltos, totalCeldas, pasoM, areas, puntos, cumplen, cumplenPor, distrito, tiempoMs: Math.round(t1 - t0) };
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
    if (def.tipo === 'cauce') {
      const u = umbralDe(c, umbrales, radioGlobalM);
      return `${def.etiqueta}${u ? ` a más de ${fmtUmbral(u)}` : ''}${prio}`;
    }
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
    const fuente = C.textoFuenteElemento(r);
    return `${etiqueta}: ${ESTADO[r.estado]} · ${r.nombre || 'sin nombre en OSM'} a ${fmtDist(r.distanciaM)} (referencia ${fmtUmbral(r.umbralM)}${extra}).${fuente ? ` Fuente: ${fuente}.` : ''}`;
  };

  // Líneas de SmartBus del punto, en una línea («Líneas que pasan a ≤400 m: C2 (Cono Norte), …»); nada si no se calcularon.
  const lineaLineas = (t) => (t && t.rutas && !t.rutas.error ? [`${RT.resumen(t.rutas, 6)}.`] : []);

  // Cierre de «¿hay … cerca?»: de qué fuente sale cada tipo. Salud y colegios, de los registros oficiales; lo demás, de OpenStreetMap.
  function cierreServicios(ids) {
    const partes = [];
    if (ids.includes('salud')) partes.push('salud: RENIPRESS (SUSALUD)');
    if (ids.some((id) => id === 'colegio' || (CRITERIOS[id] && CRITERIOS[id].nivel))) partes.push('colegios: ESCALE (MINEDU)');
    const abierto = ids.filter((id) => id === 'transporte' || id === 'areaVerde');
    if (partes.length === 0) return 'Distancias en línea recta, con datos de OpenStreetMap.';
    if (abierto.length) partes.push('paraderos y áreas verdes: OpenStreetMap');
    return `Distancias en línea recta. Fuentes: ${partes.join('; ')}${ids.some((id) => id === 'salud' || id === 'colegio' || (CRITERIOS[id] && CRITERIOS[id].nivel)) ? '. OpenStreetMap solo de respaldo, donde ningún registro oficial tiene un punto cerca' : ''}.`;
  }

  function lineasServicio(id, entorno) {
    if (id === 'salud') return [linea('Salud', entorno.salud)];
    if (id === 'transporte') return [linea('Transporte', entorno.transporte), ...lineaLineas(entorno.transporte)];
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

  // ------------------------------------------------------- Distritos: contar, perfil y «mejor zona»

  const GRUPO_DE_CRITERIO = { inicial: 'colegios', primaria: 'colegios', secundaria: 'colegios', colegio: 'colegios', salud: 'salud', transporte: 'paraderos', areaVerde: 'parques' };
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  /** «235 colegios: 134 inicial, 90 primaria, 55 secundaria», «18 establecimientos de salud»… o null si no hay ninguno. */
  function parteDeConteo(grupo, conteo) {
    if (grupo === 'colegios') return conteo.colegios.total > 0 ? Ent().fraseColegios(conteo.colegios) : null;
    if (grupo === 'salud') return conteo.salud.total > 0 ? plural(conteo.salud.total, 'establecimiento de salud', 'establecimientos de salud') : null;
    if (grupo === 'paraderos') return conteo.paraderos.total > 0 ? plural(conteo.paraderos.total, 'paradero', 'paraderos') : null;
    const p = conteo.parques;
    if (p.total === 0) return null;
    if (p.grandes === 0) return `${plural(p.total, 'área verde', 'áreas verdes')}, ninguna de media hectárea o más`;
    return `${plural(p.grandes, 'parque', 'parques')} de al menos media hectárea (${plural(p.total, 'área verde', 'áreas verdes')} en total)`;
  }
  // De dónde salen los conteos de un distrito: salud y colegios, de los registros oficiales (con OpenStreetMap de respaldo); lo demás, de OpenStreetMap.
  function fuentesDeGrupos(grupos) {
    const oficial = [grupos.includes('salud') ? 'RENIPRESS' : null, grupos.includes('colegios') ? 'ESCALE' : null].filter(Boolean);
    const abierto = grupos.some((g) => g === 'paraderos' || g === 'parques');
    if (oficial.length === 0) return 'OpenStreetMap';
    return `${oficial.join(' y ')}, con OpenStreetMap ${abierto ? 'de respaldo y para paraderos y parques' : 'de respaldo'}`;
  }
  const NOMBRE_DE_GRUPO = { colegios: 'colegios', salud: 'establecimientos de salud', paraderos: 'paraderos', parques: 'parques' };

  const textoDistritoFuera = (t) => `${t} es un distrito de la provincia de Arequipa, pero no está en los datos de GeoVerificador: solo tengo los límites de 25 distritos, entre ellos los 21 del Plan de Desarrollo Metropolitano. Prueba con otro, por ejemplo Cayma, Paucarpata o Cerro Colorado.`;

  function respuestaContar(intencion, c) {
    const t = c.distritoTitulo || Dist().titulo(intencion.distrito);
    if (intencion.distritoFuera) return { texto: textoDistritoFuera(t), sugerencias: SUGERENCIAS_BASE };
    if (!c.conteo) return { texto: `Todavía estoy contando lo que hay en ${t}; vuelve a preguntar en unos segundos.`, sugerencias: [] };
    const pedidos = intencion.criterios.filter((x) => GRUPO_DE_CRITERIO[x.id]);
    const grupos = [...new Set(pedidos.map((x) => GRUPO_DE_CRITERIO[x.id]))];
    const con = grupos.map((g) => [g, parteDeConteo(g, c.conteo)]);
    const hay = con.filter(([, p]) => p);
    const sin = con.filter(([, p]) => !p).map(([g]) => NOMBRE_DE_GRUPO[g]);
    const fecha = c.fecha || 'sin fecha';
    const lineas = [];
    if (hay.length) lineas.push(`En ${t} hay ${hay.map(([, p]) => p).join('; ')} (${fuentesDeGrupos(hay.map(([g]) => g))}, ${fecha}; puede faltar alguno).`);
    if (sin.length) {
      lineas.push(hay.length
        ? `No encontré ${listaEs(sin)} en mis datos: puede que existan sin estar registrados ni mapeados.`
        : `En ${t} no encontré ${listaEs(sin)} en mis datos (${fuentesDeGrupos(sin.map((n) => Object.keys(NOMBRE_DE_GRUPO).find((g) => NOMBRE_DE_GRUPO[g] === n)))}, ${fecha}): puede que existan sin estar registrados ni mapeados.`);
    }
    const col = c.conteo.colegios;
    if (grupos.includes('colegios') && col.total > 0 && (col.inicial + col.primaria + col.secundaria > col.total || col.sinNivel > 0)) {
      lineas.push(`Un colegio puede atender varios niveles, por eso los niveles suman más que el total${col.sinNivel > 0 ? `; ${col.sinNivel} no dicen su nivel en OpenStreetMap y los cuento como primaria y secundaria` : ''}.`);
    }
    if (hay.length) lineas.push('Los marqué en el mapa.');
    return {
      texto: lineas.join('\n'),
      sugerencias: [`Busco en ${t} un sector con colegio y parque cerca`, `Cuéntame de ${t}`],
      mapa: hay.length ? { distrito: intencion.distrito, capas: pedidos.map((x) => x.id) } : null,
    };
  }

  /** Los botones que preguntan «¿qué es lo primero para ti?»: cada uno es una búsqueda, en el distrito si hay uno. */
  function botonesDePrioridad(t) {
    const en = t ? `en ${t} ` : '';
    return [
      { etiqueta: 'Colegio cerca', texto: `Busco ${en}un sector con colegio cerca` },
      { etiqueta: 'Parque cerca', texto: `Busco ${en}un sector con parque cerca` },
      { etiqueta: 'Transporte cerca', texto: `Busco ${en}un sector con paradero cerca` },
      { etiqueta: 'Zona tranquila', texto: `Busco ${en}una zona tranquila` },
      { etiqueta: 'Posta cerca', texto: `Busco ${en}un sector con posta cerca` },
      { etiqueta: 'Colegio y parque', texto: `Busco ${en}un sector con colegio y parque cerca` },
    ];
  }
  const PREGUNTA_PRIORIDAD = '¿Qué es lo primero para ti: colegio cerca, parque, transporte, tranquilidad…?';

  function respuestaPerfil(intencion, c) {
    const t = c.distritoTitulo || Dist().titulo(intencion.distrito);
    if (intencion.distritoFuera) return { texto: textoDistritoFuera(t), sugerencias: SUGERENCIAS_BASE };
    const p = c.perfil;
    if (!p) return { texto: `Todavía estoy armando el perfil de ${t}; vuelve a preguntar en unos segundos.`, sugerencias: [] };
    const lineas = [`${t} en pocas palabras:`];
    const principales = p.zonas.partes.filter((x) => x.pct >= 5).slice(0, 3).map((x) => `${x.etiqueta} (${Math.round(x.pct)} %)`);
    lineas.push(p.zonas.conPlano && principales.length
      ? `• Zonificación (plano del PDM 2016-2025): sobre todo ${listaEs(principales)}.`
      : `• Zonificación: no tengo zonificación de ${t} en el plano del PDM 2016-2025.`);
    const partes = ['colegios', 'salud', 'paraderos', 'parques'].map((g) => parteDeConteo(g, p.conteo)).filter(Boolean);
    lineas.push(`• Servicios (${fuentesDeGrupos(['colegios', 'salud', 'paraderos', 'parques'])}, ${c.fecha || 'sin fecha'}; puede faltar alguno): ${partes.length ? partes.join('; ') : 'no encontré ninguno en los datos'}.`);
    const q = p.cauces;
    const deDonde = q.fuentes && q.fuentes.length ? listaEs(q.fuentes.map((f) => C.nombreFuenteCauce(f))) : 'la ANA';
    const ningunoDe = Array.isArray(q.fuentes) ? 'la ANA, el IGP y OpenStreetMap no registran' : 'la ANA no registra';
    if (q.sinDato) lineas.push('• Quebradas y ríos: no pude leer el archivo de cauces, así que no lo afirmo.');
    else if (q.nombres.length) lineas.push(`• Quebradas y ríos: lo cruzan ${listaEs(q.nombres.slice(0, 5))} (según ${deDonde}; no incluyen todas las quebradas urbanas ni son un mapa de peligro).`);
    else lineas.push(`• Quebradas y ríos: ${ningunoDe} cauces en este distrito (no incluyen todas las quebradas urbanas ni son un mapa de peligro).`);
    // Líneas de SmartBus que cruzan el distrito y precio de oferta por m² (Aptología, solo 3 distritos): se agregan solo si hay dato; nada inventado.
    const rd = c.rutasDistrito;
    if (rd && !rd.error && rd.res) {
      const ls = rd.res.lineas;
      lineas.push(ls.length
        ? `• Líneas de transporte (SmartBus): ${plural(ls.length, 'línea cruza', 'líneas cruzan')} el distrito: ${RT.listaTexto(ls, MAX_LINEAS_TEXTO)}.`
        : '• Líneas de transporte (SmartBus): ninguna de las líneas publicadas cruza el distrito.');
    }
    const pr = c.precios ? P.buscar(c.precios, intencion.distrito) : null;
    if (pr && pr.estado === 'INFORMATIVO' && pr.precioM2.venta !== null) {
      lineas.push(`• Precio de oferta (Aptología, ${P.textoPeriodo(pr.periodo)}): ${soles(pr.precioM2.venta)} por m² (mediana de ${pr.nAvisos.venta} avisos de departamentos en venta; es lo que piden, no lo que se paga).`);
    }
    // Escenario del CENEPRED ante El Niño: solo los dos niveles del distrito; el detalle se pregunta aparte.
    const cen = c.cenepredDatos ? Cen().buscar(c.cenepredDatos, intencion.distrito) : null;
    if (cen && cen.estado === 'INFORMATIVO') lineas.push(`• Riesgo ante El Niño (CENEPRED): inundaciones, riesgo ${cen.inundacion.nivel.toLowerCase()}; movimientos en masa, riesgo ${cen.movimientos_masa.nivel.toLowerCase()}. Es una estimación del distrito, no de tu predio.`);
    lineas.push(PREGUNTA_PRIORIDAD);
    return { texto: lineas.join('\n'), sugerencias: botonesDePrioridad(t), mapa: { distrito: intencion.distrito, capas: [] } };
  }

  function respuestaMejorZona() {
    return {
      texto: `No elijo una «mejor zona»: depende de lo que te importe a ti. Para una familia con niños pesa el colegio; para quien no tiene auto, el transporte; para quien busca calma, que sea una zona residencial tranquila. Puedes decirme un distrito y te cuento cómo es, o decirme qué necesitas y busco los sectores donde se cumpla.\n${PREGUNTA_PRIORIDAD}`,
      sugerencias: botonesDePrioridad(null),
    };
  }

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

  const fmtM = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
  const AVISO_RIESGO = 'Es contexto informativo, no una evaluación de peligro: para decidir, consulta SIGRID (CENEPRED) y al IMPLA.';

  function textoQuebrada(c) {
    const q = c.cauce;
    if (!q) return 'Todavía estoy calculando las quebradas cercanas a tu punto; vuelve a preguntar en unos segundos.';
    if (q.estado === 'SIN DATO' || q.distanciaM === null) return `No tengo el dato de quebradas y cauces para tu punto (${q.error || 'archivo no disponible'}), así que no lo afirmo. Consulta SIGRID (CENEPRED) y al IMPLA.`;
    const lineas = [`El cauce más cercano es ${q.nombre}${q.tipo ? ` (${q.tipo.toLowerCase()})` : ''}, a ${fmtM(q.distanciaM)} en línea recta de tu punto${q.fuenteCorta ? ` (fuente: ${q.fuenteCorta})` : ''}.`];
    if (Array.isArray(q.alias) && q.alias.length) lineas.push(`También figura como ${listaEs(q.alias.map((a) => a.nombre))}.`);
    if (q.segunUmbralUsuario) lineas.push(`Según tu umbral (al menos ${fmtUmbral(q.umbralM)} de un cauce): ${q.estado === 'CUMPLE' ? 'cumple' : 'no cumple'}.`);
    else lineas.push('No existe una distancia normativa a una quebrada, así que no digo si es «cerca» o «lejos». Si quieres un criterio propio, fija tu distancia mínima en «Mis umbrales».');
    const faltan = C.textoQuebradasAusentes(q.ausentes);
    lineas.push(`Límites: los cauces vienen de ${C.textoFuentesCauces(q.fuentes)} y ninguna fuente es completa${faltan ? `; todavía no figuran ${faltan}` : ''}. Tampoco es un mapa de peligro ni delimita la faja marginal.`, AVISO_RIESGO);
    return lineas.join('\n');
  }

  function textoSismos(c) {
    const s = c.sismos;
    if (!s) return 'Todavía estoy calculando la actividad sísmica reportada cerca de tu punto; vuelve a preguntar en unos segundos.';
    if (s.estado === 'SIN DATO' || s.total === null) return `No tengo el archivo de sismos reportados del IGP (${s.error || 'no disponible'}), así que no lo afirmo.`;
    const lineas = [`Entre el ${s.desde} y el ${s.hasta}, el IGP reportó ${s.total} sismo${s.total === 1 ? '' : 's'} con epicentro a ${s.radioM / 1000} km o menos de tu punto${s.magnitudMaxima !== null ? `; la magnitud máxima fue ${String(s.magnitudMaxima).replace('.', ',')}` : ''}.`];
    lineas.push('Es actividad reciente reportada: no predice sismos ni mide el peligro. Para construir, la referencia normativa es la zona sísmica de la Norma E.030, que depende del distrito y del suelo.');
    return lineas.join('\n');
  }

  function textoPeligros(c) {
    const p = c.peligros;
    if (!p) return 'Todavía estoy calculando los peligros registrados cerca de tu punto; vuelve a preguntar en unos segundos.';
    if (p.estado === 'SIN DATO' || p.total === null) return `No tengo el inventario de peligros geológicos (${p.error || 'no disponible'}), así que no lo afirmo. Consulta SIGRID (CENEPRED).`;
    const tipo = p.masCercano ? p.masCercano.subtipo || p.masCercano.tipo : null;
    const lineas = [`El inventario de INGEMMET tiene ${p.total} peligro${p.total === 1 ? '' : 's'} geológico${p.total === 1 ? '' : 's'} registrado${p.total === 1 ? '' : 's'} a ${p.radioM} m o menos de tu punto.`];
    if (p.masCercano) lineas.push(`El más cercano${tipo ? ` (${tipo.toLowerCase()})` : ''} está a ${fmtM(p.distanciaM)} en línea recta.`);
    lineas.push('Es un inventario de eventos documentados, no un mapa de susceptibilidad: que no haya registros cerca no significa que el lugar sea seguro.', AVISO_RIESGO);
    return lineas.join('\n');
  }

  // ---------------------------------------------------- Peligro volcánico del Misti (zonas del IGP, informativo)

  const FUENTE_VOLCAN = 'Zonas de peligro volcánico del Misti del Instituto Geofísico del Perú (IGP), congeladas con su fecha de extracción. El mapa oficial de referencia es el de INGEMMET (Boletín Serie C n.° 100, 2025); no se pudo confirmar de qué edición salen las capas del IGP y el servicio no trae fecha.';
  const LIM_VOLCAN = 'Es un mapa de escala regional y sin fecha de elaboración: cerca del borde de una zona el nivel no es exacto a nivel de predio. No es una evaluación de riesgo ni dice si habrá una erupción, y que un lugar no esté en una zona no significa que no haya peligro. Para decidir, consulta el CENEPRED (SIGRID), tu municipalidad y el IGP o INGEMMET.';
  const SUGERENCIAS_VOLCAN = ['¿Hay lahares cerca de mi punto?', '¿Paucarpata está en peligro por el Misti?', 'Dame un resumen de mi punto'];

  /** Los fenómenos que se pueden dibujar entre los que pidió la persona (todos los dibujables si no nombró ninguno); null si no hay nada que dibujar (solo ceniza). */
  function mapaDeVolcan(intencion, distrito) {
    const pedidos = intencion.volcanTipos || [];
    const dibujables = Vol().dibujables();
    const tipos = pedidos.length ? pedidos.filter((t) => dibujables.includes(t)) : dibujables;
    return tipos.length ? { distrito, capas: [], volcan: { tipos } } : null;
  }

  function textoVolcanPunto(intencion, c) {
    const v = c.volcan;
    const pedidos = intencion.volcanTipos || [];
    if (!v) return 'Todavía estoy calculando el peligro volcánico de tu punto; vuelve a preguntar en unos segundos.';
    if (v.estado === 'SIN DATO') return `No tengo el mapa de peligro volcánico del IGP (${v.error || 'archivo no disponible'}), así que no lo afirmo. Consulta el CENEPRED (SIGRID), tu municipalidad y el IGP.`;
    const resumen = pedidos.length ? v.resumen.filter((r) => pedidos.includes(r.tipo)) : v.resumen;
    const lineas = [Vol().frasePunto(resumen, { tipos: pedidos })];
    if (resumen.length) Vol().lineasPunto(resumen).forEach((l) => lineas.push(`• ${l.texto}`));
    if (pedidos.includes('ceniza') && pedidos.length === 1) lineas.push('La ceniza cubre toda la ciudad en los escenarios del IGP, por eso no la dibujo en el mapa.');
    lineas.push(`Datos del IGP congelados el ${v.fecha || 'sin fecha'}. ${LIM_VOLCAN}`);
    return lineas.join('\n');
  }

  function respuestaVolcanDistrito(intencion, c) {
    const t = c.distritoTitulo || Dist().titulo(intencion.distrito);
    if (intencion.distritoFuera) return { texto: textoDistritoFuera(t), sugerencias: SUGERENCIAS_BASE };
    const d = c.volcanDistrito;
    if (!d) return { texto: `Todavía estoy midiendo el peligro volcánico de ${t}; vuelve a preguntar en unos segundos.`, sugerencias: SUGERENCIAS_VOLCAN };
    if (d.error) return { texto: `No tengo el mapa de peligro volcánico del IGP (${d.error}), así que no lo afirmo. Consulta el CENEPRED (SIGRID), tu municipalidad y el IGP.`, sugerencias: SUGERENCIAS_VOLCAN };
    const pedidos = intencion.volcanTipos || [];
    const texto = [Vol().fraseDistrito(t, d.r, { tipos: pedidos }), `Datos del IGP congelados el ${d.fecha || 'sin fecha'}. Los porcentajes salen de una muestra de puntos del distrito. ${LIM_VOLCAN}`].join('\n');
    return { texto, sugerencias: [`¿Qué líneas pasan por ${t}?`, 'Dame un resumen de mi punto', '¿Hay lahares cerca de mi punto?'], mapa: mapaDeVolcan(intencion, intencion.distrito) };
  }

  // ------------------------------- Escenario de riesgo del CENEPRED ante El Niño (por distrito, informativo)

  const FUENTE_CENEPRED = 'Escenario de riesgo por inundaciones y movimientos en masa ante lluvias asociadas al Fenómeno El Niño del CENEPRED (estudio de mayo de 2026; capas del SIGRID actualizadas en 2026), congelado con su fecha de descarga.';
  const LIM_CENEPRED = Cen().QUE_NO_CUBRE;
  const SUGERENCIAS_CENEPRED = ['¿Paucarpata se inunda?', 'Riesgo de huaico en Sachaca', '¿Qué dice el CENEPRED de mi punto?'];
  const SIN_CENEPRED = 'Consulta el SIGRID (CENEPRED) y la evaluación de riesgos de tu municipalidad.';

  /** Qué dibujar: un fenómeno a la vez (si pidió los dos, la inundación) y, si lo hay, el distrito al que acercar el mapa. */
  function mapaDeCenepred(intencion, distrito) {
    const f = intencion.cenepredFenomenos || [];
    return { distrito, capas: [], cenepred: { fenomeno: f.length === 1 ? f[0] : 'inundacion' } };
  }

  function textoCenepred(r, intencion, fecha) {
    const f = intencion.cenepredFenomenos || [];
    const lineas = [Cen().frase(r, { fenomenos: f })];
    Cen().lineas(r, { fenomenos: f }).forEach((l) => lineas.push(`• ${l.texto}`));
    lineas.push(Cen().SUSCEPTIBILIDAD);
    if (f.includes('movimientos_masa') || f.length === 0) lineas.push(`Los movimientos en masa son, por ejemplo, ${Cen().EXPLICA_MM}.`);
    lineas.push(`Datos del CENEPRED congelados el ${fecha || 'sin fecha'}. ${LIM_CENEPRED}`);
    if (intencion.cenepredMapa && f.length !== 1) lineas.push('Dibujé en el mapa el riesgo ante inundaciones; pide «mapa del riesgo de movimientos en masa» para ver el otro.');
    return lineas.join('\n');
  }

  /** Los distritos de los datos agrupados por nivel, del más alto al más bajo, para «¿qué distritos tienen riesgo muy alto de inundación?». */
  function textoCenepredTodos(intencion, datos) {
    const f = intencion.cenepredFenomenos && intencion.cenepredFenomenos.length ? intencion.cenepredFenomenos : Cen().IDS;
    const total = Object.keys(datos.distritos).length;
    const bloques = f.map((id) => {
      const filas = Cen().distritosPorFenomeno(datos, id);
      const cabecera = `Ante ${Cen().FENOMENOS[id].nombre}, según el CENEPRED, en un escenario El Niño:`;
      const niveles = [...Cen().NIVELES].reverse().map((nivel) => ({ nivel, nombres: filas.filter((d) => d.nivel === nivel).map((d) => Dist().titulo(d.distrito)).sort((a, b) => a.localeCompare(b, 'es')) })).filter((x) => x.nombres.length);
      return [cabecera, ...niveles.map((x) => `• Riesgo ${x.nivel.toLowerCase()} (${x.nombres.length}): ${x.nombres.join(', ')}.`)].join('\n');
    });
    return [`Estos son los ${total} distritos de Arequipa Metropolitana que tengo, por nivel de riesgo.`, ...bloques, `Datos del CENEPRED congelados el ${datos.fecha_descarga || 'sin fecha'}. ${LIM_CENEPRED}`].join('\n');
  }

  function respuestaCenepred(intencion, c) {
    const fin = (texto, mapa) => ({ texto, sugerencias: SUGERENCIAS_CENEPRED, ...(mapa ? { mapa } : {}) });
    if (intencion.cenepredTodos && !intencion.distrito) {
      if (!c.cenepredDatos) return fin(`No pude leer el archivo del escenario de riesgo del CENEPRED, así que no afirmo nada. ${SIN_CENEPRED}`);
      return fin(textoCenepredTodos(intencion, c.cenepredDatos), intencion.cenepredMapa ? mapaDeCenepred(intencion, null) : null);
    }
    if (intencion.distrito) {
      const t = c.distritoTitulo || Dist().titulo(intencion.distrito);
      if (intencion.distritoFuera) return { texto: textoDistritoFuera(t), sugerencias: SUGERENCIAS_BASE };
      if (!c.cenepredDatos) return fin(`No pude leer el archivo del escenario de riesgo del CENEPRED, así que no afirmo nada de ${t}. ${SIN_CENEPRED}`);
      const r = Cen().buscar(c.cenepredDatos, intencion.distrito);
      if (r.estado !== 'INFORMATIVO') return fin(`${r.causa} No lo estimo. ${SIN_CENEPRED}`);
      return fin(textoCenepred(r, intencion, r.fechaDescarga), intencion.cenepredMapa ? mapaDeCenepred(intencion, intencion.distrito) : null);
    }
    if (!c.punto) return fin('Elige un punto en el mapa para ver qué estima el CENEPRED para su distrito, o pregúntame por un distrito: «¿Paucarpata se inunda?».');
    const r = c.cenepred;
    if (!r) return fin('Todavía estoy calculando el escenario del CENEPRED para tu punto; vuelve a preguntar en unos segundos.');
    if (r.estado !== 'INFORMATIVO') return fin(`No tengo el escenario de riesgo del CENEPRED para tu punto (${r.error || 'archivo no disponible'}), así que no lo afirmo. ${SIN_CENEPRED}`);
    return fin(textoCenepred(r, intencion, r.fecha), intencion.cenepredMapa ? mapaDeCenepred(intencion, null) : null);
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

  const FUENTE_RUTAS = 'SmartBus (smartbus.app)';
  const fmtFechaCorta = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'sin fecha');
  const citaRutas = (r) => `Fuente: ${r.fuente || FUENTE_RUTAS}, recorridos del ${fmtFechaCorta(r.fecha)}, usados con ${r.permiso || 'autorización verbal de SmartBus; confirmación escrita pendiente'}. Son los recorridos publicados: sin frecuencias ni horarios.`;
  const MAX_LINEAS_TEXTO = 10;

  /** Líneas que pasan cerca del punto elegido (r = Equipamiento.evaluar().transporte.rutas). */
  function textoRutasPunto(r) {
    if (!r) return 'No tengo las líneas de transporte para tu punto todavía; vuelve a preguntar en unos segundos.';
    if (r.error) return `No pude leer las líneas de SmartBus (${r.error}). El paradero más cercano de OpenStreetMap sí está en la ficha.`;
    const ref = fmtUmbral(r.distanciaM);
    if (!r.lineas.length) {
      return [`Ninguna de las líneas que publica SmartBus pasa a ${ref} o menos de tu punto (${ref} es una convención del proyecto).`, citaRutas(r), 'Distancia en línea recta al trazado, no recorrido a pie.'].join('\n');
    }
    const lineas = r.lineas.slice(0, MAX_LINEAS_TEXTO).map((l) => {
      const parada = l.parada ? `; parada más cercana «${l.parada.nombre}» a ${fmtDist(l.parada.distanciaM)}` : '';
      return `• ${RT.etiquetaLinea(l)}: el trazado pasa a ${fmtDist(l.distanciaM)}${parada}.`;
    });
    if (r.lineas.length > MAX_LINEAS_TEXTO) lineas.push(`• … y ${r.lineas.length - MAX_LINEAS_TEXTO} más.`);
    return [
      `Líneas que pasan a ${ref} o menos de tu punto: ${RT.listaTexto(r.lineas, MAX_LINEAS_TEXTO)}.`,
      ...lineas,
      `${ref} es una convención del proyecto. Distancia en línea recta al trazado, no recorrido a pie.`,
      citaRutas(r),
    ].join('\n');
  }

  /**
   * Líneas que cruzan un distrito (`nombre` ya viene del buscador de distritos). `d` = { res, error } que arma la vista con
   * Rutas.cruzan; res = resultado de Rutas.cruzan.
   */
  function textoRutasDistrito(d, nombre) {
    if (!d) return 'No tengo las líneas de transporte todavía; vuelve a preguntar en unos segundos.';
    if (d.error) return `No pude leer las líneas de SmartBus (${d.error}).`;
    const r = d.res;
    if (!r.lineas.length) return [`Ninguna de las líneas que publica SmartBus tiene su trazado dentro del distrito de ${nombre}.`, citaRutas(r)].join('\n');
    const lineas = r.lineas.slice(0, MAX_LINEAS_TEXTO + 2).map((l) => `• ${RT.etiquetaLinea(l)}: ${l.paradas > 0 ? `${l.paradas} ${l.paradas === 1 ? 'parada' : 'paradas'} dentro del distrito` : 'el trazado entra al distrito, sin paradas dentro'}.`);
    if (r.lineas.length > MAX_LINEAS_TEXTO + 2) lineas.push(`• … y ${r.lineas.length - MAX_LINEAS_TEXTO - 2} más.`);
    return [
      `Líneas con trazado dentro del distrito de ${nombre}: ${RT.listaTexto(r.lineas, MAX_LINEAS_TEXTO + 2)}.`,
      ...lineas,
      'Una línea cuenta si algún punto de su trazado cae dentro del distrito; no dice por qué calles ni a qué hora. El límite del distrito es el de GEOCATMIN.',
      citaRutas(r),
    ].join('\n');
  }

  /**
   * Qué dibujar para una respuesta de líneas: los recorridos de las líneas halladas y, con un punto, su parada más cercana. null si no
   * hay ninguna (no se pinta nada). Los recorridos salen del archivo de SmartBus, que solo se carga cuando se va a dibujar.
   */
  function mapaDeLineas(res, distrito, punto) {
    if (!res || res.error || !Array.isArray(res.lineas) || res.lineas.length === 0) return null;
    return { distrito, capas: [], lineas: { nombres: res.lineas.map((l) => l.linea), punto: punto ? { lat: punto.lat, lon: punto.lon } : null } };
  }

  const TEXTO_FUENTES = [
    'De dónde sale cada cosa:',
    '• Zonificación: plano y reglamento del PDM Arequipa 2016-2025 (O.M. 961-MPA, con la zonificación restituida por la 975-MPA). Es referencial.',
    '• Salud: RENIPRESS (SUSALUD, licencia ODC-By) y colegios: padrón de ESCALE (MINEDU), como fuente primaria, con su fecha. OpenStreetMap (ODbL) solo de respaldo, donde ningún registro oficial tiene un punto a 200 m; cada establecimiento dice de cuál es.',
    '• Paraderos y áreas verdes: OpenStreetMap (ODbL), copia congelada con su fecha de extracción. Algo que falte en el mapa puede existir.',
    '• Líneas de transporte (recorridos y paradas): SmartBus (smartbus.app), usados con su autorización verbal (confirmación escrita pendiente). Sin frecuencias ni horarios.',
    '• Umbrales: colegios 500 m inicial, 1500 m primaria y 3000 m secundaria (MINEDU); área verde ≥ 0,5 ha a 300 m (OMS Europa); salud 1000 m, paradero 400 m y borde de zona 20 m son convenciones del proyecto.',
    '• Peligro volcánico del Misti: zonas del Instituto Geofísico del Perú (IGP), sin fecha de elaboración en el servicio; el mapa oficial de referencia es el de INGEMMET (Boletín n.° 100, 2025). Es informativo, no una evaluación de riesgo.',
    '• Riesgo del distrito ante El Niño: escenario del CENEPRED (SIGRID) para inundaciones y movimientos en masa, estimado por distrito para lluvias como las de 1983, 1998, 2017 y 2023. Es informativo y no es una evaluación de tu predio.',
    '• Precio de oferta por m² del distrito: Aptología (datos abiertos, CC BY 4.0). Son precios pedidos en avisos, no de cierre, y solo hay cifra en los distritos con suficientes avisos.',
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

  const TEXTO_LIMITE_CAUCES = 'Ojo: «lejos de quebradas y ríos» usa los cauces de la ANA, el IGP y OpenStreetMap, que no incluyen todas las quebradas urbanas, no son un mapa de peligro y no delimitan la faja marginal. Cumplirlo no garantiza que el lugar esté libre de huaicos.';

  const SUGERENCIAS_PRECIO = ['¿Cuánto cuesta el m² en Cayma?', 'Precio por m² en todos los distritos', 'Dame un resumen de mi punto'];
  // Se escribe con coma, como el resto de cifras del asistente, y sin espacios dentro del número (el texto se verifica cifra por cifra).
  const soles = (n) => `S/ ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  const LIM_PRECIO = 'Son precios pedidos en avisos de venta de departamentos, no de cierre ni una tasación, y es la mediana del distrito, no el precio de un inmueble en particular.';

  function lineaPrecio(r) {
    const nAv = r.nAvisos.venta;
    return `${titulo(r.distrito)}: ${soles(r.precioM2.venta)} por m² (${nAv} avisos)`;
  }

  /**
   * Precio de oferta por m² del distrito, con los datos de Aptología congelados (ctx.precios = contenido de
   * precios_m2_distrito.json). Solo informa: no compara con un precio, no dice si es caro y no recomienda.
   *   ctx: { precios, distrito? (distrito del punto, en mayúsculas), punto? }
   */
  function textoPrecio(intencion, c) {
    const datos = c.precios;
    if (!datos) return 'No pude leer el archivo de precios por distrito, así que no tengo una cifra para darte.';
    const conDato = P.distritosConDato(datos).map((d) => titulo(d));
    const cierre = `${LIM_PRECIO}\n${datos.atribucion} (${datos.licencia}), ${P.textoPeriodo(datos.periodo)}. Es informativo y referencial: no reemplaza una tasación.`;
    const nombre = intencion.distrito || (intencion.todosPrecio ? null : c.distrito || null);
    if (!nombre) {
      const filas = P.distritosConDato(datos).map((d) => P.buscar(datos, d)).filter((r) => r.estado === 'INFORMATIVO').map((r) => `• ${lineaPrecio(r)}`);
      if (filas.length === 0) return 'El archivo de precios no trae ningún distrito con cifra.';
      return [`Precio de oferta por m² (venta) en los distritos con cifra publicada:`, ...filas, 'Para los demás distritos no hay cifra: la fuente solo publica distritos con suficientes avisos.', cierre].join('\n');
    }
    const r = P.buscar(datos, nombre);
    if (r.estado === 'SIN DATO') {
      return [`${r.causa}`, conDato.length ? `Distritos con cifra: ${conDato.join(', ')}.` : null, 'No estimo un precio donde la fuente no lo publica.'].filter(Boolean).join('\n');
    }
    return [
      `En ${titulo(r.distrito)} el precio de oferta mediano es ${soles(r.precioM2.venta)} por m² (departamentos en venta, ${r.nAvisos.venta} avisos).`,
      cierre,
    ].join('\n');
  }

  const TEMAS = {
    seguridad: 'No evalúo seguridad ciudadana: el proyecto la dejó fuera de alcance, aunque los estudios muestran que pesa en la decisión de compra. No te doy una respuesta a medias.',
    precio: 'No tengo el precio de una casa, un terreno ni un alquiler en particular, ni puedo decirte qué zona es más barata. Solo conozco el precio de oferta por m² promedio de algunos distritos (Aptología): pregúntame «¿cuánto cuesta el m² en Cayma?».',
    volcan_busqueda: 'Todavía no puedo buscar zonas según el peligro volcánico. Sí puedo decirte en qué zonas de peligro del Misti cae tu punto («¿hay lahares cerca de mi punto?») o qué parte de un distrito cae en cada una («¿Paucarpata está en peligro por el Misti?»).',
    cenepred_busqueda: 'Todavía no puedo buscar zonas según el riesgo de inundación o de movimientos en masa. Sí puedo decirte qué estima el CENEPRED para el distrito de tu punto («¿qué dice el CENEPRED de mi punto?») o para un distrito («¿Paucarpata se inunda?»).',
    ruido: 'No tengo datos de ruido. «Zona tranquila» es solo una aproximación con la zonificación (residencial de densidad baja o media 1), no una medición.',
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
    if (tipo === 'ayuda') return fin('Puedo:\n• Buscar zonas: «busco cerca de un colegio y un parque, lo más importante es el parque» o «posta y paradero en un radio de 1 km».\n• Contarte de tu punto: «¿qué zona es?», «¿hay un colegio cerca?», «dame un resumen».\n• Líneas de transporte: «¿qué buses pasan por aquí?» o «¿qué líneas pasan por Paucarpata?».\n• Peligro volcánico del Misti: «¿hay lahares cerca de mi punto?» o «¿Paucarpata está en peligro por el Misti?».\n• Riesgo ante El Niño por distrito (CENEPRED): «¿Paucarpata se inunda?», «riesgo de huaico en Sachaca» o «¿qué dice el CENEPRED de mi punto?».\n• Calcular: «¿cuánto puedo construir en un lote de 200 m²?».\n• Decirte el precio de oferta por m² promedio de un distrito: «¿cuánto cuesta el m² en Cayma?».\n• Explicar el PDM nuevo y de dónde salen los datos.\nNo tengo datos de seguridad ni ruido, ni el precio de una casa o un terreno en particular.');
    if (tipo === 'fuentes') return fin(TEXTO_FUENTES);
    if (tipo === 'no_soportado') return fin(`${TEMAS[intencion.temaNoSoportado] || 'Eso no está en los datos que uso.'}\nSí puedo ayudarte con la zonificación y con la cercanía a colegios, salud, transporte y áreas verdes.`);
    if (tipo === 'desconocido') return fin('No entendí eso. Puedes pedirme, por ejemplo:', SUGERENCIAS_BASE);
    if (tipo === 'pdm') return fin(textoPDM(c.estadoPDM));
    if (tipo === 'contar') return respuestaContar(intencion, c);
    if (tipo === 'perfil') return respuestaPerfil(intencion, c);
    if (tipo === 'mejor_zona') return respuestaMejorZona();
    if (tipo === 'distrito_desconocido') return fin('No reconozco «' + (intencion.distritoTexto || 'ese lugar') + '» como un distrito de la provincia de Arequipa. Puedes escribir, por ejemplo, Cayma, Paucarpata o Cerro Colorado.');

    // Líneas de transporte: con un distrito no hace falta punto; sin él, se habla del punto elegido.
    if (tipo === 'rutas') {
      if (intencion.distrito) {
        const t = c.distritoTitulo || Dist().titulo(intencion.distrito);
        if (intencion.distritoFuera) return fin(textoDistritoFuera(t), SUGERENCIAS_BASE);
        return { ...fin(textoRutasDistrito(c.rutasDistrito, t), ['¿Qué buses pasan por aquí?', `Cuéntame de ${t}`]), mapa: mapaDeLineas(c.rutasDistrito && c.rutasDistrito.res, intencion.distrito, null) };
      }
      if (!c.punto) return fin('Elige un punto en el mapa para ver qué líneas pasan cerca, o pregúntame por un distrito: «¿qué líneas pasan por Paucarpata?».', SUGERENCIAS_BASE);
      const rp = c.entorno && c.entorno.transporte && c.entorno.transporte.rutas;
      return { ...fin(textoRutasPunto(rp), ['Dame un resumen del punto', '¿Hay un paradero cerca?']), mapa: mapaDeLineas(rp, null, c.punto) };
    }
    if (tipo === 'precio') return fin(textoPrecio(intencion, c), SUGERENCIAS_PRECIO);
    if (tipo === 'cenepred') return respuestaCenepred(intencion, c);
    if (tipo === 'volcan' && intencion.distrito) return respuestaVolcanDistrito(intencion, c);
    if (tipo === 'volcan' && !c.punto) return fin('Elige un punto en el mapa para ver en qué zonas de peligro volcánico del Misti cae, o pregúntame por un distrito: «¿Paucarpata está en peligro por el Misti?».', SUGERENCIAS_VOLCAN);
    if (tipo === 'volcan') return { ...fin(textoVolcanPunto(intencion, c), SUGERENCIAS_VOLCAN), mapa: mapaDeVolcan(intencion, null) };

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

    if (tipo === 'quebrada') return fin(textoQuebrada(c));
    if (tipo === 'sismos') return fin(textoSismos(c));
    if (tipo === 'peligros') return fin(textoPeligros(c));

    if (tipo === 'servicio' || tipo === 'ficha') {
      if (!c.entorno) return fin('Todavía estoy calculando los servicios cercanos a tu punto; vuelve a preguntar en unos segundos.');
      if (tipo === 'servicio') {
        const ids = intencion.criterios.filter((x) => CRITERIOS[x.id].tipo === 'servicio').map((x) => x.id);
        if (ids.length === 0) return fin('Eso lo uso para buscar zonas, no para describir un punto. Prueba: «busco una zona cerca de campiña y residencial».');
        return fin([...ids.flatMap((id) => lineasServicio(id, c.entorno)), cierreServicios(ids)].join('\n'));
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
        ...lineaLineas(e.transporte),
        linea('Área verde', e.areaVerde),
        c.estadoPDM ? 'Sobre el PDM nuevo, pregúntame «¿cambiará la zonificación?».' : null,
        AVISO_REFERENCIAL,
      ].filter(Boolean).join('\n'));
    }
    return fin('No entendí eso. Puedes pedirme, por ejemplo:');
  }

  // ------------------------------------------------------ Texto de una búsqueda

  const MAX_SECTORES = 6;

  /**
   * Cómo se dice un criterio de la búsqueda en palabras de todos los días.
   * Devuelve { grupo, texto }: «tienes» (algo que está cerca), «zona» (dónde estás) o «lejos» (a más de cierta distancia).
   */
  function fraseCriterio(c) {
    const def = CRITERIOS[c.id];
    const u = c.umbralEfectivoM;
    const menos = (m) => `a menos de ${fmtDist(m)}`;
    if (def.tipo === 'cauce') return { grupo: 'lejos', texto: `a más de ${fmtDist(u)} de una quebrada o río` };
    if (def.tipo === 'zona') {
      const txt = {
        residencial: u > 0 ? `con zona residencial ${menos(u)}` : 'en zona residencial',
        tranquilo: 'en zona tranquila (residencial de baja densidad)',
        campina: `con campiña ${menos(u)}`,
        comercial: `con zona comercial ${menos(u)}`,
        historico: `con el centro histórico ${menos(u)}`,
      }[c.id];
      return { grupo: 'zona', texto: txt };
    }
    if (def.niveles) {
      const por = c.umbralPorNivel || {};
      const partes = def.niveles.filter((n) => esNumero(por[n])).map((n, k) => `${k === 0 ? 'inicial' : 'de primaria'} ${menos(por[n])}`);
      return { grupo: 'tienes', texto: partes.length ? `un colegio ${partes.join(' o ')}` : 'un colegio inicial o de primaria cerca' };
    }
    const txt = {
      salud: `un establecimiento de salud ${menos(u)}`,
      inicial: `un colegio inicial ${menos(u)}`,
      primaria: `un colegio de primaria ${menos(u)}`,
      secundaria: `un colegio de secundaria ${menos(u)}`,
      transporte: `un paradero ${menos(u)}`,
      areaVerde: `un parque ${menos(u)}`,
    }[c.id];
    return { grupo: 'tienes', texto: txt };
  }

  /** «un colegio inicial a menos de 500 m y un parque a menos de 300 m, y estás a más de…»: la condición completa, en una frase. */
  function condicionEnFrase(criterios, { subjuntivo = false } = {}) {
    const fr = criterios.map(fraseCriterio);
    const de = (g) => fr.filter((f) => f.grupo === g).map((f) => f.texto);
    const zona = de('zona');
    const tienes = de('tienes');
    const lejos = de('lejos');
    let out = zona.length ? ` ${listaEs(zona)}` : '';
    if (tienes.length) out += ` donde ${subjuntivo ? 'tengas' : 'tienes'} a la vez ${listaEs(tienes)}`;
    if (lejos.length) out += `${tienes.length ? ', y estás' : ''} ${listaEs(lejos)}`;
    return out;
  }

  const hectareasEnFrase = (ha) => `unas ${ha < 15 ? Math.max(1, Math.round(ha)) : Math.round(ha / 5) * 5} hectáreas`;

  /** Lo que hay en el centro de un sector, con distancias redondeadas: «colegio inicial a 230 m (Jardín X), parque a 120 m». */
  function notaDeSector(celda, criterios) {
    const partes = criterios.map((c) => {
      const d = celda.detalle && celda.detalle[c.id];
      if (!d || d.distanciaM === null || d.distanciaM === undefined) return null;
      const nivel = d.nivel === 'inicial' ? 'colegio inicial' : 'colegio de primaria';
      const cual = {
        salud: 'salud', inicial: 'colegio inicial', primaria: 'colegio de primaria', secundaria: 'colegio de secundaria', colegio: d.nivel ? nivel : 'colegio',
        transporte: 'paradero', areaVerde: 'parque', campina: 'campiña', comercial: 'zona comercial', historico: 'centro histórico',
      }[c.id];
      if (!cual) return null;
      if (CRITERIOS[c.id].tipo === 'zona' && d.distanciaM === 0) return null;
      return `${cual} a ${fmtDist(Math.max(10, Math.round(d.distanciaM / 10) * 10))}${d.nombre ? ` (${d.nombre})` : ''}`;
    }).filter(Boolean);
    return partes.length ? `En el centro del sector: ${partes.join(', ')}.` : '';
  }

  // Cómo se nombra un criterio al decir «Quita …».
  const QUITA = {
    salud: 'la posta', inicial: 'el colegio inicial', primaria: 'el colegio de primaria', secundaria: 'el colegio de secundaria', colegio: 'el colegio',
    transporte: 'el paradero', areaVerde: 'el parque', residencial: 'la zona residencial', tranquilo: 'la zona tranquila', campina: 'la campiña',
    comercial: 'la zona comercial', historico: 'el centro histórico', lejosQuebrada: 'lo de las quebradas',
  };

  /**
   * Presenta el resultado de buscar en lenguaje de personas: sectores donde se cumple todo a la vez, nunca celdas ni porcentajes.
   *   meta: { aproximados, temaNoSoportado, radioGlobalM, datos?, distrito? (título, p. ej. «Paucarpata»), maxSectores? }
   *   datos (Asistente.prepararDatos) sirve para ponerle a cada sector el nombre del elemento con nombre más cercano.
   * Devuelve { texto, lineas, filas, sectores, sugerencias }. filas son los sectores que se muestran en el chat (los más extensos,
   * o los más cercanos a lo que la persona marcó como prioridad); sectores son todos, con su contorno, para dibujarlos en el mapa.
   */
  function formatearBusqueda(resultado, meta = {}) {
    const lineas = [];
    const esDetalle = []; // paralela a lineas: true si la línea va en el apartado desplegable de la vista
    const agregarLinea = (texto, detalle = false) => { lineas.push(texto); esDetalle.push(detalle); };
    const criterios = resultado.criterios;
    const max = meta.maxSectores || MAX_SECTORES;
    const lugar = meta.distrito ? ` de ${meta.distrito}` : ' en la ciudad';
    const prioritarios = criterios.filter((c) => c.prioridad > 1);

    let todos = Sect().agrupar(resultado.cumplen || [], { pasoM: resultado.pasoM });
    const grandes = todos.filter((s) => s.celdas.length >= 2);
    if (grandes.length > 0) todos = grandes.map((s, k) => ({ ...s, n: k + 1 })); // un sector de un solo cuadro es demasiado pequeño para fiarse
    const sugerencias = [];
    let filas = [];
    let sectores = [];

    if (todos.length === 0) {
      if (resultado.totalCeldas === 0) {
        agregarLinea(`No encontré dónde buscar${lugar}: el plano de zonificación no tiene zonas construibles ahí.`);
        sugerencias.push('Incluye zonas condicionales');
      } else {
        agregarLinea(`No encontré ningún sector${lugar}${condicionEnFrase(criterios, { subjuntivo: true })}.`);
        const por = resultado.cumplenPor || {};
        const limita = criterios.filter((c) => por[c.id] !== undefined).sort((a, b) => por[a.id] - por[b.id])[0];
        if (limita && criterios.length > 1) {
          agregarLinea(`Lo que más limita es ${fraseCriterio(limita).texto}: ${por[limita.id] === 0 ? 'no hay ningún lugar que lo cumpla' : 'solo se cumple en una parte pequeña de la zona'}.`);
          sugerencias.push(`Quita ${QUITA[limita.id] || 'ese criterio'}`);
        }
        sugerencias.push('Incluye zonas condicionales');
        if (!hay(meta.radioGlobalM)) sugerencias.push('Busca con un radio de 1,5 km');
      }
    } else {
      const n = todos.length;
      agregarLinea(`Encontré ${n} ${n === 1 ? 'sector' : 'sectores'}${lugar}${condicionEnFrase(criterios)}.`);
      if (!meta.distrito) {
        const porDistrito = {};
        todos.forEach((s) => { if (s.distrito) porDistrito[s.distrito] = (porDistrito[s.distrito] || 0) + 1; });
        const nombres = Object.entries(porDistrito).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, k]) => `${Dist().titulo(d)} (${k})`);
        if (Object.keys(porDistrito).length > 1) agregarLinea(`Están en ${Object.keys(porDistrito).length} distritos: ${listaEs(nombres)}.`);
      }
      // Sin prioridad no hay orden de calidad: los más extensos primero. Con prioridad, los más cercanos a eso.
      const conCentro = todos.map((s) => ({ ...s, centroCelda: s.celdas.find((c) => c.lat === s.centro.lat && c.lon === s.centro.lon) || s.celdas[0] }));
      const clave = (s) => prioritarios.reduce((m, c) => {
        const d = s.centroCelda.detalle && s.centroCelda.detalle[c.id];
        return m + (d && d.distanciaM !== null && d.distanciaM !== undefined ? d.distanciaM / (c.umbralEfectivoM || 1) : 2);
      }, 0);
      const ordenados = (prioritarios.length > 0 ? [...conCentro].sort((a, b) => clave(a) - clave(b)) : conCentro).map((s, k) => ({ ...s, n: k + 1 }));
      if (n > max) agregarLinea(`Te muestro ${prioritarios.length ? `los ${max} más cercanos a lo que priorizaste` : `los ${max} más extensos`}; los demás están en el mapa.`);
      agregarLinea(prioritarios.length
        ? `Los ordené por cercanía a lo que marcaste como prioridad (${listaEs(prioritarios.map((c) => fraseCriterio(c).texto))}).`
        : 'Los numeré solo para ubicarlos en el mapa; no es un ranking.');
      const ids = criterios.map((c) => c.id);
      sectores = ordenados.map((s) => ({
        n: s.n, centro: s.centro, hectareas: s.hectareas, distrito: s.distrito, nombre: null, contorno: Sect().contorno(s.celdas, { pasoM: resultado.pasoM }),
        centros: s.celdas.map((c) => [c.lat, c.lon]), // para dibujar solo las entidades que hacen cumplir al sector (capas.js)
      }));
      filas = ordenados.slice(0, max).map((s) => {
        const nom = meta.datos ? Sect().nombrar(s.centro, meta.datos, ids) : null;
        sectores[s.n - 1].nombre = nom ? nom.nombre : null;
        const donde = s.distrito && !meta.distrito ? ` en ${Dist().titulo(s.distrito)}` : '';
        return {
          titulo: `Sector ${s.n}${nom ? ` · cerca de ${nom.nombre}` : ''}`,
          distrito: s.distrito,
          orden: s.n,
          detalle: `${hectareasEnFrase(s.hectareas)}${donde}`,
          nota: notaDeSector(s.centroCelda, criterios),
          mejor: { lat: s.centro.lat, lon: s.centro.lon, zona: s.centro.zona },
          n: s.n,
        };
      });
      sugerencias.push('Agrega transporte', 'Prioriza el parque', 'Incluye zonas condicionales');
    }
    if (hay(meta.radioGlobalM)) agregarLinea(`Usé ${fmtDist(meta.radioGlobalM)} como distancia para todo lo que pediste (si quieres otra para uno solo, dime por ejemplo «colegio a 500 m»).`, true);
    if (todos.length > 0) agregarLinea('Para encontrarlos reviso el mapa en cuadros de 250 m y junto los vecinos que cumplen lo que pediste; por eso los bordes son aproximados.', true);
    if (meta.aproximados && meta.aproximados.length) {
      const nombres = meta.aproximados.map((id) => CRITERIOS[id].etiqueta.split(' (')[0].toLowerCase());
      const varios = nombres.length > 1;
      const motivos = meta.aproximados.map((id) => MOTIVO_APROXIMADO[id]);
      agregarLinea(`Ojo: ${nombres.join(' y ')} ${varios ? 'son aproximaciones' : 'es una aproximación'} con la zonificación (${motivos.join('; ')}), no ${varios ? 'datos medidos' : 'un dato medido'}.`);
    }
    if (criterios.some((c) => CRITERIOS[c.id].tipo === 'cauce')) agregarLinea(TEXTO_LIMITE_CAUCES);
    if (meta.temaNoSoportado) agregarLinea(`${TEMAS[meta.temaNoSoportado]}`);
    agregarLinea(AVISO_REFERENCIAL.replace('Es una consulta referencial: no', 'Resultado referencial: no'), true);
    return {
      texto: lineas.join('\n'),
      // La vista muestra principal y deja detalle dentro del apartado «Por qué, fuente y límites». Juntas son texto.
      lineas: { principal: lineas.filter((_, i) => !esDetalle[i]), detalle: lineas.filter((_, i) => esDetalle[i]) },
      filas,
      sectores,
      sugerencias,
    };
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

  // ------------------------------------------------ Búsqueda armada con menús

  /**
   * Lo que ofrecen los menús desplegables de la vista. Son los mismos criterios de CRITERIOS: los menús no agregan
   * nada que el chat no entienda. «Colegio» con su nivel se resuelve en construirConsulta.
   */
  const OPCIONES = {
    servicios: [
      { id: 'salud', etiqueta: 'Salud (posta, hospital, clínica)' },
      { id: 'colegio', etiqueta: 'Colegio' },
      { id: 'transporte', etiqueta: 'Transporte (paradero)' },
      { id: 'areaVerde', etiqueta: 'Área verde (parque)' },
    ],
    zonas: [
      { id: 'residencial', etiqueta: 'Zona residencial' },
      { id: 'tranquilo', etiqueta: 'Zona tranquila (aproximada)' },
      { id: 'campina', etiqueta: 'Campiña (zona agrícola)' },
      { id: 'comercial', etiqueta: 'Zona comercial (aproximada)' },
      { id: 'historico', etiqueta: 'Centro histórico (aproximado)' },
    ],
    niveles: [
      { id: 'colegio', etiqueta: 'Inicial o primaria' },
      { id: 'inicial', etiqueta: 'Inicial' },
      { id: 'primaria', etiqueta: 'Primaria' },
      { id: 'secundaria', etiqueta: 'Secundaria' },
    ],
    radios: [null, 500, 1000, 1500, 2000, 3000], // null = el umbral de cada criterio en la ficha
    // Distancia MÍNIMA a quebradas y ríos para «lejos de quebradas». Son opciones para elegir, no umbrales recomendados:
    // ninguna norma fija esa distancia. null = no importa.
    cauces: [null, 100, 200, 300, 500, 1000],
    // Casilla «Solo cerca de mi punto»: limita la búsqueda a celdas alrededor del punto elegido (CONFIG.asistente.radioAreaM si no hay radio).
    cercaDeMiPunto: { etiqueta: 'Solo cerca de mi punto' },
  };

  const NIVELES_MENU = OPCIONES.niveles.map((n) => n.id);

  /**
   * La estructura que produce `interpretar` para una búsqueda nueva, armada desde los menús en vez de desde un texto.
   *   entrada: { criterios: [id…], prioridades: [id…], nivel, radioM, incluirCondicional, lejosQuebradaM, cercaDeMiPunto }
   *   lejosQuebradaM (metros, opcional) agrega «lejos de quebradas y ríos» con esa distancia mínima.
   * «colegio» se reemplaza por el nivel elegido (inicial, primaria o secundaria); sin nivel válido queda «colegio»
   * (inicial o primaria). Una prioridad pesa 2 y el resto 1, igual que «lo más importante es…». Sin criterios válidos
   * devuelve la misma intención «desconocido» que el intérprete con un texto vacío.
   */
  function construirConsulta(entrada = {}) {
    const { criterios = [], prioridades = [], nivel = 'colegio', radioM = null, incluirCondicional = false, lejosQuebradaM = null, cercaDeMiPunto = false } = entrada || {};
    const aId = (id) => (id === 'colegio' && NIVELES_MENU.includes(nivel) ? nivel : id);
    const elegidos = [];
    (Array.isArray(criterios) ? criterios : []).forEach((id) => {
      const real = typeof id === 'string' && CRITERIOS[id] ? aId(id) : null;
      if (real && !elegidos.includes(real)) elegidos.push(real);
    });
    const minCauce = esNumero(lejosQuebradaM) && lejosQuebradaM > 0 ? lejosQuebradaM : null;
    if (minCauce !== null && !elegidos.includes('lejosQuebrada')) elegidos.push('lejosQuebrada');
    const prioritarios = new Set((Array.isArray(prioridades) ? prioridades : []).map((id) => aId(id)));
    const q = interpretar('');
    if (elegidos.length === 0) return q;
    q.tipo = 'buscar';
    q.modo = 'nuevo';
    q.criterios = elegidos.map((id) => ({ id, umbralM: id === 'lejosQuebrada' ? minCauce : null, prioridad: prioritarios.has(id) ? 2 : 1 }));
    q.aproximados = q.criterios.filter((c) => CRITERIOS[c.id].aproximado).map((c) => c.id);
    q.radioGlobalM = esNumero(radioM) && radioM > 0 ? radioM : null;
    q.incluirCondicional = Boolean(incluirCondicional);
    // «Solo cerca de mi punto»: lo mismo que el intérprete saca de «… cerca de mi punto». La distancia máxima pasa a ser el radio del área.
    q.limitarAlPunto = cercaDeMiPunto === true;
    return q;
  }

  // Cómo se dice cada criterio en una frase que el intérprete entiende (se comprueba en las pruebas).
  const EN_FRASE = {
    salud: 'posta', colegio: 'colegio', inicial: 'colegio inicial', primaria: 'colegio de primaria', secundaria: 'colegio de secundaria',
    transporte: 'paradero', areaVerde: 'parque', residencial: 'zona residencial', tranquilo: 'zona tranquila',
    campina: 'campiña', comercial: 'centro comercial', historico: 'centro histórico', lejosQuebrada: 'lejos de quebradas',
  };
  // En la lista, «lejos de quebradas» lleva su distancia mínima («a más de 200 m»); en «lo más importante es…» va sin ella.
  const enFrase = (c) => (c.id === 'lejosQuebrada' && esNumero(c.umbralM) ? `lejos de quebradas a más de ${fmtRadioFrase(c.umbralM)}` : EN_FRASE[c.id]);
  const fmtRadioFrase = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toString().replace('.', ',')} km`);

  /**
   * La frase que equivale a una consulta armada con menús. Se muestra en el chat como lo que «dijo» la persona y, al
   * pasarla por `interpretar`, da los mismos criterios, prioridades, radio y zonas condicionales (lo comprueban las pruebas).
   */
  function textoDeConsulta(q) {
    if (!q || !q.criterios || q.criterios.length === 0) return '';
    const partes = [`Busco una zona con ${listaEs(q.criterios.map(enFrase))}`];
    q.criterios.filter((c) => c.prioridad > 1).forEach((c) => partes.push(`lo más importante es ${EN_FRASE[c.id]}`));
    if (q.limitarAlPunto) partes.push('cerca de mi punto');
    if (esNumero(q.radioGlobalM)) partes.push(`en un radio de ${fmtRadioFrase(q.radioGlobalM)}`);
    if (q.incluirCondicional) partes.push('incluye zonas condicionales');
    return `${partes.join(', ')}.`;
  }

  function listaEs(items) {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
  }

  /** Combinaciones frecuentes para empezar con un toque. Son consultas del mismo formato que arma el menú. */
  const PRESETS = [
    { id: 'colegio-posta-parque', etiqueta: 'Colegio, posta y área verde', consulta: { criterios: ['colegio', 'salud', 'areaVerde'] } },
    { id: 'transporte-posta', etiqueta: 'Transporte y posta cerca', consulta: { criterios: ['transporte', 'salud'], radioM: 1000 } },
    { id: 'tranquilo-parque', etiqueta: 'Zona tranquila con parque', consulta: { criterios: ['tranquilo', 'areaVerde'], prioridades: ['areaVerde'] } },
    { id: 'campina-transporte', etiqueta: 'Campiña con transporte', consulta: { criterios: ['campina', 'transporte'] } },
  ];

  // ------------------------------------------------ Por qué, fuente y límites

  const FUENTE_PLANO = 'Plano y Reglamento del PDM Arequipa 2016-2025 (O.M. 961-MPA; zonificación restituida por la 975-MPA).';
  const FUENTE_OSM = 'OpenStreetMap (ODbL), copia congelada con su fecha de extracción.';
  const FUENTE_SERVICIOS = 'Salud: RENIPRESS (SUSALUD, ODC-By). Colegios: padrón de ESCALE (MINEDU, con su acuerdo de uso de datos). Son la fuente primaria; OpenStreetMap (ODbL) solo de respaldo donde ningún registro oficial tiene un punto a 200 m. Paraderos y áreas verdes: OpenStreetMap. Copias congeladas con su fecha.';
  const FUENTE_UMBRALES = 'Umbrales: colegios 500 m inicial, 1500 m primaria y 3000 m secundaria (MINEDU); área verde de al menos 5000 m² a 300 m (OMS Europa, 2016); salud 1000 m y paradero 400 m son convenciones del proyecto.';
  const LIM_REFERENCIAL = 'Es referencial: no reemplaza el Certificado de Zonificación y Vías ni el de Parámetros Urbanísticos y Edificatorios.';
  const LIM_RECTA = 'Las distancias son en línea recta, no recorrido a pie.';
  const LIM_OSM = 'OpenStreetMap es colaborativo: lo que no figura puede existir. «Sin dato» no significa que no exista.';
  const LIM_OFICIAL = 'Los registros oficiales no ubican todos los establecimientos (cerca del 42 % de los de salud de Arequipa en RENIPRESS no trae coordenadas) y ESCALE ubica el local que reportó la UGEL. Un establecimiento oficial puede estar y no verse; uno de OpenStreetMap solo aparece donde no hay un punto oficial cerca.';
  const LIM_PLANO = 'El plano se extrajo de un PDF y cerca del borde entre dos zonas el resultado puede no ser exacto. La vigencia del PDM 2016-2025 es incierta y hay un PDM nuevo en trámite.';
  const FUENTE_ANA = 'Cauces congelados con su fecha de extracción: la red hidrográfica de la Autoridad Nacional del Agua (ANA, 2018), las quebradas y ríos del Instituto Geofísico del Perú (IGP, sin fecha de elaboración) y los cauces de OpenStreetMap (ODbL). Cada cauce dice de cuál fuente viene.';
  const FUENTE_IGP = 'Sismos reportados, Instituto Geofísico del Perú (IGP), congelados con su fecha de extracción.';
  const FUENTE_INGEMMET = 'Inventario de peligros geológicos, GEOCATMIN (INGEMMET), congelado con su fecha de extracción.';
  const LIM_CAUCES = 'Ninguna de las tres fuentes de cauces es completa (la red de la ANA es de escala nacional): faltan quebradas urbanas y torrenteras menores, no son un mapa de peligro de huaicos o inundación y no delimitan la faja marginal.';
  const LIM_INVENTARIO = 'Es un inventario de eventos documentados, no un mapa de susceptibilidad: que no haya registros cerca no significa que el lugar sea seguro.';
  const GENERICO = {
    porque: ['Los datos, distancias y estados los calcula siempre el motor de la ficha con reglas explícitas. Un modelo, si está activo, solo interpreta tu frase y redacta; no aporta cifras, por eso no puede inventar un dato.'],
    fuente: ['Responde solo con los datos de la ficha: el plano de zonificación y los servicios (RENIPRESS, ESCALE y OpenStreetMap de respaldo).'],
    limites: ['No tiene datos de seguridad ni ruido, ni el precio de un inmueble en particular (solo el promedio de oferta por m² de algunos distritos), y lo dice cuando se lo preguntan.', LIM_REFERENCIAL],
  };
  const SERVICIOS = {
    porque: ['Se mide la distancia en línea recta desde tu punto hasta el elemento más cercano de cada tipo y se compara con la distancia de referencia (umbral).'],
    fuente: [FUENTE_SERVICIOS, FUENTE_UMBRALES],
    limites: [LIM_RECTA, LIM_OFICIAL, LIM_OSM, LIM_REFERENCIAL],
  };
  const EXPLICACIONES = {
    saludo: GENERICO,
    ayuda: GENERICO,
    desconocido: GENERICO,
    no_soportado: GENERICO,
    fuentes: {
      porque: ['Resume de dónde sale cada dato de la ficha y qué umbral se usa.'],
      fuente: [FUENTE_PLANO, FUENTE_SERVICIOS, FUENTE_UMBRALES],
      limites: [LIM_RECTA, LIM_OFICIAL, LIM_OSM, LIM_REFERENCIAL],
    },
    pdm: {
      porque: ['Muestra el aviso sobre el estado del PDM nuevo que registra la herramienta, con su fuente y su fecha. No lo interpreta.'],
      fuente: ['Una nota de prensa, no un documento oficial. Si no hay fuente y fecha registradas, el asistente no afirma nada.'],
      limites: ['No hay mapa de la zonificación proyectada: el plano del PDM nuevo no es público hasta que se apruebe.', LIM_REFERENCIAL],
    },
    zona: {
      porque: ['Se ubica tu punto dentro de los polígonos del plano de zonificación y se buscan las reglas de esa zona en la tabla del reglamento.'],
      fuente: [FUENTE_PLANO],
      limites: [LIM_PLANO, LIM_REFERENCIAL],
    },
    construir: {
      porque: ['Se multiplica el área del lote por el coeficiente de edificación de la zona: el mismo cálculo de la ficha.'],
      fuente: [FUENTE_PLANO],
      limites: ['Es un máximo teórico: no considera retiros, estacionamientos ni la forma del lote.', 'En zonas condicionadas o no construibles no se calcula.', LIM_REFERENCIAL],
    },
    quebrada: {
      porque: ['Se mide la distancia en línea recta desde tu punto hasta el tramo más cercano de los cauces de la ANA, el IGP y OpenStreetMap, y se dice de cuál fuente es. Si fijaste tu distancia mínima en «Mis umbrales», se compara con ella; si no, solo se informa.'],
      fuente: [FUENTE_ANA],
      limites: [LIM_CAUCES, 'No existe una distancia normativa a una quebrada: la faja marginal solo está delimitada donde la ANA la fijó.', LIM_RECTA, LIM_REFERENCIAL],
    },
    sismos: {
      porque: ['Se cuentan los sismos reportados por el IGP cuyo epicentro está a 100 km o menos de tu punto, dentro del periodo que cubre el archivo. El radio es una convención del proyecto para dar contexto.'],
      fuente: [FUENTE_IGP],
      limites: ['Es actividad reciente reportada, no una predicción ni un nivel de peligro. Solo cubre el periodo indicado, no el catálogo histórico.', 'La referencia normativa para construir es la zona sísmica de la Norma E.030, que depende del distrito y del suelo, no de este conteo.', LIM_RECTA],
    },
    peligros: {
      porque: ['Se cuentan los eventos del inventario de peligros geológicos de INGEMMET a 500 m o menos de tu punto y se mide la distancia al más cercano.'],
      fuente: [FUENTE_INGEMMET],
      limites: [LIM_INVENTARIO, LIM_RECTA, LIM_REFERENCIAL],
    },
    volcan: {
      porque: ['Se busca en qué polígonos de peligro volcánico del IGP cae tu punto. Para un distrito, se prueba un punto cada 250 m dentro de él y, por cada fenómeno, se cuenta el nivel más alto de ese punto.'],
      fuente: [FUENTE_VOLCAN],
      limites: [LIM_VOLCAN, 'La ceniza cubre toda la ciudad en los escenarios del IGP: por eso no se dibuja en el mapa.'],
    },
    cenepred: {
      porque: ['Se busca el distrito (el de tu punto o el que nombras) en el escenario de riesgo del CENEPRED y se dice tal cual su nivel de riesgo ante inundaciones y ante movimientos en masa, con las viviendas, locales educativos y establecimientos de salud del distrito que están en zonas de mayor susceptibilidad. No se calcula nada nuevo.'],
      fuente: [FUENTE_CENEPRED],
      limites: [LIM_CENEPRED, 'El nivel es uno solo por distrito: no distingue entre una calle y otra ni mira tu predio.'],
    },
    servicio: SERVICIOS,
    contar: {
      porque: ['Cuento los elementos de OpenStreetMap cuyo punto cae dentro del límite del distrito (los parques, por el centro de su polígono).'],
      fuente: [FUENTE_OSM, 'Límites distritales del INEI vía GEOCATMIN (INGEMMET).'],
      limites: [LIM_OSM, 'Un colegio puede atender varios niveles; los que no declaran su nivel se cuentan como primaria y secundaria.', 'Los parques se cuentan todos; los criterios de búsqueda usan solo los de al menos 0,5 ha (OMS Europa, 2016).'],
    },
    perfil: {
      porque: ['Junta lo que hay dentro del distrito: cómo se reparte la zonificación del plano (se mide con puntos cada 300 m), cuántos servicios hay y qué cauces (de la ANA, el IGP y OpenStreetMap) lo cruzan.'],
      fuente: [FUENTE_PLANO, FUENTE_OSM, FUENTE_ANA],
      limites: [LIM_PLANO, LIM_OSM, LIM_CAUCES, LIM_REFERENCIAL],
    },
    mejor_zona: GENERICO,
    distrito_desconocido: GENERICO,
    rutas: {
      porque: ['Se mide la distancia en línea recta desde tu punto hasta el trazado de cada recorrido de SmartBus y se listan las líneas que pasan a 400 m o menos. Con un distrito, se listan las líneas cuyo trazado entra en él.'],
      fuente: ['SmartBus (smartbus.app): recorridos y paradas descargados una vez, con fecha, y usados con su autorización verbal (confirmación escrita pendiente). Los 400 m son una convención del proyecto.'],
      limites: ['Son los recorridos publicados, no un servicio garantizado: sin frecuencias ni horarios, y un cambio de ruta por tramos puede no estar reflejado.', 'La distancia es al trazado, no a donde se puede subir. Las paradas de SmartBus tienen nombres numerados.', LIM_RECTA],
    },
    precio: {
      porque: ['Busca el distrito en el archivo de precios de oferta por m² y lo dice tal cual: la mediana de los avisos de departamentos en venta del periodo indicado. No lo compara ni lo evalúa.'],
      fuente: ['Aptología, estudio «Vivienda en Arequipa» (datos abiertos, CC BY 4.0): datos: Aptologia. Archivo congelado con su fecha de descarga.'],
      limites: [LIM_PRECIO, 'Aptología solo publica distritos con al menos 30 avisos, así que para los demás no hay cifra y el asistente no la estima.', LIM_REFERENCIAL],
    },
    ficha: {
      porque: ['Junta lo que la ficha ya calculó para tu punto: la zona del plano y la distancia al servicio más cercano de cada tipo.'],
      fuente: [FUENTE_PLANO, FUENTE_OSM, FUENTE_UMBRALES],
      limites: [LIM_PLANO, LIM_RECTA, LIM_OSM, LIM_REFERENCIAL],
    },
  };

  /**
   * El apartado «Por qué, fuente y límites» de una respuesta. Es texto fijo según el tipo de respuesta (más la fecha
   * de los datos y las aproximaciones de una búsqueda): nunca lleva cifras inventadas. Un tipo desconocido devuelve listas vacías.
   *   meta (solo `buscar`): { fecha?, aproximados?: [id…] }
   */
  function explicar(tipo, meta = {}) {
    if (tipo === 'buscar') {
      const aprox = (meta.aproximados || []).map((id) => `${CRITERIOS[id].etiqueta.split(' (')[0]} es una aproximación con la zonificación (${MOTIVO_APROXIMADO[id]}), no un dato medido.`);
      return {
        porque: [
          'Reviso las zonas construibles del plano en cuadros de 250 m y, en cada uno, hago los mismos cálculos de la ficha para cada cosa que pediste. Un sector es una zona continua donde se cumple todo a la vez.',
          'No hay puntaje ni orden de calidad: los sectores se numeran solo para ubicarlos. Si marcas una prioridad (por ejemplo «lo más importante es el parque»), los ordeno por cercanía a ella.',
        ],
        fuente: [meta.fecha ? `OpenStreetMap (ODbL), extraído el ${meta.fecha}.` : FUENTE_OSM, FUENTE_PLANO, FUENTE_UMBRALES],
        limites: ['No es una probabilidad ni una recomendación.', LIM_RECTA, 'Los bordes de un sector son aproximados: la resolución es de 250 m y no distingue cuadras.', LIM_OSM, ...aprox, ...(meta.cauce ? [LIM_CAUCES] : []), LIM_REFERENCIAL],
      };
    }
    const e = EXPLICACIONES[tipo];
    return e ? { porque: [...e.porque], fuente: [...e.fuente], limites: [...e.limites] } : { porque: [], fuente: [], limites: [] };
  }

  return {
    CRITERIOS,
    OPCIONES,
    PRESETS,
    SUGERENCIAS_BASE,
    construirConsulta,
    criteriosSinUmbral,
    textoDeConsulta,
    explicar,
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
    botonesDePrioridad,
    textoDistritoFuera,
    NIVELES_COLEGIO: ['inicial', 'primaria', 'secundaria'],
    distanciaM,
    titulo,
    fmtDist,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Asistente;
