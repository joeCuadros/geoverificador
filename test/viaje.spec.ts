/**
 * Viaje en combi/bus: «¿qué ruta me lleva de este punto a mi trabajo?». Rutas directas entre dos puntos sobre los trazados de OpenStreetMap y de SmartBus:
 * pasan a ≤ 400 m (a pie, en línea recta) de los dos y el origen queda ANTES que el destino a lo largo del recorrido. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Calculos = require('../public/js/calculos.js');
Object.assign(globalThis, { Calculos });
const Viaje = require('../public/js/viaje.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const LAT0 = -16.4;
const LON0 = -71.54;
const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((LAT0 * Math.PI) / 180));
/** Punto a `este` m al este y `norte` m al norte de (LAT0, LON0). */
const pt = (este: number, norte = 0) => ({ lat: LAT0 + norte / M_POR_GRADO_LAT, lon: LON0 + dLon(este) });
const linea = (...xs: Array<[number, number]>) => xs.map(([e, n]) => [pt(e, n).lon, pt(e, n).lat]);
/** Un recorrido recto este-oeste de 6 km, con pocos vértices (hay que densificarlo). */
const RECTA = linea([0, 0], [6000, 0]);
const ruta = (id: string, partes: number[][][], extra: object = {}) => ({
  id, fuente: 'OSM', linea: 'C10', ramal: 'A', nombre: `C-10 ${id}`, desde: 'Ciudad Blanca', hasta: 'La Mansión del Fundador', operador: 'C10 - MegaBus', duracionMin: 40, intervaloMin: 5, partes, ...extra,
});
const OPC = { caminarM: 400 };

