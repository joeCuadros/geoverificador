/**
 * Lo que comparten el buscador y el panel de capas sin conocerse: ambos se despliegan sobre el mapa y, abiertos a la vez, se taparían. Cuando uno se abre avisa por aquí
 * y el otro se pliega; así ninguno depende del otro ni de quien los monta.
 */
export type Superficie = 'buscador' | 'capas';

const EVENTO = 'geoverificador:superficie';

/** Avisa que `abierta` acaba de desplegarse sobre el mapa. */
export function avisarSuperficie(abierta: Superficie): void {
  window.dispatchEvent(new CustomEvent<Superficie>(EVENTO, { detail: abierta }));
}

/** Llama a `plegar` cuando se abre la superficie `otra`. Devuelve la función que deja de escuchar. */
export function alAbrirSuperficie(otra: Superficie, plegar: () => void): () => void {
  const oyente = (e: Event) => {
    if ((e as CustomEvent<Superficie>).detail === otra) plegar();
  };
  window.addEventListener(EVENTO, oyente);
  return () => window.removeEventListener(EVENTO, oyente);
}

/** Lo que dice el buscador cuando hay resultados: solo cuántos (la lista se lee aparte, no dentro de la región de estado). */
export function anuncioDeResultados(n: number): string {
  return n === 1 ? '1 resultado' : `${n} resultados`;
}

/** El estado de una capa de datos del mapa (lo que el panel de capas cuenta de cada una). */
export type EstadoCapa = { tipo: 'cargando' } | { tipo: 'ok'; n: number } | { tipo: 'recortada'; n: number } | { tipo: 'lejos'; zoomMin: number; ventana: boolean } | { tipo: 'error' };

/** La frase de cada estado de capa. Los errores hablan sin sujeto («No se pudo…») y dicen qué hacer después. */
export function textoDeEstado(e: EstadoCapa): string {
  switch (e.tipo) {
    case 'cargando':
      return 'Cargando…';
    case 'ok':
      return e.n === 0 ? 'Sin elementos en esta vista.' : e.n === 1 ? '1 elemento en esta vista.' : `${e.n} elementos en esta vista.`;
    case 'recortada':
      return `Se muestran los primeros ${e.n}: acerca el mapa para ver el resto.`;
    case 'lejos':
      return e.ventana ? 'La vista abarca demasiado terreno: acerca el mapa para ver esta capa.' : `Acerca el mapa (zoom ${e.zoomMin} o más) para ver esta capa.`;
    case 'error':
      return 'No se pudo cargar esta capa. Revisa tu conexión y pulsa Reintentar.';
  }
}

/**
 * Hacia dónde va el foco con una tecla en la lista de resultados. `actual` es la posición del resultado enfocado (-1 es el campo de búsqueda) y `total` cuántos hay.
 * Devuelve la nueva posición (-1: el campo), o null si la tecla no mueve el foco. No da la vuelta: ↑ en el primero vuelve al campo y ↓ en el último se queda.
 */
export function indiceDeResultado(actual: number, total: number, tecla: string): number | null {
  if (total <= 0) return null;
  switch (tecla) {
    case 'ArrowDown':
      return Math.min(actual + 1, total - 1);
    case 'ArrowUp':
      return Math.max(actual - 1, -1);
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
}
