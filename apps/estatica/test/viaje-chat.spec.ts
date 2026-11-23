/**
 * «¿Qué combi me lleva de mi punto a mi trabajo?» en el asistente y en el mapa: destinos con nombre (Parque Industrial), filtros por línea («tomo la C10») o por lo
 * que dice el letrero («el carro de Ciudad Blanca»), la búsqueda de zonas con ruta directa (opt-in, determinista, sin puntaje) y la capa del mapa. Sin red.
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
Object.assign(globalThis, { CONFIG, Calculos, Services: {}, Rutas: {} });
const Viaje = require('../public/js/viaje.js');
Object.assign(globalThis, { Viaje });
const Asistente = require('../public/js/asistente.js');
const Capas = require('../public/js/capas.js');

const PI = CONFIG.destinos.find((d: any) => d.id === 'parque-industrial');
const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((PI.lat * Math.PI) / 180));
/** Punto a `este` m al este y `norte` m al norte del Parque Industrial de la configuración. */
const pt = (este: number, norte = 0) => ({ lat: PI.lat + norte / M_POR_GRADO_LAT, lon: PI.lon + dLon(este) });
const traza = (...xs: Array<[number, number]>) => xs.map(([e, n]) => [pt(e, n).lon, pt(e, n).lat]);
const ruta = (id: string, partes: number[][][], extra: object = {}) => ({
  id, fuente: 'OSM', linea: 'C10', ramal: 'A', nombre: `C-10 ${id}`, desde: 'Ciudad Blanca', hasta: 'La Mansión del Fundador', operador: 'C10 - MegaBus', duracionMin: 40, intervaloMin: 5, horario: null, tarifa: null, color: '#123456', url: null, partes, ...extra,
});
// Una ruta este-oeste de 8 km que termina a 100 m del Parque Industrial; el origen del ejemplo está 4 km al oeste.
const C10 = ruta('osm/c10', [traza([-6000, 0], [0, 100], [2000, 100])]);
const C10_DUP = ruta('osm/c10b', [traza([-6000, 0], [0, 100], [2000, 100])], { duracionMin: null, intervaloMin: null }); // la misma ruta dibujada en otra relación
const C4 = ruta('osm/c4', [traza([-6000, 200], [0, 150], [2000, 150])], { linea: 'C4', ramal: 'Gráficos', desde: 'San Luis', hasta: 'Av. Salaverry', operador: 'C4 - Unión Aqp' });
const REVES = ruta('osm/rev', [traza([2000, 100], [0, 100], [-6000, 0])], { desde: 'La Mansión del Fundador', hasta: 'Ciudad Blanca' });
const CASA = pt(-4000, 60);
const ctxBase = { punto: CASA, viajeRutas: [C10, C10_DUP, C4, REVES], caminarM: 400, zona: null, estadoPDM: null };

// ------------------------------------------------------------------------------ Configuración

describe('CONFIG: destinos con nombre y la distancia a pie', () => {
  it('el Parque Industrial viene de OpenStreetMap (el polígono nombrado) con su referencia y una nota de qué punto es', () => {
    expect(PI).toMatchObject({ nombre: 'Parque Industrial', osm: 'way/491224938' });
    expect(PI.alias).toEqual(expect.arrayContaining(['parque industrial']));
    expect(PI.lat).toBeCloseTo(-16.4179, 3);
    expect(PI.lon).toBeCloseTo(-71.5497, 3);
    expect(PI.nota).toMatch(/centro|referencia/i);
  });
  it('Ciudad Blanca es un barrio (también el final de las rutas C2 y C10), no una empresa', () => {
    const cb = CONFIG.destinos.find((d: any) => d.id === 'ciudad-blanca');
    expect(cb).toMatchObject({ nombre: 'Ciudad Blanca', tipo: 'barrio', osm: 'node/4329651109' });
  });
  it('la distancia a pie de la combi es la del paradero (CONFIG.umbrales.transporte), no otra', () => {
    expect(CONFIG.viaje.caminarM).toBe(CONFIG.umbrales.transporte);
    expect(CONFIG.viaje.osmUrl).toBe('data/rutas_osm.geojson');
  });
});

// ------------------------------------------------------------------------------ Intención