describe('Viaje.rutasDirectas', () => {
  const ida = ruta('ida', [RECTA]);
  const vuelta = ruta('vuelta', [[...RECTA].reverse()], { desde: 'La Mansión del Fundador', hasta: 'Ciudad Blanca' });
  const lejos = ruta('lejos', [linea([0, 3000], [6000, 3000])]);

  it('lista la ruta que pasa a ≤ 400 m de los dos y lleva del origen al destino, con lo que se camina en cada punta', () => {
    const r = Viaje.rutasDirectas(pt(500, 120), pt(5000, -200), [ida, lejos], OPC);
    expect(r.directas).toHaveLength(1);
    const d = r.directas[0];
    expect(d.ruta.id).toBe('ida');
    expect(d.caminarOrigenM).toBeGreaterThan(100);
    expect(d.caminarOrigenM).toBeLessThan(130);
    expect(d.caminarDestinoM).toBeGreaterThan(190);
    expect(d.caminarDestinoM).toBeLessThan(215);
    expect(d.viajeM).toBeGreaterThan(4400);
    expect(d.viajeM).toBeLessThan(4600);
    expect(d.caminarTotalM).toBeCloseTo(d.caminarOrigenM + d.caminarDestinoM, 5);
  });
  it('el sentido importa: la ruta que pasa por los dos pero en el orden contrario va aparte («al revés»), no como directa', () => {
    const r = Viaje.rutasDirectas(pt(500, 120), pt(5000, -200), [ida, vuelta], OPC);
    expect(r.directas.map((d: any) => d.ruta.id)).toEqual(['ida']);
    expect(r.alReves.map((d: any) => d.ruta.id)).toEqual(['vuelta']);
  });
  it('si el origen queda a más de 400 m del trazado o el destino también, no hay ruta directa', () => {
    expect(Viaje.rutasDirectas(pt(500, 450), pt(5000, 0), [ida], OPC).directas).toEqual([]);
    expect(Viaje.rutasDirectas(pt(500, 0), pt(5000, 450), [ida], OPC).directas).toEqual([]);
    expect(Viaje.rutasDirectas(pt(500, 450), pt(5000, 0), [ida], { caminarM: 500 }).directas).toHaveLength(1);
  });
  it('el segmento devuelto va de donde subes a donde bajas, siguiendo el recorrido, y trae esos dos puntos', () => {
    const d = Viaje.rutasDirectas(pt(500, 120), pt(5000, -200), [ida], OPC).directas[0];
    expect(d.subida.lat).toBeCloseTo(LAT0, 4);
    expect(d.bajada.lat).toBeCloseTo(LAT0, 4);
    const xs = d.segmento.map((p: number[]) => p[0]);
    expect(xs[0]).toBeLessThan(xs[xs.length - 1]);
    expect(d.segmento.length).toBeGreaterThan(10);
  });
  it('un recorrido que pasa dos veces cerca del origen usa el paso que sirve (el que viene antes del destino)', () => {
    const bucle = ruta('bucle', [linea([0, 0], [3000, 0], [3000, 2000], [100, 2000], [100, 100], [4000, 100], [6000, 100])]);
    const d = Viaje.rutasDirectas(pt(100, 50), pt(5500, 100), [bucle], OPC).directas[0];
    expect(d).toBeDefined();
    expect(d.viajeM).toBeGreaterThan(0);
  });
  it('un trazado en partes (con saltos) cuenta cada parte y no inventa el tramo entre ellas', () => {
    const partido = ruta('partido', [linea([0, 0], [2000, 0]), linea([2500, 0], [6000, 0])]);
    const d = Viaje.rutasDirectas(pt(500, 100), pt(5000, 100), [partido], OPC).directas[0];
    expect(d).toBeDefined();
    expect(d.viajeM).toBeGreaterThan(4300);
    expect(d.viajeM).toBeLessThan(4600);
  });
  it('ordena por lo que se camina en total y respeta un filtro de línea y de texto (de / a)', () => {
    const otra = ruta('otra', [linea([0, 60], [6000, 60])], { linea: 'C4', ramal: 'Gráficos', desde: 'San Luis', hasta: 'Av. Salaverry', operador: 'C4 - Unión Aqp' });
    const todas = Viaje.rutasDirectas(pt(500, 100), pt(5000, 100), [ida, otra], OPC).directas.map((d: any) => d.ruta.id);
    expect(todas).toEqual(['otra', 'ida']); // otra pasa a 40 m del origen
    expect(Viaje.rutasDirectas(pt(500, 100), pt(5000, 100), [ida, otra], { ...OPC, linea: 'C10' }).directas.map((d: any) => d.ruta.id)).toEqual(['ida']);
    expect(Viaje.rutasDirectas(pt(500, 100), pt(5000, 100), [ida, otra], { ...OPC, texto: 'ciudad blanca' }).directas.map((d: any) => d.ruta.id)).toEqual(['ida']);
    expect(Viaje.rutasDirectas(pt(500, 100), pt(5000, 100), [ida, otra], { ...OPC, linea: 'c-10' }).directas.map((d: any) => d.ruta.id)).toEqual(['ida']);
  });
  it('sin rutas, o con puntos inválidos, no hay nada y no revienta', () => {
    expect(Viaje.rutasDirectas(pt(0), pt(10), [], OPC)).toEqual({ directas: [], alReves: [], evaluadas: 0 });
    expect(Viaje.rutasDirectas({ lat: NaN, lon: 0 }, pt(10), [ida], OPC).directas).toEqual([]);
  });
});

describe('Viaje.unir: la misma ruta que traen OpenStreetMap y SmartBus sale una vez, con las dos fuentes', () => {
  const osm = ruta('osm/1', [RECTA], { fuente: 'OSM', linea: 'C3', ramal: 'Enace', desde: 'Urbanización Deán Valdivia', hasta: 'Avenida Venezuela' });
  const sb = ruta('sb/1', [RECTA], { fuente: 'SmartBus', linea: 'C3', ramal: 'Enace', desde: 'Urbanización Deán Valdivia', hasta: 'Avenida Venezuela', duracionMin: null, intervaloMin: null });
  const otra = ruta('sb/2', [RECTA], { fuente: 'SmartBus', linea: 'C4', ramal: 'Gráficos', desde: 'San Luis', hasta: 'Av. Salaverry' });
  it('une por línea + ramal + de/hasta (sin tildes ni mayúsculas) y conserva las fuentes y el dato de OSM', () => {
    const r = Viaje.rutasDirectas(pt(500, 100), pt(5000, 100), [osm, sb, otra], OPC);
    const u = Viaje.unir(r.directas);
    expect(u).toHaveLength(2);
    const c3 = u.find((x: any) => x.ruta.linea === 'C3');
    expect(c3.fuentes).toEqual(['OSM', 'SmartBus']);
    expect(c3.ruta.duracionMin).toBe(40);
    expect(u.find((x: any) => x.ruta.linea === 'C4').fuentes).toEqual(['SmartBus']);
  });
});

