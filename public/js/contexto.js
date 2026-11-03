/**
 * contexto.js — Quebradas y cauces (ANA) y contexto de riesgo (peligros geológicos y sismos) para el punto elegido.
 *
 * Lee archivos CONGELADOS de public/data (no consulta ningún servicio al elegir el punto) y calcula con las funciones puras
 * de calculos.js. Nada de esto es una evaluación de peligro:
 *   - Quebradas y cauces: distancia al cauce más cercano de la red hidrográfica de la ANA. No hay umbral normativo, así que
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

  /** Cauces listos para medir; las tarjetas y el asistente comparten esta lista. */
  async function cauces() {
    const { features, meta } = await archivo('quebradas');
    const lista = features
      .filter((f) => f.geometry && /LineString/.test(f.geometry.type))
      .map((f) => ({ nombre: f.properties.nombre, tipo: f.properties.tipo, categoria: f.properties.categoria, cuenca: f.properties.cuenca, geometry: f.geometry }));
    if (lista.length === 0) throw new Error('El archivo de quebradas no tiene cauces.');
    return { lista, meta };
  }

  /**
   * Cauce más cercano al punto. Con \`umbralUsuarioM\` (de «Mis umbrales») da CUMPLE o NO CUMPLE según ese umbral; sin él,
   * INFORMATIVO. Devuelve SIN DATO si el archivo falta.
   */
  async function quebradas(lat, lon, umbralUsuarioM = null) {
    const base = { fuente: CONFIG.quebradas.fuente };
    try {
      const { lista, meta } = await cauces();
      const r = Calculos.evaluarCauces({ lat, lon }, lista, {
        umbralUsuarioM,
        fuente: meta.fuente || base.fuente,
        fecha: dia(meta.descargado),
        metodo: 'Distancia en línea recta desde el punto hasta el tramo más cercano de la red hidrográfica de la ANA (distancia a la línea del mapa, no al cauce real ni a su faja marginal). Datos congelados.',
      });
      return { ...r, nombres: meta.nombres || [], elaboracion: meta.elaboracion || null, tramos: meta.registros };
    } catch (err) {
      return sinDato({ ...base, nombre: null, tipo: null, umbralM: null, segunUmbralUsuario: false, fecha: null, metodo: 'No se pudo obtener el dato.', error: err.message });
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

  /** Los sismos del archivo congelado tal como vienen (GeoJSON), para dibujarlos en el mapa. Rechaza si el archivo falta. */
  async function sismosCrudos() {
    const { features } = await archivo('sismos');
    return features;
  }

  /** Las tres variables para un punto: { quebradas, peligros, sismos } (ninguna rechaza). */
  async function evaluar(lat, lon, umbralUsuarioM = null) {
    const [q, p, s] = await Promise.all([quebradas(lat, lon, umbralUsuarioM), peligros(lat, lon), sismos(lat, lon)]);
    return { quebradas: q, peligros: p, sismos: s };
  }

  return { cauces, quebradas, peligros, sismos, sismosCrudos, evaluar };
})();