describe('Asistente.interpretar: viaje', () => {
  const i = (t: string, ctx: object = { hayPunto: true }) => Asistente.interpretar(t, ctx);
  it('«¿qué combi me lleva a mi trabajo en el Parque Industrial?» es un viaje con ese destino', () => {
    const r = i('¿qué combi me lleva de mi punto a mi trabajo en el Parque Industrial?');
    expect(r).toMatchObject({ tipo: 'viaje', criterios: [] });
    expect(r.destino.id).toBe('parque-industrial');
  });
  it('«trabajo en el Parque Industrial» a secas también (fija el destino y responde)', () => {
    expect(i('trabajo en el Parque Industrial')).toMatchObject({ tipo: 'viaje' });
  });
  it('«tomo la C10» filtra por línea y «el carro de Ciudad Blanca» por lo que dice el letrero; Ciudad Blanca ahí no es el destino', () => {
    const a = i('tomo la C10 y trabajo en el Parque Industrial');
    expect(a).toMatchObject({ tipo: 'viaje', viaje: { linea: 'C10' } });
    expect(a.destino.id).toBe('parque-industrial');
    const b = i('tomo el carro de Ciudad Blanca porque trabajo en el Parque Industrial');
    expect(b.viaje.texto).toBe('ciudad blanca');
    expect(b.destino.id).toBe('parque-industrial');
    expect(i('la C-4 hasta el parque industrial').viaje.linea).toBe('C4');
  });
  it('sin destino en la frase usa el que la persona ya fijó (ctx.destino), pero solo si pregunta por llegar', () => {
    const d = { id: 'x', nombre: 'Mi oficina', lat: -16.41, lon: -71.52 };
    expect(i('¿qué combi me lleva a mi trabajo?', { hayPunto: true, destino: d })).toMatchObject({ tipo: 'viaje' });
    expect(i('¿qué combi me lleva a mi trabajo?', { hayPunto: true }).destino).toBeNull(); // sin destino: la respuesta lo pide
    expect(i('¿qué buses pasan por aquí?', { hayPunto: true, destino: d }).tipo).toBe('rutas'); // la pregunta de siempre sigue igual
  });
  it('buscar zonas con ruta directa al destino es otra intención (opt-in), con el mismo destino', () => {
    const r = i('busco una zona con ruta directa al Parque Industrial');
    expect(r).toMatchObject({ tipo: 'ruta_zonas' });
    expect(r.destino.id).toBe('parque-industrial');
    expect(i('quiero vivir donde una combi me lleve al parque industrial sin transbordo').tipo).toBe('ruta_zonas');
  });
  it('lo de siempre no cambia: un parque, una zona industrial sin viaje, las líneas de un punto', () => {
    expect(i('quiero un parque cerca').tipo).toBe('buscar');
    expect(i('¿qué líneas pasan por Paucarpata?').tipo).toBe('rutas');
    expect(Asistente.CRITERIOS.rutaDirecta).toBeUndefined(); // no es un criterio del puntaje: ver ruta_zonas
  });
});

// ------------------------------------------------------------------------------ Respuesta

describe('Asistente.responder: viaje', () => {
  const dest = PI;
  const resp = (intencion: object, c: object = ctxBase) => Asistente.responder({ tipo: 'viaje', criterios: [], destino: dest, viaje: {}, ...intencion }, c);

  it('lista las rutas directas con lo que caminas en cada punta, los km en bus, la fuente y el sentido; la misma ruta dibujada en dos relaciones de OSM, una vez', () => {
    const t = resp({}).texto;
    expect(t).toMatch(/Parque Industrial/);
    expect(t).toMatch(/C10/);
    expect(t).toMatch(/C4/);
    expect(t).toMatch(/Fuente: OpenStreetMap\./);
    expect(t).not.toMatch(/SmartBus/);
    expect(t).toMatch(/caminas \d+ m al subir y \d+ m al bajar/);
    expect(t).toMatch(/\d,\d km en bus/);
    expect(t.split('\n').filter((l: string) => /^• C10 ·/.test(l))).toHaveLength(1);
    expect(t).not.toMatch(/Gráficos[^\n]*\n[^\n]*Gráficos/); // sin repetidas
  });
  it('la ruta que pasa por los dos puntos pero al revés no se ofrece como directa: se dice aparte que sirve para el regreso', () => {
    const t = resp({}).texto;
    expect(t).toMatch(/en sentido contrario/);
    expect(t.split('\n').filter((l: string) => /^•/.test(l)).some((l: string) => /La Mansión del Fundador → Ciudad Blanca/.test(l))).toBe(false);
  });
  it('la salvedad: línea recta, sin saber dónde subir ni bajar ni si opera hoy', () => {
    const t = resp({}).texto;
    expect(t).toMatch(/línea recta/);
    expect(t).toMatch(/dónde subir|dónde se sube/);
    expect(t).toMatch(/no sé si|no dice si/);
  });
  it('trae, de OSM, la duración e intervalo que etiqueta la ruta, sin presentarlos como el tiempo de tu viaje', () => {
    const t = resp({}).texto;
    expect(t).toMatch(/OSM etiqueta 40 min de punta a punta, cada 5 min/);
  });
  it('filtra por línea y por texto, y lo dice', () => {
    const c4 = resp({ viaje: { linea: 'C4' } }).texto;
    expect(c4).toMatch(/solo la línea C4/);
    expect(c4).not.toMatch(/C10 ·/);
    const cb = resp({ viaje: { texto: 'ciudad blanca' } }).texto;
    expect(cb).toMatch(/«ciudad blanca»/);
    expect(cb).toMatch(/C10/);
    expect(cb).not.toMatch(/C4 ·/);
  });
  it('si ninguna llega, lo dice y cuántas pasan cerca del destino, sin inventar un transbordo', () => {
    const t = resp({}, { ...ctxBase, punto: pt(-4000, 3000) }).texto;
    expect(t).toMatch(/ninguna ruta directa/i);
    expect(t).not.toMatch(/transbord\w+ en/); // no propone transbordos
  });
  it('devuelve el mapa con los tramos de subida a bajada, el origen y el destino', () => {
    const r = resp({});
    expect(r.mapa.viaje.destino).toMatchObject({ lat: PI.lat, lon: PI.lon });
    expect(r.mapa.viaje.origen).toMatchObject({ lat: CASA.lat, lon: CASA.lon });
    expect(r.mapa.viaje.tramos.length).toBeGreaterThanOrEqual(2);
    expect(r.mapa.viaje.tramos[0]).toMatchObject({ nombre: expect.any(String) });
    expect(r.mapa.viaje.tramos[0].segmento.length).toBeGreaterThan(5);
  });
  it('sin punto, sin destino o sin rutas cargadas pide lo que falta', () => {
    expect(resp({}, { ...ctxBase, punto: undefined }).texto).toMatch(/punto/);
    expect(Asistente.responder({ tipo: 'viaje', criterios: [], destino: null, viaje: {} }, ctxBase).texto).toMatch(/¿A dónde|trabajas|destino/);
    expect(resp({}, { ...ctxBase, viajeRutas: null }).texto).toMatch(/cargando|vuelve a preguntar/);
  });
});

