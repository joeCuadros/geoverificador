/**
 * delitos.js — Denuncias de robo y hurto alrededor del punto elegido.
 *
 * Fuente: Mapa del Delito Georreferenciado (MININTER), datos del SIDPOL de la PNP,
 * descargados con scripts/descargar-delitos.mjs a data/delitos_aqp.geojson.
 * Solo trae denuncias con coordenada real (ESTADO_COORD = 'INVERTIDA'); ver el script.
 *
 * Periodo: la proporción de denuncias que trae coordenada real cambió mucho (≈25 % hasta noviembre de 2025,
 * ≈90 % desde enero de 2026), aunque el total de denuncias por mes se mantuvo. Mezclar ambos periodos
 * sesgaría el mapa en el tiempo, así que se usa el tramo más reciente con cobertura homogénea: desde el último
 * mes del archivo se retrocede mientras la cobertura mensual sea ≥ `coberturaMinima`, hasta `maxMeses`.
 *
 * Todo se muestra agregado, nunca como puntos individuales:
 *   - indicador(lat, lon): cuántas denuncias hay a menos de `radio` metros, con desglose robo/hurto.
 *   - capa(pane): mapa de calor de toda la ciudad. Cada denuncia se reparte con un núcleo gaussiano
 *     (σ = `suavizado` metros) sobre una cuadrícula de `celda` metros, así que no se puede leer
 *     la ubicación exacta de ninguna denuncia.
 *
 * Todo se calcula en el navegador con archivos locales. No hay datos simulados:
 * si el archivo falta o está mal formado, se lanza un error con la causa.
 */
