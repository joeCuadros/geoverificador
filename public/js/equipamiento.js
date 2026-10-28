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
   */
  async function evaluar(lat, lon) {
    const punto = { lat, lon };
    const u = CONFIG.umbrales;
    const [s, e, t, v] = await Promise.all([
      variable('salud', punto, salud, (m) => sinDato(m, u.salud)),
      variable('educacion', punto, educacion, (m) => Object.fromEntries(NIVELES.map((n) => [n, sinDato(m, u.educacion[n])]))),
      variable('transporte', punto, transporte, (m) => sinDato(m, u.transporte)),
      variable('areasVerdes', punto, areaVerde, (m) => ({ ...sinDato(m, u.areaVerde.distanciaM), areaM2: null, cumple1ha: false })),
    ]);
    return { salud: s, educacion: e, transporte: t, areaVerde: v };
  }

  return { NIVELES, evaluar };
})();
