/**
 * delitos.js — Denuncias de robo y hurto alrededor del punto elegido.
 *
 * Fuente: Mapa del Delito Georreferenciado (MININTER), datos del SIDPOL de la PNP,
 * descargados con scripts/descargar-delitos.mjs a data/delitos_aqp.geojson.
 * Solo trae denuncias con coordenada real (ESTADO_COORD = 'INVERTIDA'); ver el script.
 *
 * El indicador es agregado: cuántas denuncias hay a menos de `radio` metros en los últimos 12 meses
 * del archivo, y qué tan alto es ese número frente al resto de la ciudad (percentil).
 * «Resto de la ciudad» = una cuadrícula de puntos cada `paso` metros dentro de las zonas
 * construibles del plano de zonificación (se excluyen zona agrícola, reservas y zonas de riesgo).
 *
 * Todo se calcula en el navegador con archivos locales. No hay datos simulados:
 * si el archivo falta o está mal formado, se lanza un error con la causa.
 */
const Delitos = (() => {
  let ready = null; // promesa de carga (se comparte entre llamadas)
  let meta = null; // { fuente, desde, hasta, ventanaDesde, registros, enVentana }
  let pts = []; // denuncias dentro de la ventana: [{ lat, lon, subtipo }]
  let celdas = new Map(); // índice espacial: "i|j" → [puntos]
  let referencia = null; // promesa con los conteos ordenados de la cuadrícula de la ciudad

  const TAM_CELDA = 0.005; // grados (~550 m): con radio 500 m basta mirar la celda y sus 8 vecinas
  const claveCelda = (i, j) => `${i}|${j}`;
  const celdaDe = (lat, lon) => [Math.floor(lat / TAM_CELDA), Math.floor(lon / TAM_CELDA)];

  // "2026-07-31" → "2025-08-01": primer día de la ventana de 12 meses que termina en `hasta`.
  function inicioVentana(hasta) {
    const [a, m] = hasta.split('-').map(Number);
    const d = new Date(Date.UTC(a - 1, m, 1)); // mes siguiente, un año antes (Date.UTC usa meses 0-11)
    return d.toISOString().slice(0, 10);
  }

  /** Carga el archivo (una sola vez). Si falla, la siguiente llamada lo reintenta. */
  function load() {
    if (!ready) {
      ready = (async () => {
        const cfg = CONFIG.delitos;
        let res;
        try {
          res = await fetch(cfg.geojsonUrl);
        } catch (_) {
          throw new Error(`No se pudo leer el archivo de denuncias (${cfg.geojsonUrl}).`);
        }
        if (!res.ok) {
          throw new Error(`No se encontró ${cfg.geojsonUrl} (HTTP ${res.status}). Genera el archivo con: node scripts/descargar-delitos.mjs`);
        }
        let fc;
        try {
          fc = await res.json();
        } catch (_) {
          throw new Error(`${cfg.geojsonUrl} no es un JSON válido.`);
        }
        if (!fc || !Array.isArray(fc.features) || !fc.metadata || !fc.metadata.hasta) {
          throw new Error('El archivo de denuncias no tiene el formato esperado (falta `features` o `metadata.hasta`).');
        }

        const hasta = fc.metadata.hasta;
        const desde = inicioVentana(hasta);
        const lista = [];
        const idx = new Map();
        fc.features.forEach((f) => {
          const p = f.properties || {};
          const c = f.geometry && f.geometry.coordinates;
          if (!c || !p.fecha || p.fecha < desde || p.fecha > hasta) return;
          const d = { lat: c[1], lon: c[0], subtipo: p.subtipo };
          lista.push(d);
          const k = claveCelda(...celdaDe(d.lat, d.lon));
          if (!idx.has(k)) idx.set(k, []);
          idx.get(k).push(d);
        });
        if (lista.length === 0) throw new Error(`El archivo de denuncias no tiene registros entre ${desde} y ${hasta}.`);

        pts = lista;
        celdas = idx;
        meta = {
          fuente: fc.metadata.fuente,
          desde: fc.metadata.desde,
          hasta,
          ventanaDesde: desde,
          registros: fc.features.length,
          enVentana: lista.length,
        };
        return meta;
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  // Denuncias a menos de `radio` metros, separadas por subtipo.
  function contar(lat, lon, radio) {
    const [i0, j0] = celdaDe(lat, lon);
    const out = { total: 0, ROBO: 0, HURTO: 0 };
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        const lista = celdas.get(claveCelda(i, j));
        if (!lista) continue;
        for (const d of lista) {
          if (Geo.haversine(lat, lon, d.lat, d.lon) > radio) continue;
          out.total++;
          if (d.subtipo in out) out[d.subtipo]++;
        }
      }
    }
    return out;
  }

  /**
   * Cuadrícula de referencia: un punto cada `paso` metros dentro de las zonas construibles del plano.
   * Devuelve (promesa) los conteos ordenados de menor a mayor. Se calcula una sola vez.
   */
  function cargarReferencia() {
    if (!referencia) {
      referencia = calcularReferencia().catch((err) => {
        referencia = null;
        throw err;
      });
    }
    return referencia;
  }

  async function calcularReferencia() {
    const cfg = CONFIG.delitos;
    const [oeste, norte, este, sur] = CONFIG.viewbox.split(',').map(Number);
    const latMedia = (norte + sur) / 2;
    const dLat = cfg.paso / 111320;
    const dLon = cfg.paso / (111320 * Math.cos((latMedia * Math.PI) / 180));
    const conteos = [];
    for (let lat = sur; lat <= norte; lat += dLat) {
      for (let lon = oeste; lon <= este; lon += dLon) {
        const z = await Zonificacion.lookup(lat, lon);
        if (!z || !z.regla || z.regla.edificable === 'no') continue;
        conteos.push(contar(lat, lon, cfg.radio).total);
      }
    }
    if (conteos.length === 0) throw new Error('No se pudo armar la cuadrícula de referencia: ningún punto cayó en una zona construible.');
    return conteos.sort((a, b) => a - b);
  }

  // Porcentaje de puntos de referencia con MENOS denuncias que `n` (los empates cuentan la mitad).
  function percentil(ref, n) {
    let menores = 0;
    let iguales = 0;
    for (const v of ref) {
      if (v < n) menores++;
      else if (v === n) iguales++;
      else break;
    }
    // Tope en 99: «más que el 100 %» no tiene sentido si el punto empata con el máximo.
    return Math.min(99, Math.round((100 * (menores + iguales / 2)) / ref.length));
  }

  const mediana = (ref) => ref[Math.floor(ref.length / 2)];

  /**
   * Indicador para un punto:
   *   { radio, conteo: { total, ROBO, HURTO }, percentil, mediana, puntosReferencia, meta }
   */
  async function indicador(lat, lon) {
    await Promise.all([load(), Zonificacion.load()]);
    const ref = await cargarReferencia();
    const conteo = contar(lat, lon, CONFIG.delitos.radio);
    return {
      radio: CONFIG.delitos.radio,
      conteo,
      percentil: percentil(ref, conteo.total),
      mediana: mediana(ref),
      puntosReferencia: ref.length,
      meta,
    };
  }

  return { load, indicador };
})();
