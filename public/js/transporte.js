/**
 * transporte.js — Punto de extensión para las rutas de buses (sin DOM, sin red).
 *
 * Hoy la herramienta solo sabe dónde están los paraderos (OpenStreetMap); no hay datos de rutas, horarios ni frecuencias. La
 * gestión de esos datos con SmartBus sigue en curso, así que `rutas` está vacía y NO se inventa nada. Cuando haya datos
 * basta con llenar `rutas` con objetos { id, nombre, paraderos: [...] }: la vista ya pregunta `hayRutas()` y deja de decir
 * que faltan.
 *
 * Se carga como script del navegador (define `Transporte`) y también como módulo CommonJS para las pruebas.
 */
const Transporte = (() => {
  /** Rutas de buses con datos. Vacía a propósito hasta tener una fuente (ver arriba). */
  const rutas = [];

  const esRuta = (r) => r !== null && typeof r === 'object' && typeof r.id === 'string' && typeof r.nombre === 'string';
  const validas = (lista) => (Array.isArray(lista) ? lista : []).filter(esRuta);

  /** ¿Hay rutas de buses con datos? */
  function hayRutas(lista = rutas) {
    return validas(lista).length > 0;
  }

  /** Una línea para la vista: dice que faltan los datos o cuántas rutas hay. */
  function textoRutas(lista = rutas) {
    const n = validas(lista).length;
    if (n === 0) return 'Rutas de buses: aún sin datos (en gestión con SmartBus).';
    return `Rutas de buses: ${n} ${n === 1 ? 'ruta' : 'rutas'} con datos.`;
  }

  return { rutas, hayRutas, textoRutas };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Transporte;
