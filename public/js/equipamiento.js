/**
 * equipamiento.js — Variables V2 a V5: salud, educación por nivel, transporte y área verde.
 *
 * Lee los archivos congelados de public/data/equipamiento (scripts/extraer-equipamiento.mjs) y calcula, para el punto
 * elegido, el elemento más cercano de cada variable y su veredicto con los umbrales de CONFIG.umbrales. Solo si falta
 * un archivo consulta Overpass en vivo (respaldo), alrededor del punto. Los cálculos están en calculos.js.
 *
 * Cada resultado trae { estado, nombre, distanciaM, umbralM, fuente, fecha, metodo, ... } con estado
 * CUMPLE | NO CUMPLE | SIN DATO. Las distancias son en línea recta, no recorrido a pie.
 */
const Equipamiento = (() => {
  const NIVELES = ['inicial', 'primaria', 'secundaria'];
  const archivos = new Map(); // categoría → promesa con los datos congelados
  let indiceRutas = null;      // promesa con las rutas de SmartBus ya indexadas (Rutas.indexar)

  // ------------------------------------------------------------- Carga de datos

  /** Lee el archivo congelado de una categoría; devuelve null si falta o no es válido (entonces se usa el respaldo). */
  async function leerArchivo(categoria) {
    try {
      const res = await fetch(CONFIG.equipamiento.archivos[categoria]);
      if (!res.ok) return null;
      const fc = await res.json();
      if (!fc || !Array.isArray(fc.features)) return null;
      return { features: fc.features, fecha: (fc.metadata && fc.metadata.fecha_extraccion) || null, origen: 'archivo' };
    } catch (_) {
      return null;
    }
  }

  function archivo(categoria) {
    if (!archivos.has(categoria)) {
      archivos.set(categoria, leerArchivo(categoria).then((datos) => {
        if (!datos) archivos.delete(categoria); // si falló, la próxima vez se reintenta
        return datos;
      }));
    }
    return archivos.get(categoria);
  }

  /** Respaldo: una consulta a Overpass solo para esta categoría, alrededor del punto. */
  async function enVivo(categoria, punto) {
    const radio = CONFIG.equipamiento.respaldoRadioM;
    const consulta = Services.buildOverpassQuery(categoria, punto.lat, punto.lon, radio);
    const r = await Services.overpassWithFallback(CONFIG.overpassEndpoints[0].url, consulta);
    const modo = categoria === 'areasVerdes' ? 'poligonos' : 'puntos';
    const features = Calculos.osmAFeatures(r.data.elements, modo).filter((f) => Calculos.categoriasDe(f.properties.tags).includes(categoria));
    const base = r.data.osm3s && r.data.osm3s.timestamp_osm_base;
    return { features, fecha: base ? base.slice(0, 10) : new Date().toISOString().slice(0, 10), origen: 'overpass', alcanceM: radio };
  }

  async function cargar(categoria, punto) {
    return (await archivo(categoria)) || enVivo(categoria, punto);
  }

  /** Rutas de SmartBus (archivo congelado): se leen una sola vez y, si falla, la próxima consulta lo reintenta. */
  function cargarRutas() {
    if (!indiceRutas) {
      indiceRutas = (async () => {
        const res = await fetch(CONFIG.rutas.geojsonUrl);
        if (!res.ok) throw new Error(`No se encontró el archivo de rutas (HTTP ${res.status}).`);
        const fc = await res.json();
        if (!fc || !Array.isArray(fc.features)) throw new Error('El archivo de rutas no es un GeoJSON válido.');
        return Rutas.indexar(fc);
      })().catch((err) => {
        indiceRutas = null;
        throw err;
      });
    }
    return indiceRutas;
  }

  /**
   * Líneas que pasan cerca del punto (a la misma distancia de referencia del paradero). Nunca rechaza: si el archivo falta,
   * devuelve { error } y la ficha sigue mostrando el paradero más cercano.
   */
  async function lineasCerca(punto) {
    const u = CONFIG.umbrales.transporte;
    try {
      return Rutas.cerca(await cargarRutas(), punto.lat, punto.lon, u);
    } catch (err) {
      console.error('[Equipamiento] rutas', err);
      return { error: err.message, distanciaM: u, lineas: [], rutas: 0, fuente: CONFIG.rutas.fuente, fecha: null, permiso: CONFIG.rutas.permiso, atribucion: CONFIG.rutas.atribucion };
    }
  }

  // ------------------------------------------------------------------ Cálculo

  const candidato = (f, etiqueta) => ({
    nombre: f.properties.nombre,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    osm: f.properties.osm,
    etiqueta,
  });

  const metodoBase = (datos, que) => {
    const origen = datos.origen === 'archivo'
      ? 'Datos congelados de OpenStreetMap (ODbL).'
      : `Datos de respaldo: no se encontró el archivo local, así que se consultó Overpass en vivo en un radio de ${CONFIG.equipamiento.respaldoRadioM / 1000} km.`;
    return `Distancia en línea recta (haversine, R = 6 371 008,8 m) hasta ${que} más cercano. ${origen}`;
  };

  const comunes = (datos, umbralM, fuenteUmbral, metodo) => ({
    umbralM,
    fuente: CONFIG.equipamiento.fuente,
    fecha: datos.fecha,
    metodo: `${metodo} Umbral de ${umbralM} m: ${fuenteUmbral}.`,
    alcanceM: datos.alcanceM,
  });

  function salud(datos, punto) {
    const u = CONFIG.umbrales.salud;
    return Calculos.evaluarMasCercano(
      punto,
      datos.features.map((f) => candidato(f, Calculos.etiquetaDe(f.properties.tags, 'salud'))),
      comunes(datos, u, CONFIG.fuentesUmbral.salud, metodoBase(datos, 'el establecimiento de salud (hospital, clínica, consultorio o healthcare=*)')),
    );
  }

  function transporte(datos, punto) {
    const u = CONFIG.umbrales.transporte;
    return Calculos.evaluarMasCercano(
      punto,
      datos.features.map((f) => candidato(f, Calculos.etiquetaDe(f.properties.tags, 'transporte'))),
      comunes(datos, u, CONFIG.fuentesUmbral.transporte, metodoBase(datos, 'el paradero de transporte público')),
    );
  }

  /** Un resultado por nivel. Regla de niveles: Calculos.nivelesEducativos (documentada allí). */
  function educacion(datos, punto) {
    const out = {};
    NIVELES.forEach((nivel) => {
      const u = CONFIG.umbrales.educacion[nivel];
      const candidatos = datos.features
        .filter((f) => Calculos.nivelesEducativos(f.properties.tags).includes(nivel))
        .map((f) => {
          const t = f.properties.tags;
          const asumido = t.amenity === 'school' && !t['isced:level'] && !t.school;
          return candidato(f, `${Calculos.etiquetaDe(t, 'educacion')}${asumido ? ' (sin etiqueta de nivel: se asume primaria o secundaria)' : ''}`);
        });
      out[nivel] = Calculos.evaluarMasCercano(
        punto,
        candidatos,
        comunes(datos, u, CONFIG.fuentesUmbral.educacion, metodoBase(datos, `el colegio de nivel ${nivel}`)),
      );
    });
    return out;
  }

  function areaVerde(datos, punto) {
    const u = CONFIG.umbrales.areaVerde;
    return Calculos.evaluarAreaVerde(punto, datos.features, {
      areaMinM2: u.areaMinM2,
      distanciaMaxM: u.distanciaM,
      areaGrandeM2: u.areaGrandeM2,
      fuente: CONFIG.equipamiento.fuente,
      fecha: datos.fecha,
      metodo: `Área de cada polígono (geodésica, esfera de R = 6 371 008,8 m) y distancia en línea recta hasta su borde más cercano (0 si el punto está dentro); cumple si alguno mide al menos ${u.areaMinM2} m² y está a ${u.distanciaM} m o menos. ${datos.origen === 'archivo' ? 'Datos congelados de OpenStreetMap (ODbL).' : `Datos de respaldo: consulta en vivo a Overpass en un radio de ${CONFIG.equipamiento.respaldoRadioM / 1000} km.`} Umbral: ${CONFIG.fuentesUmbral.areaVerde}.`,
    });
  }

  const sinDato = (error, umbralM) => ({
    estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM,
    fuente: CONFIG.equipamiento.fuente, fecha: null, metodo: 'No se pudo obtener el dato.', error,
  });

  // Calcula una variable; si falla la carga, devuelve SIN DATO con la causa en vez de romper las demás.
  async function variable(categoria, punto, calcular, resultadoVacio) {
    try {
      return calcular(await cargar(categoria, punto), punto);
    } catch (err) {
      console.error(`[Equipamiento] ${categoria}`, err);
      return resultadoVacio(err.message);
    }
  }

  /**
   * Evalúa las cuatro variables del equipamiento para el punto.
   * Devuelve { salud, educacion: { inicial, primaria, secundaria }, transporte, areaVerde }.
   * `transporte.rutas` agrega las líneas de SmartBus que pasan a ≤ CONFIG.umbrales.transporte del punto (Rutas.cerca): el paradero
   * de OpenStreetMap y los recorridos de SmartBus son dos fuentes distintas y no se mezclan.
   */
  async function evaluar(lat, lon) {
    const punto = { lat, lon };
    const u = CONFIG.umbrales;
    const [s, e, t, v, rutas] = await Promise.all([
      variable('salud', punto, salud, (m) => sinDato(m, u.salud)),
      variable('educacion', punto, educacion, (m) => Object.fromEntries(NIVELES.map((n) => [n, sinDato(m, u.educacion[n])]))),
      variable('transporte', punto, transporte, (m) => sinDato(m, u.transporte)),
      variable('areasVerdes', punto, areaVerde, (m) => ({ ...sinDato(m, u.areaVerde.distanciaM), areaM2: null, cumple1ha: false })),
      lineasCerca(punto),
    ]);
    return { salud: s, educacion: e, transporte: { ...t, rutas }, areaVerde: v };
  }

  /**
   * Los archivos congelados tal como se leyeron ({ features, fecha, origen }), o null si falta alguno. Los usa el asistente
   * de chat para buscar zonas: ahí no hay un punto alrededor del cual consultar Overpass en vivo, así que sin archivos no busca.
   */
  async function datosCongelados() {
    const categorias = ['salud', 'educacion', 'transporte', 'areasVerdes'];
    const lista = await Promise.all(categorias.map((c) => archivo(c)));
    if (lista.some((d) => !d)) return null;
    return Object.fromEntries(categorias.map((c, i) => [c, lista[i]]));
  }

  return { NIVELES, evaluar, datosCongelados, indiceRutas: cargarRutas };
})();
