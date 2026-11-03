/**
 * cuenta.js — Lógica pura de la cuenta opcional (sin DOM). La usan la entrada de la barra (cuenta-ui.js) y la página
 * de acceso (login.js); se prueba con jest en test/cuenta.spec.ts.
 *
 * La aplicación funciona completa sin cuenta. Si el servidor no tiene el inicio de sesión configurado (503), si el sitio es
 * estático (404) o si no hay red, la cuenta simplemente no aparece y nada más cambia.
 */
const Cuenta = (() => {
  const RUTAS = Object.freeze({ me: '/api/auth/me', inicio: '/api/auth/google', salir: '/api/auth/logout' });
  const MAX_NOMBRE = 80;

  const MENSAJES = Object.freeze({
    acceso_denegado: 'Cancelaste el acceso con Google. No pasa nada: puedes intentarlo de nuevo o seguir sin cuenta.',
    estado_invalido: 'No pudimos confirmar que la solicitud saliera de este navegador. Inténtalo de nuevo.',
    sesion_expirada: 'El intento caducó antes de terminar. Inténtalo de nuevo.',
    intercambio_fallido: 'Google no respondió como esperábamos. Inténtalo de nuevo en un momento.',
    token_invalido: 'No pudimos verificar la respuesta de Google. Inténtalo de nuevo.',
    google_error: 'Google devolvió un error. Inténtalo de nuevo en un momento.',
    no_configurado: 'El inicio de sesión no está configurado todavía. Puedes seguir usando GeoVerificador sin cuenta.',
  });
  const MENSAJE_GENERICO = 'No se pudo iniciar sesión. Inténtalo de nuevo.';

  const limpiarNombre = (valor) => {
    if (typeof valor !== 'string') return '';
    return Array.from(valor.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim()).slice(0, MAX_NOMBRE).join('');
  };

  /** Misma regla que el servidor: ruta relativa del mismo sitio, sin «//», sin barras invertidas y fuera de /api/. */
  function volverSeguro(valor) {
    if (typeof valor !== 'string' || valor.length === 0 || valor.length > 200) return null;
    if (valor[0] !== '/' || valor[1] === '/' || /[\u0000-\u001f\u007f\\]/.test(valor) || valor.startsWith('/api/')) return null;
    return valor;
  }

  /** Traduce la respuesta de /api/auth/me a un estado: sesion, anonimo, no_configurado o error. */
  function interpretarMe(status, cuerpo) {
    if (status === 503 || status === 404) return { tipo: 'no_configurado' };
    if (status !== 200) return { tipo: 'error' };
    const nombre = cuerpo && cuerpo.autenticado === true ? limpiarNombre(cuerpo.nombre) : '';
    return nombre ? { tipo: 'sesion', nombre } : { tipo: 'anonimo' };
  }

  async function leerJson(r) {
    try { return await r.json(); } catch (err) { return null; }
  }

  /** Consulta /api/auth/me. Nunca lanza: sin red o sin servidor devuelve { tipo: 'error' }. */
  async function consultarMe(fetchFn) {
    if (typeof fetchFn !== 'function') return { tipo: 'error' };
    try {
      const r = await fetchFn(RUTAS.me, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      return interpretarMe(r.status, await leerJson(r));
    } catch (err) {
      return { tipo: 'error' };
    }
  }

  /** POST a /api/auth/logout (el servidor exige que la petición sea del mismo origen). true si se cerró la sesión. */
  async function cerrarSesion(fetchFn) {
    if (typeof fetchFn !== 'function') return false;
    try {
      const r = await fetchFn(RUTAS.salir, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      return Boolean(r && r.ok);
    } catch (err) {
      return false;
    }
  }

  /** Mensaje para un código de error del flujo. Un código desconocido nunca se refleja en la página. */
  function mensajeDeError(codigo) {
    return typeof codigo === 'string' && Object.prototype.hasOwnProperty.call(MENSAJES, codigo) ? MENSAJES[codigo] : MENSAJE_GENERICO;
  }

  /** Reintentar sirve en todos los errores salvo cuando el inicio de sesión no está configurado. */
  const permiteReintentar = (codigo) => codigo !== 'no_configurado';

  /** Lee `error` y `volver` de la cadena de consulta de la página de acceso. */
  function leerParametros(busqueda) {
    const p = new URLSearchParams(typeof busqueda === 'string' ? busqueda : '');
    const error = p.get('error');
    return { error: error && /^[a-z_]{1,40}$/.test(error) ? error : null, volver: volverSeguro(p.get('volver')) };
  }

  /** Enlace que inicia el flujo; la ruta de regreso solo se añade si es segura. */
  function hrefInicio(volver) {
    const ruta = volverSeguro(volver);
    return ruta ? `${RUTAS.inicio}?volver=${encodeURIComponent(ruta)}` : RUTAS.inicio;
  }

  /** Texto de la entrada de la barra superior; oculta cuando no hay inicio de sesión disponible. */
  function entradaDeBarra(estado) {
    if (estado && estado.tipo === 'anonimo') return { visible: true, texto: 'Iniciar sesión' };
    if (estado && estado.tipo === 'sesion') return { visible: true, texto: `Hola, ${estado.nombre}` };
    return { visible: false, texto: '' };
  }

  return { RUTAS, interpretarMe, consultarMe, cerrarSesion, mensajeDeError, permiteReintentar, leerParametros, hrefInicio, entradaDeBarra, volverSeguro };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cuenta;
