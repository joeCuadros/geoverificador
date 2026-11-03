/**
 * disposicion.js: Cómo se reparte la pantalla de trabajo entre el chat y el mapa (sin DOM, sin red).
 *
 * En escritorio el chat va a la izquierda (cerca del 45 %, nunca menos de 360 px) y el mapa a la derecha, con un divisor que
 * se arrastra o se mueve con el teclado. «Ampliar el chat» lo deja a todo el ancho; «Volver a ver el mapa» regresa a la
 * pantalla dividida. En el móvil (hasta 639,98 px) el chat ocupa toda la pantalla y un botón de abajo alterna con el mapa.
 * El ancho elegido se recuerda como fracción del contenedor (localStorage, con try/catch).
 *
 * Se carga como script del navegador (define `Disposicion`) y también como módulo CommonJS para las pruebas
 * (test/disposicion.spec.ts). espacio-ui.js es quien toca el DOM.
 */
const Disposicion = (() => {
  const MIN_CHAT_PX = 360;
  const MIN_MAPA_PX = 270; // 360 + 10 + 270 = 640: justo lo que mide la pantalla más angosta con dos paneles
  const DIVISOR_PX = 10;
  const FRACCION_INICIAL = 0.45;
  const PASO_PX = 24;
  const PASO_GRANDE_PX = 96;
  const CORTE_MOVIL_PX = 640;
  const CLAVE_ANCHO = 'geoverificador.chatAncho';

  const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);
  const maximoChat = (contenedor) => Math.max(MIN_CHAT_PX, contenedor - MIN_MAPA_PX - DIVISOR_PX);

  /** Ancho por defecto del chat en un contenedor de `contenedor` px. */
  function anchoInicial(contenedor) {
    const c = esNumero(contenedor) ? contenedor : CORTE_MOVIL_PX;
    return Math.min(maximoChat(c), Math.max(MIN_CHAT_PX, Math.round(c * FRACCION_INICIAL)));
  }

  /** Deja el ancho del chat entre su mínimo y lo que permite el mapa. Un valor inválido vuelve al ancho inicial. */
  function limitarAncho(px, contenedor) {
    if (!esNumero(px)) return anchoInicial(contenedor);
    const c = esNumero(contenedor) ? contenedor : CORTE_MOVIL_PX;
    return Math.min(maximoChat(c), Math.max(MIN_CHAT_PX, Math.round(px)));
  }

  const TECLAS = {
    ArrowLeft: -PASO_PX, ArrowRight: PASO_PX, ArrowUp: PASO_PX, ArrowDown: -PASO_PX,
    PageUp: PASO_GRANDE_PX, PageDown: -PASO_GRANDE_PX,
  };
  const esTeclaDeDivisor = (tecla) => tecla === 'Home' || tecla === 'End' || Object.prototype.hasOwnProperty.call(TECLAS, tecla);

  /** Ancho nuevo del chat tras una tecla del divisor (izquierda y derecha achican y agrandan el chat). */
  function mover(ancho, tecla, contenedor, { grande = false } = {}) {
    if (tecla === 'Home') return limitarAncho(MIN_CHAT_PX, contenedor);
    if (tecla === 'End') return limitarAncho(maximoChat(esNumero(contenedor) ? contenedor : CORTE_MOVIL_PX), contenedor);
    if (!Object.prototype.hasOwnProperty.call(TECLAS, tecla)) return limitarAncho(ancho, contenedor);
    const paso = grande && Math.abs(TECLAS[tecla]) === PASO_PX ? Math.sign(TECLAS[tecla]) * PASO_GRANDE_PX : TECLAS[tecla];
    return limitarAncho(ancho + paso, contenedor);
  }

  /** Valores aria del divisor (role="separator"): porcentaje del contenedor que ocupa el chat. */
  function valoresAria(ancho, contenedor) {
    const c = esNumero(contenedor) && contenedor > 0 ? contenedor : CORTE_MOVIL_PX;
    const pct = (px) => Math.round((px / c) * 100);
    return { min: pct(MIN_CHAT_PX), max: pct(maximoChat(c)), now: pct(limitarAncho(ancho, c)) };
  }

  const textoValor = (ancho, contenedor) => `El chat ocupa el ${valoresAria(ancho, contenedor).now} % del ancho`;

  // El almacenamiento del navegador puede faltar o lanzar (ventana privada, datos bloqueados): nunca debe romper la página.
  function leerFraccion(almacen) {
    try {
      const crudo = almacen && almacen.getItem(CLAVE_ANCHO);
      const n = crudo === null || crudo === undefined || crudo === '' ? NaN : Number(crudo);
      return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
    } catch (err) {
      return null;
    }
  }

  function guardarFraccion(almacen, fraccion) {
    try {
      if (almacen && esNumero(fraccion) && fraccion > 0 && fraccion < 1) almacen.setItem(CLAVE_ANCHO, String(fraccion));
    } catch (err) {
      /* sin almacenamiento: el ancho vale mientras la página siga abierta */
    }
  }

  function guardarAncho(almacen, ancho, contenedor) {
    if (esNumero(ancho) && esNumero(contenedor) && contenedor > 0) guardarFraccion(almacen, Math.round((ancho / contenedor) * 1000) / 1000);
  }

  /** Ancho a usar al abrir: el recordado (como fracción del contenedor de hoy) o el inicial. */
  function anchoGuardado(almacen, contenedor) {
    const f = leerFraccion(almacen);
    return f === null ? anchoInicial(contenedor) : limitarAncho(f * contenedor, contenedor);
  }

  const esMovil = (anchoVentana) => esNumero(anchoVentana) && anchoVentana < CORTE_MOVIL_PX;

  const alternarAmpliar = (modo) => (modo === 'chat' ? 'dividido' : 'chat');
  const etiquetaAmpliar = (modo) => (modo === 'chat'
    ? { texto: 'Volver a ver el mapa', pulsado: true }
    : { texto: 'Ampliar el chat', pulsado: false });

  const alternarMovil = (panel) => (panel === 'mapa' ? 'chat' : 'mapa');
  const etiquetaMovil = (panel) => (panel === 'mapa' ? 'Ver chat' : 'Ver mapa');

  /** Qué paneles se ven según el tamaño de pantalla y el modo elegido. */
  function visibles({ movil, modo, panelMovil }) {
    if (movil) return { chat: panelMovil !== 'mapa', mapa: panelMovil === 'mapa' };
    return modo === 'chat' ? { chat: true, mapa: false } : { chat: true, mapa: true };
  }

  return {
    MIN_CHAT_PX, MIN_MAPA_PX, DIVISOR_PX, FRACCION_INICIAL, CORTE_MOVIL_PX, CLAVE_ANCHO,
    anchoInicial, limitarAncho, mover, esTeclaDeDivisor, valoresAria, textoValor,
    leerFraccion, guardarFraccion, guardarAncho, anchoGuardado,
    esMovil, alternarAmpliar, etiquetaAmpliar, alternarMovil, etiquetaMovil, visibles,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Disposicion;
