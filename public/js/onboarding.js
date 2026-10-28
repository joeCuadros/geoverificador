/**
 * onboarding.js — Lógica pura de los 3 pasos de la consulta (sin DOM, sin red).
 *
 *   Paso 1 «Ubica tu predio»   → buscar una dirección, usar la ubicación o tocar el mapa
 *   Paso 2 «Confirma el punto» → «¿Es este el predio?»; el punto se mueve tocando el mapa o con botones
 *   Paso 3 «Lee tu reporte»    → zonificación y servicios cerca del punto
 *
 * Se carga como script del navegador (define `Onboarding`) y también como módulo CommonJS para probarlo con jest
 * (test/onboarding.spec.ts). app.js es quien toca el DOM; aquí solo viven las decisiones.
 */
const Onboarding = (() => {
  const PASOS = ['ubicar', 'confirmar', 'reporte'];
  const ESTADO_INICIAL = Object.freeze({ paso: 'ubicar', hayPunto: false, moviendo: false });
  const CLAVE_CONSEJO = 'geoverificador.consejoVisto';

  const R = 6371008.8; // radio medio de la Tierra en metros (el mismo de calculos.js)
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  /**
   * Siguiente estado según el evento. No modifica el estado recibido.
   *   elegir-punto: tocar el mapa, elegir un resultado de búsqueda o usar la ubicación
   *   mover:        «Mover el punto» (muestra u oculta los botones de movimiento)
   *   confirmar:    «Sí, verificar»
   *   cambiar:      «Cambiar» en el reporte (vuelve al paso 1 y conserva el punto)
   *   nueva:        «Nueva consulta» (vuelve al inicio, sin punto)
   * En el reporte, tocar el mapa no hace nada: el punto se cambia a propósito con «Cambiar».
   */
  function transicion(estado, evento) {
    const e = { paso: estado.paso, hayPunto: estado.hayPunto, moviendo: estado.moviendo };
    switch (evento) {
      case 'elegir-punto':
        if (e.paso === 'reporte') return e;
        return { paso: 'confirmar', hayPunto: true, moviendo: false };
      case 'mover':
        return e.paso === 'confirmar' ? { ...e, moviendo: !e.moviendo } : e;
      case 'confirmar':
        return e.paso === 'confirmar' && e.hayPunto ? { paso: 'reporte', hayPunto: true, moviendo: false } : e;
      case 'cambiar':
        return e.paso === 'reporte' ? { paso: 'ubicar', hayPunto: e.hayPunto, moviendo: false } : e;
      case 'nueva':
        return { ...ESTADO_INICIAL };
      default:
        return e;
    }
  }

  const numeroDePaso = (paso) => PASOS.indexOf(paso) + 1;

  /**
   * Mueve un punto `metros` hacia N, S, E u O (en línea recta). Alternativa al arrastre del marcador
   * (WCAG 2.2, criterio 2.5.7). Con una dirección o una distancia inválidas devuelve el mismo punto.
   */
  function desplazar(punto, direccion, metros) {
    const { lat, lon } = punto;
    if (!(Number.isFinite(metros) && metros > 0)) return { lat, lon };
    const dLat = deg(metros / R);
    const dLon = deg(metros / (R * Math.cos(rad(lat))));
    switch (direccion) {
      case 'N': return { lat: lat + dLat, lon };
      case 'S': return { lat: lat - dLat, lon };
      case 'E': return { lat, lon: lon + dLon };
      case 'O': return { lat, lon: lon - dLon };
      default: return { lat, lon };
    }
  }

  /** ¿El punto cae dentro de la caja «oeste,norte,este,sur» (formato de CONFIG.viewbox)? */
  function dentroDeCaja(lat, lon, caja) {
    const v = String(caja).split(',').map(Number);
    if (v.length !== 4 || v.some((n) => !Number.isFinite(n))) return false;
    const [oeste, norte, este, sur] = v;
    return lon >= oeste && lon <= este && lat <= norte && lat >= sur;
  }

  // El almacenamiento del navegador puede faltar o lanzar (ventana privada, datos bloqueados): nunca debe romper la página.
  function consejoVisto(almacen) {
    try {
      return !!almacen && almacen.getItem(CLAVE_CONSEJO) === '1';
    } catch (err) {
      return false;
    }
  }

  function marcarConsejoVisto(almacen) {
    try {
      if (almacen) almacen.setItem(CLAVE_CONSEJO, '1');
    } catch (err) {
      /* sin almacenamiento: el consejo volverá a aparecer, no pasa nada */
    }
  }

  return { PASOS, ESTADO_INICIAL, transicion, numeroDePaso, desplazar, dentroDeCaja, consejoVisto, marcarConsejoVisto };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Onboarding;
