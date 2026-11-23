/**
 * Desplazamiento de la conversación. Se hace a mano (no con scrollIntoView) porque scrollIntoView también mueve los contenedores con `overflow: hidden`
 * y la página entera, y sacaba la cabecera de la pantalla.
 */
function contenedorDeScroll(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

function limitesVisibles(c: HTMLElement | null): { arriba: number; abajo: number } {
  if (c) {
    const r = c.getBoundingClientRect();
    return { arriba: r.top, abajo: r.bottom };
  }
  return { arriba: 0, abajo: window.innerHeight };
}

function mover(c: HTMLElement | null, delta: number): void {
  if (Math.abs(delta) < 1) return;
  if (c) c.scrollTop += delta;
  else window.scrollBy(0, delta);
}

/** Lleva el inicio del elemento a la parte de arriba de lo visible (para leer una respuesta desde su primera línea). */
export function llevarAlInicio(el: HTMLElement, margen = 8): void {
  const c = contenedorDeScroll(el);
  mover(c, el.getBoundingClientRect().top - limitesVisibles(c).arriba - margen);
}

/** Lleva el elemento a la vista con el mínimo desplazamiento, sin dejarlo debajo del campo de escribir (`reservaAbajo` px). */
export function llevarALaVista(el: HTMLElement, reservaAbajo: number, margen = 8): void {
  const c = contenedorDeScroll(el);
  const { arriba, abajo } = limitesVisibles(c);
  const r = el.getBoundingClientRect();
  if (r.top < arriba + margen) mover(c, r.top - arriba - margen);
  else if (r.bottom > abajo - reservaAbajo) mover(c, Math.min(r.bottom - (abajo - reservaAbajo) + margen, r.top - arriba - margen));
}

/** Baja hasta el final del contenido. */
export function llevarAlFinal(el: HTMLElement): void {
  const c = contenedorDeScroll(el);
  if (c) c.scrollTop = c.scrollHeight;
  else window.scrollTo(0, document.documentElement.scrollHeight);
}
