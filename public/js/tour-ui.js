/**
 * tour-ui.js — Vista del recorrido guiado (diálogo). El contenido y la navegación están en tour.js.
 * Se abre solo la primera visita (se puede omitir) y de nuevo con el botón «¿Cómo funciona?». Cualquier forma de cerrarlo
 * (Omitir, Escape, la X o llegar al final) lo marca como visto en localStorage, con try/catch. Con `?tour=no` en la URL no
 * se abre solo.
 */
const TourUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icono = (id) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const almacen = () => { try { return window.localStorage; } catch (err) { return null; } };

  let indice = 0;

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
    $('tour-siguiente').textContent = Tour.esUltimo(indice) ? 'Empezar' : 'Siguiente';
    $('tour-omitir').hidden = Tour.esUltimo(indice);
    $('tour-cuerpo').scrollTop = 0;
  }

  function ir(i, { foco = true } = {}) {
    indice = Tour.limitar(i);
    render();
    if (foco) $('tour-h').focus(); // el lector de pantalla lee el título del paso nuevo
  }

  function abrir() {
    const d = $('tour');
    if (d.open) return;
    indice = 0;
    render();
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    $('tour-h').focus();
  }

  function cerrar() {
    const d = $('tour');
    if (typeof d.close === 'function') d.close(); else { d.removeAttribute('open'); Tour.marcarTourVisto(almacen()); }
  }

  function iniciar() {
    const d = $('tour');
    $('ayuda-btn').addEventListener('click', abrir);
    $('tour-siguiente').addEventListener('click', () => { if (Tour.esUltimo(indice)) cerrar(); else ir(Tour.siguiente(indice)); });
    $('tour-anterior').addEventListener('click', () => ir(Tour.anterior(indice)));
    $('tour-omitir').addEventListener('click', cerrar);
    $('tour-cerrar').addEventListener('click', cerrar);
    d.addEventListener('close', () => Tour.marcarTourVisto(almacen()));

    const sinTour = /(^|[?&])tour=no(&|$)/.test(window.location.search);
    if (!sinTour && !Tour.tourVisto(almacen())) setTimeout(abrir, 350);
  }

  return { iniciar, abrir };
})();
