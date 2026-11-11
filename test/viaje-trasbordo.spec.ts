/**
 * Viaje con UN trasbordo: cuando ninguna ruta lleva directo del origen al destino, la ruta A se aborda a ≤ 400 m del origen, la ruta B se deja a ≤ 400 m del destino y las
 * dos pasan a ≤ 200 m una de la otra (supuesto declarado, no una norma), respetando el sentido de cada relación: se sube a A antes del trasbordo y se baja de B después.
 * Se ordenan por tiempo aproximado total (sin la espera) o, sin duración etiquetada, por lo que se camina y los km en vehículo. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Calculos = require('../public/js/calculos.js');
Object.assign(globalThis, { Calculos });
const Viaje = require('../public/js/viaje.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const LAT0 = -16.4;
const LON0 = -71.54;
const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((LAT0 * Math.PI) / 180));
const pt = (este: number, norte = 0) => ({ lat: LAT0 + norte / M_POR_GRADO_LAT, lon: LON0 + dLon(este) });
const linea = (...xs: Array<[number, number]>) => xs.map(([e, n]) => [pt(e, n).lon, pt(e, n).lat]);
const ruta = (id: string, partes: number[][][], extra: object = {}) => ({
  id, fuente: 'OSM', linea: 'C3', ramal: id, nombre: `ruta ${id}`, desde: `de ${id}`, hasta: `a ${id}`, operador: 'C3 - X', duracionMin: 30, intervaloMin: 10, partes, ...extra,
});
const T = { velocidadPieMs: 1.0, factorRodeo: null };

// A va de oeste a este por la calle norte=0 (6 km, 30 min). B baja de norte a sur por la calle este=6100 (4 km, 20 min): se cruzan cerca del final de A.
const A = ruta('a', [linea([0, 0], [6000, 0])], { linea: 'C3' });
const B = ruta('b', [linea([6100, 50], [6100, -4000])], { linea: 'C9', duracionMin: 20, intervaloMin: 6 });
const ORIGEN = pt(300, 100);
const DESTINO = pt(6050, -3800);

describe('Viaje.rutasConTrasbordo: una combinación válida', () => {
  const r = Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, B], { caminarM: 400, trasbordoM: 200, tiempo: T });
  it('no hay ruta directa y sí una con un trasbordo A → B, con lo que se camina en cada tramo y lo que se viaja en cada ruta', () => {
    expect(Viaje.rutasDirectas(ORIGEN, DESTINO, [A, B], { caminarM: 400 }).directas).toEqual([]);
    expect(r.trasbordos).toHaveLength(1);
    const t = r.trasbordos[0];
    expect([t.rutaA.id, t.rutaB.id]).toEqual(['a', 'b']);
    expect(t.caminarOrigenM).toBeGreaterThan(95);
    expect(t.caminarOrigenM).toBeLessThan(110);
    expect(t.caminarTrasbordoM).toBeGreaterThan(95);
    expect(t.caminarTrasbordoM).toBeLessThan(115);
    expect(t.caminarDestinoM).toBeGreaterThan(45);
    expect(t.caminarDestinoM).toBeLessThan(60);
    expect(t.viajeAM).toBeGreaterThan(5600);
    expect(t.viajeAM).toBeLessThan(5800);
    expect(t.viajeBM).toBeGreaterThan(3700);
    expect(t.viajeBM).toBeLessThan(3900);
    expect(t.caminarTotalM).toBeCloseTo(t.caminarOrigenM + t.caminarTrasbordoM + t.caminarDestinoM, 5);
    expect(t.viajeM).toBeCloseTo(t.viajeAM + t.viajeBM, 5);
  });
  it('trae los puntos de subida, de bajada de A, de subida a B y de bajada final, y un tramo dibujable de cada ruta', () => {
    const t = r.trasbordos[0];
    for (const p of [t.subida, t.bajadaA, t.subidaB, t.bajada]) expect(Number.isFinite(p.lat) && Number.isFinite(p.lon)).toBe(true);
    expect(t.bajadaA.lat).toBeCloseTo(LAT0, 4); // se baja de A al final de su recorrido (norte = 0)
    expect(t.subidaB.lon).toBeCloseTo(pt(6100).lon, 4);
    expect(t.segmentoA.length).toBeGreaterThan(10);
    expect(t.segmentoB.length).toBeGreaterThan(10);
    expect(t.trasbordo.lat).toBeCloseTo((t.bajadaA.lat + t.subidaB.lat) / 2, 6);
  });
  it('cuenta las dos esperas (la mitad de cada intervalo etiquetado) y no las suma al total, igual que el viaje directo', () => {
    const e = Viaje.estimarTiempoTrasbordo(r.trasbordos[0], T);
    expect(e.esperaMediaMin).toBeCloseTo(10 / 2 + 6 / 2, 6);
    const t = r.trasbordos[0];
    expect(e.busMin).toBeCloseTo((30 * t.viajeAM) / t.longitudAM + (20 * t.viajeBM) / t.longitudBM, 6);
    expect(t.longitudAM).toBeGreaterThan(5990);
    expect(t.longitudBM).toBeGreaterThan(4040);
    expect(e.caminarMin).toBeCloseTo(r.trasbordos[0].caminarTotalM / 1.0 / 60, 6);
    expect(e.totalSinEsperaMin).toBeCloseTo(e.caminarMin + e.busMin, 6);
  });
});

describe('Viaje.rutasConTrasbordo: el sentido y las distancias importan', () => {
  it('con A recorrida al revés (el origen queda al final) o B al revés (el destino queda antes del trasbordo) no hay trasbordo', () => {
    const Ar = ruta('ar', [[...linea([0, 0], [6000, 0])].reverse()], { linea: 'C3' });
    const Br = ruta('br', [[...linea([6100, 50], [6100, -4000])].reverse()], { linea: 'C9' });
    expect(Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [Ar, B], { tiempo: T }).trasbordos).toEqual([]);
    expect(Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, Br], { tiempo: T }).trasbordos).toEqual([]);
  });
  it('si las rutas pasan a más de 200 m una de la otra no hay trasbordo con el valor por omisión, y sí con uno mayor', () => {
    const Blejos = ruta('bl', [linea([6300, 50], [6300, -4000])], { linea: 'C9' });
    const dest = pt(6250, -3800);
    expect(Viaje.rutasConTrasbordo(ORIGEN, dest, [A, Blejos], { tiempo: T }).trasbordos).toEqual([]);
    expect(Viaje.rutasConTrasbordo(ORIGEN, dest, [A, Blejos], { tiempo: T, trasbordoM: 400 }).trasbordos).toHaveLength(1);
  });
  it('el origen o el destino a más de 400 m de toda ruta no da nada', () => {
    expect(Viaje.rutasConTrasbordo(pt(300, 600), DESTINO, [A, B], { tiempo: T }).trasbordos).toEqual([]);
    expect(Viaje.rutasConTrasbordo(ORIGEN, pt(6900, -3800), [A, B], { tiempo: T }).trasbordos).toEqual([]);
  });
  it('una ruta no hace trasbordo consigo misma, ni con la que repite su misma línea, ramal y sentido', () => {
    expect(Viaje.rutasConTrasbordo(ORIGEN, pt(5000, 100), [A], { tiempo: T }).trasbordos).toEqual([]);
    const copia = { ...A, id: 'a2' };
    expect(Viaje.rutasConTrasbordo(ORIGEN, pt(5000, 100), [A, copia], { tiempo: T }).trasbordos).toEqual([]);
  });
});

describe('Viaje.rutasConTrasbordo: orden y selección', () => {
  const B2 = ruta('b2', [linea([6100, 20], [6100, -4000])], { linea: 'C7', duracionMin: 50, intervaloMin: 6 }); // misma calle pero muy lenta
  const B3 = ruta('b3', [linea([6120, 20], [6120, -4000])], { linea: 'C9', duracionMin: 25, intervaloMin: 6 }); // otra ruta de la línea C9
  it('ordena por el tiempo aproximado total (sin la espera): gana la ruta B más rápida', () => {
    const r = Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, B2, B], { tiempo: T });
    expect(r.trasbordos.map((x: any) => x.rutaB.id)).toEqual(['b', 'b2']);
  });
  it('deja una sola combinación por par de líneas (línea A, línea B): la mejor', () => {
    const r = Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, B3, B], { tiempo: T });
    expect(r.trasbordos).toHaveLength(1);
    expect(r.trasbordos[0].rutaB.id).toBe('b'); // 20 min contra 25 min
  });
  it('devuelve como mucho `max` combinaciones', () => {
    const muchas = [A, ...[1, 2, 3, 4, 5, 6, 7].map((k) => ruta(`m${k}`, [linea([6100, 50], [6100, -4000])], { linea: `L${k}`, duracionMin: 20 + k }))];
    expect(Viaje.rutasConTrasbordo(ORIGEN, DESTINO, muchas, { tiempo: T }).trasbordos).toHaveLength(5);
    expect(Viaje.rutasConTrasbordo(ORIGEN, DESTINO, muchas, { tiempo: T, max: 3 }).trasbordos).toHaveLength(3);
  });
  it('sin duración etiquetada (o sin velocidad a pie) ordena por lo que se camina y, a igual caminata, por los km en vehículo; no inventa el tiempo', () => {
    const Bsin = ruta('bs', [linea([6100, 50], [6100, -4000])], { linea: 'C9', duracionMin: null, intervaloMin: null });
    const Bcerca = ruta('bc', [linea([6040, 50], [6040, -4000])], { linea: 'C5', duracionMin: null, intervaloMin: null }); // más cerca de A y del destino: menos caminata
    const r = Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, Bsin, Bcerca], { tiempo: T });
    expect(r.trasbordos.map((x: any) => x.rutaB.id)).toEqual(['bc', 'bs']);
    const e = Viaje.estimarTiempoTrasbordo(r.trasbordos[0], T);
    expect(e).toMatchObject({ busMin: null, totalSinEsperaMin: null });
    expect(e.caminarMin).not.toBeNull();
  });
  it('con una sola de las dos duraciones tampoco inventa el tiempo en bus ni la espera', () => {
    const Bsin = ruta('bs', [linea([6100, 50], [6100, -4000])], { linea: 'C9', duracionMin: null, intervaloMin: null });
    const r = Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, Bsin], { tiempo: T });
    expect(Viaje.estimarTiempoTrasbordo(r.trasbordos[0], T)).toMatchObject({ busMin: null, totalSinEsperaMin: null, esperaMediaMin: null });
  });
});

describe('Viaje.rutasConTrasbordo: la parada mapeada del trasbordo', () => {
  const parada = (n: string, este: number, norte: number, rutas: string[]) => ({ osm: `node/${n}`, nombre: `Parada ${n}`, lat: pt(este, norte).lat, lon: pt(este, norte).lon, rutas });
  it('da la parada mapeada más cercana al punto del trasbordo, ligada a A o a B y a 200 m o menos; una a más de 200 m o de otra ruta no cuenta', () => {
    const paradas = [parada('1', 6050, 180, ['a']), parada('2', 6060, 20, ['b']), parada('3', 6050, 0, ['zzz']), parada('4', 6100, -2000, ['b'])]; // la 3 es la más cercana pero de otra ruta
    const t = Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, B], { tiempo: T, paradas }).trasbordos[0];
    expect(t.parada).toMatchObject({ nombre: 'Parada 2' });
    expect(t.parada.distanciaM).toBeLessThan(200);
  });
  it('sin ninguna parada mapeada cerca el trasbordo dice null (paradas no mapeadas), no inventa una', () => {
    expect(Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, B], { tiempo: T, paradas: [parada('9', 6100, -3000, ['b'])] }).trasbordos[0].parada).toBeNull();
    expect(Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [A, B], { tiempo: T }).trasbordos[0].parada).toBeNull();
  });
});

describe('Viaje.prepararDestinoTrasbordo: lo que solo depende del destino se calcula una vez', () => {
  it('con el destino preparado el resultado es el mismo que sin prepararlo, para varios orígenes', () => {
    const preparado = Viaje.prepararDestinoTrasbordo(DESTINO, [A, B], {});
    for (const o of [ORIGEN, pt(1000, -100), pt(500, 700)]) {
      const sin = Viaje.rutasConTrasbordo(o, DESTINO, [A, B], { tiempo: T });
      const con = Viaje.rutasConTrasbordo(o, DESTINO, [A, B], { tiempo: T, preparado: preparado });
      expect(con.trasbordos.map((x: any) => [x.rutaA.id, x.rutaB.id, Math.round(x.caminarTotalM)])).toEqual(sin.trasbordos.map((x: any) => [x.rutaA.id, x.rutaB.id, Math.round(x.caminarTotalM)]));
    }
  });
});

describe('Viaje.rutasConTrasbordo: filtros y entradas inválidas', () => {
  it('sin origen o destino válidos, o sin rutas, no devuelve nada', () => {
    expect(Viaje.rutasConTrasbordo(null, DESTINO, [A, B], {}).trasbordos).toEqual([]);
    expect(Viaje.rutasConTrasbordo(ORIGEN, { lat: NaN, lon: 1 }, [A, B], {}).trasbordos).toEqual([]);
    expect(Viaje.rutasConTrasbordo(ORIGEN, DESTINO, [], {}).trasbordos).toEqual([]);
    expect(Viaje.rutasConTrasbordo(ORIGEN, DESTINO, null, {}).trasbordos).toEqual([]);
  });
});

describe('Viaje.rutasConTrasbordo: rapidez', () => {
  it('con 240 rutas de unos 1 000 vértices busca en menos de 2 s (el presupuesto de la búsqueda)', () => {
    // Una rejilla de calles este-oeste y norte-sur cada 700 m, como un plano de ciudad; cada ruta es una calle de 14 km.
    const rutas: any[] = [];
    for (let k = 0; k < 120; k++) rutas.push(ruta(`h${k}`, [linea([-3000 + (k % 7) * 300, (k - 60) * 120], [11000 + (k % 5) * 200, (k - 60) * 120])], { linea: `H${k % 12}`, ramal: `h${k}` }));
    for (let k = 0; k < 120; k++) rutas.push(ruta(`v${k}`, [linea([(k - 60) * 120, 9000 + (k % 5) * 200], [(k - 60) * 120, -9000 + (k % 7) * 300])], { linea: `V${k % 12}`, ramal: `v${k}` }));
    const t0 = Date.now();
    const r = Viaje.rutasConTrasbordo(pt(-1500, 0), pt(7000, -5000), rutas, { tiempo: T });
    const ms = Date.now() - t0;
    expect(r.trasbordos.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });
});
