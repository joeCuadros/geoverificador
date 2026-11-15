/**
 * Líneas de bus en el mapa: Rutas.paraMapa (trazos con un color por línea y parada más cercana) y la capa «lineas» de
 * Capas.construir, más lo que el chat pide dibujar al hablar de buses. Los recorridos son un GeoJSON pequeño hecho a mano.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const RT = require('../public/js/rutas.js');
const Capas = require('../public/js/capas.js');
const A = require('../public/js/asistente.js');

const ruta = (linea: string, empresa: string, id: string, coords: number[][], extra = {}) => ({
  type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { tipo: 'ruta', fuente: 'OSM', osm: `relation/${id}`, linea, ramal: 'R', nombre: `${linea}: A → B`, desde: 'A', hasta: 'B', operador: `${linea} - ${empresa}`, ...extra },
});
const parada = (linea: string, id: string, lon: number, lat: number, nombre: string) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { tipo: 'parada', osm: `node/${id}${nombre}`, nombre, clase: 'platform', rutas: [`relation/${id}`], lineas: [linea] },
});
const FC = {
  type: 'FeatureCollection',
  metadata: { fuente: 'OpenStreetMap (ODbL), relaciones route=bus de la red SIT y paradas de bus', fecha_extraccion: '2026-11-10' },
  features: [
    ruta('C2', 'Cono Norte', '1', [[-71.54, -16.4], [-71.53, -16.4]]),
    ruta('C2', 'Cono Norte', '2', [[-71.53, -16.4], [-71.54, -16.401]]),
    ruta('C5', 'EtraBus', '3', [[-71.52, -16.39], [-71.52, -16.41]]),
    ruta('C10', 'Otra', '4', [[-71.6, -16.5], [-71.59, -16.5]]),
    parada('C2', '1', -71.535, -16.4, 'Cettar - 2'),
    parada('C2', '1', -71.54, -16.4, 'Cettar - 1'),
    parada('C5', '3', -71.52, -16.395, 'Norte - 7'),
    parada('C5', '3', -71.52, -16.409, 'Norte - 9'),
  ],
};
const idx = RT.indexar(FC);
const UMBRALES = { educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, salud: 1000, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000 } };
const DATOS = { colegiosLista: [], salud: [], transporte: [], verdes: [] };

describe('Rutas.paraMapa', () => {
  it('devuelve el trazado de cada línea pedida, en orden natural, con su color y sus empresas', () => {
    const m = RT.paraMapa(idx, ['C5', 'C10', 'C2']);
    expect(m.trazos.map((t: any) => t.linea)).toEqual(['C2', 'C5', 'C10']);
    expect(m.trazos[0]).toMatchObject({ linea: 'C2', empresas: ['Cono Norte'] });
    expect(m.trazos[0].partes).toHaveLength(2); // los dos sentidos
    expect(m.trazos[0].ramales).toHaveLength(2);
    expect(m.paradas).toEqual([]); // sin punto no hay «parada más cercana»
  });

  it('cada línea tiene su propio color y es siempre el mismo, pida lo que se pida', () => {
    const todas = RT.paraMapa(idx, ['C2', 'C5', 'C10']);
    expect(new Set(todas.trazos.map((t: any) => t.color)).size).toBe(3);
    expect(RT.paraMapa(idx, ['C5']).trazos[0].color).toBe(todas.trazos[1].color);
    expect(RT.colorDe(idx, 'C2')).toBe(todas.trazos[0].color);
    todas.trazos.forEach((t: any) => expect(RT.COLORES).toContain(t.color));
  });

  it('con un punto agrega la parada más cercana de cada línea, con su distancia', () => {
    const m = RT.paraMapa(idx, ['C2', 'C5'], { lat: -16.4, lon: -71.5352 });
    expect(m.paradas.map((p: any) => p.linea)).toEqual(['C2', 'C5']);
    expect(m.paradas[0]).toMatchObject({ linea: 'C2', nombre: 'Cettar - 2' });
    expect(m.paradas[0].distanciaM).toBeLessThan(50);
    expect(m.paradas[1]).toMatchObject({ linea: 'C5', nombre: 'Norte - 7' });
    expect(m.paradas[0].color).toBe(m.trazos[0].color);
  });

  it('ignora las líneas que no existen y no inventa trazados', () => {
    expect(RT.paraMapa(idx, ['C99']).trazos).toEqual([]);
    expect(RT.paraMapa(idx, []).bbox).toBeNull();
    expect(RT.paraMapa(idx, null).trazos).toEqual([]);
  });
});

describe('Capas.construir: capa «lineas»', () => {
  const construir = (capa: object, extra = {}) => Capas.construir({ capas: [capa], datos: DATOS, zonas: [], cauces: [], sismos: [], umbrales: UMBRALES, rutas: idx, ...extra });

  it('dibuja los recorridos de las líneas y la parada más cercana al punto, y lo dice en la leyenda', () => {
    const r = construir({ id: 'lineas', nombres: ['C2', 'C5'], punto: { lat: -16.4, lon: -71.5352 } });
    expect(r.lineasBus.map((l: any) => l.linea)).toEqual(['C2', 'C5']);
    expect(r.paradasBus).toHaveLength(2);
    expect(r.leyenda[0]).toMatchObject({ capa: 'lineas', n: 2 });
    expect(r.leyenda[0].texto).toContain('C2 (Cono Norte), C5 (EtraBus)');
    expect(r.resumen).toBe('Muestro 2 líneas de bus.');
    // con punto se encuadra el punto y sus paradas, no toda la línea
    expect(r.limites[0]).toBeGreaterThan(-71.55);
    expect(r.limites[2]).toBeLessThan(-71.51);
  });

  it('sin punto (un distrito) dibuja solo los trazados y encuadra el distrito si lo hay', () => {
    const r = construir({ id: 'lineas', nombres: ['C2'] });
    expect(r.paradasBus).toEqual([]);
    expect(r.lineasBus).toHaveLength(1);
    expect(r.limites).toEqual(RT.paraMapa(idx, ['C2']).bbox);
    const poly = [[[-71.56, -16.43], [-71.5, -16.43], [-71.5, -16.38], [-71.56, -16.38], [-71.56, -16.43]]];
    const d = construir({ id: 'lineas', nombres: ['C2'] }, { area: { polys: [poly] } });
    expect(d.limites).toEqual([-71.56, -16.43, -71.5, -16.38]);
  });

  it('si los recorridos no se pudieron leer, lo dice y no dibuja nada', () => {
    const r = construir({ id: 'lineas', nombres: ['C2'] }, { rutas: null });
    expect(r.sinDatos).toEqual(['lineas']);
    expect(r.lineasBus).toEqual([]);
  });

  it('las demás capas no se ven afectadas: sin la capa de líneas no hay trazados', () => {
    const r = Capas.construir({ capas: [{ id: 'paraderos' }], datos: DATOS, zonas: [], cauces: [], sismos: [], umbrales: UMBRALES });
    expect(r.lineasBus).toEqual([]);
    expect(r.paradasBus).toEqual([]);
  });
});

describe('El chat pide dibujar las líneas de bus', () => {
  const lineas = [
    { linea: 'C2', empresas: ['Cono Norte'], distanciaM: 120, ramales: [], parada: { nombre: 'Cettar - 2', distanciaM: 80 } },
    { linea: 'C5', empresas: ['EtraBus'], distanciaM: 300, ramales: [], parada: null },
  ];
  const cita = { fuente: 'OpenStreetMap (ODbL)', fecha: '2026-11-10' };

  it('«¿qué buses pasan por aquí?» pide las líneas y el punto', () => {
    const r = A.responder(A.interpretar('¿qué buses pasan por aquí?', { hayPunto: true }), { punto: { lat: -16.4, lon: -71.535 }, entorno: { transporte: { rutas: { distanciaM: 400, lineas, ...cita } } } });
    expect(r.mapa).toEqual({ distrito: null, capas: [], lineas: { nombres: ['C2', 'C5'], punto: { lat: -16.4, lon: -71.535 } } });
  });

  it('«¿qué líneas pasan por Paucarpata?» pide las líneas y marca el distrito, sin punto', () => {
    const r = A.responder(A.interpretar('¿qué líneas pasan por Paucarpata?'), { distritoTitulo: 'Paucarpata', rutasDistrito: { distrito: 'PAUCARPATA', res: { lineas, rutas: 2, ...cita } } });
    expect(r.mapa).toEqual({ distrito: 'PAUCARPATA', capas: [], lineas: { nombres: ['C2', 'C5'], punto: null } });
  });

  it('si ninguna línea pasa, o los datos fallaron, no pide dibujar nada', () => {
    const sin = A.responder(A.interpretar('¿qué buses pasan por aquí?', { hayPunto: true }), { punto: { lat: 0, lon: 0 }, entorno: { transporte: { rutas: { distanciaM: 400, lineas: [], ...cita } } } });
    expect(sin.mapa).toBeNull();
    const falla = A.responder(A.interpretar('¿qué buses pasan por aquí?', { hayPunto: true }), { punto: { lat: 0, lon: 0 }, entorno: { transporte: { rutas: { error: 'sin red', distanciaM: 400, lineas: [] } } } });
    expect(falla.mapa).toBeNull();
  });
});
