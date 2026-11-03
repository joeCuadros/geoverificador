/**
 * recorrido.js: El primer momento de la visita: Inicio → guía → chat (sin DOM, sin red).
 *
 * La primera vez se abre el Inicio; «Comenzar recorrido» abre la guía (tour.js) y, al terminarla u omitirla, la persona
 * llega al chat. «Ya lo conozco: ir al chat» salta la guía. En ambos casos se recuerda en este navegador y, en las visitas
 * siguientes, se abre directo el chat. «¿Cómo funciona?» vuelve a abrir la guía y un enlace del encabezado vuelve al Inicio.
 *
 * Estado: { vista: 'inicio' | 'espacio', guia: boolean, enRecorrido: boolean }
 *   enRecorrido: la guía se abrió desde el Inicio (al cerrarla se pasa al chat); si se abrió con «¿Cómo funciona?» no.
 *
 * Se carga como script del navegador (define `Recorrido`) y también como módulo CommonJS para las pruebas
 * (test/recorrido.spec.ts). espacio-ui.js es quien toca el DOM; aquí solo viven las decisiones.
 */
const Recorrido = (() => {
  const CLAVE_VISTO = 'geoverificador.inicioVisto';

  const estadoInicial = (vista) => ({ vista: vista === 'inicio' ? 'inicio' : 'espacio', guia: false, enRecorrido: false });

  /** Qué vista abre la página: el Inicio la primera vez, el chat en las visitas de regreso. */
  function vistaInicial({ visto, busqueda } = {}) {
    const q = typeof busqueda === 'string' ? busqueda : '';
    if (/(^|[?&])inicio=1(&|$)/.test(q)) return 'inicio';
    if (/(^|[?&])(tour|inicio)=no(&|$)/.test(q)) return 'espacio';
    return visto ? 'espacio' : 'inicio';
  }

  /**
   * Siguiente estado según el evento, y si hay que recordar que la persona ya pasó por el Inicio. No modifica el estado recibido.
   *   comenzar:    «Comenzar recorrido →»
   *   saltar:      «Ya lo conozco: ir al chat»
   *   abrir-guia:  «¿Cómo funciona?»
   *   cerrar-guia: terminar, omitir o cerrar la guía
   *   abrir-inicio: el enlace del encabezado
   */
  function transicion(estado, evento) {
    const e = { vista: estado.vista, guia: estado.guia, enRecorrido: estado.enRecorrido };
    switch (evento) {
      case 'comenzar':
        return { estado: { vista: 'inicio', guia: true, enRecorrido: true }, marcarVisto: false };
      case 'saltar':
        return { estado: { vista: 'espacio', guia: false, enRecorrido: false }, marcarVisto: true };
      case 'abrir-guia':
        return { estado: { vista: e.vista, guia: true, enRecorrido: false }, marcarVisto: false };
      case 'cerrar-guia':
        if (e.enRecorrido) return { estado: { vista: 'espacio', guia: false, enRecorrido: false }, marcarVisto: true };
        return { estado: { vista: e.vista, guia: false, enRecorrido: false }, marcarVisto: false };
      case 'abrir-inicio':
        return { estado: { vista: 'inicio', guia: false, enRecorrido: false }, marcarVisto: false };
      default:
        return { estado: e, marcarVisto: false };
    }
  }

  // El almacenamiento del navegador puede faltar o lanzar (ventana privada, datos bloqueados): nunca debe romper la página.
  function visto(almacen) {
    try {
      return !!almacen && almacen.getItem(CLAVE_VISTO) === '1';
    } catch (err) {
      return false;
    }
  }

  function marcarVisto(almacen) {
    try {
      if (almacen) almacen.setItem(CLAVE_VISTO, '1');
    } catch (err) {
      /* sin almacenamiento: el Inicio volverá a aparecer en la próxima visita, no pasa nada */
    }
  }

  return { CLAVE_VISTO, estadoInicial, vistaInicial, transicion, visto, marcarVisto };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Recorrido;
