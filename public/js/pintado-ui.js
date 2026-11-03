/**
 * pintado-ui.js: Vista de «Pintar el mapa por»: chips de criterios, capa de colores sobre el mapa, leyenda y «Quitar colores».
 *
 * Las decisiones (qué es cumple, no cumple o sin dato; la intersección; el conteo; la leyenda con su umbral y su fuente) están en
 * pintado.js y salen de los MISMOS cálculos de la búsqueda del asistente. Aquí solo se conecta con la página: se pide la
 * cuadrícula y los datos ya preparados (AsistenteUI.datosParaPintar), se evalúan y se dibujan las celdas en un lienzo sobre el
 * mapa. Cumple va liso, no cumple con rayas y sin dato con puntos: nunca se distingue solo por el color. Una búsqueda del chat
 * pinta el mismo resultado (aplicarBusqueda). No hay puntaje global ni una «mejor zona».
 */
const PintadoUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icono = (id) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const css = (nombre, defecto) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto;
  const rgba = (hex, a) => {
    const h = String(hex).replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const v = parseInt(n, 16);
    return Number.isFinite(v) ? `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})` : hex;
  };

  let api = null; // { map, datos(opciones), distanciaQuebradaM(), alCambiar? }
  let capa = null;
  let criterios = []; // lo que se pinta ahora: [{ id, umbralM, prioridad: 1 }]
  let contexto = { radioGlobalM: null, incluirCondicional: false }; // lo que vino de una búsqueda del chat
  let secuencia = 0; // descarta cálculos viejos si la persona cambia de criterio rápido

  // -------------------------------------------------------------- Capa de colores
  /** Un solo lienzo sobre el mapa con todas las celdas; se redibuja al mover o acercar. */
  function crearCapa(map) {
    const Capa = L.Layer.extend({
      onAdd(m) {
        this._canvas = L.DomUtil.create('canvas', 'pintado-canvas');
        this._canvas.setAttribute('aria-hidden', 'true');
        m.getPane('pintado').appendChild(this._canvas);
        m.on('moveend zoomend resize viewreset', this._dibujar, this);
        m.on('zoomstart', this._ocultar, this);
        this._dibujar();
      },
      onRemove(m) {
        m.off('moveend zoomend resize viewreset', this._dibujar, this);
        m.off('zoomstart', this._ocultar, this);
        L.DomUtil.remove(this._canvas);
        this._canvas = null;
      },
      fijar(celdas, estados, pasoM) {
        this._celdas = celdas;
        this._estados = estados;
        this._pasoM = pasoM;
        this._dibujar();
      },
      _ocultar() { if (this._canvas) this._canvas.style.opacity = '0'; },
      _trama(tipo, dpr) {
        const t = document.createElement('canvas');
        const lado = 8 * dpr;
        t.width = lado; t.height = lado;
        const c = t.getContext('2d');
        if (tipo === 'rayas') {
          const no = css('--no', '#9b2415');
          c.fillStyle = rgba(no, 0.1); c.fillRect(0, 0, lado, lado);
          c.strokeStyle = rgba(no, 0.65); c.lineWidth = 2.2 * dpr; c.lineCap = 'square';
          c.beginPath();
          // Tres tramos de la misma diagonal: la central y las dos esquinas, para que la trama empalme sin costuras.
          c.moveTo(-lado, lado * 2); c.lineTo(lado * 2, -lado);
          c.moveTo(-lado, lado); c.lineTo(lado, -lado);
          c.moveTo(0, lado * 2); c.lineTo(lado * 2, 0);
          c.stroke();
        } else {
          const dato = css('--dato', '#444b5c');
          c.fillStyle = rgba(dato, 0.1); c.fillRect(0, 0, lado, lado);
          c.fillStyle = rgba(dato, 0.85);
          c.beginPath(); c.arc(lado / 2, lado / 2, 1.7 * dpr, 0, Math.PI * 2); c.fill();
        }
        return t;
      },
      _dibujar() {
        const m = this._map || map;
        const cv = this._canvas;
        if (!cv || !m) return;
        const dpr = window.devicePixelRatio || 1;
        const size = m.getSize();
        const padX = Math.round(size.x * 0.5);
        const padY = Math.round(size.y * 0.5);
        const w = size.x + padX * 2;
        const h = size.y + padY * 2;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        cv.style.width = `${w}px`; cv.style.height = `${h}px`;
        L.DomUtil.setPosition(cv, m.containerPointToLayerPoint([-padX, -padY]));
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (this._celdas && this._estados) {
          const ok = rgba(css('--ok', '#17603a'), 0.5);
          const rayas = ctx.createPattern(this._trama('rayas', dpr), 'repeat');
          const puntos = ctx.createPattern(this._trama('puntos', dpr), 'repeat');
          [rayas, puntos].forEach((p) => { if (p && p.setTransform) p.setTransform(new DOMMatrix().scale(1 / dpr)); });
          const relleno = { cumple: ok, nocumple: rayas, sindato: puntos };
          for (let i = 0; i < this._celdas.length; i += 1) {
            const r = Pintado.rectDeCelda(this._celdas[i], this._pasoM);
            const a = m.latLngToContainerPoint([r.norte, r.oeste]);
            const b = m.latLngToContainerPoint([r.sur, r.este]);
            const x = a.x + padX - 0.5; const y = a.y + padY - 0.5;
            const ancho = b.x - a.x + 1; const alto = b.y - a.y + 1;
            if (x + ancho < 0 || y + alto < 0 || x > w || y > h) continue;
            ctx.fillStyle = relleno[this._estados[i]];
            ctx.fillRect(x, y, ancho, alto);
          }
        }
        cv.style.opacity = '1';
      },
    });
    return new Capa();
  }

  // -------------------------------------------------------------------- Chips
  const quebradaM = () => (api && api.distanciaQuebradaM ? api.distanciaQuebradaM() : null);

  function dibujarChips() {
    const lista = Pintado.chips({ distanciaQuebradaM: quebradaM() });
    const activos = new Set(criterios.map((c) => c.id));
    const boton = (c) => `<button type="button" class="chip" data-id="${c.id}" aria-pressed="${activos.has(c.id)}">${icono('cumple')}<span>${esc(c.etiqueta)}</span></button>`;
    const grupo = (g) => lista.filter((c) => c.grupo === g).map(boton).join('');
    const cauce = grupo('cauce');
    $('pintar-chips').innerHTML = `${grupo('servicio')}<span class="pintar-sep" aria-hidden="true"></span>${grupo('zona')}${cauce ? `<span class="pintar-sep" aria-hidden="true"></span>${cauce}` : ''}`;
    $('pintar-quitar').hidden = criterios.length === 0;
  }

  // ------------------------------------------------------------------ Leyenda
  function limpiarLeyenda() {
    $('leyenda').hidden = true;
    $('leyenda-resumen').textContent = '';
    $('leyenda-estados').innerHTML = '';
    $('leyenda-filas').innerHTML = '';
  }

  function dibujarLeyenda(r, datos) {
    const l = Pintado.leyenda({ criterios, umbrales: datos.umbrales, radioGlobalM: contexto.radioGlobalM, config: CONFIG });
    const cuenta = { cumple: r.resumen.cumple, nocumple: r.resumen.nocumple, sindato: r.resumen.sindato };
    const texto = Pintado.textoResumen(r.resumen, criterios);
    $('leyenda-resumen').textContent = texto;
    $('leyenda-estados').innerHTML = l.estados.map((e) => `<li>
        <span class="muestra muestra-${e.patron}" aria-hidden="true"></span>
        <span class="estado-txt e-${e.id}">${icono(e.icono)}${esc(e.texto)}</span>
        <span class="n">${Pintado.fmtMiles(cuenta[e.id])} ${cuenta[e.id] === 1 ? 'celda' : 'celdas'}</span>
        ${e.id === 'sindato' ? `<small>${esc(e.explicacion)}</small>` : ''}
      </li>`).join('');
    $('leyenda-inter').hidden = !l.interseccion;
    $('leyenda-filas').innerHTML = l.filas.map((f) => {
      const c = r.porCriterio[f.id];
      return `<li><strong>${esc(f.descripcion)}</strong>
        <small>Fuente: ${esc(f.fuente)}.</small>
        ${f.aproximado ? '<small>Es una aproximación con la zonificación, no un dato medido.</small>' : ''}
        <small>${Pintado.fmtMiles(c.cumple)} de ${Pintado.fmtMiles(c.total)} celdas cumplen este criterio${c.sindato ? `; ${Pintado.fmtMiles(c.sindato)} sin dato` : ''}.</small></li>`;
    }).join('');
    $('leyenda-pie').textContent = `Cada celda mide ${CONFIG.asistente.pasoCeldaM} m y se pinta según su centro. Solo se pintan las zonas ${contexto.incluirCondicional ? 'construibles y condicionadas' : 'construibles'} del plano. Datos de OpenStreetMap del ${datos.fecha || 'sin fecha'}; distancias en línea recta.`;
    $('leyenda').hidden = false;
    $('pintar-anuncio').textContent = texto;
  }

  function errorLeyenda(mensaje) {
    $('leyenda-resumen').textContent = 'No pude pintar el mapa';
    $('leyenda-estados').innerHTML = `<li class="leyenda-error">${esc(mensaje)}</li>`;
    $('leyenda-filas').innerHTML = '';
    $('leyenda-inter').hidden = true;
    $('leyenda-pie').textContent = 'Los demás criterios y el chat siguen funcionando.';
    $('leyenda').hidden = false;
  }

  // ------------------------------------------------------------------- Pintar
  function quitarCapa() {
    if (capa) capa.fijar(null, null, 0);
  }

  async function aplicar() {
    const mia = ++secuencia;
    dibujarChips();
    if (criterios.length === 0) {
      quitarCapa();
      limpiarLeyenda();
      return;
    }
    $('leyenda-resumen').textContent = 'Calculando…';
    $('leyenda').hidden = false;
    try {
      const datos = await api.datos({ incluirCondicional: contexto.incluirCondicional });
      if (mia !== secuencia) return;
      const r = Pintado.evaluar({ celdas: datos.celdas, datos: datos.datos, criterios, umbrales: datos.umbrales, radioGlobalM: contexto.radioGlobalM });
      capa.fijar(datos.celdas, r.estados, CONFIG.asistente.pasoCeldaM);
      dibujarLeyenda(r, datos);
    } catch (err) {
      if (mia !== secuencia) return;
      console.error('[Pintado]', err);
      quitarCapa();
      errorLeyenda(err && err.message ? err.message : 'Faltan datos para pintar.');
    }
  }

  function alternar(id) {
    const ya = criterios.some((c) => c.id === id);
    const ids = ya ? criterios.filter((c) => c.id !== id).map((c) => c.id) : [...criterios.map((c) => c.id), id];
    criterios = Pintado.criteriosDe(ids, { previos: criterios, distanciaQuebradaM: quebradaM() });
    if (criterios.length === 0) contexto = { radioGlobalM: null, incluirCondicional: false };
    aplicar();
  }

  /** «Quitar colores»: deja el mapa sin pintar y olvida lo que vino de una búsqueda. */
  function quitar({ anunciar = true } = {}) {
    criterios = [];
    contexto = { radioGlobalM: null, incluirCondicional: false };
    aplicar();
    if (anunciar) $('pintar-anuncio').textContent = 'Quité los colores del mapa.';
  }

  /** Una búsqueda del chat: se pinta el mismo resultado (los mismos criterios, distancias y zonas condicionales). */
  function aplicarBusqueda({ criterios: dichos, radioGlobalM = null, incluirCondicional = false }) {
    if (!api) return;
    const ids = (dichos || []).map((c) => c.id);
    criterios = Pintado.criteriosDe(ids, { previos: dichos, distanciaQuebradaM: (dichos.find((c) => c.id === 'lejosQuebrada') || {}).umbralM || quebradaM() });
    contexto = { radioGlobalM: Number.isFinite(radioGlobalM) ? radioGlobalM : null, incluirCondicional: Boolean(incluirCondicional) };
    aplicar();
  }

  /** La distancia a quebradas pudo cambiar (menú del chat): el chip aparece o desaparece. */
  function refrescarChips() {
    if (!api) return;
    const hayDistancia = Boolean(quebradaM());
    if (!hayDistancia && criterios.some((c) => c.id === 'lejosQuebrada')) {
      criterios = criterios.filter((c) => c.id !== 'lejosQuebrada');
      aplicar();
    } else {
      dibujarChips();
    }
  }

  function iniciar(opciones) {
    api = opciones;
    const pane = api.map.createPane('pintado');
    pane.style.zIndex = 355; // sobre el plano de zonificación y bajo el mapa de calor y los marcadores
    pane.style.pointerEvents = 'none';
    capa = crearCapa(api.map);
    capa.addTo(api.map);
    dibujarChips();
    $('pintar-chips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (b) alternar(b.dataset.id);
    });
    $('pintar-quitar').addEventListener('click', () => { quitar(); $('pintar-chips').querySelector('.chip').focus(); });
    // El tema claro u oscuro cambia los colores de las tramas: se vuelven a dibujar.
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => capa._dibujar());
    // En pantallas angostas la leyenda empieza plegada para no tapar el mapa.
    if (window.matchMedia('(max-width: 639.98px)').matches) $('leyenda').open = false;
  }

  return { iniciar, aplicarBusqueda, quitar, refrescarChips };
})();
