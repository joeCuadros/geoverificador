/**
 * http.js — Cliente HTTP cortés para la recolección de avisos. Lo usa scripts/recolectar-avisos.mjs y lo prueban
 * test/avisos-http.spec.ts (con fetch y reloj inyectados: no usan red).
 *
 * Qué hace, y qué NO hace:
 *  - Antes de pedir cualquier otra cosa a un sitio lee su robots.txt (una vez por sitio) y no pide las rutas que
 *    prohíbe para nuestro agente. Se detiene ahí e informa (estado «robots»).
 *  - Solicitudes secuenciales, con al menos `esperaMs` entre dos solicitudes al mismo sitio (o el Crawl-delay del sitio,
 *    si es mayor). También cuenta la solicitud de robots.txt.
 *  - User-Agent propio y honesto, más `Accept`. Nada más: no suplanta un navegador, no usa cookies, no rota proxies.
 *  - Si el sitio responde 401, 403 o 429, o muestra un desafío anti-bot, devuelve «bloqueado» y NO reintenta ni vuelve a
 *    pedir a ese sitio durante la ejecución. No intenta saltarse el bloqueo.
 *  - Las redirecciones se siguen a mano (máximo 3), pasando cada salto por robots.txt y por la espera.
 *
 * Resultado de obtener() / permitido(): { estado: 'ok' | 'robots' | 'bloqueado' | 'error', status, texto, url, motivo }.
 */
const R = require('./robots.js');

const MAX_REDIRECCIONES = 3;
const TIMEOUT_MS = 30000;

