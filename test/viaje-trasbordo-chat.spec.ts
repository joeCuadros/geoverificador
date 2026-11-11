/**
 * El asistente y el viaje con un trasbordo: «¿cómo llego al Parque Industrial?» responde la mejor opción primero, en una frase, y debajo las alternativas; si no hay ruta directa
 * ofrece las de un trasbordo (la ruta A, dónde bajar, la ruta B), con lo que se camina en cada tramo, el tiempo aproximado y las dos esperas, y las dibuja en el mapa. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const cargarConfig = () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${readFileSync(join(__dirname, '..', 'public', 'js', 'config.js'), 'utf8')}\nglobalThis.__CONFIG = CONFIG;`, ctx, { filename: 'config.js' });
  return (ctx as { __CONFIG: any }).__CONFIG;
};
const CONFIG = cargarConfig();
const Calculos = require('../public/js/calculos.js');
Object.assign(globalThis, { CONFIG, Calculos });
const Viaje = require('../public/js/viaje.js');
Object.assign(globalThis, { Viaje });
const Asistente = require('../public/js/asistente.js');
const Capas = require('../public/js/capas.js');

const PI = CONFIG.destinos.find((d: any) => d.id === 'parque-industrial');
const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((PI.lat * Math.PI) / 180));
const pt = (este: number, norte = 0) => ({ lat: PI.lat + norte / M_POR_GRADO_LAT, lon: PI.lon + dLon(este) });
const traza = (...xs: Array<[number, number]>) => xs.map(([e, n]) => [pt(e, n).lon, pt(e, n).lat]);
const ruta = (id: string, partes: number[][][], extra: object = {}) => ({
  id, fuente: 'OSM', linea: 'C10', ramal: 'A', nombre: `ruta ${id}`, desde: 'Ciudad Blanca', hasta: 'La Mansión del Fundador', operador: 'C10 - MegaBus', duracionMin: 40, intervaloMin: 5, horario: null, tarifa: null, color: '#123456', url: null, partes, ...extra,
});
// A: de oeste a este, termina a 2 km del Parque Industrial. B: sale a ~130 m del final de A y llega a 100 m del Parque Industrial.
const A = ruta('osm/a', [traza([-6000, 0], [-2000, 0])], { linea: 'C3', ramal: 'Enace', desde: 'Zamácola', hasta: 'Av. Venezuela', operador: 'C3 - Transcayma', color: '#ff0000' });
const B = ruta('osm/b', [traza([-1900, 80], [0, 100], [1000, 100])], { linea: 'C9', ramal: 'Dolores', desde: 'Av. Venezuela', hasta: 'Parque Industrial', operador: 'C9 - Emarsistran', duracionMin: 25, intervaloMin: 6, color: '#0000ff' });
const DIRECTA = ruta('osm/d', [traza([-6000, 0], [0, 100], [2000, 100])], { linea: 'C10', ramal: 'La Mansión', duracionMin: 30, intervaloMin: 4 });
const CASA = pt(-4000, 60);
const tiempo = { velocidadPieMs: 1.07, factorRodeo: null, fuentePie: 'MUTCD', fuenteBus: 'la duración de OSM' };
const ctx = (extra: object = {}) => ({ punto: CASA, viajeRutas: [A, B], caminarM: 400, trasbordoM: 200, tiempo, zona: null, estadoPDM: null, ...extra });
const resp = (c: object = ctx()) => Asistente.responder({ tipo: 'viaje', criterios: [], destino: PI, viaje: {} }, c);

describe('Asistente.responder: viaje con un trasbordo', () => {
  it('sin ruta directa ofrece la opción con un trasbordo: la mejor primero, en una frase, con las rutas, dónde bajar, el tiempo aproximado y lo que se camina', () => {
    const r = resp();
    const lineas = r.texto.split('\n');
    expect(lineas[1]).toMatch(/^Mejor opción: C3 → bajar en el cruce del mapa → C9: con un trasbordo, ≈ \d+ min aprox\. sin esperas, caminas \d+ m\.$/);
    expect(r.resumen).toMatch(/^C3 → bajar en el cruce del mapa → C9: con un trasbordo/);
    expect(r.texto).toMatch(/No hay ninguna ruta directa/);
    expect(r.texto).toMatch(/Con un trasbordo hay 1 opción/);
    expect(r.texto).toMatch(/• C3 · Enace[^\n]*→ bajar en [^\n]*→ C9 · Dolores[^\n]*caminas \d+ m al subir, \d+ m entre las dos rutas y \d+ m al bajar \(\d+ m en total\); \d,\d km y \d,\d km en bus/);
    expect(r.texto).toMatch(/Tiempo aproximado: ≈ \d+ min en total sin contar la espera \(≈ \d+ min a pie \+ ≈ \d+ min en bus\); espera media de ≈ 5,5 min en total \(una por ruta\)/);
    expect(r.alternativas).toEqual([]);
  });
  it('dice que el trasbordo a 200 m es un supuesto, que no sabe si hay parada ni si las frecuencias enlazan, y que los tiempos son estimaciones; nada de SmartBus', () => {
    const t = resp().texto;
    expect(t).toMatch(/≤ 200 m una de la otra \(un supuesto del proyecto, no una norma\)/);
    expect(t).toMatch(/no sé si hay una parada ahí ni si las frecuencias permiten el enlace/);
    expect(t).toMatch(/estimaciones[^\n]*no un horario garantizado/);
    expect(t).not.toMatch(/SmartBus/);
  });
  it('si hay una parada mapeada a 200 m o menos del cruce dice dónde bajar con su nombre; si no, «el cruce marcado en el mapa»', () => {
    const p = { osm: 'node/1', nombre: 'Av. Venezuela', lat: pt(-1950, 40).lat, lon: pt(-1950, 40).lon, rutas: ['osm/a'] };
    const t = resp(ctx({ viajeParadas: [p] }));
    expect(t.texto).toMatch(/bajar en «Av\. Venezuela» \(parada mapeada, a \d+ m del cruce\)/);
    expect(t.resumen).toMatch(/→ bajar en «Av\. Venezuela» →/);
    expect(resp().texto).toMatch(/bajar en el cruce marcado en el mapa \(paradas no mapeadas\)/);
  });
  it('en el mapa dibuja las dos rutas (cada una de donde subes a donde bajas) y el punto de trasbordo', () => {
    const v = resp().mapa.viaje;
    expect(v.tramos).toHaveLength(2);
    expect(v.tramos.map((t: any) => t.linea)).toEqual(['C3', 'C9']);
    expect(v.tramos.map((t: any) => t.opcion)).toEqual([1, 1]);
    expect(v.tramos[0].segmento.length).toBeGreaterThan(5);
    expect(v.tramos[0].detalle).toMatch(/Subes a esta ruta/);
    expect(v.trasbordos).toHaveLength(1);
    expect(Number.isFinite(v.trasbordos[0].lat)).toBe(true);
    expect(resp().mapa.capas).toEqual(['viaje']);
  });
  it('con ruta directa la ofrece y no ofrece trasbordos; la mejor opción también va primero', () => {
    const r = resp(ctx({ viajeRutas: [A, B, DIRECTA] }));
    expect(r.texto.split('\n')[1]).toMatch(/^Mejor opción: C10 · La Mansión[^\n]*: ruta directa, ≈ \d+ min aprox\., caminas \d+ m\.$/);
    expect(r.texto).toMatch(/Hay 1 ruta directa/);
    expect(r.texto).not.toMatch(/Con un trasbordo hay/);
    expect(r.mapa.viaje.trasbordos).toEqual([]);
  });
  it('si no hay ni directa ni con un trasbordo lo dice, sin inventar', () => {
    const r = resp(ctx({ viajeRutas: [A] }));
    expect(r.texto).toMatch(/Tampoco hay una opción con un trasbordo/);
    expect(r.resumen).toBeNull();
    expect(r.texto).not.toMatch(/Mejor opción/);
    expect(r.mapa.viaje.tramos).toEqual([]);
  });
  it('sin la duración que etiqueta OSM no da minutos en el resumen pero sí lo que se camina', () => {
    const r = resp(ctx({ viajeRutas: [{ ...A, duracionMin: null }, B] }));
    expect(r.resumen).toMatch(/con un trasbordo, caminas \d+ m\./);
    expect(r.texto).toMatch(/sin duración publicada/);
  });
});

describe('Capas: la capa «viaje» con un trasbordo', () => {
  const UM = { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };
  const datos = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UM);
  const viaje = resp().mapa.viaje;
  const c = Capas.construir({ capas: [{ id: 'viaje', ...viaje }], datos, zonas: [], cauces: [], sismos: [], umbrales: UM, area: null });
  it('conserva los dos tramos y el punto de trasbordo, y la leyenda dice que son opciones con un trasbordo', () => {
    expect(c.viaje.tramos).toHaveLength(2);
    expect(c.viaje.trasbordos).toHaveLength(1);
    expect(c.leyenda.map((l: { texto: string }) => l.texto).join(' ')).toMatch(/1 opción con un trasbordo \(dos rutas, de donde subes a donde bajas\)/);
  });
  it('el encuadre del mapa incluye el origen, el destino, los dos tramos y el trasbordo', () => {
    const [oeste, sur, este, norte] = c.limites;
    for (const p of [CASA, pt(0, 100), viaje.trasbordos[0]]) {
      expect(p.lon).toBeGreaterThanOrEqual(oeste - 1e-9);
      expect(p.lon).toBeLessThanOrEqual(este + 1e-9);
      expect(p.lat).toBeGreaterThanOrEqual(sur - 1e-9);
      expect(p.lat).toBeLessThanOrEqual(norte + 1e-9);
    }
  });
});
