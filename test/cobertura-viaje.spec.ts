/**
 * Cobertura del viaje en combi o bus sobre toda la ciudad (scripts/lib/cobertura-viaje.js): una rejilla de orígenes sobre el área urbana zonificada de los 25 distritos y,
 * para cada destino, qué parte tiene un viaje directo, uno con un trasbordo o ninguno, y por qué. Con rutas y polígonos hechos a mano. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Calculos = require('../public/js/calculos.js');
Object.assign(globalThis, { Calculos });
const Viaje = require('../public/js/viaje.js');
const Cob = require('../scripts/lib/cobertura-viaje.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const LAT0 = -16.4;
const LON0 = -71.54;
const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((LAT0 * Math.PI) / 180));
const pt = (este: number, norte = 0) => ({ lat: LAT0 + norte / M_POR_GRADO_LAT, lon: LON0 + dLon(este) });
const linea = (...xs: Array<[number, number]>) => xs.map(([e, n]) => [pt(e, n).lon, pt(e, n).lat]);
const ruta = (id: string, partes: number[][][], extra: object = {}) => ({ id, fuente: 'OSM', linea: 'C3', ramal: id, nombre: id, desde: `de ${id}`, hasta: `a ${id}`, operador: 'C3 - X', duracionMin: 30, intervaloMin: 10, partes, ...extra });
const T = { velocidadPieMs: 1.0, factorRodeo: null };

// Destino a (6050, -3800). A va de oeste a este por norte = 0; B baja por este = 6100; C pasa directo por el destino desde el norte (este = 6050).
const A = ruta('a', [linea([0, 0], [6000, 0])], { linea: 'C3' });
const B = ruta('b', [linea([6100, 50], [6100, -4000])], { linea: 'C9' });
const C = ruta('c', [linea([6050, 3000], [6050, -4000])], { linea: 'C5' });
const DESTINO = pt(6050, -3800);

describe('Cobertura.clasificar: directa, con un trasbordo o ninguna, y por qué', () => {
  const rutas = [A, B, C];
  const cls = (o: { lat: number; lon: number }, extra: object = {}) => Cob.clasificar(o, DESTINO, rutas, { tiempo: T, ...extra });
  it('directa si una ruta lleva del origen al destino', () => {
    expect(cls(pt(6050, 2500)).estado).toBe('directa');
  });
  it('con un trasbordo si no hay directa pero A y B sirven; el origen cerca de A', () => {
    const r = cls(pt(300, 100));
    expect(r.estado).toBe('trasbordo');
    expect(r.motivo).toBeNull();
  });
  it('ninguna: ninguna ruta pasa a 400 m del origen', () => {
    expect(cls(pt(-3000, 3000))).toMatchObject({ estado: 'ninguna', motivo: 'sin_ruta_cerca_del_origen' });
  });
  it('ninguna: hay ruta cerca del origen pero el origen queda después del destino en el sentido de la ruta, y no hay trasbordo que sirva', () => {
    const solo = Cob.clasificar(pt(6050, -3900), pt(6050, -2000), [C], { tiempo: T }); // C va de norte a sur: el destino queda atrás
    expect(solo).toMatchObject({ estado: 'ninguna', motivo: 'sin_trasbordo' });
  });
  it('ninguna: ninguna ruta pasa a 400 m del destino', () => {
    expect(Cob.clasificar(pt(300, 100), pt(-9000, -9000), rutas, { tiempo: T })).toMatchObject({ estado: 'ninguna', motivo: 'sin_ruta_cerca_del_destino' });
  });
  it('distingue si con 400 m de trasbordo sí habría solución (la distancia entre rutas) o ni así (el sentido)', () => {
    const Blejos = ruta('bl', [linea([6300, 50], [6300, -4000])], { linea: 'C9' });
    const d2 = pt(6250, -3800);
    expect(Cob.clasificar(pt(300, 100), d2, [A, Blejos], { tiempo: T })).toMatchObject({ estado: 'ninguna', motivo: 'trasbordo_mas_lejos' });
  });
});

describe('Cobertura.resumir', () => {
  const filas = [
    { distrito: 'CAYMA', estado: 'directa', motivo: null },
    { distrito: 'CAYMA', estado: 'trasbordo', motivo: null },
    { distrito: 'CAYMA', estado: 'ninguna', motivo: 'sin_ruta_cerca_del_origen' },
    { distrito: 'YURA', estado: 'ninguna', motivo: 'sin_trasbordo' },
  ];
  it('cuenta por estado, por distrito y por motivo, con porcentajes', () => {
    const r = Cob.resumir(filas);
    expect(r.total).toBe(4);
    expect(r).toMatchObject({ directa: 1, trasbordo: 1, ninguna: 2 });
    expect(r.pctConSolucion).toBe(50);
    expect(r.porDistrito.CAYMA).toMatchObject({ total: 3, directa: 1, trasbordo: 1, ninguna: 1, pctConSolucion: 67 });
    expect(r.porDistrito.YURA).toMatchObject({ total: 1, ninguna: 1, pctConSolucion: 0 });
    expect(r.motivos).toEqual({ sin_ruta_cerca_del_origen: 1, sin_trasbordo: 1 });
  });
});

describe('Cobertura.celdasUrbanas: la rejilla de orígenes', () => {
  // Un cuadrado de 2 km de lado, con una zona edificable que cubre su mitad oeste y una no edificable en la este.
  const cuadrado = (e0: number, e1: number) => [[[pt(e0, -1000).lon, pt(e0, -1000).lat], [pt(e1, -1000).lon, pt(e1, -1000).lat], [pt(e1, 1000).lon, pt(e1, 1000).lat], [pt(e0, 1000).lon, pt(e0, 1000).lat], [pt(e0, -1000).lon, pt(e0, -1000).lat]]];
  const zonas = { features: [
    { properties: { codigo: 'RDM-1' }, geometry: { type: 'Polygon', coordinates: cuadrado(0, 1000) } },
    { properties: { codigo: 'ZA' }, geometry: { type: 'Polygon', coordinates: cuadrado(1000, 2000) } },
  ] };
  const reglas = { 'RDM-1': { edificable: 'si' }, ZA: { edificable: 'no' } };
  const distritos = { features: [{ properties: { distrito: 'CAYMA' }, geometry: { type: 'Polygon', coordinates: cuadrado(-100, 1500) } }] };
  it('solo toma puntos dentro de una zona edificable o condicionada y dentro de un distrito, con su distrito', () => {
    const c = Cob.celdasUrbanas({ zonas, reglas, distritos, pasoM: 500, caja: { sur: pt(0, -1500).lat, norte: pt(0, 1500).lat, oeste: pt(-200, 0).lon, este: pt(2200, 0).lon } });
    expect(c.length).toBeGreaterThan(3);
    expect(c.every((x: any) => x.distrito === 'CAYMA')).toBe(true);
    const lons = c.map((x: any) => x.lon);
    expect(Math.max(...lons)).toBeLessThan(pt(1000).lon + 1e-9); // nada de la zona agrícola (este de 1000 m)
  });
});
