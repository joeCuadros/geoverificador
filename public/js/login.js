/**
 * login.js — Vista de la página de acceso opcional (login.html). Las decisiones (qué mensaje, qué estado) están en cuenta.js.
 *
 * Estados: sin sesión (el botón es un enlace que inicia el flujo; sin JavaScript también funciona), redirigiendo a Google,
 * error (con reintento cuando tiene sentido), sin configurar (el botón se desactiva) y con sesión iniciada.
 * Nada de lo que llega en la URL se escribe como HTML: los textos salen de cuenta.js o se asignan con textContent.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const hacerFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined;
  const params = Cuenta.leerParametros(window.location.search);

  const enlace = $('login-google');
  const textoEnlace = enlace.textContent;
  let errorDeUrl = params.error;

  enlace.setAttribute('href', Cuenta.hrefInicio(params.volver));

  function mostrar(id, visible) { $(id).hidden = !visible; }

  function limpiarMensajes() {
    mostrar('login-info', false);
    mostrar('login-error', false);
  }

  function informar(texto) {
    limpiarMensajes();
    $('login-info-texto').textContent = texto;
    mostrar('login-info', true);
  }

  function fallar(texto) {
    limpiarMensajes();
    $('login-error-texto').textContent = texto;
    mostrar('login-error', true);
  }

  /** Deja el botón de Google listo para usarse (o para reintentar tras un error). */
  function activarBoton(etiqueta) {
    enlace.textContent = etiqueta;
    enlace.setAttribute('href', Cuenta.hrefInicio(params.volver));
    enlace.removeAttribute('aria-disabled');
    enlace.removeAttribute('aria-busy');
  }

  function desactivarBoton() {
    enlace.removeAttribute('href');
    enlace.setAttribute('aria-disabled', 'true');
    enlace.removeAttribute('aria-busy');
  }

  function vistaAnonima() {
    mostrar('login-sesion', false);
    mostrar('login-anonimo', true);
    mostrar('login-reintentar', false);
  }

  function vistaSesion(nombre) {
    limpiarMensajes();
    $('login-nombre').textContent = nombre;
    mostrar('login-anonimo', false);
    mostrar('login-sesion', true);
  }

  function aplicar(estado) {
    if (estado.tipo === 'sesion') return vistaSesion(estado.nombre);
    vistaAnonima();
    if (estado.tipo === 'no_configurado') {
      desactivarBoton();
      return fallar(Cuenta.mensajeDeError('no_configurado'));
    }
    if (estado.tipo === 'error') {
      activarBoton(textoEnlace);
      mostrar('login-reintentar', true);
      return fallar('No pudimos comprobar tu sesión ahora. Inténtalo de nuevo en un momento.');
    }
    if (errorDeUrl) {
      activarBoton('Intentar de nuevo con Google');
      return fallar(Cuenta.mensajeDeError(errorDeUrl));
    }
    activarBoton(textoEnlace);
  }

  async function comprobar() {
    $('principal').setAttribute('aria-busy', 'true');
    const estado = await Cuenta.consultarMe(hacerFetch);
    $('principal').removeAttribute('aria-busy');
    aplicar(estado);
  }

  // Redirigiendo: el enlace sigue su camino; solo evitamos un segundo toque y avisamos.
  enlace.addEventListener('click', (e) => {
    if (enlace.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    enlace.setAttribute('aria-disabled', 'true');
    enlace.setAttribute('aria-busy', 'true');
    enlace.textContent = 'Abriendo Google…';
    informar('Te estamos llevando a Google para que elijas tu cuenta.');
  });

  $('login-reintentar').addEventListener('click', () => { limpiarMensajes(); comprobar(); });

  $('login-salir').addEventListener('click', async () => {
    const boton = $('login-salir');
    boton.disabled = true;
    boton.setAttribute('aria-busy', 'true');
    const cerrada = await Cuenta.cerrarSesion(hacerFetch);
    boton.disabled = false;
    boton.removeAttribute('aria-busy');
    if (!cerrada) return fallar('No pudimos cerrar la sesión. Inténtalo de nuevo.');
    errorDeUrl = null;
    vistaAnonima();
    activarBoton(textoEnlace);
    informar('Cerraste sesión. Puedes seguir usando GeoVerificador sin cuenta.');
    $('login-h').focus();
  });

  // Al volver con «Atrás» desde Google la página puede restaurarse con el botón en «Abriendo Google…».
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    limpiarMensajes();
    comprobar();
  });

  // El código de error de la URL ya se mostró: se quita para que recargar no lo repita.
  if (errorDeUrl) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    } catch (err) { /* sin historial: no pasa nada */ }
  }

  comprobar();
})();
