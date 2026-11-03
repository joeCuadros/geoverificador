/**
 * contexto.js — Quebradas y cauces (ANA, IGP y OpenStreetMap) y contexto de riesgo (peligros geológicos y sismos) para el punto elegido.
 *
 * Lee archivos CONGELADOS de public/data (no consulta ningún servicio al elegir el punto) y calcula con las funciones puras
 * de calculos.js. Nada de esto es una evaluación de peligro:
 *   - Quebradas y cauces: distancia al cauce más cercano de la red unida de la ANA, el IGP y OpenStreetMap (cada tramo dice su fuente). No hay umbral normativo, así que
 *     el estado es INFORMATIVO salvo que la persona fije el suyo en «Mis umbrales» (entonces CUMPLE / NO CUMPLE según su umbral).
 *   - Peligros geológicos: inventario de eventos documentados de INGEMMET (el estado es siempre INFORMATIVO).
 *   - Sismos: sismos reportados por el IGP en el periodo que cubre el archivo; contexto reciente, no predicción.
 * Si un archivo falta o está mal formado, la variable devuelve SIN DATO con la causa: nunca se inventan datos.
 */
const Contexto = (() => {
  const cargas = new Map(); // clave → promesa con { features, meta }

  /** Lee un archivo congelado (una sola vez). Si falla, la siguiente llamada reintenta. */
  function archivo(clave) {
    if (!cargas.has(clave)) {
      cargas.set(clave, (async () => {
        const cfg = CONFIG[clave];
        let res;
        try {
          res = await fetch(cfg.geojsonUrl);
        } catch (_) {
          throw new Error(`No se pudo leer ${cfg.geojsonUrl}.`);
        }
        if (!res.ok) throw new Error(`No se encontró ${cfg.geojsonUrl} (HTTP ${res.status}).`);
        let fc;
        try {
          fc = await res.json();
        } catch (_) {
          throw new Error(`${cfg.geojsonUrl} no es un JSON válido.`);
        }
        if (!fc || !Array.isArray(fc.features) || !fc.metadata) throw new Error(`${cfg.geojsonUrl} no tiene el formato esperado (falta \`features\` o \`metadata\`).`);
        return { features: fc.features, meta: fc.metadata };
      })().catch((err) => { cargas.delete(clave); throw err; }));
    }
    return cargas.get(clave);
  }

  const dia = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);
  const sinDato = (extra) => ({ estado: 'SIN DATO', distanciaM: null, ...extra });

  // ------------------------------------------------------------ Quebradas y cauces

  /** Las fuentes del archivo de cauces. Un archivo antiguo, de una sola fuente, se trata como ANA. */
  function fuentesDe(meta) {
    if (Array.isArray(meta.fuentes) && meta.fuentes.length) return meta.fuentes;
    return [{ id: 'ANA', fuente: meta.fuente, capa: meta.capa, descargado: meta.descargado, elaboracion: meta.elaboracion, atribucion: meta.atribucion, licencia: meta.licencia, escala: meta.escala, registros: meta.registros }];
  }

  /** Cauces listos para medir; las tarjetas y el asistente comparten esta lista. Cada cauce dice de qué fuente es. */
  async function cauces() {
    const { features, meta } = await archivo('quebradas');
    const lista = features
      .filter((f) => f.geometry && /LineString/.test(f.geometry.type))
      .map((f) => ({
        nombre: f.properties.nombre, tipo: f.properties.tipo, categoria: f.properties.categoria, cuenca: f.properties.cuenca,
        fuente: f.properties.fuente || 'ANA', alias: f.properties.alias || [], tambienEn: f.properties.tambienEn || [], geometry: f.geometry,
      }));
    if (lista.length === 0) throw new Error('El archivo de quebradas no tiene cauces.');
    return { lista, meta, fuentes: fuentesDe(meta) };
  }

  /**
   * Cauce más cercano al punto, con su fuente (ANA, IGP u OpenStreetMap). Con `umbralUsuarioM` (de «Mis umbrales») da CUMPLE o
   * NO CUMPLE según ese umbral; sin él, INFORMATIVO. Devuelve SIN DATO si el archivo falta.
   */
  async function quebradas(lat, lon, umbralUsuarioM = null) {
    const base = { fuente: CONFIG.quebradas.fuente };
    try {
      const { lista, meta, fuentes } = await cauces();
      const r = Calculos.evaluarCauces({ lat, lon }, lista, {
        umbralUsuarioM,
        metodo: 'Distancia en línea recta desde el punto hasta el tramo más cercano de los cauces de la ANA, el IGP y OpenStreetMap (distancia a la línea del mapa, no al cauce real ni a su faja marginal). Datos congelados.',
      });
      const origen = fuentes.find((f) => f.id === r.fuenteId) || fuentes[0];
      const faltan = await quebradasAusentes();
      return {
        ...r,
        fuente: origen.fuente || base.fuente,
        fecha: dia(origen.descargado),
        elaboracion: origen.elaboracion || null,
        licencia: origen.licencia || null,
        nombres: meta.nombres || [],
        tramos: meta.registros,
        ausentes: faltan ? faltan.ausentes : [],
        fuentes: fuentes.map((f) => ({ id: f.id, fuente: f.fuente, registros: f.registros, fecha: dia(f.descargado), elaboracion: f.elaboracion || null, licencia: f.licencia || null })),
      };
    } catch (err) {
      return sinDato({ ...base, nombre: null, tipo: null, umbralM: null, segunUmbralUsuario: false, fecha: null, metodo: 'No se pudo obtener el dato.', error: err.message });
    }
  }

  /**
   * Qué quebradas conocidas NO están en el archivo de cauces: las que nombra el inventario de INGEMMET en 2 o más registros
   * y las que citan los informes (CONFIG.quebradas.citadas), menos las que sí figuran. Se calcula con los datos congelados;
   * si falta alguno, devuelve null (no se afirma nada).
   */
  async function quebradasAusentes() {
    try {
      const [{ meta, lista }, peligros] = await Promise.all([cauces(), archivo('peligros')]);
      const nombresCauces = [...(meta.nombres || []), ...lista.flatMap((c) => c.alias.map((a) => a.nombre))];
      const mencionadas = Calculos.quebradasMencionadas(peligros.features.map((f) => f.properties.sector));
      return Calculos.quebradasAusentes({ mencionadas, citadas: CONFIG.quebradas.citadas || [], nombresCauces, maximo: 6 });
    } catch (_) {
      return null;
    }
  }

  // ------------------------------------------------------------ Peligros geológicos

  /** Peligros geológicos de INGEMMET a CONFIG.peligros.radio metros y el más cercano (siempre INFORMATIVO). */
  async function peligros(lat, lon) {
    try {
      const p = await Peligros.indicador(lat, lon);
      return {
        estado: 'INFORMATIVO',
        radioM: p.radio,
        total: p.total,
        porTipo: p.porTipo,
        masCercano: p.masCercano,
        distanciaM: p.masCercano ? p.masCercano.distancia : null,
        anioDesde: p.meta.anioDesde,
        anioHasta: p.meta.anioHasta,
        registros: p.meta.registros,
        fuente: p.meta.fuente,
        fecha: dia(p.meta.descargado),
        metodo: `Se cuentan los eventos del inventario de INGEMMET a ${p.radio} m o menos del punto y se mide la distancia en línea recta al más cercano. Datos congelados.`,
      };
    } catch (err) {
      return sinDato({ radioM: CONFIG.peligros.radio, total: null, fuente: CONFIG.peligros.fuente, fecha: null, metodo: 'No se pudo obtener el dato.', error: err.message });
    }
  }

  // ---------------------------------------------------------------------- Sismos

  /** Sismos reportados por el IGP a CONFIG.sismos.radioM o menos del punto, en el periodo que cubre el archivo (INFORMATIVO). */
  async function sismos(lat, lon) {
    const radioM = CONFIG.sismos.radioM;
    try {
      const { features, meta } = await archivo('sismos');
      const lista = features
        .filter((f) => f.geometry && f.geometry.type === 'Point')
        .map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], magnitud: f.properties.magnitud, fecha: f.properties.fecha }));
      const r = Calculos.resumirSismos({ lat, lon }, lista, { radioM });
      return {
        estado: 'INFORMATIVO',
        radioM,
        total: r.total,
        magnitudMaxima: r.magnitudMaxima,
        masReciente: r.masReciente,
        distanciaM: r.masCercano ? r.masCercano.distanciaM : null,
        desde: meta.fechaDesde,
        hasta: meta.fechaHasta,
        fuente: meta.fuente || CONFIG.sismos.fuente,
        fecha: dia(meta.descargado),
        metodo: `Se cuentan los sismos reportados por el IGP a ${radioM / 1000} km o menos del punto (distancia en línea recta al epicentro) entre el ${meta.fechaDesde} y el ${meta.fechaHasta}. Datos congelados.`,
      };
    } catch (err) {
      return sinDato({ radioM, total: null, desde: null, hasta: null, fuente: CONFIG.sismos.fuente, fecha: null, metodo: 'No se pudo obtener el dato.', error: err.message });
    }
  }

  // ------------------------------------------------------- Peligro volcánico del Misti

  const V = () => (typeof Volcan !== 'undefined' ? Volcan : require('./volcan.js')); // eslint-disable-line no-undef
  let zonasVolcan = null; // zonas indexadas (una sola vez)

  /** Las zonas de peligro volcánico listas para consultar, con la metadata del archivo. Rechaza si el archivo falta. */
  async function zonasVolcanicas() {
    const { features, meta } = await archivo('volcan');
    if (!zonasVolcan || zonasVolcan.features !== features) zonasVolcan = { features, zonas: V().indexar(features) };
    if (zonasVolcan.zonas.length === 0) throw new Error('El archivo de peligro volcánico no tiene zonas.');
    return { zonas: zonasVolcan.zonas, meta };
  }

  /**
   * En qué zonas de peligro volcánico del Misti cae el punto (INFORMATIVO: nunca cumple ni puntaje). Cada fenómeno (lahares,
   * flujos piroclásticos, lava, avalanchas, ceniza) trae su nivel más alto. Si el archivo falta, SIN DATO con la causa.
   */
  async function volcan(lat, lon) {
    const base = { fuente: CONFIG.volcan.fuente };
    try {
      const { zonas, meta } = await zonasVolcanicas();
      const items = V().enZonas(lat, lon, zonas);
      const resumen = V().resumirPunto(items);
      return {
        estado: 'INFORMATIVO',
        enZona: resumen.length > 0,
        resumen,
        detalle: items,
        frase: V().frasePunto(resumen),
        lineas: V().lineasPunto(resumen),
        fuente: meta.fuente || base.fuente,
        fecha: dia(meta.descargado),
        referencia: meta.referencia || null,
        fechaDelMapa: meta.fechaDelMapa || 'Sin metadatos de fecha',
        metodo: 'Se busca en qué polígonos de peligro del IGP cae el punto (si cae en un hueco, queda fuera). Datos congelados.',
      };
    } catch (err) {
      return sinDato({ ...base, enZona: false, resumen: [], detalle: [], frase: null, fecha: null, metodo: 'No se pudo obtener el dato.', error: err.message });
    }
  }

  /** Las zonas y la metadata tal como están en el archivo, para dibujarlas en el mapa. Rechaza si el archivo falta. */
  async function volcanCrudo() {
    return zonasVolcanicas();
  }

  /** Los sismos del archivo congelado tal como vienen (GeoJSON), para dibujarlos en el mapa. Rechaza si el archivo falta. */
  async function sismosCrudos() {
    const { features } = await archivo('sismos');
    return features;
  }

  /** Las variables para un punto: { quebradas, peligros, sismos, volcan } (ninguna rechaza). */
  async function evaluar(lat, lon, umbralUsuarioM = null) {
    const [q, p, s, v] = await Promise.all([quebradas(lat, lon, umbralUsuarioM), peligros(lat, lon), sismos(lat, lon), volcan(lat, lon)]);
    return { quebradas: q, peligros: p, sismos: s, volcan: v };
  }

  return { cauces, quebradas, quebradasAusentes, peligros, sismos, sismosCrudos, volcan, volcanCrudo, evaluar };
})();
