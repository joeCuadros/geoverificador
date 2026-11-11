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

describe('Viaje.cercanas', () => {
  it('cuenta las rutas que pasan a ≤ 400 m de un punto, una por línea + ramal + sentido', () => {
    const a = ruta('a', [RECTA]);
    const b = ruta('b', [RECTA], { fuente: 'SmartBus' }); // la misma ruta en la otra fuente
    const c = ruta('c', [linea([0, 900], [6000, 900])], { ramal: 'B' });
    const r = Viaje.cercanas(pt(1000, 100), [a, b, c], OPC);
    expect(r).toHaveLength(1);
    expect(r[0].distanciaM).toBeCloseTo(100, -1);
    expect(Viaje.cercanas(pt(1000, 800), [a, b, c], OPC).map((x: any) => x.ruta.ramal)).toEqual(['B']);
    expect(Viaje.cercanas({ lat: NaN, lon: 0 }, [a], OPC)).toEqual([]);
  });
});

describe('Viaje.indiceDestino y Viaje.alcanza: desde qué orígenes se llega al destino sin transbordo (para buscar zonas)', () => {
  const ida = ruta('ida', [RECTA]);
  const vuelta = ruta('vuelta', [[...RECTA].reverse()]);
  const destino = pt(5000, 0);
  const idx = Viaje.indiceDestino(destino, [ida, vuelta], OPC);
  it('un origen cerca de la ruta y antes del destino alcanza; da cuánto camina y por qué ruta', () => {
    const a = Viaje.alcanza(idx, pt(500, 150));
    expect(a.cumple).toBe(true);
    expect(a.caminarM).toBeGreaterThan(140);
    expect(a.caminarM).toBeLessThan(160);
    expect(a.ruta.id).toBe('ida');
    expect(a.n).toBe(1);
  });
  it('un origen pasado el destino (en el sentido de la ruta) no alcanza con esa ruta, y uno lejos del trazado tampoco', () => {
    expect(Viaje.alcanza(idx, pt(5800, 50)).ruta && Viaje.alcanza(idx, pt(5800, 50)).ruta.id).not.toBe('ida');
    expect(Viaje.alcanza(idx, pt(500, 900)).cumple).toBe(false);
  });
  it('coincide con rutasDirectas en una malla de orígenes', () => {
    for (const e of [-200, 0, 700, 2500, 4900, 5100, 6200]) {
      for (const n of [-600, -100, 80, 350, 420]) {
        const o = pt(e, n);
        const directo = Viaje.rutasDirectas(o, destino, [ida, vuelta], OPC).directas.length > 0;
        expect(Viaje.alcanza(idx, o).cumple).toBe(directo);
      }
    }
  });
  it('zonasConRutaDirecta devuelve, de una lista de celdas, las que alcanzan el destino, con lo que caminan', () => {
    const celdas = [pt(500, 100), pt(500, 2000), pt(3000, -50)].map((p, i) => ({ ...p, i }));
    const r = Viaje.zonasConRutaDirecta(destino, [ida, vuelta], celdas, OPC);
    expect(r.map((x: any) => x.celda.i)).toEqual([0, 2]);
    expect(r[0].caminarM).toBeCloseTo(100, -1);
  });
});

describe('Viaje.estimarTiempo: tiempo aproximado, con sus supuestos', () => {
  const item = { caminarOrigenM: 300, caminarDestinoM: 150, viajeM: 5000, longitudM: 20000, ruta: { duracionMin: 60, intervaloMin: 10 } };
  const T = { velocidadPieMs: 1.0, factorRodeo: null };
  it('a pie: la distancia en línea recta de las dos puntas a la velocidad dada; en bus: la duración que etiqueta OSM para toda la ruta, prorrateada por la distancia recorrida', () => {
    const t = Viaje.estimarTiempo(item, T);
    expect(t.caminarMin).toBeCloseTo(7.5, 5); // 450 m a 1 m/s
    expect(t.busMin).toBeCloseTo(15, 5); // 60 min × 5 / 20 km
    expect(t.totalSinEsperaMin).toBeCloseTo(22.5, 5);
    expect(t.esperaMediaMin).toBe(5); // la mitad del intervalo de 10 min si llegas sin mirar el horario
    expect(t.fuenteBus).toMatch(/OpenStreetMap/);
  });
  it('con un factor de rodeo (si hubiera una fuente) alarga solo la caminata', () => {
    const t = Viaje.estimarTiempo(item, { velocidadPieMs: 1.0, factorRodeo: 1.5 });
    expect(t.caminarMin).toBeCloseTo(11.25, 5);
    expect(t.busMin).toBeCloseTo(15, 5);
  });
  it('sin la duración de la ruta (SmartBus) no inventa el tiempo en bus ni el total; sin velocidad a pie, tampoco la caminata', () => {
    const sb = { ...item, ruta: { duracionMin: null, intervaloMin: null } };
    const t = Viaje.estimarTiempo(sb, T);
    expect(t).toMatchObject({ busMin: null, totalSinEsperaMin: null, esperaMediaMin: null });
    expect(t.caminarMin).toBeCloseTo(7.5, 5);
    expect(Viaje.estimarTiempo(item, { velocidadPieMs: null, factorRodeo: null })).toMatchObject({ caminarMin: null, totalSinEsperaMin: null });
    expect(Viaje.estimarTiempo(item, null)).toMatchObject({ caminarMin: null, busMin: 15, totalSinEsperaMin: null });
  });
});
