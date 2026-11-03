/**
 * Pruebas de public/js/transporte.js: el punto de extensión para las rutas de buses. Hoy no hay datos de rutas (la gestión
 * con SmartBus sigue en curso), así que la lista está vacía y la herramienta lo dice en vez de inventar rutas.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Transporte = require('../public/js/transporte.js');

describe('Transporte.rutas', () => {
  it('no trae rutas: no hay datos y no se inventan', () => {
    expect(Transporte.rutas).toEqual([]);
    expect(Transporte.hayRutas()).toBe(false);
  });

  it('dice sin rodeos que faltan los datos y por qué', () => {
    expect(Transporte.textoRutas()).toBe('Rutas de buses: aún sin datos (en gestión con SmartBus).');
  });

  it('cuando se carguen rutas, el texto deja de decir que faltan', () => {
    const rutas = [{ id: 'A1', nombre: 'Línea A1', paraderos: [] }];
    expect(Transporte.hayRutas(rutas)).toBe(true);
    expect(Transporte.textoRutas(rutas)).toBe('Rutas de buses: 1 ruta con datos.');
    expect(Transporte.textoRutas([...rutas, { id: 'B2', nombre: 'Línea B2', paraderos: [] }])).toBe('Rutas de buses: 2 rutas con datos.');
  });

  it('ignora lo que no tiene la forma de una ruta', () => {
    expect(Transporte.hayRutas([{}, null, 5])).toBe(false);
  });
});
