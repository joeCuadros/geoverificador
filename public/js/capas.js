/**
 * capas.js — Qué se dibuja en el mapa (sin DOM, sin red): las entidades reales, no una cuadrícula.
 *
 * Cada cosa que la persona pide tiene su propia forma en el mapa:
 *   colegios    → los colegios mismos, con un icono por nivel (y un círculo tenue con la distancia de referencia si son pocos)
 *   salud       → los establecimientos de salud (círculo de 1000 m si son pocos)
 *   consultorios → los consultorios médicos, aparte de la salud y solo informativos: sin círculo (no hay distancia de referencia)
 *   abastecimiento (mercados + supermercados), compras_ocio (malls confirmados), comercio_barrio (galerías), finanzas (bancos + cajeros), comida_fuera (restaurantes + cafés), recreacion (juegos infantiles) → comercio por necesidad, solo informativo: sin círculo
 *                 (no hay distancia de referencia); el mall o la galería se dibuja como polígono si OSM lo tiene
 *   paraderos   → los paraderos (círculo de 400 m si son pocos)
 *   parques     → los parques, como polígonos rellenos
 *   residencial, tranquilo, campina, comercial, historico → solo los polígonos de esas zonas del plano
 *   quebradas   → líneas (cauces de la ANA, el IGP y OpenStreetMap; cada tramo dice su fuente)
 *   sismos      → círculos pequeños, más grandes cuanto mayor la magnitud
 *   volcan      → zonas de peligro volcánico del Misti (IGP): lahares, flujos piroclásticos, lava y avalanchas, coloreadas por nivel
 *                 (alto, moderado, bajo) con una línea de leyenda por nivel. La ceniza cubre toda la ciudad y no se dibuja.
 *   cenepred_inundacion, cenepred_mm → los distritos coloreados por su nivel de riesgo ante inundaciones o ante movimientos en masa en un escenario
 *                 El Niño (CENEPRED), con una línea de leyenda por nivel. Es una estimación por distrito, no del predio. Se dibuja un fenómeno a la vez.
 *   electricidad → áreas de concesión de distribución eléctrica (MINEM-DGE): polígonos enteros, una línea de leyenda por concesionaria. Solo informativas:
 *                 una concesión dice a qué empresa le corresponde el servicio, no que un predio esté conectado.
 *   acopio_agua → puntos de acopio de agua del directorio de SEDAPAR (publicado en 2024, datos de 2017): puntos, sin círculo. Informativos: son lugares de reparto con camiones
 *                 cisterna ante un desabastecimiento, no una conexión ni agua garantizada.
 *   mineria     → concesiones mineras del Catastro Minero (INGEMMET): polígonos enteros coloreados por estado (titulada, en trámite, otra; las extinguidas no se dibujan),
 *                 una línea de leyenda por estado. Solo informativas: una concesión es un derecho sobre los minerales, no dice que haya minería ni de quién es el predio.
 *   censo_luz, censo_agua, censo_desague → manzanas del censo coloreadas por el % de viviendas ocupadas con alumbrado, agua o desagüe por red pública (INEI, 2017):
 *                 informativas; el año va en la etiqueta, el popup y la leyenda. Las manzanas con pocas viviendas no dan porcentaje y las que el censo no contó no se dibujan.
 *   viaje       → «¿qué combi me lleva al trabajo?»: los tramos de cada ruta directa entre donde subes y donde bajas, el origen, el destino y, en la búsqueda de zonas, las celdas desde
 *                 las que se llega (Viaje.rutasDirectas). Los datos vienen en la propia capa; informativa, sin puntaje.
 *   lineas      → recorridos de bus de SmartBus (un color por línea) y, con un punto, la parada más cercana de cada una
 * Con una búsqueda se dibujan las entidades que hacen que cada sector cumpla, y UNA región resaltada: los sectores donde se
 * cumple todo lo que pidió. No se pinta lo que no cumple y no se ve la cuadrícula.
 *
 * Se carga como script del navegador (define `Capas`) y también como módulo CommonJS para las pruebas.
 */
