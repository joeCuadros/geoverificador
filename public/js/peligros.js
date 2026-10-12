/**
 * peligros.js — Peligros geológicos registrados cerca del punto elegido.
 *
 * Fuente: inventario de peligros geológicos de GEOCATMIN (INGEMMET), descargado con
 * scripts/descargar-peligros.mjs a data/peligros_aqp.geojson. Los nombres de tipo y subtipo son los
 * del diccionario oficial de la capa; lo que el diccionario no define queda como «sin clasificar».
 *
 * Importante para interpretar el resultado: es un INVENTARIO de eventos documentados (caídas de roca,
 * flujos de detritos, erosión, inundaciones…), no un mapa de susceptibilidad. Que no haya registros
 * cerca NO significa que el lugar sea seguro: solo que nadie documentó un evento ahí.
 *
 * Son 394 puntos, así que las distancias se calculan contra todos (no hace falta índice espacial).
 * No hay datos simulados: si el archivo falta o está mal formado, se lanza un error con la causa.
 */
const Peligros = (() => {
  let ready = null; // promesa de carga (se comparte entre llamadas)
  let lista = []; // [{ lat, lon, tipo, subtipo, distrito, sector, anio, fuente }]
  let meta = null;
  let capaMarcas = null;

  /** Carga el archivo (una sola vez). Si falla, la siguiente llamada lo reintenta. */
  function load() {
    if (!ready) {
      ready = (async () => {
        const cfg = CONFIG.peligros;
        let res;
        try {
          res = await fetch(cfg.geojsonUrl);
        } catch (_) {
          throw new Error(`No se pudo leer el archivo de peligros (${cfg.geojsonUrl}).`);
        }
        if (!res.ok) {
          throw new Error(`No se encontró ${cfg.geojsonUrl} (HTTP ${res.status}). Genera el archivo con: node scripts/descargar-peligros.mjs`);
        }
        let fc;
        try {
          fc = await res.json();
        } catch (_) {
          throw new Error(`${cfg.geojsonUrl} no es un JSON válido.`);
        }
        if (!fc || !Array.isArray(fc.features) || !fc.metadata) {
          throw new Error('El archivo de peligros no tiene el formato esperado (falta `features` o `metadata`).');
        }
        lista = fc.features
          .filter((f) => f.geometry && f.geometry.type === 'Point')
          .map((f) => {
            const p = f.properties || {};
            return {
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
              tipo: p.tipo || 'Sin clasificar',
              subtipo: p.subtipo || null,
              distrito: p.distrito || null,
              sector: p.sector || null,
              anio: p.anio || null,
              fuente: p.fuente || null,
            };
          });
        if (lista.length === 0) throw new Error('El archivo de peligros no tiene registros.');
        meta = {
          fuente: fc.metadata.fuente,
          registros: lista.length,
          anioDesde: fc.metadata.anioDesde,
          anioHasta: fc.metadata.anioHasta,
        };
        return meta;
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  /**
   * Peligros dentro de `radio` metros y el más cercano de todos.
   * Devuelve { radio, total, porTipo: [[tipo, n]…] (de más a menos), masCercano: { …, distancia }, meta }.
   */
  async function indicador(lat, lon) {
    await load();
    const radio = CONFIG.peligros.radio;
    const porTipo = {};
    let total = 0;
    let masCercano = null;
    for (const p of lista) {
      const distancia = Geo.haversine(lat, lon, p.lat, p.lon);
      if (!masCercano || distancia < masCercano.distancia) masCercano = { ...p, distancia };
      if (distancia <= radio) {
        total++;
        porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1;
      }
    }
    return { radio, total, porTipo: Object.entries(porTipo).sort((a, b) => b[1] - a[1]), masCercano, meta };
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Capa de Leaflet con cada peligro registrado como un círculo; el popup dice qué es y de dónde sale. */
  async function capa(pane) {
    await load();
    if (!capaMarcas) {
      capaMarcas = L.layerGroup(
        lista.map((p) =>
          L.circleMarker([p.lat, p.lon], { pane, bubblingMouseEvents: false, radius: 5, color: '#7c2d12', weight: 1, fillColor: '#ea580c', fillOpacity: 0.85 }).bindPopup(
            `<strong>${esc(p.subtipo || p.tipo)}</strong><br>
            ${p.subtipo ? `Tipo: ${esc(p.tipo)}<br>` : ''}
            ${p.sector ? `Sector: ${esc(p.sector)}<br>` : ''}
            ${p.distrito ? `Distrito: ${esc(p.distrito)}<br>` : ''}
            Registrado: ${p.anio ? esc(p.anio) : 'año sin dato'} · Fuente: ${esc(p.fuente || 'sin dato')}<br>
            <small>Inventario de INGEMMET (GEOCATMIN). Un registro = un evento documentado, no una predicción.</small>`,
          ),
        ),
      );
    }
    return capaMarcas;
  }

  return { load, indicador, capa };
})();