// ------------------------------------------------------------------------------ Zonas con ruta directa

describe('zonas con ruta directa al destino: búsqueda opt-in, determinista, sin puntaje', () => {
  const celdas = [
    { ...pt(-4000, 60), i: 0, j: 0 }, { ...pt(-3000, 40), i: 0, j: 1 }, { ...pt(-3000, 2500), i: 1, j: 1 }, { ...pt(-2000, 2600), i: 1, j: 2 }, { ...pt(500, 20), i: 2, j: 3 },
  ];
  const distritoDe = (lat: number) => (lat > PI.lat + 0.01 ? 'CAYMA' : 'JOSE LUIS BUSTAMANTE Y RIVERO');
  it('resumirRutaZonas cuenta las celdas que llegan, por distrito, y da las mejores (menos caminata) separadas entre sí', () => {
    const hits = Viaje.zonasConRutaDirecta(PI, [C10, C4, REVES], celdas, { caminarM: 400 });
    const r = Asistente.resumirRutaZonas(hits, celdas, distritoDe, { separacionM: 600 });
    expect(r.totalCeldas).toBe(5);
    expect(r.conRuta).toBe(hits.length);
    expect(r.conRuta).toBeGreaterThanOrEqual(2);
    expect(r.porDistrito.find((d: any) => d.distrito === 'CAYMA').conRuta).toBe(0);
    expect(r.porDistrito.find((d: any) => d.distrito === 'JOSE LUIS BUSTAMANTE Y RIVERO').pct).toBeGreaterThan(0);
    expect(r.mejores[0].caminarM).toBeLessThanOrEqual(r.mejores[r.mejores.length - 1].caminarM);
  });
  it('la respuesta dice qué mide (celdas de 250 m con una ruta directa a ≤ 400 m a pie), por distrito, que no es un puntaje y que no pesa en la búsqueda de zonas', () => {
    const hits = Viaje.zonasConRutaDirecta(PI, [C10, C4, REVES], celdas, { caminarM: 400 });
    const zonasRuta = { destino: PI, ...Asistente.resumirRutaZonas(hits, celdas, distritoDe, { separacionM: 600 }), caminarM: 400 };
    const t = Asistente.responder({ tipo: 'ruta_zonas', criterios: [], destino: PI, viaje: {} }, { zonasRuta }).texto;
    expect(t).toMatch(/ruta directa/i);
    expect(t).toMatch(/Parque Industrial/);
    expect(t).toMatch(/JOSE LUIS BUSTAMANTE Y RIVERO|José Luis Bustamante y Rivero/i);
    expect(t).toMatch(/no es un puntaje|no suma al puntaje|no entra en el puntaje/i);
    expect(t).toMatch(/línea recta/);
  });
  it('sin destino o sin el cálculo lo dice', () => {
    expect(Asistente.responder({ tipo: 'ruta_zonas', criterios: [], destino: null, viaje: {} }, {}).texto).toMatch(/¿A dónde|destino/);
    expect(Asistente.responder({ tipo: 'ruta_zonas', criterios: [], destino: PI, viaje: {} }, {}).texto).toMatch(/calculando|vuelve a preguntar/);
  });
});

