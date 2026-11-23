/**
 * tour-ui.js: Vista de la guía breve (diálogo). El contenido y la navegación están en tour.js.
 * Es el segundo momento de la visita, después del Inicio (espacio-ui.js decide cuándo abrirla con `abrir({ recorrido: true })`)
 * y se abre de nuevo con «¿Cómo funciona?». Cualquier forma de cerrarla (Omitir, Escape, la X o llegar al final) avisa a quien
 * la abrió con `alCerrar`: así el Inicio recuerda que ya se vio. La marca antigua `tourVisto` se sigue escribiendo, con try/catch.
 */
const TourUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icono = (id) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const almacen = () => { try { return window.localStorage; } catch (err) { return null; } };

  let indice = 0;
  let enRecorrido = false; // abierta desde el Inicio: al terminar lleva al chat
  let alCerrar = null;

  // Tres estados de ejemplo para la tarjeta; se rotulan como ilustrativos para que nadie los tome por un dato real.
  const MUESTRA_ESTADOS = `
    <div class="tour-muestra" role="group" aria-label="Ejemplo ilustrativo de los tres estados">
      <p class="tour-muestra-nota">Ejemplo ilustrativo: no es un dato real.</p>
      <ul>
        <li><span class="estado cumple">${icono('cumple')}Cumple</span><span>Paradero a 250 m. Referencia: 400 m.</span></li>
        <li><span class="estado nocumple">${icono('nocumple')}No cumple</span><span>Paradero a 650 m. Referencia: 400 m.</span></li>
        <li><span class="estado sindato">${icono('sindato')}Sin dato</span><span>No hay paraderos en nuestros datos.</span></li>
        <li><span class="estado informativo">${icono('info')}Informativo</span><span>Cauce a 180 m. No hay un umbral oficial para decir si es cerca o lejos.</span></li>
      </ul>
    </div>`;

  function render() {
    const paso = Tour.PASOS[indice];
    $('tour-progreso').textContent = Tour.progreso(indice);
    $('tour-h').textContent = paso.titulo;
    $('tour-puntos').innerHTML = Tour.PASOS.map((_, i) => `<li class="${i < indice ? 'hecho' : i === indice ? 'actual' : ''}"></li>`).join('');
    $('tour-cuerpo').innerHTML = `<p class="tour-intro">${esc(paso.intro)}</p>`
      + (paso.muestra === 'estados' ? MUESTRA_ESTADOS : '')
      + paso.bloques.map((b) => `<section class="tour-bloque">${b.titulo ? `<h3>${esc(b.titulo)}</h3>` : ''}<ul>${b.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul></section>`).join('');
    $('tour-anterior').disabled = Tour.esPrimero(indice);
    $('tour-siguiente').textContent = Tour.esUltimo(indice) ? (enRecorrido ? 'Ir al chat' : 'Entendido') : 'Siguiente';
    $('tour-omitir').textContent = enRecorrido ? 'Omitir e ir al chat' : 'Omitir guía';
    $('tour-omitir').hidden = Tour.esUltimo(indice);
    $('tour-cuerpo').scrollTop = 0;
  }

  function ir(i, { foco = true } = {}) {
    indice = Tour.limitar(i);
    render();
    if (foco) $('tour-h').focus(); // el lector de pantalla lee el título del paso nuevo
  }

  function abrir({ recorrido = false } = {}) {
    const d = $('tour');
    if (d.open) return;
    indice = 0;
    enRecorrido = recorrido;
    d.classList.toggle('en-recorrido', recorrido);
    render();
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    $('tour-h').focus();
  }

  function cerrar() {
    const d = $('tour');
    if (typeof d.close === 'function') d.close();
    else { d.removeAttribute('open'); Tour.marcarTourVisto(almacen()); if (alCerrar) alCerrar(); }
  }

  /** `opciones.alCerrar` se llama cada vez que la guía se cierra, sea cual sea la forma. */
  function iniciar(opciones = {}) {
    const d = $('tour');
    alCerrar = opciones.alCerrar || null;
    $('tour-siguiente').addEventListener('click', () => { if (Tour.esUltimo(indice)) cerrar(); else ir(Tour.siguiente(indice)); });
    $('tour-anterior').addEventListener('click', () => ir(Tour.anterior(indice)));
    $('tour-omitir').addEventListener('click', cerrar);
    $('tour-cerrar').addEventListener('click', cerrar);
    d.addEventListener('close', () => {
      Tour.marcarTourVisto(almacen());
      if (alCerrar) alCerrar();
    });
  }

  return { iniciar, abrir };
})();
