/**
 * espacio-ui.js: Vista del recorrido y del espacio de trabajo. Las decisiones están en recorrido.js (Inicio, guía, chat) y
 * disposicion.js (ancho del chat, ampliar, ver el mapa); aquí solo se conectan con la página.
 *
 *   Inicio → guía → chat: «Comenzar recorrido» abre la guía (TourUI); al terminarla u omitirla se pasa al chat y se recuerda
 *   en este navegador. «Ya lo conozco» salta la guía. La marca del encabezado vuelve al Inicio y «¿Cómo funciona?» abre la guía.
 *   Espacio de trabajo: chat y mapa con un divisor (role="separator") que se arrastra o se mueve con las flechas; «Ampliar el
 *   chat»; en el móvil, un botón de abajo alterna entre chat y mapa.
 *   Buscar por punto: el contenido de la antigua barra lateral, oculto por defecto, como panel que se abre desde el encabezado
 *   o desde el chat. Tocar el mapa también lo abre.
 */
const EspacioUI = (() => {
  const $ = (id) => document.getElementById(id);
  const raiz = document.documentElement;
  const almacen = () => { try { return window.localStorage; } catch (err) { return null; } };
  const anunciar = (texto) => { $('anuncios').textContent = ''; setTimeout(() => { $('anuncios').textContent = texto; }, 60); };
  const usar = (boton, icono) => { boton.querySelector('use').setAttribute('href', `#i-${icono}`); };

  let api = null; // { map, enfocarPunto }
  let estado = Recorrido.estadoInicial('inicio');
  let modo = 'dividido'; // dividido | chat (ampliado)
  let panelMovil = 'chat'; // chat | mapa
  let anchoChat = null;
  let fraccionChat = null; // proporción del chat: se conserva al cambiar el tamaño de la ventana
  let puntoAbierto = false;
  const movilMQ = window.matchMedia(`(max-width: ${Disposicion.CORTE_MOVIL_PX - 0.02}px)`);
  const esMovil = () => movilMQ.matches;
  const contenedorPx = () => $('espacio').clientWidth || Disposicion.CORTE_MOVIL_PX;

  // ------------------------------------------------------------------ Vista (Inicio o espacio)
  function aplicarVista({ foco = false } = {}) {
    raiz.setAttribute('data-vista', estado.vista);
    // «Saltar»: al chat en el espacio de trabajo y a la acción principal en el Inicio (lo demás no se ve).
    const saltar = document.querySelector('.saltar');
    if (saltar) {
      saltar.setAttribute('href', estado.vista === 'inicio' ? '#inicio-comenzar' : '#asistente');
      saltar.textContent = estado.vista === 'inicio' ? 'Saltar a Comenzar recorrido' : 'Saltar al chat';
    }
    $('espacio').inert = estado.vista === 'inicio';
    if (estado.vista === 'espacio') {
      AsistenteUI.activar();
      aplicarDisposicion();
      if (foco) $('asistente-h').focus({ preventScroll: true });
    } else if (foco) {
      $('inicio-h').setAttribute('tabindex', '-1');
      $('inicio-h').focus({ preventScroll: true });
    }
  }

  function evento(nombre) {
    const r = Recorrido.transicion(estado, nombre);
    estado = r.estado;
    if (r.marcarVisto) Recorrido.marcarVisto(almacen());
    return r;
  }

  // ------------------------------------------------------------------ Disposición (chat y mapa)
  function actualizarDivisor() {
    const v = Disposicion.valoresAria(anchoChat, contenedorPx());
    const d = $('divisor');
    d.setAttribute('aria-valuemin', String(v.min));
    d.setAttribute('aria-valuemax', String(v.max));
    d.setAttribute('aria-valuenow', String(v.now));
    d.setAttribute('aria-valuetext', Disposicion.textoValor(anchoChat, contenedorPx()));
  }

  function fijarAncho(px, { guardar = false } = {}) {
    anchoChat = Disposicion.limitarAncho(px, contenedorPx());
    $('espacio').style.setProperty('--chat-w', `${anchoChat}px`);
    actualizarDivisor();
    if (guardar) {
      fraccionChat = anchoChat / contenedorPx();
      Disposicion.guardarAncho(almacen(), anchoChat, contenedorPx());
    }
  }

  function aplicarDisposicion() {
    const movil = esMovil();
    const v = Disposicion.visibles({ movil, modo, panelMovil });
    const esp = $('espacio');
    esp.dataset.modo = modo;
    esp.dataset.panel = panelMovil;
    esp.dataset.verChat = v.chat ? 'si' : 'no';
    esp.dataset.verMapa = v.mapa ? 'si' : 'no';
    if (!movil && modo === 'dividido') {
      if (fraccionChat === null) fraccionChat = Disposicion.anchoGuardado(almacen(), contenedorPx()) / contenedorPx();
      fijarAncho(fraccionChat * contenedorPx());
    }

    const amp = Disposicion.etiquetaAmpliar(modo);
    $('chat-ampliar-texto').textContent = amp.texto;
    $('chat-ampliar').setAttribute('aria-pressed', String(amp.pulsado));
    $('chat-ampliar').title = amp.texto;
    usar($('chat-ampliar'), amp.pulsado ? 'reducir' : 'ampliar');
    $('vista-alternar-texto').textContent = Disposicion.etiquetaMovil(panelMovil);
    usar($('vista-alternar'), panelMovil === 'mapa' ? 'chat' : 'mapa');

    // Lo que no se ve tampoco se enfoca; con «Buscar por punto» abierto en escritorio, el chat queda tapado.
    $('asistente').inert = !v.chat || (puntoAbierto && !movil);
    $('mapa-zona').inert = !v.mapa;
    if (v.mapa) {
      requestAnimationFrame(() => {
        api.map.invalidateSize({ pan: false });
        AsistenteUI.reajustarVista();
      });
    }
  }

  function mostrarMapa() {
    if (esMovil()) panelMovil = 'mapa';
    else modo = 'dividido';
    aplicarDisposicion();
  }
  const mapaVisible = () => Disposicion.visibles({ movil: esMovil(), modo, panelMovil }).mapa;

  // ----------------------------------------------------------- Buscar por punto (panel secundario)
  function abrirPunto({ foco = true } = {}) {
    if (estado.vista !== 'espacio') return;
    if (!puntoAbierto) {
      puntoAbierto = true;
      if (esMovil()) panelMovil = 'mapa'; else modo = 'dividido';
      $('contenido').hidden = false;
      $('punto-btn').setAttribute('aria-expanded', 'true');
      aplicarDisposicion();
    }
    if (foco) {
      const destino = api && api.enfocarPunto ? api.enfocarPunto() : null;
      (destino || $('contenido')).focus({ preventScroll: true });
    }
  }

  function cerrarPunto({ devolverFoco = true } = {}) {
    if (!puntoAbierto) return;
    const dentro = $('contenido').contains(document.activeElement);
    puntoAbierto = false;
    $('contenido').hidden = true;
    $('punto-btn').setAttribute('aria-expanded', 'false');
    aplicarDisposicion();
    if (devolverFoco && dentro) $('punto-btn').focus();
  }

  // ------------------------------------------------------------------------- Eventos
  function iniciarDivisor() {
    const d = $('divisor');
    const arrastrar = (e) => fijarAncho(e.clientX - $('espacio').getBoundingClientRect().left - Disposicion.DIVISOR_PX / 2);
    d.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      d.setPointerCapture(e.pointerId);
      d.classList.add('arrastrando');
      $('espacio').classList.add('arrastrando');
      arrastrar(e);
    });
    d.addEventListener('pointermove', (e) => { if (d.hasPointerCapture(e.pointerId)) arrastrar(e); });
    const soltar = (e) => {
      if (!d.hasPointerCapture(e.pointerId)) return;
      d.releasePointerCapture(e.pointerId);
      d.classList.remove('arrastrando');
      $('espacio').classList.remove('arrastrando');
      fijarAncho(anchoChat, { guardar: true });
    };
    d.addEventListener('pointerup', soltar);
    d.addEventListener('pointercancel', soltar);
    d.addEventListener('keydown', (e) => {
      if (!Disposicion.esTeclaDeDivisor(e.key)) return;
      e.preventDefault();
      fijarAncho(Disposicion.mover(anchoChat, e.key, contenedorPx(), { grande: e.shiftKey }), { guardar: true });
    });
    d.addEventListener('dblclick', () => fijarAncho(Disposicion.anchoInicial(contenedorPx()), { guardar: true }));
  }

  function iniciarRecorrido() {
    const alCerrarGuia = () => {
      const eraRecorrido = estado.enRecorrido;
      evento('cerrar-guia');
      aplicarVista({ foco: eraRecorrido });
    };
    TourUI.iniciar({ alCerrar: alCerrarGuia });

    $('inicio-comenzar').addEventListener('click', () => {
      evento('comenzar');
      TourUI.abrir({ recorrido: true });
    });
    $('inicio-saltar').addEventListener('click', () => {
      evento('saltar');
      aplicarVista({ foco: true });
    });
    $('ayuda-btn').addEventListener('click', () => {
      evento('abrir-guia');
      TourUI.abrir({ recorrido: false });
    });
    const alInicio = (e) => {
      e.preventDefault();
      if (estado.vista === 'inicio') return;
      evento('abrir-inicio');
      aplicarVista({ foco: true });
    };
    $('brand-inicio').addEventListener('click', alInicio);
    $('inicio-btn').addEventListener('click', alInicio);
  }

  function iniciar(opciones) {
    api = opciones;
    estado = Recorrido.estadoInicial(raiz.getAttribute('data-vista') === 'inicio' ? 'inicio' : 'espacio');
    iniciarDivisor();
    iniciarRecorrido();

    $('chat-ampliar').addEventListener('click', () => {
      if (puntoAbierto) cerrarPunto({ devolverFoco: false });
      modo = Disposicion.alternarAmpliar(modo);
      aplicarDisposicion();
      anunciar(modo === 'chat' ? 'Chat ampliado. El mapa está oculto.' : 'Chat y mapa a la vista.');
    });
    $('vista-alternar').addEventListener('click', () => {
      panelMovil = Disposicion.alternarMovil(panelMovil);
      aplicarDisposicion();
      anunciar(panelMovil === 'mapa' ? 'Mostrando el mapa.' : 'Mostrando el chat.');
    });
    const alternarPunto = () => { if (puntoAbierto) cerrarPunto(); else abrirPunto(); };
    $('punto-btn').addEventListener('click', alternarPunto);
    $('chat-punto').addEventListener('click', () => abrirPunto());
    $('panel-cerrar').addEventListener('click', () => cerrarPunto());
    $('contenido').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !e.target.closest('dialog')) { e.stopPropagation(); cerrarPunto(); }
    });

    if (window.ResizeObserver) new ResizeObserver(() => { if (estado.vista === 'espacio' && !$('espacio').classList.contains('arrastrando')) aplicarDisposicion(); }).observe($('espacio'));
    movilMQ.addEventListener('change', aplicarDisposicion);
    aplicarVista();
  }

  return { iniciar, abrirPunto, cerrarPunto, mostrarMapa, mapaVisible };
})();
