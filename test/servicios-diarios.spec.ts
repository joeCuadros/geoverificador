/**
 * Servicios de la vida diaria de OpenStreetMap como tres necesidades INFORMATIVAS más del comercio por necesidad (Calculos.COMERCIO), sin umbral:
 *   finanzas      bancos (amenity=bank) y cajeros automáticos (amenity=atm)
 *   comida_fuera  restaurantes (amenity=restaurant) y cafés (amenity=cafe)
 *   recreacion    áreas de juegos infantiles (leisure=playground). Los parques (leisure=park|garden) ya son el criterio «área verde» y NO se duplican aquí.
 * Aquí: la clasificación (Calculos), la conversión y la deduplicación de la descarga (scripts/lib/servicios-osm.js), la ficha (Equipamiento), el mapa (Capas), el chat
 * (Asistente) y los archivos reales. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { existsSync, readFileSync } from 'node:fs';
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
const Asistente = require('../public/js/asistente.js');
const Capas = require('../public/js/capas.js');
const Servicios = require('../scripts/lib/servicios-osm.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const P = { lat: -16.409, lon: -71.5375 };
const alNorte = (m: number) => [P.lon, P.lat + m / M_POR_GRADO_LAT];
const punto = (coords: number[], properties: object) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: coords } });
const BANCO = punto(alNorte(250), { fuente: 'OSM', osm: 'node/1', nombre: 'BCP', tags: { amenity: 'bank' }, tipo: 'banco' });
const CAJERO = punto(alNorte(120), { fuente: 'OSM', osm: 'node/2', nombre: 'Cajero BBVA', tags: { amenity: 'atm' }, tipo: 'cajero' });
const RESTAURANTE = punto(alNorte(90), { fuente: 'OSM', osm: 'node/3', nombre: 'La Nueva Palomino', tags: { amenity: 'restaurant' }, tipo: 'restaurante' });
const CAFE = punto(alNorte(400), { fuente: 'OSM', osm: 'node/4', nombre: 'Café Central', tags: { amenity: 'cafe' }, tipo: 'cafe' });
const JUEGOS = punto(alNorte(60), { fuente: 'OSM', osm: 'node/5', nombre: null, tags: { leisure: 'playground' }, tipo: 'juego_infantil' });
const NUEVAS = ['finanzas', 'comida_fuera', 'recreacion'];
const TIPOS = ['banco', 'cajero', 'restaurante', 'cafe', 'juego_infantil'];
const PROHIBIDO = /\b(cumple|no cumple|seguro|inseguro|recomend\w+|mejor zona)\b/i;

// ------------------------------------------------------------------------------ Configuración

describe('CONFIG: las tres necesidades nuevas son informativas', () => {
  it('umbral null y fuente de umbral para cada necesidad y cada tipo, con su archivo de datos', () => {
    for (const k of [...NUEVAS, ...TIPOS]) {
      expect(CONFIG.umbrales[k]).toBeNull();
      expect(CONFIG.fuentesUmbral[k]).toMatch(/sin umbral/i);
    }
    expect(CONFIG.equipamiento.archivos.finanzas).toBe('data/equipamiento/finanzas.geojson');
    expect(CONFIG.equipamiento.archivos.comida_fuera).toBe('data/equipamiento/comida_fuera.geojson');
    expect(CONFIG.equipamiento.archivos.recreacion).toBe('data/equipamiento/recreacion.geojson');
  });
  it('lo que sí tiene umbral no cambia (el área verde sigue siendo el parque)', () => {
    expect(CONFIG.umbrales.areaVerde).toEqual({ distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 });
  });
});

// ------------------------------------------------------------------------------ Clasificación

describe('Calculos: etiquetas de OpenStreetMap de cada necesidad', () => {
  it('banco y cajero son finanzas; restaurante y café, comida fuera; el parque infantil, recreación', () => {
    expect(Calculos.categoriasDe({ amenity: 'bank' })).toEqual(['finanzas']);
    expect(Calculos.categoriasDe({ amenity: 'atm' })).toEqual(['finanzas']);
    expect(Calculos.categoriasDe({ amenity: 'restaurant' })).toEqual(['comida_fuera']);
    expect(Calculos.categoriasDe({ amenity: 'cafe' })).toEqual(['comida_fuera']);
    expect(Calculos.categoriasDe({ leisure: 'playground' })).toEqual(['recreacion']);
  });
  it('un parque o jardín sigue siendo SOLO área verde: no se duplica en recreación', () => {
    expect(Calculos.categoriasDe({ leisure: 'park' })).toEqual(['areasVerdes']);
    expect(Calculos.categoriasDe({ leisure: 'garden' })).toEqual(['areasVerdes']);
    expect(Calculos.categoriasDe({ landuse: 'recreation_ground' })).toEqual(['areasVerdes']);
  });
  it('lo ajeno no entra (farmacia, comida rápida, escuela)', () => {
    for (const t of [{ amenity: 'pharmacy' }, { amenity: 'fast_food' }, { amenity: 'school' }, { amenity: 'bar' }]) {
      expect(Calculos.categoriasDe(t)).not.toEqual(expect.arrayContaining(NUEVAS));
      expect(Calculos.categoriasDe(t).filter((c: string) => NUEVAS.includes(c))).toEqual([]);
    }
  });
  it('los selectores de Overpass salen de la misma definición', () => {
    expect(Calculos.selectoresOverpass('finanzas')).toEqual(['["amenity"~"^(bank|atm)$"]']);
    expect(Calculos.selectoresOverpass('comida_fuera')).toEqual(['["amenity"~"^(restaurant|cafe)$"]']);
    expect(Calculos.selectoresOverpass('recreacion')).toEqual(['["leisure"="playground"]']);
  });
});

describe('Calculos.COMERCIO: seis necesidades, tres de ellas nuevas', () => {
  it('quedan las tres de siempre y se suman finanzas, comida fuera y recreación, con su etiqueta y sus tipos', () => {
    expect(Object.keys(Calculos.COMERCIO)).toEqual(['abastecimiento', 'compras_ocio', 'comercio_barrio', ...NUEVAS]);
    expect(Calculos.COMERCIO.finanzas).toMatchObject({ etiqueta: 'Finanzas (bancos y cajeros)', tipos: ['banco', 'cajero'] });
    expect(Calculos.COMERCIO.comida_fuera).toMatchObject({ etiqueta: 'Comida fuera de casa', tipos: ['restaurante', 'cafe'] });
    expect(Calculos.COMERCIO.recreacion).toMatchObject({ etiqueta: 'Recreación (juegos infantiles)', tipos: ['juego_infantil'] });
    expect(Calculos.COMERCIO.abastecimiento.tipos).toEqual(['mercado', 'supermercado']);
  });
  it('cada tipo dice de qué archivo sale', () => {
    expect(Calculos.COMERCIO_TIPO.banco).toMatchObject({ capa: 'finanzas', singular: 'banco' });
    expect(Calculos.COMERCIO_TIPO.cajero).toMatchObject({ capa: 'finanzas', singular: 'cajero automático' });
    expect(Calculos.COMERCIO_TIPO.restaurante).toMatchObject({ capa: 'comida_fuera' });
    expect(Calculos.COMERCIO_TIPO.cafe).toMatchObject({ capa: 'comida_fuera' });
    expect(Calculos.COMERCIO_TIPO.juego_infantil).toMatchObject({ capa: 'recreacion' });
  });
  it('la recreación explica que los parques son el criterio «área verde», no esta necesidad', () => {
    expect(Calculos.COMERCIO.recreacion.alcance).toMatch(/parques?/i);
    expect(Calculos.COMERCIO.recreacion.alcance).toMatch(/área verde/i);
  });
  it('agruparComercio reparte los archivos nuevos por su necesidad, con el tipo que trae cada elemento', () => {
    const g = Calculos.agruparComercio({ finanzas: [BANCO, CAJERO], comida_fuera: [RESTAURANTE, CAFE], recreacion: [JUEGOS] });
    expect(g.finanzas.map((f: any) => f.properties.tipo).sort()).toEqual(['banco', 'cajero']);
    expect(g.comida_fuera.map((f: any) => f.properties.osm).sort()).toEqual(['node/3', 'node/4']);
    expect(g.recreacion).toHaveLength(1);
    expect(g.abastecimiento).toEqual([]);
  });
  it('necesidadComercio las reconoce', () => {
    expect(Calculos.necesidadComercio('finanzas', BANCO.properties)).toBe('finanzas');
    expect(Calculos.necesidadComercio('comida_fuera', CAFE.properties)).toBe('comida_fuera');
    expect(Calculos.necesidadComercio('recreacion', JUEGOS.properties)).toBe('recreacion');
  });
  it('el más cercano de una necesidad sin umbral es INFORMATIVO y rotula la etiqueta de OSM', () => {
    const g = Calculos.agruparComercio({ finanzas: [BANCO, CAJERO] });
    const r = Calculos.evaluarMasCercanoForma(P, g.finanzas, { umbralM: null, fuente: 'OSM', fecha: 'x', metodo: 'm' });
    expect(r).toMatchObject({ estado: 'INFORMATIVO', nombre: 'Cajero BBVA', tipo: 'cajero', etiqueta: 'amenity=atm' });
    expect(r.distanciaM).toBeGreaterThan(115);
    expect(r.distanciaM).toBeLessThan(125);
  });
  it('la nota informativa nombra las nuevas necesidades y no pide ni afirma nada', () => {
    expect(Calculos.NOTA_COMERCIO).toMatch(/finanzas/i);
    expect(Calculos.NOTA_COMERCIO).toMatch(/comida/i);
    expect(Calculos.NOTA_COMERCIO).toMatch(/recreaci[oó]n/i);
    expect(Calculos.NOTA_COMERCIO).not.toMatch(PROHIBIDO);
  });
});

// ------------------------------------------------------------------------------ La descarga

const nodo = (id: number, lat: number, lon: number, tags: object) => ({ type: 'node', id, lat, lon, tags });
describe('Servicios (scripts/lib/servicios-osm.js): la descarga', () => {
  it('tipoDe: del par etiqueta=valor al tipo', () => {
    expect(Servicios.tipoDe({ amenity: 'bank' })).toBe('banco');
    expect(Servicios.tipoDe({ amenity: 'atm' })).toBe('cajero');
    expect(Servicios.tipoDe({ amenity: 'restaurant' })).toBe('restaurante');
    expect(Servicios.tipoDe({ amenity: 'cafe' })).toBe('cafe');
    expect(Servicios.tipoDe({ leisure: 'playground' })).toBe('juego_infantil');
    expect(Servicios.tipoDe({ leisure: 'park' })).toBeNull();
  });
  it('construirConsulta: una sola consulta con las tres necesidades y la geometría', () => {
    const q = Servicios.construirConsulta([-16.6, -71.75, -16.2, -71.35]);
    expect(q).toContain('nwr["amenity"~"^(bank|atm)$"](-16.6,-71.75,-16.2,-71.35);');
    expect(q).toContain('nwr["amenity"~"^(restaurant|cafe)$"]');
    expect(q).toContain('nwr["leisure"="playground"]');
    expect(q).not.toMatch(/park|garden/);
    expect(q).toMatch(/out geom tags;$/);
  });
  it('convertir: cada elemento lleva su necesidad (categoria) y su tipo; lo ajeno se cuenta aparte', () => {
    const r = Servicios.convertir([
      nodo(1, -16.4, -71.5, { amenity: 'bank', name: 'BCP' }),
      nodo(2, -16.4, -71.5, { amenity: 'atm' }),
      nodo(3, -16.4, -71.5, { amenity: 'restaurant', name: 'X' }),
      nodo(4, -16.4, -71.5, { amenity: 'cafe' }),
      nodo(5, -16.4, -71.5, { leisure: 'playground' }),
      nodo(6, -16.4, -71.5, { amenity: 'pharmacy' }),
    ]);
    expect(r.features.map((f: any) => [f.properties.osm, f.properties.categoria, f.properties.tipo])).toEqual([
      ['node/1', 'finanzas', 'banco'], ['node/2', 'finanzas', 'cajero'], ['node/3', 'comida_fuera', 'restaurante'], ['node/4', 'comida_fuera', 'cafe'], ['node/5', 'recreacion', 'juego_infantil'],
    ]);
    expect(r.sinCategoria).toBe(1);
  });
  it('deduplicarPorTipo: un banco y su cajero con el mismo nombre son dos lugares; el mismo banco mapeado dos veces es uno', () => {
    const f = (osm: string, nombre: string, tipo: string, lon: number) => ({ type: 'Feature', properties: { osm, nombre, tipo, categoria: 'finanzas', tags: {} }, geometry: { type: 'Point', coordinates: [lon, -16.4] } });
    const r = Servicios.deduplicarPorTipo([f('node/1', 'BCP', 'banco', -71.5), f('node/2', 'BCP', 'cajero', -71.50001), f('node/3', 'BCP', 'banco', -71.50002)]);
    expect(r.features.map((x: any) => x.properties.tipo).sort()).toEqual(['banco', 'cajero']);
    expect(r.descartados).toBe(1);
    expect(r.features.find((x: any) => x.properties.tipo === 'banco').properties.osm_asociados).toEqual(['node/3']);
  });
});

// ------------------------------------------------------------------------------ Ficha

const archivo = (features: object[], fecha = '2026-11-10') => ({ type: 'FeatureCollection', metadata: { fecha_extraccion: fecha, fuente: 'OpenStreetMap (ODbL)' }, features });
const vacio = { type: 'FeatureCollection', metadata: { fecha_extraccion: '2026-10-28' }, features: [] };
const ARCHIVOS: Record<string, any> = {};
(globalThis as any).fetch = async (url: string) => {
  const hallado = Object.entries(CONFIG.equipamiento.archivos).find(([, ruta]) => ruta === url);
  const datos = hallado ? ARCHIVOS[hallado[0]] : undefined;
  return datos ? { ok: true, status: 200, json: async () => datos } : { ok: false, status: 404, json: async () => ({}) };
};
const cargarEquipamiento = (datos: Record<string, object>) => {
  for (const k of Object.keys(ARCHIVOS)) delete ARCHIVOS[k];
  Object.assign(ARCHIVOS, { salud: vacio, educacion: vacio, transporte: vacio, areasVerdes: vacio, ...datos });
  jest.resetModules();
  Object.assign(globalThis, { CONFIG, Calculos: require('../public/js/calculos.js'), Services: {}, Rutas: {} });
  return require('../public/js/equipamiento.js');
};

describe('Equipamiento.evaluar: finanzas, comida fuera y recreación', () => {
  const todos = { mercados: vacio, supermercados: vacio, malls: vacio, finanzas: archivo([BANCO, CAJERO]), comida_fuera: archivo([RESTAURANTE, CAFE]), recreacion: archivo([JUEGOS]) };
  it('cada necesidad da el más cercano, INFORMATIVO, sin umbral, con la fuente y la fecha', async () => {
    const e = await cargarEquipamiento(todos).evaluar(P.lat, P.lon);
    expect(e.finanzas).toMatchObject({ estado: 'INFORMATIVO', nombre: 'Cajero BBVA', tipo: 'cajero', umbralM: null, fecha: '2026-11-10' });
    expect(e.comida_fuera).toMatchObject({ estado: 'INFORMATIVO', nombre: 'La Nueva Palomino', tipo: 'restaurante', umbralM: null });
    expect(e.recreacion).toMatchObject({ estado: 'INFORMATIVO', tipo: 'juego_infantil', umbralM: null });
    expect(e.finanzas.metodo).toMatch(/sin umbral/i);
  });
  it('finanzas y comida fuera traen además el más cercano de cada tipo; recreación, que tiene uno solo, no', async () => {
    const e = await cargarEquipamiento(todos).evaluar(P.lat, P.lon);
    expect(e.finanzas.porTipo.banco).toMatchObject({ nombre: 'BCP' });
    expect(e.finanzas.porTipo.cajero).toMatchObject({ nombre: 'Cajero BBVA' });
    expect(e.comida_fuera.porTipo.cafe).toMatchObject({ nombre: 'Café Central' });
    expect(e.comida_fuera.porTipo.restaurante.distanciaM).toBeLessThan(e.comida_fuera.porTipo.cafe.distanciaM);
    expect(e.recreacion.porTipo).toBeUndefined();
  });
  it('si falta el archivo de una necesidad, solo esa dice SIN DATO y el resto sigue', async () => {
    const { recreacion: _r, ...sin } = todos;
    const e = await cargarEquipamiento(sin).evaluar(P.lat, P.lon);
    expect(e.recreacion).toMatchObject({ estado: 'SIN DATO', distanciaM: null });
    expect(e.finanzas.estado).toBe('INFORMATIVO');
  });
  it('nada de esto cambia la salud, la educación ni el área verde', async () => {
    const e = await cargarEquipamiento(todos).evaluar(P.lat, P.lon);
    expect(e.salud.estado).toBe('SIN DATO');
    expect(e.areaVerde).toBeDefined();
  });
});

// ------------------------------------------------------------------------------ Chat

describe('chat: banco, restaurante y juegos infantiles son una consulta informativa, no un criterio de búsqueda', () => {
  const caso = (t: string, ids: string[]) => expect(Asistente.interpretar(t, { hayPunto: true })).toMatchObject({ tipo: 'comercio', comercio: ids, criterios: [] });
  it('finanzas', () => {
    caso('¿hay un banco cerca?', ['finanzas']);
    caso('¿dónde hay un cajero automático?', ['finanzas']);
    caso('¿hay un ATM para sacar plata?', ['finanzas']);
  });
  it('comida fuera', () => {
    caso('¿hay restaurantes cerca de mi punto?', ['comida_fuera']);
    caso('¿y un café?', ['comida_fuera']);
    caso('¿hay una cafetería?', ['comida_fuera']);
  });
  it('recreación: «parque infantil» y «juegos infantiles» no son el criterio de área verde', () => {
    caso('¿hay juegos infantiles cerca?', ['recreacion']);
    caso('¿hay un parque infantil cerca de mi punto?', ['recreacion']);
  });
  it('«parque» a secas sigue siendo el criterio de área verde', () => {
    const i = Asistente.interpretar('busco una zona cerca de un parque', { hayPunto: true });
    expect(i.tipo).not.toBe('comercio');
    expect(i.criterios.map((c: { id: string }) => c.id)).toEqual(['areaVerde']);
  });
  it('buscar zonas «cerca de un banco» no se puede y lo dice', () => {
    expect(Asistente.interpretar('busco una zona cerca de un banco y un restaurante')).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'comercio_busqueda' });
  });
  it('mencionaComercio detecta las palabras nuevas', () => {
    for (const t of ['un banco', 'cajeros automáticos', 'restaurantes', 'una cafetería', 'juegos infantiles']) expect(Asistente.mencionaComercio(t)).toBe(true);
    expect(Asistente.mencionaComercio('busco una posta')).toBe(false);
  });

  const ent = (extra: object) => ({
    estado: 'INFORMATIVO', umbralM: null, fuente: 'OpenStreetMap (ODbL)', fecha: '2026-11-10', metodo: 'm', forma: null, lat: P.lat, lon: P.lon, osm: 'node/1', etiqueta: 'amenity=bank',
    fuenteElemento: 'OSM', codigo: null, verificado: null, dentroDeMall: null, ...extra,
  });
  const entorno = {
    finanzas: ent({ nombre: 'Cajero BBVA', distanciaM: 120, tipo: 'cajero', porTipo: { banco: ent({ nombre: 'BCP', distanciaM: 250, tipo: 'banco' }), cajero: ent({ nombre: 'Cajero BBVA', distanciaM: 120, tipo: 'cajero' }) } }),
    comida_fuera: ent({ nombre: 'La Nueva Palomino', distanciaM: 90, tipo: 'restaurante', porTipo: { restaurante: ent({ nombre: 'La Nueva Palomino', distanciaM: 90, tipo: 'restaurante' }), cafe: ent({ nombre: 'Café Central', distanciaM: 400, tipo: 'cafe' }) } }),
    recreacion: ent({ nombre: null, distanciaM: 60, tipo: 'juego_infantil' }),
  };
  const ctx = { punto: { lat: P.lat, lon: P.lon }, zona: null, estadoPDM: null, entorno };
  it('finanzas: el banco y el cajero más cercanos, la fuente y la salvedad, sin cumple ni no cumple', () => {
    const t = Asistente.responder({ tipo: 'comercio', criterios: [], comercio: ['finanzas'] }, ctx).texto;
    expect(t).toMatch(/Finanzas/);
    expect(t).toContain('Cajero BBVA');
    expect(t).toContain('BCP');
    expect(t).toMatch(/120 m/);
    expect(t).toMatch(/OpenStreetMap/);
    expect(t).toMatch(/informativo/i);
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('comida fuera: el restaurante y el café más cercanos', () => {
    const t = Asistente.responder({ tipo: 'comercio', criterios: [], comercio: ['comida_fuera'] }, ctx).texto;
    expect(t).toContain('La Nueva Palomino');
    expect(t).toContain('Café Central');
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('recreación: dice que es un área de juegos y que los parques son el criterio de área verde', () => {
    const t = Asistente.responder({ tipo: 'comercio', criterios: [], comercio: ['recreacion'] }, ctx).texto;
    expect(t).toMatch(/juegos infantiles/i);
    expect(t).toMatch(/60 m/);
    expect(t).toMatch(/área verde/i);
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('sin dato lo dice sin inventar', () => {
    const e = { ...entorno, finanzas: ent({ estado: 'SIN DATO', nombre: null, distanciaM: null, tipo: null }) };
    expect(Asistente.responder({ tipo: 'comercio', criterios: [], comercio: ['finanzas'] }, { ...ctx, entorno: e }).texto).toMatch(/sin dato/i);
  });
  it('el resumen del punto trae una línea informativa por necesidad', () => {
    const e: any = {
      ...entorno,
      salud: { estado: 'NO CUMPLE', nombre: 'H', distanciaM: 2500, umbralM: 1000, fuenteElemento: 'RENIPRESS' },
      educacion: { inicial: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 500 }, primaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 1500 }, secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000 } },
      transporte: { estado: 'CUMPLE', nombre: 'P', distanciaM: 100, umbralM: 400 },
      areaVerde: { estado: 'CUMPLE', nombre: 'Q', distanciaM: 100, umbralM: 300 },
    };
    const t = Asistente.responder({ tipo: 'ficha', criterios: [] }, { ...ctx, entorno: e }).texto;
    expect(t).toMatch(/Finanzas \(bancos y cajeros\) \(informativo\): Cajero BBVA a 120 m/);
    expect(t).toMatch(/Comida fuera de casa \(informativo\): La Nueva Palomino a 90 m/);
    expect(t).toMatch(/Recreación \(juegos infantiles\) \(informativo\)/);
  });
  it('«fuentes» menciona los servicios de OpenStreetMap', () => {
    const f = Asistente.explicar('comercio');
    expect([...f.fuente, ...f.limites, ...f.porque].join(' ')).toMatch(/bancos/i);
    expect([...f.fuente, ...f.limites, ...f.porque].join(' ')).toMatch(/restaurantes/i);
  });
});

// ------------------------------------------------------------------------------ Mapa

describe('Capas: finanzas, comida fuera y recreación como capas de puntos informativas', () => {
  const UM = { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };
  const datos = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [], finanzas: [BANCO, CAJERO], comida_fuera: [RESTAURANTE, CAFE], recreacion: [JUEGOS] }, [], UM);
  const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UM, area: null };
  it('tienen su etiqueta y no son un criterio de búsqueda', () => {
    for (const id of NUEVAS) expect(Capas.CAPAS.find((c: { id: string }) => c.id === id)).toBeDefined();
    expect(Asistente.CRITERIOS.finanzas).toBeUndefined();
  });
  it('cada elemento es un punto con su tipo y la leyenda cuenta por necesidad', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'finanzas' }, { id: 'comida_fuera' }, { id: 'recreacion' }] });
    const tipos = c.puntos.map((p: { tipo: string }) => p.tipo).sort();
    expect(tipos).toEqual(['banco', 'cafe', 'cajero', 'juego_infantil', 'restaurante']);
    expect(c.leyenda.map((l: { texto: string }) => l.texto).sort()).toEqual(['Comida fuera de casa: 2', 'Finanzas (bancos y cajeros): 2', 'Recreación (juegos infantiles): 1']);
    const b = c.puntos.find((p: { tipo: string }) => p.tipo === 'banco');
    expect(b.detalle).toMatch(/banco/);
    expect(b.circulo).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------ Archivos reales

const real = (n: string) => join(__dirname, '..', 'public', 'data', 'equipamiento', `${n}.geojson`);
const hayDatos = NUEVAS.every((n) => existsSync(real(n)));
(hayDatos ? describe : describe.skip)('archivos reales de servicios de la vida diaria', () => {
  const leer = (n: string) => JSON.parse(readFileSync(real(n), 'utf8'));
  it('traen la procedencia, la licencia ODbL, el aviso de informativo y los tipos que dice cada necesidad', () => {
    for (const n of NUEVAS) {
      const fc = leer(n);
      expect(fc.metadata.fuente).toMatch(/OpenStreetMap/);
      expect(fc.metadata.licencia).toBe('ODbL');
      expect(fc.metadata.fecha_extraccion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fc.metadata.informativo).toMatch(/sin umbral/i);
      expect(fc.metadata.registros).toBe(fc.features.length);
      expect(fc.features.length).toBeGreaterThan(10);
      const permitidos = Calculos.COMERCIO[n].tipos;
      expect(fc.features.every((f: any) => permitidos.includes(f.properties.tipo))).toBe(true);
    }
  });
  it('el centro de Arequipa tiene bancos, cajeros y restaurantes a pocos pasos de la Plaza de Armas', () => {
    const plaza = { lat: -16.3989, lon: -71.5369 };
    const g = Calculos.agruparComercio({ finanzas: leer('finanzas').features, comida_fuera: leer('comida_fuera').features, recreacion: leer('recreacion').features });
    for (const id of ['finanzas', 'comida_fuera']) {
      const r = Calculos.evaluarMasCercanoForma(plaza, g[id], { umbralM: null, fuente: 'OSM', fecha: 'x', metodo: 'm' });
      expect(r.estado).toBe('INFORMATIVO');
      expect(r.distanciaM).toBeLessThan(300);
    }
  });
});
