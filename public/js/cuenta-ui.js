/**
 * cuenta-ui.js — Entrada discreta «Iniciar sesión» / «Hola, X» en la barra superior. Las decisiones están en cuenta.js.
 *
 * Pregunta a /api/auth/me al cargar. Si falla de cualquier manera (sitio estático, servidor sin configurar, sin red), la
 * entrada sigue oculta y la aplicación no cambia en nada: la cuenta es opcional.
 */
const CuentaUI = (() => {
  async function iniciar() {
    const entrada = document.getElementById('cuenta-btn');
    const texto = document.getElementById('cuenta-texto');
    if (!entrada || !texto || typeof Cuenta === 'undefined') return;
    try {
      const hacerFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined;
      const vista = Cuenta.entradaDeBarra(await Cuenta.consultarMe(hacerFetch));
      if (!vista.visible) return;
      texto.textContent = vista.texto;
      entrada.hidden = false;
    } catch (err) {
      // La entrada se queda oculta.
    }
  }

  return { iniciar };
})();

CuentaUI.iniciar();
