/**
 * zonificacion.js — Zonificación urbana del punto elegido.
 *
 * Fuente: Plano de Zonificación del PDM Arequipa 2016-2025 (Ordenanza 975), convertido a GeoJSON.
 *   - data/zonas_aqp.geojson  → polígonos con `codigo` (RDM-2, CZ, ZA…) y `color` (el del plano).
 *   - data/reglas_zonas.json  → reglas por código (pisos, coeficiente, área libre, lote mínimo…).
 *
 * Son archivos locales: se cargan una sola vez y la búsqueda se hace en el navegador,
 * así que consultar la zona de un punto no envía ninguna solicitud a servicios externos.
 * No hay datos simulados: si un archivo falta, se lanza un error con la causa.
 */
const Zonificacion = (() => {
  let ready = null; // promesa de carga (se comparte entre llamadas)
  let geojson = null;
  let reglas = {};
  let index = []; // [{ feature, codigo, color, bbox, polys }]

  async function loadJson(url, nombre) {
    let res;
    try {
      res = await fetch(url);
    } catch (_) {
      throw new Error(`No se pudo leer ${nombre} (${url}).`);
    }
    if (!res.ok) {
      throw new Error(`No se encontró ${nombre}: ${url} respondió HTTP ${res.status}. Copia el archivo a public/${url}.`);
    }
    try {
      return await res.json();
    } catch (_) {
      throw new Error(`${nombre} (${url}) no es un JSON válido.`);
    }
  }

  // Polygon → [anillos]; MultiPolygon → [[anillos], [anillos]…]. Se normaliza a lista de polígonos.
  function polygonsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }

  function bboxOf(polys) {
    const b = [Infinity, Infinity, -Infinity, -Infinity]; // oeste, sur, este, norte
    polys.forEach((rings) => {
      (rings[0] || []).forEach(([x, y]) => {
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
      });
    });
    return b;
  }

  function buildIndex(fc) {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
      throw new Error('El archivo de zonas no es un GeoJSON de tipo FeatureCollection.');
    }
    const out = [];
    fc.features.forEach((feature) => {
      const polys = polygonsOf(feature.geometry);
      const props = feature.properties || {};
      if (polys.length === 0 || !props.codigo) return;
      out.push({ feature, codigo: String(props.codigo), color: props.color || '#888888', bbox: bboxOf(polys), polys });
    });
    if (out.length === 0) throw new Error('El archivo de zonas no tiene polígonos con el campo «codigo».');
    return out;
  }

  /** Carga los dos archivos (una sola vez). Si falla, la siguiente llamada lo reintenta. */
  function load() {
    if (!ready) {
      ready = (async () => {
        const cfg = CONFIG.zonificacion;
        const [fc, rg] = await Promise.all([
          loadJson(cfg.geojsonUrl, 'el mapa de zonas'),
          loadJson(cfg.reglasUrl, 'la tabla de reglas'),
        ]);
        index = buildIndex(fc);
        geojson = fc;
        reglas = rg;
        return { zonas: index.length, codigos: Object.keys(rg).length };
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  // ¿(x, y) está dentro del anillo? (ray casting; x = longitud, y = latitud)
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Dentro del anillo exterior y fuera de todos los huecos.
  function inPolygon(x, y, rings) {
    if (!rings.length || !inRing(x, y, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k])) return false;
    return true;
  }

  /**
   * Zona que contiene el punto, o null si cae fuera del área zonificada.
   * Si dos polígonos se superponen, gana el último del archivo: es el que el plano dibuja encima.
   * Devuelve { codigo, color, regla, feature, coincidencias, borde }. `regla` es null si el código no está en la tabla.
   * `borde` es la alerta de borde (Calculos.alertaBorde): { alerta, codigo, distanciaM, umbralM }, con alerta = true si un
   * polígono de OTRA zona queda a CONFIG.umbrales.bordeZona metros o menos del punto.
   */
  async function lookup(lat, lon) {
    await load();
    let hit = null;
    let coincidencias = 0;
    for (const z of index) {
      const b = z.bbox;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (z.polys.some((rings) => inPolygon(lon, lat, rings))) {
        hit = z;
        coincidencias++;
      }
    }
    if (!hit) return null;
    const borde = Calculos.alertaBorde({ lat, lon }, index, hit.codigo, CONFIG.umbrales.bordeZona);
    return { codigo: hit.codigo, color: hit.color, regla: reglas[hit.codigo] || null, feature: hit.feature, coincidencias, borde };
  }

  // "35-40" → [35, 40]; 40 → [40, 40]; vacío → null
  function rango(v) {
    if (v === null || v === undefined || v === '') return null;
    const nums = String(v).split('-').map(Number).filter((n) => Number.isFinite(n));
    if (nums.length === 0) return null;
    return [Math.min(...nums), Math.max(...nums)];
  }

  /**
   * Potencial de un lote según la regla de su zona.
   *   construible: [base, máximo] en m² techados = área del lote × coeficiente de edificación
   *   ocupable:    [mínimo, máximo] en m² de primer piso = área del lote × (1 − área libre)
   * Devuelve null si la zona no tiene coeficiente (no construible o sujeta a consulta).
   */
  function potencial(regla, areaLote) {
    if (!regla || regla.edificable !== 'si' || !(areaLote > 0)) return null;
    if (typeof regla.coef_base !== 'number') return null;
    const coefMax = typeof regla.coef_max === 'number' ? regla.coef_max : regla.coef_base;
    const libre = rango(regla.area_libre_pct);
    return {
      construible: [areaLote * regla.coef_base, areaLote * coefMax],
      ocupable: libre ? [areaLote * (1 - libre[1] / 100), areaLote * (1 - libre[0] / 100)] : null,
      bajoLoteMinimo: typeof regla.lote_min_m2 === 'number' && areaLote < regla.lote_min_m2,
    };
  }

  const estilo = (f) => ({
    color: '#333333',
    weight: 0.6,
    fillColor: (f.properties && f.properties.color) || '#888888',
    fillOpacity: 0.45,
  });

  /**
   * Capa de Leaflet con todo el plano, pintada con los colores originales.
   * Se dibuja en canvas (son cientos de polígonos) dentro del panel indicado y no intercepta los clics del mapa.
   */
  async function capa(pane) {
    await load();
    return L.geoJSON(geojson, { style: estilo, interactive: false, pane, renderer: L.canvas({ pane, padding: 0.3 }) });
  }

  /** Contorno resaltado de una zona (la del punto elegido). */
  function contorno(feature) {
    return L.geoJSON(feature, {
      style: { color: '#111827', weight: 3, dashArray: '6 4', fill: false },
      interactive: false,
    });
  }

  /** Tabla de reglas por código (vacía hasta que load() termina). */
  const tablaReglas = () => reglas;

  return { load, lookup, potencial, rango, capa, contorno, reglas: tablaReglas };
})();
