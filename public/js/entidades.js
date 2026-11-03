/**
 * entidades.js — Contar y listar las entidades reales (colegios, salud, paraderos, parques) dentro de un distrito o cerca de
 * un punto. Sin DOM ni red: trabaja con los datos que ordena Asistente.prepararDatos a partir de los archivos congelados de
 * OpenStreetMap, así que cualquier cifra sale de elementos que existen en esos archivos (y que se pueden mostrar en el mapa).
 *
 *   contar(datos, polys)                → cuántos hay dentro del distrito y cuáles son
 *   cercaDe(datos, punto, umbrales)     → los que están dentro de la distancia de referencia de cada tipo
 *   fraseColegios(colegios)             → «4 colegios: 1 inicial, 3 primaria, 2 secundaria»
 *
 * `polys` es la geometría de un distrito como Distritos.poligonos: lista de polígonos, cada uno con sus anillos [lon, lat].
 * Se carga como script del navegador (define `Entidades`) y también como módulo CommonJS para las pruebas.
 */
const Entidades = (() => {
  const C = typeof Calculos !== 'undefined' ? Calculos : require('./calculos.js'); // eslint-disable-line no-undef
  const NIVELES = ['inicial', 'primaria', 'secundaria'];

  const bboxDe = (polys) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    polys.forEach((anillos) => (anillos[0] || []).forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }));
    return b;
  };

  /** Función «¿este punto está dentro del distrito?» con una comprobación rápida por caja antes del polígono. */
  function contenedor(polys) {
    const b = bboxDe(polys || []);
    return (lat, lon) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && polys.some((anillos) => C.puntoEnPoligono(lat, lon, anillos));
  }

  /** Los elementos de `datos` que caen dentro del distrito. Un parque está dentro si lo está el centro de su caja. */
  function enDistrito(datos, polys) {
    const dentro = contenedor(polys);
    const puntos = (lista) => (lista || []).filter((p) => dentro(p.lat, p.lon));
    return {
      colegios: puntos(datos.colegiosLista),
      salud: puntos(datos.salud),
      paraderos: puntos(datos.transporte),
      parques: (datos.verdesTodos || []).filter((v) => v.centro && dentro(v.centro.lat, v.centro.lon)),
    };
  }

  // amenity=school sin `isced:level` ni `school=*`: OSM no dice el nivel y Calculos.nivelesEducativos lo supone primaria y secundaria.
  const sinNivelDeclarado = (c) => c.tags.amenity === 'school' && !c.tags['isced:level'] && !c.tags.school;

  /**
   * Cuenta lo que hay dentro de un distrito.
   * Un colegio con varios niveles suma en cada uno (por eso inicial + primaria + secundaria puede superar al total).
   * Los parques se cuentan todos; `grandes` son los de al menos el área mínima de los criterios (0,5 ha, OMS).
   */
  function contar(datos, polys, { areaMinM2 = 5000 } = {}) {
    const e = enDistrito(datos, polys);
    const porNivel = Object.fromEntries(NIVELES.map((n) => [n, e.colegios.filter((c) => c.niveles.includes(n)).length]));
    const parques = [...e.parques].sort((a, b) => b.areaM2 - a.areaM2);
    return {
      colegios: { total: e.colegios.length, ...porNivel, sinNivel: e.colegios.filter(sinNivelDeclarado).length, lista: e.colegios },
      salud: { total: e.salud.length, lista: e.salud },
      paraderos: { total: e.paraderos.length, lista: e.paraderos },
      parques: {
        total: parques.length,
        grandes: parques.filter((p) => p.areaM2 >= areaMinM2).length,
        areaTotalM2: parques.reduce((s, p) => s + p.areaM2, 0),
        lista: parques,
      },
    };
  }

  const ordenados = (lista) => lista.sort((a, b) => a.distanciaM - b.distanciaM);

  /**
   * Lo que hay a la distancia de referencia de cada tipo alrededor de un punto, del más cercano al más lejano.
   *   opciones: { inicialM, primariaM, secundariaM, saludM, transporteM, areaVerdeM } para usar otra distancia.
   */
  function cercaDe(datos, punto, umbrales, opciones = {}) {
    const u = umbrales || {};
    const radio = {
      inicial: opciones.inicialM ?? u.educacion.inicial,
      primaria: opciones.primariaM ?? u.educacion.primaria,
      secundaria: opciones.secundariaM ?? u.educacion.secundaria,
      salud: opciones.saludM ?? u.salud,
      transporte: opciones.transporteM ?? u.transporte,
      areaVerde: opciones.areaVerdeM ?? u.areaVerde.distanciaM,
    };
    const conDistancia = (lista, max) => ordenados((lista || [])
      .map((p) => ({ ...p, distanciaM: C.haversine(punto.lat, punto.lon, p.lat, p.lon) }))
      .filter((p) => p.distanciaM <= max));
    return {
      colegios: Object.fromEntries(NIVELES.map((n) => [n, conDistancia(datos.colegios[n], radio[n])])),
      salud: conDistancia(datos.salud, radio.salud),
      paraderos: conDistancia(datos.transporte, radio.transporte),
      parques: ordenados((datos.verdes || [])
        .map((v) => ({ ...v, distanciaM: C.distanciaAGeometriaM(punto.lat, punto.lon, v.geometry) }))
        .filter((v) => v.distanciaM <= radio.areaVerde)),
    };
  }

  /** «4 colegios: 1 inicial, 3 primaria, 2 secundaria», «1 colegio: …» o «ningún colegio». */
  function fraseColegios(c) {
    if (!c || c.total === 0) return 'ningún colegio';
    return `${c.total} ${c.total === 1 ? 'colegio' : 'colegios'}: ${c.inicial} inicial, ${c.primaria} primaria, ${c.secundaria} secundaria`;
  }

  // ----------------------------------------------------------- Zonificación y cauces

  const TIPOS_DE_ZONA = {
    residencial: ['residencial', 'residencial'],
    comercial: ['comercial', 'comercial'],
    industrial: ['industrial', 'industrial'],
    equipamiento: ['equipamiento', 'equipamientos (colegios, hospitales…)'],
    recreacion: ['recreacion', 'recreación'],
    especial: ['especial', 'zonas de reglamentación especial'],
    riesgo: ['riesgo', 'zonas de riesgo'],
    proteccion: ['proteccion', 'zonas de protección'],
  };

  /** Tipo principal de una zona del plano: [id, etiqueta]. La campiña (ZA, ZRE-PA) se separa de la protección. */
  function tipoDeZona(codigo, grupo) {
    if (codigo === 'ZA' || codigo === 'ZRE-PA') return ['campina', 'campiña'];
    return TIPOS_DE_ZONA[grupo] || null;
  }

  /**
   * Cómo se reparte la zonificación del plano dentro de un distrito, por tipo principal (residencial, comercial, campiña…).
   * Se mide con puntos cada `pasoM` metros dentro del distrito; gana la última zona que contiene el punto, como en el plano.
   * Devuelve { conPlano, partes: [{ id, etiqueta, pct }] } (pct sobre lo que el plano zonifica dentro del distrito).
   */
  function mezclaZonas(zonas, polys, { pasoM = 300 } = {}) {
    const b = bboxDe(polys || []);
    const conBbox = (zonas || []).filter((z) => z.bbox && z.regla);
    if (b[0] === Infinity || conBbox.length === 0) return { conPlano: false, partes: [] };
    const dentro = contenedor(polys);
    const mPorGrado = (Math.PI / 180) * C.RADIO_TIERRA_M;
    const dLat = pasoM / mPorGrado;
    const cuenta = new Map();
    let total = 0;
    for (let lat = b[1] + dLat / 2; lat < b[3]; lat += dLat) {
      const dLon = pasoM / (mPorGrado * Math.cos((lat * Math.PI) / 180));
      for (let lon = b[0] + dLon / 2; lon < b[2]; lon += dLon) {
        if (!dentro(lat, lon)) continue;
        let hit = null;
        for (const z of conBbox) {
          if (lon < z.bbox[0] || lon > z.bbox[2] || lat < z.bbox[1] || lat > z.bbox[3]) continue;
          if (z.polys.some((anillos) => C.puntoEnPoligono(lat, lon, anillos))) hit = z;
        }
        const tipo = hit ? tipoDeZona(hit.codigo, hit.regla.grupo) : null;
        if (!tipo) continue;
        total += 1;
        const previo = cuenta.get(tipo[0]) || { id: tipo[0], etiqueta: tipo[1], n: 0 };
        previo.n += 1;
        cuenta.set(tipo[0], previo);
      }
    }
    if (total === 0) return { conPlano: false, partes: [] };
    const partes = [...cuenta.values()].sort((x, y) => y.n - x.n).map((p) => ({ id: p.id, etiqueta: p.etiqueta, pct: (100 * p.n) / total }));
    return { conPlano: true, partes };
  }

  /**
   * Cauces (ANA, IGP y OpenStreetMap) que pasan por el distrito: los nombres sin repetir, cuántos tramos lo cruzan y de qué
   * fuentes (`fuentes`: ids ANA, IGP, OSM, en ese orden; un archivo antiguo sin `fuente` cuenta como ANA).
   * Un tramo cruza si alguno de sus vértices cae dentro. Sin lista de cauces (archivo ausente) devuelve `sinDato`.
   */
  function caucesEnDistrito(cauces, polys) {
    if (!Array.isArray(cauces) || cauces.length === 0) return { nombres: [], total: 0, sinDato: true };
    const dentro = contenedor(polys);
    const nombres = new Set();
    const fuentes = new Set();
    let total = 0;
    cauces.forEach((c) => {
      const g = c.geometry;
      const lineas = g && g.type === 'LineString' ? [g.coordinates] : g && g.type === 'MultiLineString' ? g.coordinates : [];
      if (lineas.some((l) => l.some(([x, y]) => dentro(y, x)))) {
        total += 1;
        fuentes.add(c.fuente || 'ANA');
        if (c.nombre) nombres.add(c.nombre);
      }
    });
    return { nombres: [...nombres], total, fuentes: ['ANA', 'IGP', 'OSM'].filter((f) => fuentes.has(f)).map((id) => ({ id })) };
  }

  /** Todo lo que se cuenta de un distrito en su perfil: conteo, mezcla de zonas y cauces. */
  function perfil(datos, zonas, cauces, polys, opciones = {}) {
    return { conteo: contar(datos, polys, opciones), zonas: mezclaZonas(zonas, polys, opciones), cauces: caucesEnDistrito(cauces, polys) };
  }

  return { enDistrito, contar, cercaDe, fraseColegios, contenedor, mezclaZonas, caucesEnDistrito, perfil, tipoDeZona, NIVELES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Entidades;
