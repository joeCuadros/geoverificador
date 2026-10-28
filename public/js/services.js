/**
 * services.js — Solicitudes HTTP reales a Overpass API y Nominatim.
 * No hay datos simulados: si el servicio falla, se lanza un ServiceError con la causa.
 */
const Services = (() => {
  class ServiceError extends Error {
    constructor(kind, message, status) {
      super(message);
      this.name = 'ServiceError';
      this.kind = kind; // network | timeout | rate_limit | forbidden | busy | http | runtime | parse
      this.status = status;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** fetch con timeout propio; distingue timeout, cancelación y fallo de red. */
  async function request(url, options, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError' && timedOut) {
        throw new ServiceError('timeout', `El servicio no respondió en ${Math.round(timeoutMs / 1000)} s.`);
      }
      throw new ServiceError('network', 'No se pudo contactar con el servicio.');
    } finally {
      clearTimeout(timer);
    }
  }

  async function httpError(res, name) {
    let detail = '';
    try {
      detail = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    } catch (_) { /* sin cuerpo legible */ }
    const retry = res.headers.get('Retry-After');
    const extra = (retry ? ` Retry-After: ${retry}s.` : '') + (detail ? ` Detalle: ${detail}` : '');
    if (res.status === 429) return new ServiceError('rate_limit', `${name} limitó las solicitudes (HTTP 429).${extra}`, 429);
    if (res.status === 403) return new ServiceError('forbidden', `${name} rechazó la solicitud (HTTP 403).${extra}`, 403);
    if ([502, 503, 504].includes(res.status)) {
      return new ServiceError('busy', `${name} está ocupado o no disponible (HTTP ${res.status}).${extra}`, res.status);
    }
    return new ServiceError('http', `${name} respondió HTTP ${res.status}.${extra}`, res.status);
  }

  // ---------------------------------------------------------------- Overpass

  /**
   * Consulta de respaldo de UNA variable alrededor del punto (solo se usa si falta su archivo congelado).
   * Las etiquetas salen de Calculos.FILTROS, las mismas con las que se extrajeron los archivos.
   *   salud, educacion, transporte → `out center` (un punto por elemento)
   *   areasVerdes                   → vías y relaciones con `out geom` (polígonos)
   */
  function buildOverpassQuery(categoria, lat, lon, radius) {
    const around = `(around:${radius},${lat.toFixed(6)},${lon.toFixed(6)})`;
    const sel = Calculos.selectoresOverpass(categoria);
    const areas = categoria === 'areasVerdes';
    const lines = sel.flatMap((s) => (areas ? [`  way${s}${around};`, `  relation${s}${around};`] : [`  nwr${s}${around};`]));
    return `[out:json][timeout:${CONFIG.overpassTimeoutSec}][maxsize:${CONFIG.overpassMaxSizeBytes}];\n(\n${lines.join('\n')}\n);\nout ${areas ? 'geom' : 'center'} tags;`;
  }

  async function overpass(endpoint, query) {
    const t0 = performance.now();
    const res = await request(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'data=' + encodeURIComponent(query),
      },
      CONFIG.clientTimeoutMs
    );
    if (!res.ok) throw await httpError(res, 'Overpass');

    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new ServiceError('parse', 'Overpass respondió algo que no es JSON válido.', res.status);
    }
    // Overpass puede devolver HTTP 200 con un error de ejecución dentro de "remark".
    if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) {
      throw new ServiceError('runtime', `Overpass reportó: ${data.remark}`, res.status);
    }
    return { data, ms: Math.round(performance.now() - t0), status: res.status };
  }

  // Fallos pasajeros de un servidor público: vale la pena reintentar u otro servidor.
  const TRANSIENT = new Set(['busy', 'timeout', 'network', 'parse']);
  const isTransient = (err) =>
    err instanceof ServiceError && (TRANSIENT.has(err.kind) || (err.kind === 'http' && err.status >= 500));

  /**
   * Prueba el servidor elegido y, si falla por saturación, rota por los demás de CONFIG
   * con una espera creciente. Un 429 descarta solo ese servidor (cada uno tiene su propio cupo);
   * otros errores no pasajeros (403, consulta demasiado pesada) se lanzan al instante.
   * onAttempt(n, total, endpoint) permite mostrar el progreso en pantalla.
   */
  async function overpassWithFallback(preferred, query, onAttempt) {
    const others = CONFIG.overpassEndpoints.map((e) => e.url).filter((u) => u !== preferred);
    const order = [preferred, ...others];
    const limited = new Set();
    const total = CONFIG.overpassMaxAttempts;
    let lastErr;
    for (let i = 0, turn = 0; i < total; i++) {
      const pool = order.filter((u) => !limited.has(u));
      if (pool.length === 0) break;
      const endpoint = pool[turn++ % pool.length];
      if (i > 0) await sleep(CONFIG.overpassRetryDelayMs * i);
      if (onAttempt) onAttempt(i + 1, total, endpoint);
      try {
        return { ...(await overpass(endpoint, query)), endpoint, attempts: i + 1 };
      } catch (err) {
        lastErr = err;
        console.warn(`[Overpass] intento ${i + 1}/${total} falló en ${endpoint}:`, err.message);
        if (err instanceof ServiceError && err.kind === 'rate_limit') {
          limited.add(endpoint);
          turn--; // el servidor siguiente ocupa ahora la posición del descartado
        } else if (!isTransient(err)) {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  // --------------------------------------------------------------- Nominatim

  const geoCache = new Map();
  let lastNominatim = 0;

  /** Búsqueda solo bajo petición explícita (nunca al escribir) y como máximo 1 solicitud/segundo. */
  async function geocode(q, { bounded }) {
    const key = `${bounded ? 1 : 0}|${q.toLowerCase()}`;
    if (geoCache.has(key)) return { results: geoCache.get(key), cached: true, ms: 0 };

    const wait = lastNominatim + CONFIG.nominatimMinIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();

    const params = new URLSearchParams({
      format: 'jsonv2',
      q,
      limit: '5',
      countrycodes: 'pe',
      'accept-language': 'es',
    });
    if (bounded) {
      params.set('viewbox', CONFIG.viewbox);
      params.set('bounded', '1');
    }
    if (CONFIG.nominatimEmail) params.set('email', CONFIG.nominatimEmail);

    const t0 = performance.now();
    const res = await request(`${CONFIG.nominatimUrl}?${params}`, { headers: { Accept: 'application/json' } }, 15000);
    if (!res.ok) throw await httpError(res, 'Nominatim');

    let json;
    try {
      json = await res.json();
    } catch (_) {
      throw new ServiceError('parse', 'Nominatim respondió algo que no es JSON válido.', res.status);
    }
    const results = json.map((r) => ({
      name: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      osm: r.osm_type && r.osm_id ? `${r.osm_type}/${r.osm_id}` : null,
    }));
    geoCache.set(key, results);
    return { results, cached: false, ms: Math.round(performance.now() - t0) };
  }

  return { ServiceError, buildOverpassQuery, overpass, overpassWithFallback, geocode };
})();