describe('Viaje: adaptadores de las dos fuentes', () => {
  it('rutas de OSM (Feature con linea, ramal, desde, hasta…) y de SmartBus (índice de Rutas) quedan con la misma forma', () => {
    const fc = { features: [
      { type: 'Feature', properties: { tipo: 'ruta', fuente: 'OSM', osm: 'relation/7', linea: 'C10', ramal: 'A', nombre: 'C-10 Bus A: X → Y', desde: 'X', hasta: 'Y', operador: 'C10 - MegaBus', duracion_min: 30, intervalo_min: 5, horario: 'Mo-Su 05:00-21:00', tarifa: '1.30 PEN', color: '#fff' }, geometry: { type: 'LineString', coordinates: RECTA } },
      { type: 'Feature', properties: { tipo: 'ruta', fuente: 'OSM', osm: 'relation/8', linea: 'C3', ramal: 'B' }, geometry: { type: 'MultiLineString', coordinates: [RECTA, RECTA] } },
    ] };
    const o = Viaje.desdeOsm(fc);
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ id: 'relation/7', fuente: 'OSM', linea: 'C10', ramal: 'A', desde: 'X', hasta: 'Y', operador: 'C10 - MegaBus', duracionMin: 30, intervaloMin: 5, horario: 'Mo-Su 05:00-21:00', tarifa: '1.30 PEN' });
    expect(o[1].partes).toHaveLength(2);
    const indice = { rutas: [{ props: { tipo: 'ruta', linea: 'C3', empresa: 'Transcayma', ramal: 'Enace', nombre: 'Enace : A → B', sentido: 'A → B', id_ruta: '17445532', color: '#FEDD00', url: 'https://smartbus.app/pe/arequipa/c3' }, partes: [RECTA] }] };
    const s = Viaje.desdeSmartbus(indice);
    expect(s[0]).toMatchObject({ id: 'smartbus/17445532', fuente: 'SmartBus', linea: 'C3', ramal: 'Enace', desde: 'A', hasta: 'B', operador: 'Transcayma', duracionMin: null });
  });
});

describe('Viaje.resolverDestino y Viaje.textoRuta', () => {
  const destinos = [
    { id: 'parque-industrial', nombre: 'Parque Industrial', alias: ['parque industrial', 'zona industrial'], lat: -16.4179, lon: -71.5497, osm: 'way/491224938' },
    { id: 'ciudad-blanca', nombre: 'Ciudad Blanca', alias: ['ciudad blanca'], lat: -16.4146, lon: -71.4844, osm: 'node/4329651109' },
  ];
  it('busca el destino por su nombre o alias, sin tildes ni mayúsculas, dentro de una frase', () => {
    expect(Viaje.resolverDestino('trabajo en el Parque Industrial', destinos).id).toBe('parque-industrial');
    expect(Viaje.resolverDestino('voy a la ZONA INDUSTRIAL', destinos).id).toBe('parque-industrial');
    expect(Viaje.resolverDestino('mi trabajo', destinos)).toBeNull();
  });
  it('si una frase nombra dos, gana el que aparece primero', () => {
    expect(Viaje.resolverDestino('de ciudad blanca al parque industrial', destinos).id).toBe('ciudad-blanca');
  });
});
