/**
 * equipamiento.js — Variables V2 a V5: salud, educación por nivel, transporte y área verde.
 *
 * Lee los archivos congelados de public/data/equipamiento (scripts/extraer-equipamiento.mjs) y calcula, para el punto
 * elegido, el elemento más cercano de cada variable y su veredicto con los umbrales de CONFIG.umbrales. Solo si falta
 * un archivo consulta Overpass en vivo (respaldo), alrededor del punto. Los cálculos están en calculos.js.
 *
 * Cada resultado trae { estado, nombre, distanciaM, umbralM, fuente, fecha, metodo, ... } con estado
 * CUMPLE | NO CUMPLE | SIN DATO. Las distancias son en línea recta, no recorrido a pie.
 *
 * Además, los servicios de la manzana según el censo (`censo`: alumbrado, agua y desagüe por red pública; INFORMATIVOS, cifras de 2017 de la manzana, no del predio).
 *
 * Además, la electricidad (`electricidad`: ¿dentro de un área de concesión de distribución?, INFORMATIVA y sin umbral; una concesión no es una conexión).
 *
 * Además, las tres necesidades de comercio (`abastecimiento`, `compras_ocio`, `comercio_barrio`; ver Calculos.COMERCIO): INFORMATIVAS como el consultorio (sin umbral;
 * del polígono de un mall se mide la distancia al borde).
 *
 * Además, el consultorio médico más cercano (`consultorio`): una categoría APARTE de la salud, INFORMATIVA (sin umbral: la distancia
 * de referencia es una decisión pendiente; estado INFORMATIVO | SIN DATO). La salud se evalúa solo con establecimientos.
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
      const meta = fc.metadata || {};
      return {
        features: fc.features,
        fecha: meta.fecha_extraccion || meta.fecha_descarga || null, // OpenStreetMap trae la fecha de extracción; las concesiones eléctricas, la de descarga
        origen: 'archivo',
        fuente: meta.fuente || null, // p. ej. «RENIPRESS (SUSALUD) (fuente primaria) y OpenStreetMap (ODbL, respaldo)»
        fuentes: Array.isArray(meta.fuentes) ? meta.fuentes : null, // [{ rol: 'primaria' | 'respaldo', id, nombre, fecha }]
        radioDedupM: (meta.deduplicacion && meta.deduplicacion.radio_m) || null,
      };
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
    const features = Calculos.osmAFeatures(r.data.elements, modo).filter((f) => Calculos.categoriasDe(f.properties.tags, f.properties.nombre).includes(categoria));
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

  /**
   * Candidato de salud o de educación: además dice de qué fuente es (RENIPRESS, ESCALE u OSM) y su código oficial. En educación,
   * `nivel` elige la institución del local de ESCALE cuyo nombre, código modular y gestión se muestran.
   */
  const candidatoConFuente = (f, etiqueta, nivel) => {
    const o = Calculos.origenDe(f.properties, nivel);
    return { ...candidato(f, etiqueta), nombre: o.nombre, fuente: o.fuente, codigo: o.codigo, categoria: o.categoria, gestion: o.gestion };
  };

  /** De dónde salen los datos del archivo: la fuente primaria con su fecha y OpenStreetMap solo como respaldo. */
  const origenDeLosDatos = (datos) => {
    if (datos.origen !== 'archivo') return `Datos de respaldo: no se encontró el archivo local, así que se consultó Overpass en vivo en un radio de ${CONFIG.equipamiento.respaldoRadioM / 1000} km.`;
    const primaria = (datos.fuentes || []).find((x) => x.rol === 'primaria');
    if (!primaria) return 'Datos congelados de OpenStreetMap (ODbL).';
    const respaldo = (datos.fuentes || []).find((x) => x.rol === 'respaldo');
    const radio = datos.radioDedupM ? ` a ${datos.radioDedupM} m` : '';
    return `Datos congelados de ${primaria.nombre}${primaria.fecha ? ` (${primaria.fecha})` : ''}, fuente primaria, y de OpenStreetMap (ODbL${respaldo && respaldo.fecha ? `, ${respaldo.fecha}` : ''}), solo como respaldo donde no hay un punto oficial${radio}.`;
  };

  const metodoBase = (datos, que) => `Distancia en línea recta (haversine, R = 6 371 008,8 m) hasta ${que} más cercano. ${origenDeLosDatos(datos)}`;

  const comunes = (datos, umbralM, fuenteUmbral, metodo) => ({
    umbralM,
    fuente: datos.fuente || CONFIG.equipamiento.fuente,
    fecha: datos.fecha,
    metodo: `${metodo} Umbral de ${umbralM} m: ${fuenteUmbral}.`,
    alcanceM: datos.alcanceM,
  });

  function salud(datos, punto) {
    const u = CONFIG.umbrales.salud;
    return Calculos.evaluarMasCercano(
      punto,
      datos.features.map((f) => candidatoConFuente(f, Calculos.etiquetaElemento(f.properties, 'salud'))),
      comunes(datos, u, CONFIG.fuentesUmbral.salud, metodoBase(datos, 'el establecimiento de salud (hospital, clínica, centro o puesto de salud, policlínico o healthcare=*; el consultorio médico es otra categoría)')),
    );
  }

  /** Consultorio médico más cercano: INFORMATIVO. No hay umbral (CONFIG.umbrales.consultorio es null), así que no hay cumple / no cumple. */
  function consultorio(datos, punto) {
    return Calculos.evaluarMasCercano(
      punto,
      datos.features.map((f) => candidatoConFuente(f, Calculos.etiquetaElemento(f.properties, 'consultorios'))),
      {
        umbralM: CONFIG.umbrales.consultorio,
        fuente: datos.fuente || CONFIG.equipamiento.fuente,
        fecha: datos.fecha,
        metodo: `${metodoBase(datos, 'el consultorio médico')} Sin umbral: ${CONFIG.fuentesUmbral.consultorio}.`,
      },
    );
  }

  /**
   * Una necesidad de comercio (abastecimiento | compras_ocio | comercio_barrio): INFORMATIVA. No hay umbral (CONFIG.umbrales.* son null), así que no
   * hay cumple / no cumple. Los elementos pueden ser puntos o polígonos: del polígono se mide la distancia al BORDE (0 si el punto está dentro).
   *   archivos: los archivos de los que sale la necesidad (para la fuente, la fecha y de dónde son los datos).
   */
  function comercio(id, archivosDe, features, punto, umbralM = CONFIG.umbrales[id], que = Calculos.COMERCIO[id].singular) {
    const def = Calculos.COMERCIO[id];
    const datos = archivosDe[0];
    const fechas = archivosDe.map((d) => d.fecha).filter(Boolean).sort();
    return Calculos.evaluarMasCercanoForma(punto, features, {
      umbralM,
      fuente: datos.fuente || CONFIG.equipamiento.fuente,
      fecha: fechas.length ? fechas[fechas.length - 1] : null,
      metodo: `Distancia en línea recta hasta el ${que} más cercano; si es un polígono, hasta su borde (0 si el punto está dentro). ${origenDeLosDatos(datos)} ${def.alcance} Sin umbral: ${CONFIG.fuentesUmbral[id]}.`,
    });
  }

  function transporte(datos, punto) {
    const u = CONFIG.umbrales.transporte;
    return Calculos.evaluarMasCercano(
      punto,
      datos.features.map((f) => candidato(f, Calculos.etiquetaDe(f.properties.tags, 'transporte'))),
      comunes(datos, u, CONFIG.fuentesUmbral.transporte, metodoBase(datos, 'el paradero de transporte público')),
    );
  }

  /** Un resultado por nivel. Regla de niveles: los del local de ESCALE o, para OpenStreetMap, Calculos.nivelesEducativos (documentada allí). */
  function educacion(datos, punto) {
    const out = {};
    NIVELES.forEach((nivel) => {
      const u = CONFIG.umbrales.educacion[nivel];
      const candidatos = datos.features
        .filter((f) => Calculos.nivelesDe(f.properties).includes(nivel))
        .map((f) => {
          const t = f.properties.tags || {};
          const asumido = t.amenity === 'school' && !t['isced:level'] && !t.school;
          const etiqueta = Calculos.etiquetaElemento(f.properties, 'educacion');
          return candidatoConFuente(f, etiqueta && `${etiqueta}${asumido ? ' (sin etiqueta de nivel: se asume primaria o secundaria)' : ''}`, nivel);
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

  /** El consultorio más cercano, sin respaldo en vivo: es un dato informativo y no vale una consulta a Overpass. Nunca rechaza. */
  async function consultorioCercano(punto) {
    try {
      const datos = await archivo('consultorios');
      return datos ? consultorio(datos, punto) : sinDato('No se encontró el archivo de consultorios médicos.', CONFIG.umbrales.consultorio);
    } catch (err) {
      console.error('[Equipamiento] consultorios', err);
      return sinDato(err.message, CONFIG.umbrales.consultorio);
    }
  }

  /**
   * Las tres necesidades de comercio para el punto, sin respaldo en vivo: son datos informativos y no valen una consulta a Overpass. Nunca rechaza.
   * Cada una pide los archivos de los que sale (abastecimiento: mercados y supermercados; compras_ocio y comercio_barrio: malls); si falta alguno, esa necesidad
   * dice SIN DATO en vez de calcularse con la mitad. El abastecimiento suma además el más cercano de cada tipo (`porTipo`: mercado y supermercado).
   */
  async function comercioPorNecesidad(punto) {
    const ids = Object.keys(Calculos.COMERCIO);
    let leidos;
    try {
      const nombres = Object.values(Calculos.COMERCIO_TIPO).map((t) => t.capa);
      leidos = Object.fromEntries(await Promise.all(nombres.map(async (c) => [c, await archivo(c)])));
    } catch (err) {
      console.error('[Equipamiento] comercio', err);
      return Object.fromEntries(ids.map((id) => [id, sinDato(err.message, CONFIG.umbrales[id])]));
    }
    const grupos = Calculos.agruparComercio(Object.fromEntries(Object.entries(leidos).map(([c, d]) => [c, d ? d.features : []])));
    const out = {};
    for (const id of ids) {
      const def = Calculos.COMERCIO[id];
      const faltan = def.capas.filter((c) => !leidos[c]);
      if (faltan.length) {
        out[id] = sinDato(`No se encontró el archivo de ${faltan.map((c) => Object.values(Calculos.COMERCIO_TIPO).find((x) => x.capa === c).plural).join(' ni de ')}.`, CONFIG.umbrales[id]);
        continue;
      }
      const archivosDe = def.capas.map((c) => leidos[c]);
      try {
        out[id] = comercio(id, archivosDe, grupos[id], punto);
        if (id === 'abastecimiento') {
          out[id].porTipo = Object.fromEntries(['mercado', 'supermercado'].map((tipo) => {
            const t = Calculos.COMERCIO_TIPO[tipo];
            return [tipo, comercio(id, [leidos[t.capa]], grupos[id].filter((f) => f.properties.tipo === tipo), punto, CONFIG.umbrales[tipo], t.singular)];
          }));
        }
      } catch (err) {
        console.error(`[Equipamiento] ${id}`, err);
        out[id] = sinDato(err.message, CONFIG.umbrales[id]);
      }
    }
    return out;
  }

  /**
   * ¿El punto está dentro de un área de concesión de distribución eléctrica (MINEM-DGE)? INFORMATIVO, sin respaldo en vivo. Nunca rechaza.
   * Dentro de una concesión NO es tener una conexión: ver Calculos.NOTA_ELECTRICIDAD.
   */
  async function electricidadPorConcesion(punto) {
    const metodoSin = (datos) => `Se comprueba si el punto cae dentro de algún polígono de concesión de distribución eléctrica (punto en polígono; un hueco queda fuera) y, si no, la distancia en línea recta hasta el borde de la más cercana. ${datos ? 'Datos congelados del MINEM (Dirección General de Electricidad), licencia ODC-By.' : 'No se encontró el archivo de concesiones.'} Sin umbral: ${CONFIG.fuentesUmbral.electricidad}. Esto no dice que el predio esté conectado.`;
    try {
      const datos = await archivo('electricidad');
      const r = Calculos.evaluarConcesion(punto, datos ? datos.features : [], {
        fuente: datos && datos.fuente ? datos.fuente : 'MINEM (Dirección General de Electricidad), Concesiones de Distribución Eléctrica',
        fecha: datos ? datos.fecha : null,
        metodo: metodoSin(datos),
      });
      return datos ? r : { ...r, error: 'No se encontró el archivo de concesiones eléctricas.' };
    } catch (err) {
      console.error('[Equipamiento] electricidad', err);
      return { ...Calculos.evaluarConcesion(punto, [], { metodo: metodoSin(null) }), error: err.message };
    }
  }

  /**
   * ¿El punto cae dentro de una concesión minera (Catastro Minero de INGEMMET)? INFORMATIVO, sin respaldo en vivo. Nunca rechaza. Un derecho a explorar y explotar los minerales
   * no es minería en el predio: ver Calculos.NOTA_MINERA.
   */
  async function mineriaPorPunto(punto) {
    const metodo = (datos) => `Se comprueba si el punto cae dentro de algún polígono del Catastro Minero de INGEMMET (punto en polígono; las concesiones extinguidas no cuentan) y, si no, la distancia en línea recta hasta el borde de la más cercana. ${datos ? 'Datos congelados del catastro, que es referencial y se actualiza a diario.' : 'No se encontró el archivo del Catastro Minero.'} ${CONFIG.fuentesUmbral.mineria}.`;
    try {
      const datos = await archivo('mineria');
      const r = Calculos.evaluarMinera(punto, datos ? datos.features : [], { fuente: datos && datos.fuente ? datos.fuente : 'INGEMMET, Catastro Minero (GEOCATMIN)', fecha: datos ? datos.fecha : null, metodo: metodo(datos) });
      return datos ? r : { ...r, error: 'No se encontró el archivo del Catastro Minero.' };
    } catch (err) {
      console.error('[Equipamiento] mineria', err);
      return { ...Calculos.evaluarMinera(punto, [], { metodo: metodo(null) }), error: err.message };
    }
  }

  // ------------------------------------------------------------- Censo por manzana

  const jsonCensos = new Map(); // url → promesa con el JSON (o null si falta): el índice y las piezas por distrito se leen una sola vez
  function leerJson(url) {
    if (!jsonCensos.has(url)) {
      jsonCensos.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
        if (!d) jsonCensos.delete(url); // si falló, la próxima vez se reintenta
        return d;
      }));
    }
    return jsonCensos.get(url);
  }

  /**
   * Los servicios de la manzana del punto según el censo (INEI, REDATAM): INFORMATIVO, sin respaldo en vivo. Lee el índice y SOLO la pieza del distrito cuya caja
   * contiene el punto (un punto pegado al límite puede traer dos). Nunca rechaza. Son cifras de la manzana en el año del censo, no del predio.
   */
  async function censoPorManzana(punto) {
    const c = CONFIG.censo;
    const metodo = (indice) => `Se busca la manzana del censo ${c.anio} (INEI) que contiene el punto (o la más cercana a ${c.manzanaCercanaM} m o menos, si está en la calle) y se dan sus conteos de viviendas ocupadas con personas presentes: porcentaje con alumbrado eléctrico, agua y servicio higiénico por red pública. ${indice ? `Datos congelados de REDATAM, descargados el ${indice.fecha_descarga || 'sin fecha'}.` : 'No se encontró el archivo del censo por manzana.'} ${CONFIG.fuentesUmbral.censo}. Esto no dice cómo está un predio en particular ni cómo está hoy.`;
    const opc = (indice, extra = {}) => ({ anio: c.anio, fuente: (indice && indice.fuente) || 'INEI, Censos Nacionales 2017 (REDATAM)', fecha: (indice && indice.fecha_descarga) || null, metodo: metodo(indice), cercanaM: c.manzanaCercanaM, minViviendas: c.minViviendasPct, ...extra });
    try {
      const indice = await leerJson(c.indiceUrl);
      if (!indice || !Array.isArray(indice.distritos)) return Calculos.evaluarManzana(punto, [], opc(null, { motivoVacio: 'sin_archivo' }));
      const mLat = c.manzanaCercanaM / ((Math.PI / 180) * Calculos.RADIO_TIERRA_M);
      const mLon = mLat / Math.max(0.2, Math.cos((punto.lat * Math.PI) / 180));
      const piezas = indice.distritos.filter((d) => punto.lon >= d.caja[0] - mLon && punto.lon <= d.caja[2] + mLon && punto.lat >= d.caja[1] - mLat && punto.lat <= d.caja[3] + mLat);
      if (piezas.length === 0) return Calculos.evaluarManzana(punto, [], opc(indice, { motivoVacio: 'fuera_de_manzanas' }));
      const cargadas = await Promise.all(piezas.map((d) => leerJson(`${c.carpetaUrl}${d.archivo}`)));
      if (cargadas.some((x) => !x)) return Calculos.evaluarManzana(punto, [], opc(indice, { motivoVacio: 'sin_archivo' }));
      return Calculos.evaluarManzana(punto, cargadas.flatMap((x) => x.features), opc(indice));
    } catch (err) {
      console.error('[Equipamiento] censo', err);
      return Calculos.evaluarManzana(punto, [], opc(null, { motivoVacio: 'sin_archivo' }));
    }
  }

  /**
   * Evalúa las variables del equipamiento para el punto.
   * Devuelve { salud, consultorio, abastecimiento, compras_ocio, comercio_barrio (las tres necesidades de comercio, informativas: ver Calculos.COMERCIO; `abastecimiento.porTipo` trae el mercado y el supermercado más cercanos), electricidad (informativa: área de concesión eléctrica; ver Calculos.evaluarConcesion), educacion: { inicial, primaria, secundaria }, transporte, areaVerde }.
   * `transporte.rutas` agrega las líneas de SmartBus que pasan a ≤ CONFIG.umbrales.transporte del punto (Rutas.cerca): el paradero
   * de OpenStreetMap y los recorridos de SmartBus son dos fuentes distintas y no se mezclan.
   */
  async function evaluar(lat, lon) {
    const punto = { lat, lon };
    const u = CONFIG.umbrales;
    const [s, c, e, t, v, rutas, comercioNecesidades, elec, cen, min] = await Promise.all([
      variable('salud', punto, salud, (m) => sinDato(m, u.salud)),
      consultorioCercano(punto),
      variable('educacion', punto, educacion, (m) => Object.fromEntries(NIVELES.map((n) => [n, sinDato(m, u.educacion[n])]))),
      variable('transporte', punto, transporte, (m) => sinDato(m, u.transporte)),
      variable('areasVerdes', punto, areaVerde, (m) => ({ ...sinDato(m, u.areaVerde.distanciaM), areaM2: null, cumple1ha: false })),
      lineasCerca(punto),
      comercioPorNecesidad(punto),
      electricidadPorConcesion(punto),
      censoPorManzana(punto),
      mineriaPorPunto(punto),
    ]);
    return { salud: s, consultorio: c, ...comercioNecesidades, electricidad: elec, censo: cen, mineria: min, educacion: e, transporte: { ...t, rutas }, areaVerde: v };
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

  /** El archivo de consultorios tal como se leyó ({ features, fecha, origen }), o null si falta: es informativo y la búsqueda de zonas no lo necesita. */
  async function consultorios() {
    try {
      return await archivo('consultorios');
    } catch (_) {
      return null;
    }
  }

  /** Los archivos de mercados, supermercados y malls tal como se leyeron: { mercados, supermercados, malls }, cada uno { features, fecha, origen } o null si falta. */
  async function comercioDatos() {
    const ids = Object.values(Calculos.COMERCIO_TIPO).map((d) => d.capa);
    const lista = await Promise.all(ids.map((c) => archivo(c).catch(() => null)));
    return Object.fromEntries(ids.map((c, i) => [c, lista[i]]));
  }

  return { NIVELES, evaluar, datosCongelados, consultorios, comercio: comercioDatos, indiceRutas: cargarRutas };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Equipamiento;