const Capas = (() => {
  const A = () => (typeof Asistente !== 'undefined' ? Asistente : require('./asistente.js')); // eslint-disable-line no-undef
  const R = () => (typeof Rutas !== 'undefined' ? Rutas : require('./rutas.js')); // eslint-disable-line no-undef
  const E = () => (typeof Entidades !== 'undefined' ? Entidades : require('./entidades.js')); // eslint-disable-line no-undef
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef
  const V = () => (typeof Volcan !== 'undefined' ? Volcan : require('./volcan.js')); // eslint-disable-line no-undef
  const Cen = () => (typeof Cenepred !== 'undefined' ? Cenepred : require('./cenepred.js')); // eslint-disable-line no-undef
  const Dist = () => (typeof Distritos !== 'undefined' ? Distritos : require('./distritos.js')); // eslint-disable-line no-undef
  const M_POR_GRADO = (Math.PI / 180) * C.RADIO_TIERRA_M;
  const NIVELES = ['inicial', 'primaria', 'secundaria'];

  /** Las capas que se pueden pedir, en el orden en que se ofrecen. */
  const CAPAS = [
    { id: 'colegios', etiqueta: 'Colegios', grupo: 'servicio' },
    { id: 'salud', etiqueta: 'Salud', grupo: 'servicio' },
    { id: 'consultorios', etiqueta: 'Consultorios médicos', grupo: 'servicio' }, // aparte de la salud, informativa: sin círculo de distancia
    { id: 'abastecimiento', etiqueta: 'Abastecimiento (mercados y supermercados)', grupo: 'servicio' }, // comercio por necesidad: informativo, sin círculo de distancia
    { id: 'compras_ocio', etiqueta: 'Compras y ocio (malls)', grupo: 'servicio' },
    { id: 'comercio_barrio', etiqueta: 'Comercio de barrio (galerías)', grupo: 'servicio' },
    { id: 'finanzas', etiqueta: 'Finanzas (bancos y cajeros)', grupo: 'servicio' }, // servicios de la vida diaria (OSM): informativos, sin círculo de distancia
    { id: 'comida_fuera', etiqueta: 'Comida fuera de casa (restaurantes y cafés)', grupo: 'servicio' },
    { id: 'recreacion', etiqueta: 'Recreación (juegos infantiles)', grupo: 'servicio' }, // los parques son la capa «parques» (área verde)
    { id: 'paraderos', etiqueta: 'Paraderos', grupo: 'servicio' },
    { id: 'parques', etiqueta: 'Parques', grupo: 'servicio' },
    { id: 'residencial', etiqueta: 'Zona residencial', grupo: 'zona' },
    { id: 'tranquilo', etiqueta: 'Zona tranquila', grupo: 'zona' },
    { id: 'campina', etiqueta: 'Campiña', grupo: 'zona' },
    { id: 'comercial', etiqueta: 'Zona comercial', grupo: 'zona' },
    { id: 'historico', etiqueta: 'Centro histórico', grupo: 'zona' },
    { id: 'quebradas', etiqueta: 'Quebradas y ríos', grupo: 'riesgo' },
    { id: 'sismos', etiqueta: 'Sismos', grupo: 'riesgo' },
    { id: 'electricidad', etiqueta: 'Concesión eléctrica (SEAL y otras)', grupo: 'servicio' }, // informativa: no es una conexión
    { id: 'acopio_agua', etiqueta: 'Puntos de acopio de agua (SEDAPAR, datos de 2017)', grupo: 'servicio' }, // informativa: lugares de reparto con camiones cisterna, no una conexión
    { id: 'mineria', etiqueta: 'Concesiones mineras (INGEMMET)', grupo: 'riesgo' }, // informativa: un derecho sobre los minerales, no minería en el predio
    { id: 'censo_luz', etiqueta: 'Alumbrado eléctrico por red pública (censo 2017)', grupo: 'servicio' }, // censo por manzana: informativas, cifras de 2017
    { id: 'censo_agua', etiqueta: 'Agua por red pública (censo 2017)', grupo: 'servicio' },
    { id: 'censo_desague', etiqueta: 'Desagüe por red pública (censo 2017)', grupo: 'servicio' },
    { id: 'viaje', etiqueta: 'Ruta al trabajo (combi o bus)', grupo: 'servicio' }, // sus datos vienen del asistente (origen, destino, tramos), no se arman con un botón
    { id: 'volcan', etiqueta: 'Peligro volcánico (Misti)', grupo: 'riesgo' },
    { id: 'cenepred_inundacion', etiqueta: 'Riesgo de inundación por distrito (CENEPRED)', grupo: 'riesgo' },
    { id: 'cenepred_mm', etiqueta: 'Riesgo de movimientos en masa por distrito (CENEPRED)', grupo: 'riesgo' },
  ];
  const ZONAS = ['residencial', 'tranquilo', 'campina', 'comercial', 'historico'];

  // ----------------------------------------------------------- Criterios → capas

  /**
   * Traduce los criterios de una búsqueda (o del conteo) a capas. Los de colegio se juntan en una sola capa con sus niveles
   * («colegio» a secas son inicial y primaria, como en la búsqueda). Conserva las distancias ya resueltas si vienen.
   */
  function deCriterios(criterios) {
    const out = [];
    const capa = (id) => {
      let c = out.find((x) => x.id === id);
      if (!c) { c = { id }; out.push(c); }
      return c;
    };
    (criterios || []).forEach((c) => {
      if (NIVELES.includes(c.id) || c.id === 'colegio') {
        const k = capa('colegios');
        const niveles = c.id === 'colegio' ? ['inicial', 'primaria'] : [c.id];
        k.niveles = NIVELES.filter((n) => (k.niveles || []).includes(n) || niveles.includes(n));
        k.umbralPorNivel = { ...(k.umbralPorNivel || {}), ...(c.umbralPorNivel || {}) };
        if (!c.umbralPorNivel && typeof c.umbralEfectivoM === 'number') niveles.forEach((n) => { k.umbralPorNivel[n] = c.umbralEfectivoM; });
      } else if (c.id in C.COMERCIO || c.id === 'electricidad' || c.id === 'mineria' || c.id === 'acopio_agua' || /^censo_(luz|agua|desague)$/.test(c.id)) capa(c.id); // solo del mapa del chat (no son un criterio de búsqueda)
      else if (c.id === 'consultorios') capa('consultorios'); // solo del mapa del chat (no es un criterio de búsqueda)
      else if (c.id === 'salud') capa('salud').umbralM = c.umbralEfectivoM;
      else if (c.id === 'transporte') capa('paraderos').umbralM = c.umbralEfectivoM;
      else if (c.id === 'areaVerde') capa('parques').umbralM = c.umbralEfectivoM;
      else if (ZONAS.includes(c.id)) capa(c.id).umbralM = c.umbralEfectivoM;
      else if (c.id === 'lejosQuebrada') capa('quebradas').umbralM = c.umbralM;
    });
    return out;
  }

  // ------------------------------------------------------------------- Auxiliares

  const listaEs = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

  const bboxDe = (puntos) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    puntos.forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    });
    return b;
  };
  const bboxDePolys = (polys) => bboxDe(polys.flatMap((anillos) => anillos[0] || []));
  const unir = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const valido = (b) => Array.isArray(b) && b[0] !== Infinity;
  const coordsDe = (geometry) => {
    if (!geometry) return [];
    const g = geometry.type;
    if (g === 'Polygon') return geometry.coordinates[0] || [];
    if (g === 'MultiPolygon') return geometry.coordinates.flatMap((p) => p[0] || []);
    if (g === 'LineString') return geometry.coordinates;
    if (g === 'MultiLineString') return geometry.coordinates.flat();
    return [];
  };

  /** Radio en píxeles de un círculo de sismo: crece con la magnitud, entre 3 y 16. */
  function sismoRadioPx(magnitud) {
    return Math.round(Math.min(16, Math.max(3, 3 + (magnitud - 2) * 2.4)));
  }

  const cercaDe = (centros, lat, lon, u) => {
    for (const [la, lo] of centros) {
      if (Math.abs(la - lat) * M_POR_GRADO > u) continue;
      if (C.haversine(lat, lon, la, lo) <= u) return true;
    }
    return false;
  };

  const tituloColegio = (c) => c.nombre || 'Colegio sin nombre en OpenStreetMap';
  // De qué fuente es el punto (RENIPRESS, ESCALE u OSM de respaldo) y su código oficial, para el popup del mapa.
  const fuenteDe = (p) => ({ fuente: p.fuente || 'OSM', fuenteTexto: C.textoFuenteElemento({ fuenteElemento: p.fuente || 'OSM', codigo: p.codigo, categoria: p.categoria, gestion: p.gestion, osm: p.osm }) });
  const NOMBRE_NIVEL = { inicial: 'inicial', primaria: 'primaria', secundaria: 'secundaria' };

  // -------------------------------------------------------------------- Construir

  /**
   * Arma lo que hay que dibujar.
   *   capas:    [{ id, niveles?, umbralM?, umbralPorNivel? }] (ver deCriterios)
   *   datos:    Asistente.prepararDatos; zonas: Zonificacion.zonas(); cauces: [{ nombre, tipo, geometry }] o null; sismos: [{ lat, lon, magnitud, … }] o null
   *   area:     { polys } (un distrito), { bbox } o null (todo el mapa)
   cenepred: el contenido de data/riesgo_cenepred_fen2027.json (y Distritos cargado para los límites); solo hace falta con una capa cenepred_inundacion o cenepred_mm
   censo:    las Features de las manzanas del censo (data/censo/manzanas/*.json) de lo que se ve; solo hacen falta con una capa censo_luz, censo_agua o censo_desague (censoAnio: el año, 2017)
   electricidad: las Features del archivo de concesiones eléctricas (Polygon / MultiPolygon); solo hacen falta con una capa { id: 'electricidad' }
   acopio:   las Features Point del archivo de puntos de acopio de agua de SEDAPAR; solo hacen falta con una capa { id: 'acopio_agua' }
   mineria:  las Features del archivo de concesiones mineras (Polygon / MultiPolygon); solo hacen falta con una capa { id: 'mineria' }
   volcan:   las zonas de Volcan.indexar; solo hacen falta (y solo se cargan) con una capa { id: 'volcan', tipos?: ['lahar', …] }
   rutas:    el índice de Rutas.indexar; solo hace falta (y solo se carga) si hay una capa { id: 'lineas', nombres:[…], punto?}
   *   sectores: los de Asistente.formatearBusqueda (con `centros`); si hay, solo se dibujan las entidades que los hacen cumplir
   * Devuelve { puntos, circulos, poligonos, lineas, sismos, peligroVolcan, riesgoDistritos, sectores, lineasBus, paradasBus, leyenda, vacias, sinDatos, resumen, limites }.
   */
  function construir({ capas, datos, zonas, cauces, sismos, volcan = null, electricidad = null, mineria = null, acopio = null, censo = null, censoAnio = 2017, minViviendasCenso = 5, cenepred = null, area = null, umbrales, sectores = null, rutas = null, maxCirculos = 12 }) {
    const polys = area && area.polys ? area.polys : null;
    const cajaArea = polys ? bboxDePolys(polys) : area && area.bbox ? area.bbox : null;
    const dentroPoligonos = polys ? E().contenedor(polys) : null;
    const enArea = (lat, lon) => {
      if (dentroPoligonos) return dentroPoligonos(lat, lon);
      if (cajaArea) return lon >= cajaArea[0] && lon <= cajaArea[2] && lat >= cajaArea[1] && lat <= cajaArea[3];
      return true;
    };
    const centros = sectores && sectores.length ? sectores.flatMap((s) => s.centros || [[s.centro.lat, s.centro.lon]]) : null;
    const cajaCentros = centros ? bboxDe(centros.map(([la, lo]) => [lo, la])) : null;
    const u = umbrales;

    const puntos = [];
    const circulos = [];
    const poligonos = [];
    const lineas = [];
    const sism = [];
    const peligroVolcan = [];
    const riesgoDistritos = [];
    let lineasBus = [];
    let viajeOut = null;
    let paradasBus = [];
    let cajaLineas = null;
    const leyenda = [];
    const vacias = [];
    const sinDatos = [];
    let limites = null;

    // Cómo se nombra cada capa en el resumen: [singular, plural].
    const NOMBRES = {
      colegios: ['colegio', 'colegios'], salud: ['establecimiento de salud', 'establecimientos de salud'], consultorios: ['consultorio médico', 'consultorios médicos'], abastecimiento: ['punto de abastecimiento', 'puntos de abastecimiento'], compras_ocio: ['mall confirmado', 'malls confirmados'], comercio_barrio: ['galería o comercio de barrio', 'galerías y comercios de barrio'], finanzas: ['banco o cajero', 'bancos y cajeros'], comida_fuera: ['restaurante o café', 'restaurantes y cafés'], recreacion: ['área de juegos infantiles', 'áreas de juegos infantiles'], paraderos: ['paradero', 'paraderos'], parques: ['parque', 'parques'],
      residencial: ['zona residencial', 'zonas residenciales'], tranquilo: ['zona tranquila', 'zonas tranquilas'], campina: ['zona de campiña', 'zonas de campiña'],
      comercial: ['zona comercial', 'zonas comerciales'], historico: ['zona del centro histórico', 'zonas del centro histórico'],
      quebradas: ['tramo de quebrada o río', 'tramos de quebradas y ríos'], sismos: ['sismo', 'sismos'], volcan: ['zona de peligro volcánico', 'zonas de peligro volcánico'], cenepred_inundacion: ['distrito coloreado por su riesgo ante inundaciones', 'distritos coloreados por su riesgo ante inundaciones'], cenepred_mm: ['distrito coloreado por su riesgo ante movimientos en masa', 'distritos coloreados por su riesgo ante movimientos en masa'], lineas: ['línea de bus', 'líneas de bus'], electricidad: ['área de concesión eléctrica', 'áreas de concesión eléctrica'], mineria: ['concesión minera', 'concesiones mineras'], acopio_agua: ['punto de acopio de agua', 'puntos de acopio de agua'], viaje: ['ruta al trabajo', 'rutas al trabajo'], censo_luz: ['manzana con cifras de alumbrado', 'manzanas con cifras de alumbrado'], censo_agua: ['manzana con cifras de agua', 'manzanas con cifras de agua'], censo_desague: ['manzana con cifras de desagüe', 'manzanas con cifras de desagüe'], sectores: ['sector', 'sectores'],
    };
    const nombreDe = (capa, n) => NOMBRES[capa][n === 1 ? 0 : 1];
    const cuenta = (capa, n, texto) => {
      if (n === 0) { vacias.push(capa); return; }
      leyenda.push({ capa, texto, n });
    };

    (capas || []).forEach((capa) => {
      const id = capa.id;
      if (id === 'colegios') {
        const niveles = capa.niveles && capa.niveles.length ? capa.niveles : NIVELES;
        const umbralDe = (n) => (capa.umbralPorNivel && typeof capa.umbralPorNivel[n] === 'number' ? capa.umbralPorNivel[n] : u.educacion[n]);
        const elegidos = (datos.colegiosLista || []).filter((c) => {
          const propios = c.niveles.filter((n) => niveles.includes(n));
          if (propios.length === 0 || !enArea(c.lat, c.lon)) return false;
          return !centros || propios.some((n) => cercaDe(centros, c.lat, c.lon, umbralDe(n)));
        });
        elegidos.forEach((c) => {
          const propios = c.niveles.filter((n) => niveles.includes(n));
          const subtipo = propios.length === 1 ? propios[0] : propios[0];
          puntos.push({
            capa: 'colegios', tipo: 'colegio', subtipo, niveles: propios, lat: c.lat, lon: c.lon, nombre: c.nombre, osm: c.osm, ...fuenteDe(c),
            titulo: tituloColegio(c), detalle: `Colegio de ${propios.map((n) => NOMBRE_NIVEL[n]).join(' y ')}`, radioM: umbralDe(subtipo),
          });
        });
        cuenta('colegios', elegidos.length, `Colegios (${niveles.join(', ')}): ${elegidos.length}`);
      } else if (id === 'salud' || id === 'paraderos') {
        const lista = id === 'salud' ? datos.salud : datos.transporte;
        const umbral = typeof capa.umbralM === 'number' ? capa.umbralM : id === 'salud' ? u.salud : u.transporte;
        const elegidos = (lista || []).filter((p) => enArea(p.lat, p.lon) && (!centros || cercaDe(centros, p.lat, p.lon, umbral)));
        elegidos.forEach((p) => puntos.push({
          capa: id, tipo: id === 'salud' ? 'salud' : 'paradero', subtipo: id, lat: p.lat, lon: p.lon, nombre: p.nombre, osm: p.osm, ...(id === 'salud' ? fuenteDe(p) : {}),
          titulo: p.nombre || (id === 'salud' ? 'Establecimiento de salud sin nombre' : 'Paradero'), detalle: id === 'salud' ? 'Establecimiento de salud' : 'Paradero de transporte público', radioM: umbral,
        }));
        cuenta(id, elegidos.length, `${id === 'salud' ? 'Establecimientos de salud' : 'Paraderos'}: ${elegidos.length}`);
      } else if (id === 'consultorios') {
        const elegidos = (datos.consultorios || []).filter((p) => enArea(p.lat, p.lon));
        elegidos.forEach((p) => puntos.push({
          capa: 'consultorios', tipo: 'consultorio', subtipo: 'consultorios', lat: p.lat, lon: p.lon, nombre: p.nombre, osm: p.osm, ...fuenteDe(p),
          titulo: p.nombre || 'Consultorio médico sin nombre', detalle: 'Consultorio médico',
        })); // sin radioM: no hay distancia de referencia, así que tampoco se dibuja un círculo
        cuenta('consultorios', elegidos.length, `Consultorios médicos: ${elegidos.length}`);
      } else if (id in C.COMERCIO) {
        // Comercio: informativo (sin umbral). Un punto, o el centro de un polígono (que además se dibuja): sin radioM, así que tampoco hay círculo.
        const def = C.COMERCIO[id];
        const elegidos = (datos[id] || []).filter((p) => enArea(p.lat, p.lon));
        elegidos.forEach((p) => {
          // El icono dice qué es (mercado, supermercado, mall o galería); el detalle, para qué necesidad cuenta y, de un supermercado, en qué mall está.
          const tipo = id === 'compras_ocio' ? 'mall' : id === 'comercio_barrio' ? 'galeria' : p.tipo; // abastecimiento y los servicios de la vida diaria traen su propio tipo
          const detalle = `${def.etiqueta}${def.tipos.length > 1 && C.COMERCIO_TIPO[p.tipo] ? `: ${C.COMERCIO_TIPO[p.tipo].singular}` : ''}${p.dentroDeMall ? ` · dentro de ${p.dentroDeMall.nombre || 'un mall'}` : ''}`;
          const titulo = p.nombre || `${def.etiqueta} sin nombre en OpenStreetMap`;
          puntos.push({
            capa: id, tipo, subtipo: id, lat: p.lat, lon: p.lon, nombre: p.nombre, osm: p.osm, fuente: 'OSM', fuenteTexto: C.textoFuenteComercio(p), verificado: p.verificado || null,
            titulo, detalle,
          });
          if (p.forma) poligonos.push({ capa: id, geometry: p.forma, nombre: p.nombre, osm: p.osm, titulo, detalle });
        });
        cuenta(id, elegidos.length, `${def.etiqueta}: ${elegidos.length}`);
      } else if (id === 'parques') {
        const umbral = typeof capa.umbralM === 'number' ? capa.umbralM : u.areaVerde.distanciaM;
        const elegidos = (datos.verdes || []).filter((v) => {
          if (!v.centro || !enArea(v.centro.lat, v.centro.lon)) return false;
          if (!centros) return true;
          return centros.some(([la, lo]) => {
            const b = v.bbox;
            const m = umbral / M_POR_GRADO;
            if (la < b[1] - m || la > b[3] + m || lo < b[0] - m * 1.1 || lo > b[2] + m * 1.1) return false;
            return C.distanciaAGeometriaM(la, lo, v.geometry) <= umbral;
          });
        });
        elegidos.forEach((v) => poligonos.push({
          capa: 'parques', geometry: v.geometry, nombre: v.nombre, osm: v.osm, areaM2: v.areaM2,
          titulo: v.nombre || 'Parque sin nombre en OpenStreetMap', detalle: `Parque de ${Math.round(v.areaM2 / 100) / 100} ha`,
        }));
        cuenta('parques', elegidos.length, `Parques de media hectárea o más: ${elegidos.length}`);
      } else if (ZONAS.includes(id)) {
        const def = A().CRITERIOS[id];
        const dentro = (z) => {
          const caja = z.bbox;
          if (cajaArea && (caja[2] < cajaArea[0] || caja[0] > cajaArea[2] || caja[3] < cajaArea[1] || caja[1] > cajaArea[3])) return false;
          if (cajaCentros && (caja[2] < cajaCentros[0] - 0.02 || caja[0] > cajaCentros[2] + 0.02 || caja[3] < cajaCentros[1] - 0.02 || caja[1] > cajaCentros[3] + 0.02)) return false;
          if (!dentroPoligonos) return true;
          const anillo = (z.polys[0] && z.polys[0][0]) || [];
          const pasos = Math.max(1, Math.floor(anillo.length / 12));
          const muestras = [[(caja[0] + caja[2]) / 2, (caja[1] + caja[3]) / 2]];
          for (let k = 0; k < anillo.length; k += pasos) muestras.push(anillo[k]);
          return muestras.some(([x, y]) => dentroPoligonos(y, x));
        };
        const elegidas = (zonas || []).filter((z) => z.regla && z.bbox && ((def.codigos && def.codigos.includes(z.codigo)) || (def.grupos && def.grupos.includes(z.regla.grupo))) && dentro(z));
        elegidas.forEach((z) => poligonos.push({
          capa: id, codigo: z.codigo, geometry: { type: 'MultiPolygon', coordinates: z.polys }, nombre: z.regla.nombre, titulo: `Zona ${z.codigo}`, detalle: z.regla.nombre,
        }));
        cuenta(id, elegidas.length, `${def.etiqueta.split(' (')[0]}: ${elegidas.length} ${elegidas.length === 1 ? 'zona' : 'zonas'} del plano`);
      } else if (id === 'quebradas') {
        if (!Array.isArray(cauces) || cauces.length === 0) { sinDatos.push('quebradas'); return; }
        const elegidos = cauces.filter((q) => coordsDe(q.geometry).some(([x, y]) => enArea(y, x)));
        const fuenteDe = (q) => C.nombreFuenteCauce(q.fuente || 'ANA');
        elegidos.forEach((q) => lineas.push({ capa: 'quebradas', geometry: q.geometry, nombre: q.nombre, tipo: q.tipo, fuente: q.fuente || 'ANA', titulo: q.nombre || 'Cauce sin nombre', detalle: `${q.tipo ? `${q.tipo} · ` : ''}Fuente: ${fuenteDe(q)}` }));
        const porFuente = ['ANA', 'IGP', 'OSM'].map((id) => [id, elegidos.filter((q) => (q.fuente || 'ANA') === id).length]).filter(([, n]) => n > 0).map(([id, n]) => `${C.nombreFuenteCauce(id)} ${n}`);
        cuenta('quebradas', elegidos.length, `Quebradas y ríos: ${elegidos.length} ${elegidos.length === 1 ? 'tramo' : 'tramos'}${porFuente.length ? ` (${porFuente.join(', ')})` : ''}`);
      } else if (id === 'lineas') {
        if (!rutas) { sinDatos.push('lineas'); return; }
        const m = R().paraMapa(rutas, capa.nombres || [], capa.punto || null);
        lineasBus = m.trazos;
        paradasBus = m.paradas;
        // Con un punto se encuadra el punto y las paradas más cercanas; sin él, los trazados (o el distrito, si lo hay).
        if (capa.punto) cajaLineas = bboxDe([[capa.punto.lon, capa.punto.lat], ...m.paradas.map((p) => [p.lon, p.lat])]);
        else cajaLineas = m.bbox;
        const etiquetas = m.trazos.map((t) => R().etiquetaLinea(t));
        cuenta('lineas', m.trazos.length, `Líneas de bus de SmartBus: ${etiquetas.join(', ')}${m.paradas.length ? `; con la parada más cercana de cada una (${m.paradas.length})` : ''}`);
      } else if (id === 'censo_luz' || id === 'censo_agua' || id === 'censo_desague') {
        // Censo por manzana: coroplético por el % de viviendas ocupadas con el servicio. Informativo; con pocas viviendas no hay porcentaje y sin cifras no se dibuja.
        if (!Array.isArray(censo) || censo.length === 0) { sinDatos.push('censo'); return; }
        const clave = id === 'censo_luz' ? 'luz' : id === 'censo_agua' ? 'agua' : 'desague';
        const rotulo = { luz: 'alumbrado eléctrico por red pública', agua: 'agua por red pública', desague: 'desagüe por red pública' }[clave];
        const conCifras = censo.filter((f) => f && f.geometry && f.properties && typeof f.properties.o === 'number' && (!cajaArea || (() => {
          const b = bboxDe(coordsDe(f.geometry));
          return !(b[2] < cajaArea[0] || b[0] > cajaArea[2] || b[3] < cajaArea[1] || b[1] > cajaArea[3]);
        })()));
        const porClase = new Array(C.CLASES_CENSO.length).fill(0);
        let pocas = 0;
        conCifras.forEach((f) => {
          const p = f.properties;
          const s = C.serviciosDeManzana(p, minViviendasCenso);
          const pct = s[clave].pct;
          const clase = C.claseCenso(pct);
          if (clase === null) pocas++; else porClase[clase]++;
          poligonos.push({
            capa: id, geometry: f.geometry, nombre: p.id || null, osm: null, valor: pct, clase,
            titulo: `Manzana ${p.id || ''}`.trim(),
            detalle: pct === null
              ? `Censo ${censoAnio}: solo ${p.o} ${p.o === 1 ? 'vivienda ocupada' : 'viviendas ocupadas'} en la manzana; son pocas para dar un porcentaje de ${rotulo}`
              : `Censo ${censoAnio}: ${String(pct).replace('.', ',')} % de las ${p.o} viviendas ocupadas de la manzana tenía ${rotulo}`,
          });
        });
        if (conCifras.length === 0) vacias.push(id);
        porClase.forEach((n, i) => { if (n > 0) leyenda.push({ capa: id, clase: i, texto: `${C.CLASES_CENSO[i]}: ${n}`, n }); });
        if (pocas > 0) leyenda.push({ capa: id, clase: null, texto: `Pocas viviendas (sin porcentaje): ${pocas}`, n: pocas });
      } else if (id === 'viaje') {
        // Ruta al trabajo: los datos los trae la capa (los armó el asistente con Viaje.rutasDirectas). Tramo = de donde subes a donde bajas.
        const tramos = (capa.tramos || []).filter((t) => t && Array.isArray(t.segmento) && t.segmento.length >= 2);
        const celdasViaje = (capa.celdas || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
        if (!capa.destino && tramos.length === 0) { vacias.push('viaje'); return; }
        viajeOut = { origen: capa.origen || null, destino: capa.destino || null, tramos, celdas: celdasViaje };
        const destinoTxt = capa.destino && capa.destino.nombre ? ` a ${capa.destino.nombre}` : '';
        leyenda.push({ capa: 'viaje', texto: tramos.length ? `Ruta al trabajo${destinoTxt}: ${tramos.length} ${tramos.length === 1 ? 'ruta directa' : 'rutas directas'} (de donde subes a donde bajas)` : `Ruta al trabajo${destinoTxt}${celdasViaje.length ? `: ${celdasViaje.length} celdas desde las que se llega sin transbordo` : ''}`, n: Math.max(tramos.length, celdasViaje.length, 1) });
      } else if (id === 'electricidad') {
        // Áreas de concesión de distribución eléctrica: polígonos ENTEROS del registro (no se recortan al distrito). Informativas, sin círculo.
        if (!Array.isArray(electricidad) || electricidad.length === 0) { sinDatos.push('electricidad'); return; }
        const delArea = electricidad.filter((f) => {
          if (!f || !f.geometry) return false;
          if (!cajaArea) return true;
          const b = bboxDe(coordsDe(f.geometry));
          return !(b[2] < cajaArea[0] || b[0] > cajaArea[2] || b[3] < cajaArea[1] || b[1] > cajaArea[3]);
        });
        delArea.forEach((f) => {
          const p = f.properties || {};
          poligonos.push({
            capa: 'electricidad', geometry: f.geometry, nombre: p.nombre_zona || null, osm: null, concesionaria: p.concesionaria || null,
            titulo: p.nombre_zona || 'Área de concesión eléctrica',
            detalle: `Concesión de distribución de ${p.concesionaria || p.empresa || 'una empresa'}${p.expediente ? ` · expediente ${p.expediente}` : ''}${p.situacion ? ` · ${String(p.situacion).toLowerCase()}` : ''}`,
          });
        });
        if (delArea.length === 0) vacias.push('electricidad');
        const porEmpresa = new Map();
        delArea.forEach((f) => { const k = (f.properties && (f.properties.concesionaria || f.properties.empresa)) || 'una empresa'; porEmpresa.set(k, (porEmpresa.get(k) || 0) + 1); });
        porEmpresa.forEach((n, k) => leyenda.push({ capa: 'electricidad', texto: `Concesión de ${k}: ${n}`, n }));
      } else if (id === 'acopio_agua') {
        // Puntos de acopio de agua (SEDAPAR): informativos, un punto cada uno, sin círculo.
        if (!Array.isArray(acopio) || acopio.length === 0) { sinDatos.push('acopio_agua'); return; }
        const elegidos = acopio.filter((f) => f && f.geometry && f.geometry.type === 'Point' && enArea(f.geometry.coordinates[1], f.geometry.coordinates[0]));
        elegidos.forEach((f) => {
          const p = f.properties || {};
          puntos.push({
            capa: 'acopio_agua', tipo: 'acopio', subtipo: 'acopio', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], nombre: p.direccion || null, osm: null, fuente: 'SEDAPAR',
            fuenteTexto: 'Directorio de Puntos de Acopio de Agua Potable de SEDAPAR (gob.pe, publicado el 16 de febrero de 2024; datos de 2017)', verificado: null,
            titulo: p.direccion || 'Punto de acopio de agua',
            detalle: `Punto de acopio de agua${p.distrito ? ` · ${p.distrito}` : ''} · datos de 2017 · lugar de reparto con camiones cisterna, no una conexión`,
          });
        });
        cuenta('acopio_agua', elegidos.length, `Puntos de acopio de agua (SEDAPAR, datos de 2017): ${elegidos.length}`);
      } else if (id === 'mineria') {
        // Concesiones mineras (Catastro Minero): polígonos ENTEROS (no se recortan al distrito), sin las extinguidas. Informativas, sin círculo.
        if (!Array.isArray(mineria) || mineria.length === 0) { sinDatos.push('mineria'); return; }
        const delArea = mineria.filter((f) => {
          if (!f || !f.geometry || !f.properties || f.properties.estado === 'EXTINGUIDO') return false;
          if (!cajaArea) return true;
          const b = bboxDe(coordsDe(f.geometry));
          return !(b[2] < cajaArea[0] || b[0] > cajaArea[2] || b[3] < cajaArea[1] || b[1] > cajaArea[3]);
        });
        const TXT_ESTADO = { TITULADO: 'titulada', 'EN TRÁMITE': 'en trámite', OTRO: 'de otro tipo' };
        delArea.forEach((f) => {
          const p = f.properties;
          poligonos.push({
            capa: 'mineria', geometry: f.geometry, nombre: p.nombre || p.codigo || null, osm: null, estado: p.estado, codigo: p.codigo || null,
            titulo: p.nombre || p.codigo || 'Concesión minera',
            detalle: `Concesión ${TXT_ESTADO[p.estado] || p.estado}${p.sustancia ? ` · ${p.sustancia}` : ''}${p.hectareas ? ` · ${Math.round(p.hectareas)} ha` : ''}${p.codigo ? ` · código ${p.codigo}` : ''}`,
          });
        });
        if (delArea.length === 0) vacias.push('mineria');
        const porEstado = new Map();
        delArea.forEach((f) => porEstado.set(f.properties.estado, (porEstado.get(f.properties.estado) || 0) + 1));
        porEstado.forEach((n, k) => leyenda.push({ capa: 'mineria', texto: `Concesión ${TXT_ESTADO[k] || k}: ${n}`, n }));
      } else if (id === 'volcan') {
        if (!Array.isArray(volcan) || volcan.length === 0) { sinDatos.push('volcan'); return; }
        const pedidos = (capa.tipos && capa.tipos.length ? capa.tipos : V().dibujables()).filter((t) => V().TIPOS[t] && V().TIPOS[t].mapa);
        const zonasVol = volcan.filter((z) => pedidos.includes(z.tipo) && (!cajaArea || !(z.bbox[2] < cajaArea[0] || z.bbox[0] > cajaArea[2] || z.bbox[3] < cajaArea[1] || z.bbox[1] > cajaArea[3])));
        // Del nivel más bajo al más alto: el más alto queda encima.
        [...zonasVol].sort((a, b) => V().NIVELES.indexOf(a.nivel) - V().NIVELES.indexOf(b.nivel)).forEach((z) => peligroVolcan.push({
          capa: 'volcan', tipo: z.tipo, nivel: z.nivel, geometry: z.geometry,
          titulo: `${V().nombreTipo(z.tipo).charAt(0).toUpperCase()}${V().nombreTipo(z.tipo).slice(1)}: peligro ${z.nivel}`,
          detalle: `Zona del IGP${z.detalle ? `. ${z.detalle}` : ''}. Mapa de escala regional, sin fecha de elaboración; no es una evaluación de riesgo.`,
        }));
        const filas = V().leyenda(zonasVol, { tipos: pedidos });
        if (filas.length === 0) vacias.push('volcan');
        filas.forEach((f) => leyenda.push({ capa: 'volcan', nivel: f.nivel, texto: f.texto, n: zonasVol.filter((z) => z.nivel === f.nivel && f.tipos.includes(z.tipo)).length }));
      } else if (id === 'cenepred_inundacion' || id === 'cenepred_mm') {
        if (riesgoDistritos.length) return; // un fenómeno a la vez: el segundo se pintaría encima del primero
        const fen = id === 'cenepred_mm' ? 'movimientos_masa' : 'inundacion';
        const nombreFen = Cen().FENOMENOS[fen].nombre;
        const delArchivo = cenepred ? Cen().distritosPorFenomeno(cenepred, fen).map((d) => ({ d, f: Dist().feature(d.distrito) })).filter((x) => x.f) : [];
        if (delArchivo.length === 0) { sinDatos.push('cenepred'); return; }
        // Del nivel más bajo al más alto: el más alto queda encima.
        [...delArchivo].sort((a, b) => Cen().NIVELES.indexOf(a.d.nivel) - Cen().NIVELES.indexOf(b.d.nivel)).forEach(({ d, f }) => {
          const l = Cen().lineas(Cen().buscar(cenepred, d.ubigeo), { fenomenos: [fen] })[0];
          riesgoDistritos.push({
            capa: id, fenomeno: fen, nivel: d.nivel, distrito: d.distrito, ubigeo: d.ubigeo, geometry: f.geometry,
            titulo: `${Dist().titulo(d.distrito)}: riesgo ${d.nivel.toLowerCase()} ante ${nombreFen}`,
            detalle: `${l ? `${l.texto} ` : ''}Estimación por distrito para un escenario El Niño (CENEPRED); no es del predio.`,
          });
        });
        [...Cen().porNivel(cenepred, fen)].reverse().forEach(({ nivel, n }) => { // del más alto al más bajo, como la leyenda del volcán
          const nombres = delArchivo.filter((x) => x.d.nivel === nivel).map((x) => Dist().titulo(x.d.distrito));
          leyenda.push({ capa: id, nivel, n, texto: `Riesgo ${nivel.toLowerCase()} ante ${nombreFen}: ${n} ${n === 1 ? 'distrito' : 'distritos'}${n <= 10 ? ` (${nombres.join(', ')})` : ''}` });
        });
      } else if (id === 'sismos') {
        if (!Array.isArray(sismos)) { sinDatos.push('sismos'); return; }
        sismos.forEach((s) => sism.push({ ...s, radioPx: sismoRadioPx(s.magnitud) }));
        cuenta('sismos', sism.length, `Sismos reportados por el IGP (cuanto mayor la magnitud, más grande el círculo): ${sism.length}`);
      }
    });

    if (puntos.length > 0 && puntos.length <= maxCirculos) {
      puntos.forEach((p) => { if (p.radioM) circulos.push({ capa: p.capa, lat: p.lat, lon: p.lon, radioM: p.radioM, nivel: p.tipo === 'colegio' ? p.subtipo : null }); });
    }

    const regiones = (sectores || []).map((s) => ({ n: s.n, centro: s.centro, hectareas: s.hectareas, distrito: s.distrito, nombre: s.nombre || null, contorno: s.contorno }));
    if (regiones.length > 0) leyenda.push({ capa: 'sectores', texto: `Sectores donde se cumple todo lo que pediste: ${regiones.length}`, n: regiones.length });

    // Encuadre: los sectores si los hay; si no, el área (distrito); si no, lo que se dibujó.
    if (regiones.length > 0) {
      limites = bboxDe(regiones.flatMap((s) => s.contorno.flatMap((a) => a)));
      limites = unir(limites, bboxDe(puntos.map((p) => [p.lon, p.lat])));
    } else if (cajaArea) limites = cajaArea;
    else if (cajaLineas && valido(cajaLineas) && puntos.length === 0 && poligonos.length === 0) limites = cajaLineas;
    else {
      const todos = [...puntos.map((p) => [p.lon, p.lat]), ...poligonos.flatMap((p) => coordsDe(p.geometry)), ...peligroVolcan.flatMap((p) => coordsDe(p.geometry)), ...riesgoDistritos.flatMap((p) => coordsDe(p.geometry)),
        ...(viajeOut ? [...(viajeOut.origen ? [[viajeOut.origen.lon, viajeOut.origen.lat]] : []), ...(viajeOut.destino ? [[viajeOut.destino.lon, viajeOut.destino.lat]] : []), ...viajeOut.tramos.flatMap((t) => t.segmento), ...viajeOut.celdas.map((p) => [p.lon, p.lat])] : [])];
      limites = todos.length ? bboxDe(todos) : null;
    }
    if (limites && !valido(limites)) limites = null;

    // Una capa puede tener varias líneas de leyenda (el peligro volcánico, una por nivel): el resumen las junta.
    const porCapa = [];
    leyenda.forEach((l) => { const p = porCapa.find((x) => x.capa === l.capa); if (p) p.n += l.n; else porCapa.push({ capa: l.capa, n: l.n }); });
    const resumen = !leyenda.length && !vacias.length && !sinDatos.length
      ? (cajaArea ? 'Marqué el distrito en el mapa. Elige arriba qué quieres ver dentro de él.' : '')
      : vacias.length && !leyenda.length
      ? `En esta zona no hay ${vacias.map((v) => ({ colegios: 'colegios', salud: 'establecimientos de salud', consultorios: 'consultorios médicos', abastecimiento: 'puntos de abastecimiento', compras_ocio: 'malls confirmados', comercio_barrio: 'galerías o comercio de barrio', finanzas: 'bancos o cajeros', comida_fuera: 'restaurantes o cafés', recreacion: 'áreas de juegos infantiles', acopio_agua: 'puntos de acopio de agua', electricidad: 'áreas de concesión eléctrica', censo_luz: 'manzanas con cifras del censo', censo_agua: 'manzanas con cifras del censo', censo_desague: 'manzanas con cifras del censo', paraderos: 'paraderos', parques: 'parques', volcan: 'zonas de peligro volcánico' }[v] || v)).join(' ni ')} en los datos.`
      : `Muestro ${listaEs(porCapa.map((l) => `${l.n} ${nombreDe(l.capa, l.n)}`))}.${vacias.length ? ` No hay ${listaEs(vacias.map((v) => nombreDe(v, 2)))} en esta zona.` : ''}`;
    return { puntos, circulos, poligonos, lineas, viaje: viajeOut, sismos: sism, peligroVolcan, riesgoDistritos, sectores: regiones, lineasBus, paradasBus, leyenda, vacias, sinDatos, resumen, limites };
  }

  /** Los sismos del archivo GeoJSON del IGP como lista simple { lat, lon, magnitud, fecha, profundidadKm, ref }; ignora lo que no es un punto con magnitud. */
  function sismosDeFeatures(features) {
    return (features || [])
      .filter((f) => f && f.geometry && f.geometry.type === 'Point' && f.properties && typeof f.properties.magnitud === 'number')
      .map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], magnitud: f.properties.magnitud, fecha: f.properties.fecha || null, profundidadKm: f.properties.profundidadKm ?? null, ref: f.properties.ref || null }));
  }

  return { CAPAS, ZONAS, NIVELES, deCriterios, construir, sismoRadioPx, sismosDeFeatures };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Capas;