// Páginas de desafío conocidas. Ojo: «challenge-platform/scripts/jsd» (script pasivo de Cloudflare) y la palabra «captcha»
// aparecen en páginas normales, así que NO cuentan.
const TITULOS_DESAFIO = /<title>\s*(just a moment|attention required|verifying you are human|checking your browser|un momento|access denied|pardon our interruption)/i;
const MARCAS_DESAFIO = [/id=["']challenge-form["']/i, /cf-browser-verification/i, /challenge-platform\/h\/[a-z]\/orchestrate\/(chl_page|managed|jsch)/i, /_pxCaptcha|px-captcha/i, /Incapsula incident/i];

/**
 * Si la respuesta es un bloqueo, un texto con el motivo; si no, null.
 * `headers` debe tener `.get(nombre)` (Headers de fetch).
 */
function detectarBloqueo({ status, headers, texto }) {
  const mitigado = headers && typeof headers.get === 'function' ? headers.get('cf-mitigated') : null;
  if (mitigado) return `desafío anti-bot (cf-mitigated: ${mitigado})`;
  const cuerpo = String(texto || '').slice(0, 30000);
  const desafio = TITULOS_DESAFIO.test(cuerpo) || MARCAS_DESAFIO.some((m) => m.test(cuerpo));
  if (desafio) return `desafío anti-bot${status ? ` (HTTP ${status})` : ''}`;
  if (status === 401 || status === 403 || status === 407 || status === 429) return `bloqueado por el sitio o por límite de solicitudes (HTTP ${status})`;
  return null;
}

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cliente. Opciones: { userAgent (obligatorio), esperaMs = 3000, fetchFn = fetch, ahora = Date.now, dormir, timeoutMs,
 * seguirRedirecciones = true }. Con seguirRedirecciones: false, una redirección se trata como bloqueo y se detiene el sitio.
 */
function crearCliente(opciones) {
  const { userAgent, esperaMs = 3000, fetchFn = globalThis.fetch, ahora = Date.now, dormir = dormirReal, timeoutMs = TIMEOUT_MS, seguirRedirecciones = true } = opciones;
  if (!userAgent) throw new Error('crearCliente: falta el User-Agent');
  const ultimo = new Map(); // host → instante de la última solicitud
  const robotsPorOrigen = new Map(); // origen → Promise<{ estado, reglas, retardo, motivo }>
  const bloqueados = new Map(); // host → motivo
  const cabeceras = { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' };
  let solicitudes = 0;

  async function esperar(host, retardoSeg) {
    const minimo = Math.max(esperaMs, (retardoSeg || 0) * 1000);
    const previo = ultimo.get(host);
    if (previo !== undefined) {
      const falta = previo + minimo - ahora();
      if (falta > 0) await dormir(falta);
    }
    ultimo.set(host, ahora());
  }

  async function pedirCrudo(url, redirect) {
    solicitudes++;
    const res = await fetchFn(url, { headers: { ...cabeceras }, redirect, signal: AbortSignal.timeout(timeoutMs) });
    const texto = await res.text();
    return { status: res.status, headers: res.headers, texto };
  }

  const marcarBloqueo = (host, motivo) => {
    bloqueados.set(host, motivo);
    return { estado: 'bloqueado', status: null, texto: null, motivo };
  };

  function cargarRobots(u) {
    if (!robotsPorOrigen.has(u.origin)) {
      robotsPorOrigen.set(
        u.origin,
        (async () => {
          const url = `${u.origin}/robots.txt`;
          let r;
          try {
            await esperar(u.host, null);
            r = await pedirCrudo(url, 'follow');
          } catch (err) {
            return { estado: 'error', motivo: `no se pudo leer ${url}: ${err.message}. No se pide nada más a ${u.host}.` };
          }
          const bloqueo = detectarBloqueo(r);
          if (bloqueo) return marcarBloqueo(u.host, `${bloqueo} al leer ${url}`);
          if (r.status >= 500) return { estado: 'error', status: r.status, motivo: `no se pudo leer ${url} (HTTP ${r.status}). No se pide nada más a ${u.host}.` };
          if (r.status >= 400) return { estado: 'ok', ...R.reglasPara([], userAgent) }; // sin robots.txt: sin restricciones (RFC 9309)
          return { estado: 'ok', ...R.reglasPara(R.parsearRobots(r.texto), userAgent) };
        })()
      );
    }
    return robotsPorOrigen.get(u.origin);
  }

  async function obtenerInterno(url, saltos, soloRobots) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { estado: 'error', motivo: `URL no válida: ${url}` };
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { estado: 'error', motivo: `Protocolo no admitido: ${u.protocol}` };
    if (bloqueados.has(u.host)) return { estado: 'bloqueado', status: null, texto: null, motivo: `${bloqueados.get(u.host)} (no se vuelve a pedir a ${u.host})` };

    const robots = await cargarRobots(u);
    if (robots.estado !== 'ok') return robots.estado === 'bloqueado' ? { estado: 'bloqueado', status: null, texto: null, motivo: `${bloqueados.get(u.host) || robots.motivo}` } : robots;
    const ruta = u.pathname + u.search;
    if (!R.permitido(robots, ruta)) return { estado: 'robots', status: null, texto: null, url, motivo: `robots.txt de ${u.host} no permite ${ruta}` };
    if (soloRobots) return { estado: 'ok', status: null, texto: null, url };

    await esperar(u.host, robots.retardo);
    let r;
    try {
      r = await pedirCrudo(url, 'manual');
    } catch (err) {
      return { estado: 'error', status: null, texto: null, url, motivo: `fallo de red al pedir ${url}: ${err.message}` };
    }
    const bloqueo = detectarBloqueo(r);
    if (bloqueo) return { ...marcarBloqueo(u.host, bloqueo), status: r.status, url };

    if (r.status >= 300 && r.status < 400) {
      const destino = r.headers.get('location');
      if (!seguirRedirecciones) return { ...marcarBloqueo(u.host, `redirección${destino ? ` a ${destino}` : ''} (HTTP ${r.status})`), status: r.status, url };
      if (!destino) return { estado: 'error', status: r.status, texto: null, url, motivo: `redirección sin destino (HTTP ${r.status})` };
      if (saltos >= MAX_REDIRECCIONES) return { estado: 'error', status: r.status, texto: null, url, motivo: `demasiadas redirecciones (más de ${MAX_REDIRECCIONES})` };
      return obtenerInterno(new URL(destino, u).href, saltos + 1, false);
    }
    if (r.status >= 400) return { estado: 'error', status: r.status, texto: null, url, motivo: `HTTP ${r.status}` };
    return { estado: 'ok', status: r.status, texto: r.texto, url };
  }

  return {
    /** Pide la URL respetando robots.txt, la espera entre solicitudes y los bloqueos. */
    obtener: (url) => obtenerInterno(url, 0, false),
    /** Solo comprueba robots.txt para la URL (lo lee si hace falta); no pide la página. */
    permitido: (url) => obtenerInterno(url, 0, true),
    get solicitudes() {
      return solicitudes;
    },
    bloqueados: () => Object.fromEntries(bloqueados),
  };
}

module.exports = { detectarBloqueo, crearCliente, MAX_REDIRECCIONES };