// ------------------------------------------------------------------------------ Mapa

describe('Capas: la capa «viaje» dibuja los tramos de subida a bajada, el origen y el destino', () => {
  const datos = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 } });
  const UM = { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };
  const viaje = Asistente.responder({ tipo: 'viaje', criterios: [], destino: PI, viaje: {} }, ctxBase).mapa.viaje;
  it('tiene su etiqueta entre las capas y se arma con los datos de la respuesta', () => {
    expect(Capas.CAPAS.find((c: { id: string }) => c.id === 'viaje')).toMatchObject({ etiqueta: 'Ruta al trabajo (combi o bus)' });
    const c = Capas.construir({ capas: [{ id: 'viaje', ...viaje }], datos, zonas: [], cauces: [], sismos: [], umbrales: UM, area: null });
    expect(c.viaje.tramos.length).toBe(viaje.tramos.length);
    expect(c.viaje.origen).toMatchObject({ lat: CASA.lat });
    expect(c.viaje.destino.nombre).toBe('Parque Industrial');
    expect(c.leyenda.map((l: { texto: string }) => l.texto).join(' ')).toMatch(/Ruta al trabajo/);
    expect(c.limites).not.toBeNull();
  });
});

// ------------------------------------------------------------------------------ Tiempo de viaje

describe('tiempo de viaje: aproximado, con sus supuestos y sin inventar lo que falta', () => {
  const TIEMPO = CONFIG.viaje.tiempo;
  const resp = (c: object = {}) => Asistente.responder({ tipo: 'viaje', criterios: [], destino: PI, viaje: {} }, { ...ctxBase, tiempo: TIEMPO, ...c }).texto;

  it('CONFIG.viaje.tiempo: velocidad a pie con su fuente, sin factor de rodeo (no hay una fuente aplicable a Arequipa) y de dónde sale el tiempo en bus', () => {
    expect(TIEMPO.velocidadPieMs).toBeCloseTo(1.07, 2);
    expect(TIEMPO.factorRodeo).toBeNull();
    expect(TIEMPO.fuentePie).toMatch(/MUTCD/);
    expect(TIEMPO.fuenteBus).toMatch(/OpenStreetMap/);
  });
  it('cada ruta con duración de OSM trae «unos N min» (a pie + en bus) sin contar la espera, y la espera media aparte', () => {
    const t = resp();
    const linea = t.split('\n').find((l: string) => /^• C10 ·/.test(l));
    expect(linea).toMatch(/≈ \d+ min en total sin contar la espera/);
    expect(linea).toMatch(/≈ \d+ min a pie/);
    expect(linea).toMatch(/≈ \d+ min en bus/);
    expect(linea).toMatch(/espera media de ≈ 2,5 min/);
  });
  it('dice los supuestos: velocidad a pie y su fuente, línea recta (el recorrido real a pie es más largo), y que el tiempo en bus es la duración de OSM prorrateada', () => {
    const t = resp();
    expect(t).toMatch(/1,07 m\/s/);
    expect(t).toMatch(/MUTCD/);
    expect(t).toMatch(/más largo/);
    expect(t).toMatch(/prorrate/i);
    expect(t).toMatch(/no es una medición/i);
  });
  it('una ruta de OSM sin duración etiquetada: se da la distancia y la caminata, sin total', () => {
    const solo = ruta('osm/9', [traza([-6000, 0], [0, 100], [2000, 100])], { linea: 'C5', ramal: 'Z', desde: 'A', hasta: 'B', duracionMin: null, intervaloMin: null });
    const t = resp({ viajeRutas: [solo] });
    const linea = t.split('\n').find((l: string) => /^• C5/.test(l));
    expect(linea).not.toMatch(/en total/);
    expect(linea).toMatch(/≈ \d+ min a pie/);
    expect(linea).toMatch(/sin duración publicada/);
  });
  it('sin la configuración de tiempo (o sin ella) la respuesta es la de antes: distancias, sin minutos', () => {
    const t = Asistente.responder({ tipo: 'viaje', criterios: [], destino: PI, viaje: {} }, ctxBase).texto;
    expect(t).not.toMatch(/≈ \d+ min/);
  });
});
