/**
 * distritos.js — Distrito del punto y su zona sísmica según la Norma E.030.
 *
 * Fuentes (archivos locales):
 *   - data/distritos_aqp.geojson      → límites distritales (GEOCATMIN, con límites remitidos por el INEI),
 *                                       generado con scripts/descargar-distritos.mjs.
 *   - data/zonas_sismicas_e030.json   → Anexo II y Tabla N.° 1 de la Norma E.030 Diseño Sismorresistente 2026 (MVCS).
 *
 * La zona sísmica es regional (por distrito): no considera el suelo del predio. El efecto del suelo lo determina el
 * Estudio de Mecánica de Suelos que la propia E.030 exige a todo proyecto de edificación (Art. 16.1).
 * No hay datos simulados: si un archivo falta, se lanza un error con la causa.
 */
const Distritos = (() => {
  let ready = null;
  let index = []; // [{ props, bbox, polys }]
  let e030 = null;

  async function loadJson(url, nombre) {
    let res;
    try {
      res = await fetch(url);
    } catch (_) {
      throw new Error(`No se pudo leer ${nombre} (${url}).`);
    }
    if (!res.ok) throw new Error(`No se encontró ${nombre}: ${url} respondió HTTP ${res.status}.`);
    return res.json();
  }

  const polygonsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

  function bboxOf(polys) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    polys.forEach((rings) => (rings[0] || []).forEach(([x, y]) => {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }));
    return b;
  }

  // Ray casting; dentro del anillo exterior y fuera de los huecos.
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inPolygon = (x, y, rings) => rings.length > 0 && inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));

  /** Carga ambos archivos (una sola vez). Si falla, la siguiente llamada lo reintenta. */
  function load() {
    if (!ready) {
      ready = (async () => {
        const cfg = CONFIG.distritos;
        const [fc, tabla] = await Promise.all([loadJson(cfg.geojsonUrl, 'los límites distritales'), loadJson(cfg.e030Url, 'la tabla de la Norma E.030')]);
        if (!fc || !Array.isArray(fc.features)) throw new Error('El archivo de distritos no es un GeoJSON válido.');
        index = fc.features.map((f) => {
          const polys = polygonsOf(f.geometry);
          return { props: f.properties || {}, polys, bbox: bboxOf(polys) };
        });
        e030 = tabla;
        return { distritos: index.length };
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  /**
   * Distrito y zona sísmica del punto, o null si cae fuera de los distritos descargados.
   * Devuelve { distrito, provincia, ubigeo, fuenteLimite, zona, z, norma, definicionZ }; zona es null si el distrito
   * no figura en la transcripción del Anexo II (no debería pasar: el script de descarga lo impide).
   */
  async function lookup(lat, lon) {
    await load();
    const hit = index.find((d) => {
      const b = d.bbox;
      return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && d.polys.some((rings) => inPolygon(lon, lat, rings));
    });
    if (!hit) return null;
    const p = hit.props;
    const zona = e030.anexo_ii?.[p.departamento]?.[p.provincia]?.[p.distrito] ?? null;
    return {
      distrito: p.distrito,
      provincia: p.provincia,
      ubigeo: p.ubigeo,
      fuenteLimite: p.fuente_limite,
      zona,
      z: zona ? e030.z[String(zona)] : null,
      norma: e030.norma,
      definicionZ: e030.definicion_z,
    };
  }

  return { load, lookup };
})();
