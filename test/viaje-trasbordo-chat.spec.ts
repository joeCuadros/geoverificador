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

describe('Asistente.interpretar: «vivo en X y trabajo en el Parque Industrial»', () => {
  const i = (t: string) => Asistente.interpretar(t, {});
  it('un lugar con nombre como origen: viaje con el origen y el destino, sin confundir uno con otro', () => {
    const r = i('vivo en Ciudad Blanca y trabajo en el Parque Industrial');
    expect(r.tipo).toBe('viaje');
    expect(r.destino.id).toBe('parque-industrial');
    expect(r.origen).toMatchObject({ tipo: 'lugar', nombre: 'Ciudad Blanca' });
    expect(Number.isFinite(r.origen.lat)).toBe(true);
  });
  it('un distrito como origen: la interfaz le pone el centro de su zona urbana', () => {
    const r = i('vivo en Cayma y trabajo en el Parque Industrial');
    expect(r).toMatchObject({ tipo: 'viaje', origen: { tipo: 'distrito', distrito: 'CAYMA', nombre: 'Cayma' } });
    expect(r.destino.id).toBe('parque-industrial');
  });
  it('«desde Paucarpata hasta el Parque Industrial»', () => {
    expect(i('¿cómo llego desde Paucarpata hasta el Parque Industrial?')).toMatchObject({ tipo: 'viaje', origen: { tipo: 'distrito', distrito: 'PAUCARPATA' } });
  });
  it('sin origen dicho el origen es null y vale el punto del mapa', () => {
    expect(i('¿cómo llego al Parque Industrial?')).toMatchObject({ tipo: 'viaje', origen: null });
  });
  it('responder: un origen con punto propio se usa aunque no haya punto elegido, y la cabecera lo dice', () => {
    const r = Asistente.responder(i('vivo en Ciudad Blanca y trabajo en el Parque Industrial'), { punto: null, viajeRutas: [DIRECTA], caminarM: 400, tiempo });
    expect(r.texto.split('\n')[0]).toMatch(/^De Ciudad Blanca \(su punto de referencia en OpenStreetMap\) a Parque Industrial/);
  });
  it('responder: un distrito sin punto resuelto pide elegir el punto; con `origenPunto` lo usa y avisa que es aproximado', () => {
    const intencion = i('vivo en Cayma y trabajo en el Parque Industrial');
    expect(Asistente.responder(intencion, { punto: null, viajeRutas: [DIRECTA], caminarM: 400, tiempo }).texto).toMatch(/No pude ubicar el centro de Cayma/);
    const r = Asistente.responder(intencion, { punto: null, origenPunto: CASA, viajeRutas: [DIRECTA], caminarM: 400, tiempo });
    expect(r.texto.split('\n')[0]).toMatch(/^De Cayma \(el centro de su zona urbana, aproximado\) a Parque Industrial/);
    expect(r.mapa.viaje.origen.lat).toBeCloseTo(CASA.lat, 6);
  });
});

describe('Búsqueda de zonas con ruta al destino: «directa» (por omisión) o «con un trasbordo» (opt-in)', () => {
  const i = (x: string) => Asistente.interpretar(x, {});
  it('por omisión la búsqueda de zonas con ruta sigue siendo solo de rutas directas', () => {
    expect(i('busco una zona con ruta directa al Parque Industrial')).toMatchObject({ tipo: 'ruta_zonas', trasbordo: false });
    expect(i('busco una zona donde llegue en combi al Parque Industrial')).toMatchObject({ tipo: 'ruta_zonas', trasbordo: false });
    expect(i('busco una zona sin transbordo al Parque Industrial')).toMatchObject({ tipo: 'ruta_zonas', trasbordo: false });
  });
  it('pedir «con un trasbordo» la amplía a las rutas con un trasbordo', () => {
    expect(i('busco una zona con ruta con un trasbordo al Parque Industrial')).toMatchObject({ tipo: 'ruta_zonas', trasbordo: true });
    expect(i('busco una zona con un transbordo al Parque Industrial')).toMatchObject({ tipo: 'ruta_zonas', trasbordo: true });
  });
  it('el resumen separa las directas de las de un trasbordo y dice el supuesto; sin la opción ofrece pedirlo', () => {
    const hits = [
      { celda: { lat: -16.4, lon: -71.5 }, caminarM: 100, ruta: A, tipo: 'directa' },
      { celda: { lat: -16.41, lon: -71.51 }, caminarM: 250, ruta: B, tipo: 'trasbordo' },
    ];
    const celdas = [...hits.map((h) => h.celda), { lat: -16.5, lon: -71.6 }, { lat: -16.6, lon: -71.7 }];
    const zonasRuta = { ...Asistente.resumirRutaZonas(hits, celdas, () => 'CAYMA', {}), caminarM: 400, trasbordo: true, trasbordoM: 200, celdasConRuta: hits.map((h) => h.celda) };
    expect(zonasRuta).toMatchObject({ conRuta: 2, directas: 1, conTrasbordo: 1 });
    const r = Asistente.responder({ tipo: 'ruta_zonas', criterios: [], destino: PI, viaje: {}, trasbordo: true }, { zonasRuta });
    expect(r.texto).toMatch(/Zonas con ruta directa o con un trasbordo a Parque Industrial: de 4 celdas[^\n]*2 \(50 %\) llegan: 1 \(25 %\) con una ruta directa y 1 \(25 %\) con UN trasbordo/);
    expect(r.texto).toMatch(/supuesto del proyecto/);
    expect(r.texto).toMatch(/\(con un trasbordo\)/);
    const sin = Asistente.responder({ tipo: 'ruta_zonas', criterios: [], destino: PI, viaje: {} }, { zonasRuta: { ...zonasRuta, trasbordo: false } });
    expect(sin.texto).toMatch(/Zonas con ruta directa a Parque Industrial/);
    expect(sin.texto).toMatch(/Para sumar los orígenes desde los que se llega con un trasbordo di, por ejemplo, «busco una zona con ruta con un trasbordo al Parque Industrial»/);
  });
});

describe('Asistente.responder: un origen sin ninguna ruta cerca', () => {
  it('dice que no hay dónde subir y cuál es la ruta más cercana y a qué distancia, sin inventar un trasbordo', () => {
    const lejos = pt(-9000, 60); // 3 km al oeste del inicio de A
    const r = Asistente.responder({ tipo: 'viaje', criterios: [], destino: PI, viaje: {} }, { punto: lejos, viajeRutas: [A, B], caminarM: 400, trasbordoM: 200, tiempo });
    expect(r.texto).toMatch(/0 rutas pasan a esa distancia de tu punto, así que no hay dónde subir cerca/);
    expect(r.texto).toMatch(/La ruta más cercana a tu punto es C3 · Enace[^\n]*, que pasa a 3 km en línea recta/);
    expect(r.resumen).toBeNull();
  });
});