const Delitos = (() => {
  let ready = null; // promesa de carga (se comparte entre llamadas)
  let meta = null; // { fuente, desde, hasta, ventanaDesde, meses, coberturaVentana, registros, enVentana }
  let pts = []; // denuncias dentro de la ventana: [{ lat, lon, subtipo }]
  let celdas = new Map(); // índice espacial: "i|j" → [puntos]
  let calor = null; // capa del mapa de calor (se crea la primera vez que se pide)

  const TAM_CELDA = 0.005; // grados (~550 m): con radio 500 m basta mirar la celda y sus 8 vecinas
  const claveCelda = (i, j) => `${i}|${j}`;
  const celdaDe = (lat, lon) => [Math.floor(lat / TAM_CELDA), Math.floor(lon / TAM_CELDA)];

  /**
   * Primer día de la ventana: se parte del último mes con datos y se retrocede mientras el mes tenga
   * cobertura (denuncias con coordenada / total) de al menos `minima`, hasta `maxMeses` meses.
   * Devuelve { desde: "2026-01-01", meses: 7, cobertura: 0.89 } o lanza un error si ni el último mes cumple.
   */
  function elegirVentana(hasta, cobertura, minima, maxMeses) {
    const meses = [];
    let [a, m] = hasta.split('-').map(Number);
    while (meses.length < maxMeses) {
      const c = cobertura[`${a}-${String(m).padStart(2, '0')}`];
      if (!c || c.total === 0 || c.conUbicacion / c.total < minima) break;
      meses.push({ a, m, ...c });
      m--;
      if (m === 0) { m = 12; a--; }
    }
    if (meses.length === 0) throw new Error(`Ningún mes reciente tiene al menos ${Math.round(minima * 100)} % de denuncias con ubicación.`);
    const primero = meses[meses.length - 1];
    const con = meses.reduce((t, x) => t + x.conUbicacion, 0);
    const total = meses.reduce((t, x) => t + x.total, 0);
    return { desde: `${primero.a}-${String(primero.m).padStart(2, '0')}-01`, meses: meses.length, cobertura: con / total };
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
        if (!fc || !Array.isArray(fc.features) || !fc.metadata || !fc.metadata.hasta || !fc.metadata.cobertura) {
          throw new Error('El archivo de denuncias no tiene el formato esperado (falta `features`, `metadata.hasta` o `metadata.cobertura`). Vuelve a generarlo con scripts/descargar-delitos.mjs.');
        }

        const hasta = fc.metadata.hasta;
        const ventana = elegirVentana(hasta, fc.metadata.cobertura, cfg.coberturaMinima, cfg.maxMeses);
        const desde = ventana.desde;
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
          meses: ventana.meses,
          coberturaVentana: ventana.cobertura,
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

  // Rampa de color: transparente → amarillo → naranja → rojo oscuro. [posición 0-1, r, g, b, alfa 0-255]
  const RAMPA = [
    [0, 255, 237, 160, 0],
    [0.15, 255, 237, 160, 110],
    [0.45, 253, 141, 60, 170],
    [0.75, 227, 26, 28, 200],
    [1, 128, 0, 38, 220],
  ];

  function colorDe(t) {
    for (let k = 1; k < RAMPA.length; k++) {
      if (t <= RAMPA[k][0]) {
        const [p0, ...c0] = RAMPA[k - 1];
        const [p1, ...c1] = RAMPA[k];
        const f = (t - p0) / (p1 - p0);
        return c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
      }
    }
    return RAMPA[RAMPA.length - 1].slice(1);
  }

  /**
   * Densidad de denuncias sobre la caja de Arequipa metropolitana (CONFIG.viewbox), pintada en un canvas.
   * La escala es relativa: el rojo más oscuro es la celda con más densidad de la ciudad.
   * La imagen se estira en grados (no en Mercator): a esta escala la diferencia es menor a un píxel.
   */
  function pintarCalor() {
    const cfg = CONFIG.delitos;
    const [oeste, norte, este, sur] = CONFIG.viewbox.split(',').map(Number);
    const mLat = 111320;
    const mLon = 111320 * Math.cos((((norte + sur) / 2) * Math.PI) / 180);
    const ancho = Math.ceil(((este - oeste) * mLon) / cfg.celda);
    const alto = Math.ceil(((norte - sur) * mLat) / cfg.celda);
    const dens = new Float32Array(ancho * alto);

    // Núcleo gaussiano precalculado, truncado en 3σ.
    const r = Math.ceil((3 * cfg.suavizado) / cfg.celda);
    const nucleo = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = (dx * dx + dy * dy) * cfg.celda * cfg.celda;
        nucleo.push([dx, dy, Math.exp(-d2 / (2 * cfg.suavizado * cfg.suavizado))]);
      }
    }
    for (const d of pts) {
      const cx = Math.floor(((d.lon - oeste) * mLon) / cfg.celda);
      const cy = Math.floor(((norte - d.lat) * mLat) / cfg.celda);
      for (const [dx, dy, w] of nucleo) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < ancho && y >= 0 && y < alto) dens[y * ancho + x] += w;
      }
    }

    // Tope de la escala: el máximo de la ciudad. Se usa raíz cuadrada para que las zonas medias
    // no queden transparentes sin saturar el centro, donde se concentran cientos de denuncias.
    const valores = Array.from(dens).filter((v) => v > 0.01).sort((a, b) => a - b);
    if (valores.length === 0) throw new Error('No hay denuncias dentro de la caja de Arequipa metropolitana.');
    const tope = Math.sqrt(valores[valores.length - 1]);

    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(ancho, alto);
    for (let i = 0; i < dens.length; i++) img.data.set(colorDe(Math.min(1, Math.sqrt(dens[i]) / tope)), i * 4);
    ctx.putImageData(img, 0, 0);
    return { url: canvas.toDataURL(), bounds: [[sur, oeste], [norte, este]] };
  }

  /** Capa de Leaflet con el mapa de calor, en el panel indicado y sin capturar clics. */
  async function capa(pane) {
    await load();
    if (!calor) {
      const { url, bounds } = pintarCalor();
      calor = L.imageOverlay(url, bounds, { pane, interactive: false, opacity: 0.75, className: 'calor' });
    }
    return calor;
  }

  /** Indicador para un punto: { radio, conteo: { total, ROBO, HURTO }, meta } */
  async function indicador(lat, lon) {
    await load();
    return { radio: CONFIG.delitos.radio, conteo: contar(lat, lon, CONFIG.delitos.radio), meta };
  }

  return { load, indicador, capa };
})();
