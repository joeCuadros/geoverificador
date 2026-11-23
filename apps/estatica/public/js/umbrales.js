/**
 * umbrales.js — «Mis umbrales»: valores que fija la PERSONA y que no existen en ninguna norma (sin DOM, sin red).
 *
 * Hoy hay uno: la distancia mínima a una quebrada o a un río. Ninguna norma peruana fija esa distancia (la faja marginal
 * solo existe donde la ANA la delimitó), así que por defecto no hay umbral y la variable se muestra como INFORMATIVO. Si la
 * persona escribe el suyo, la variable pasa a cumple / no cumple «según tu umbral». Se guarda solo en este navegador
 * (localStorage, con try/catch: si el almacenamiento falla, el valor vale mientras la página siga abierta).
 *
 * Se carga como script del navegador (define `Umbrales`) y también como módulo CommonJS para las pruebas.
 */
const Umbrales = (() => {
  const CLAVE = 'geoverificador.umbrales';
  const MAXIMO_M = 50000; // un tope de sentido común: más de 50 km no distingue ningún predio de Arequipa
  const VACIO = Object.freeze({ quebradaMinM: null });

  /** Deja solo lo conocido: { quebradaMinM: entero positivo ≤ MAXIMO_M | null }. */
  function normalizar(valor) {
    const v = valor && typeof valor === 'object' ? valor.quebradaMinM : null;
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    const ok = typeof n === 'number' && Number.isFinite(n) && Math.round(n) > 0 && Math.round(n) <= MAXIMO_M;
    return { quebradaMinM: ok ? Math.round(n) : null };
  }

  function leer(almacen) {
    try {
      const crudo = almacen && almacen.getItem(CLAVE);
      return crudo ? normalizar(JSON.parse(crudo)) : { ...VACIO };
    } catch (err) {
      return { ...VACIO };
    }
  }

  /** Guarda y devuelve lo normalizado (aunque no se pueda guardar, para que la vista use el valor). */
  function guardar(almacen, valor) {
    const limpio = normalizar(valor);
    try {
      if (almacen) almacen.setItem(CLAVE, JSON.stringify(limpio));
    } catch (err) {
      /* sin almacenamiento: el umbral vale mientras la página siga abierta */
    }
    return limpio;
  }

  return { CLAVE, MAXIMO_M, normalizar, leer, guardar };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Umbrales;
