/**
 * El comercio organizado por NECESIDAD, no por la etiqueta de OpenStreetMap. Tres grupos, todos INFORMATIVOS (sin umbral):
 *   abastecimiento    mercados + supermercados (comida, escala de barrio); el supermercado dentro de un mall es el punto de abastecimiento, el mall no
 *   compras_ocio      solo los malls confirmados con su fuente (escala metropolitana); distancia al borde del polígono
 *   comercio_barrio   el resto de lo que OSM etiqueta shop=mall (galerías y centros comerciales pequeños)
 * Aquí: la clasificación (Calculos), la ficha (Equipamiento), el mapa (Capas), el conteo (Entidades), el chat (Asistente) y el informe (Reporte).
 * Sin red: `fetch` devuelve los archivos de prueba, salvo la prueba con los archivos reales de public/data/equipamiento.
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
const Asistente = require('../public/js/asistente.js');
const Capas = require('../public/js/capas.js');
const Entidades = require('../public/js/entidades.js');
const Reporte = require('../public/js/reporte.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const P = { lat: -16.409, lon: -71.5375 };
const alNorte = (m: number) => [P.lon, P.lat + m / M_POR_GRADO_LAT];
const punto = (coords: number[], properties: object) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: coords } });
const cuadrado = (mNorte: number, mEste: number, lado: number, properties: object) => {
  const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((P.lat * Math.PI) / 180));
  const x0 = P.lon + dLon(mEste);
  const x1 = P.lon + dLon(mEste + lado);
  const y0 = P.lat + mNorte / M_POR_GRADO_LAT;
  const y1 = P.lat + (mNorte + lado) / M_POR_GRADO_LAT;
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } };
};
const VERIFICADO = { id: 'aventura', nombre: 'Mall Aventura Arequipa', url: 'https://mallaventura.pe/arequipa/', entidad: 'Mall Aventura' };

// Un mall confirmado de 600 m de lado al norte-oeste del punto (borde sur a 200 m), con un supermercado en su interior; una galería (shop=mall sin fuente).
const MALL = cuadrado(200, -300, 600, { fuente: 'OSM', osm: 'way/3', nombre: 'Mall Aventura', tags: { shop: 'mall' }, verificado: VERIFICADO });
const SUPER_DENTRO = punto(alNorte(500), { fuente: 'OSM', osm: 'node/20', nombre: 'Tottus Mall Aventura', tags: { shop: 'supermarket' } });
const SUPER_FUERA = punto(alNorte(-900), { fuente: 'OSM', osm: 'node/21', nombre: 'Metro Sur', tags: { shop: 'supermarket' } });
const MERCADO = punto(alNorte(-400), { fuente: 'OSM', osm: 'node/1', nombre: 'Mercado San Camilo', tags: { amenity: 'marketplace' } });
const GALERIA = punto(alNorte(80), { fuente: 'OSM', osm: 'node/50', nombre: 'Galería Unicentro', tags: { shop: 'mall' } });
const GALERIA_POLIGONO = cuadrado(50, -20, 40, { fuente: 'OSM', osm: 'way/51', nombre: 'Galería Los Álamos', tags: { shop: 'mall' } });

// ------------------------------------------------------------------------------ Configuración

describe('CONFIG: los tres grupos de comercio siguen sin umbral', () => {
  it('abastecimiento, compras_ocio, comercio_barrio y las tres categorías de OSM tienen umbral null y dicen que falta una decisión', () => {
    for (const k of ['abastecimiento', 'compras_ocio', 'comercio_barrio', 'mercado', 'supermercado', 'mall']) {
      expect(CONFIG.umbrales[k]).toBeNull();
      expect(CONFIG.fuentesUmbral[k]).toMatch(/decisi[oó]n/i);
    }
  });
  it('cada categoría de OpenStreetMap tiene su propio archivo de datos', () => {
    expect(CONFIG.equipamiento.archivos.mercados).toBe('data/equipamiento/mercados.geojson');
    expect(CONFIG.equipamiento.archivos.supermercados).toBe('data/equipamiento/supermercados.geojson');
    expect(CONFIG.equipamiento.archivos.malls).toBe('data/equipamiento/malls.geojson');
  });
  it('lo que sí tiene umbral no cambia', () => {
    expect(CONFIG.umbrales.salud).toBe(1000);
    expect(CONFIG.umbrales.educacion).toEqual({ inicial: 500, primaria: 1500, secundaria: 3000 });
    expect(CONFIG.umbrales.transporte).toBe(400);
    expect(CONFIG.umbrales.areaVerde).toEqual({ distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 });
  });
});

describe('Calculos.COMERCIO: una entrada por necesidad', () => {
  it('son abastecimiento, compras_ocio y comercio_barrio, con etiqueta y escala', () => {
    expect(Object.keys(Calculos.COMERCIO)).toEqual(['abastecimiento', 'compras_ocio', 'comercio_barrio']);
    expect(Calculos.COMERCIO.abastecimiento).toMatchObject({ etiqueta: 'Abastecimiento (comida)', escala: 'barrio' });
    expect(Calculos.COMERCIO.compras_ocio).toMatchObject({ etiqueta: 'Compras y ocio', escala: 'metropolitana' });
    expect(Calculos.COMERCIO.comercio_barrio).toMatchObject({ etiqueta: 'Comercio de barrio', escala: 'barrio' });
  });
});

// ------------------------------------------------------------------------------ Clasificación

describe('Calculos.necesidadComercio: de qué necesidad es cada elemento', () => {
  it('un mercado y un supermercado son abastecimiento', () => {
    expect(Calculos.necesidadComercio('mercados', MERCADO.properties)).toBe('abastecimiento');
    expect(Calculos.necesidadComercio('supermercados', SUPER_FUERA.properties)).toBe('abastecimiento');
  });
  it('un mall confirmado con su fuente es compras y ocio', () => {
    expect(Calculos.necesidadComercio('malls', MALL.properties)).toBe('compras_ocio');
  });
  it('un shop=mall sin fuente es comercio de barrio (galería), aunque OSM lo llame mall', () => {
    expect(Calculos.necesidadComercio('malls', GALERIA.properties)).toBe('comercio_barrio');
  });
});

describe('Calculos.mallQueContiene: el supermercado dentro de un mall', () => {
  it('devuelve el mall cuyo polígono contiene el punto', () => {
    const c = Calculos.mallQueContiene({ lat: P.lat + 500 / M_POR_GRADO_LAT, lon: P.lon }, [GALERIA, MALL]);
    expect(c.properties.osm).toBe('way/3');
  });
  it('null si el punto está fuera de todo polígono; un mall que es solo un punto no contiene nada', () => {
    expect(Calculos.mallQueContiene({ lat: P.lat, lon: P.lon }, [GALERIA, MALL])).toBeNull();
    expect(Calculos.mallQueContiene({ lat: P.lat + 80 / M_POR_GRADO_LAT, lon: P.lon }, [GALERIA])).toBeNull();
  });
  it('prefiere el mall confirmado si dos polígonos contienen el punto', () => {
    const grande = cuadrado(100, -400, 900, { fuente: 'OSM', osm: 'way/9', nombre: 'Terreno comercial', tags: { shop: 'mall' } });
    expect(Calculos.mallQueContiene({ lat: P.lat + 500 / M_POR_GRADO_LAT, lon: P.lon }, [grande, MALL]).properties.osm).toBe('way/3');
  });
});

describe('Calculos.agruparComercio: reparte por necesidad sin cortar ni mover nada', () => {
  const g = Calculos.agruparComercio({ mercados: [MERCADO], supermercados: [SUPER_DENTRO, SUPER_FUERA], malls: [MALL, GALERIA, GALERIA_POLIGONO] });
  const osm = (lista: any[]) => lista.map((f) => f.properties.osm as string).sort((a, b) => a.localeCompare(b));

  it('abastecimiento = mercados + supermercados; el mall que contiene un supermercado NO es abastecimiento', () => {
    expect(osm(g.abastecimiento)).toEqual(['node/1', 'node/20', 'node/21']);
    expect(g.abastecimiento.some((f: any) => f.properties.osm === 'way/3')).toBe(false);
  });
  it('compras_ocio = solo los malls confirmados; comercio_barrio = el resto de shop=mall', () => {
    expect(osm(g.compras_ocio)).toEqual(['way/3']);
    expect(osm(g.comercio_barrio)).toEqual(['node/50', 'way/51']);
  });
  it('cada elemento trae su tipo y su necesidad', () => {
    const por = Object.fromEntries([...g.abastecimiento, ...g.compras_ocio, ...g.comercio_barrio].map((f: any) => [f.properties.osm, f.properties]));
    expect(por['node/1']).toMatchObject({ tipo: 'mercado', necesidad: 'abastecimiento' });
    expect(por['node/20']).toMatchObject({ tipo: 'supermercado', necesidad: 'abastecimiento' });
    expect(por['way/3']).toMatchObject({ tipo: 'mall', necesidad: 'compras_ocio' });
    expect(por['node/50']).toMatchObject({ tipo: 'mall', necesidad: 'comercio_barrio' });
  });
  it('el supermercado dentro del polígono de un mall lo dice (con el mall y si está confirmado); el de afuera no', () => {
    const por = Object.fromEntries(g.abastecimiento.map((f: any) => [f.properties.osm, f.properties]));
    expect(por['node/20'].dentro_de_mall).toEqual({ osm: 'way/3', nombre: 'Mall Aventura', verificado: true });
    expect(por['node/21'].dentro_de_mall).toBeNull();
    expect(por['node/1'].dentro_de_mall).toBeUndefined();
  });
  it('conserva la geometría y la fuente de cada elemento (no recorta nada) y no modifica la entrada', () => {
    expect(g.compras_ocio[0].geometry).toBe(MALL.geometry);
    expect(g.comercio_barrio.find((f: any) => f.properties.osm === 'way/51').geometry.type).toBe('Polygon');
    expect(g.compras_ocio[0].properties.verificado).toEqual(VERIFICADO);
    expect((SUPER_DENTRO.properties as any).necesidad).toBeUndefined();
  });
  it('sin listas, los tres grupos están vacíos', () => {
    expect(Calculos.agruparComercio({})).toEqual({ abastecimiento: [], compras_ocio: [], comercio_barrio: [] });
  });
});

// ------------------------------------------------------------------------------ Distancia (evaluarMasCercanoForma)

describe('Calculos.evaluarMasCercanoForma con los grupos', () => {
  const g = Calculos.agruparComercio({ mercados: [MERCADO], supermercados: [SUPER_DENTRO, SUPER_FUERA], malls: [MALL] });
  it('es INFORMATIVO sin umbral y lleva el tipo y el mall que contiene al supermercado', () => {
    const r = Calculos.evaluarMasCercanoForma({ lat: P.lat + 500 / M_POR_GRADO_LAT, lon: P.lon + 1e-5 }, g.abastecimiento, { umbralM: null, fuente: 'OSM', fecha: '2026-11-10', metodo: 'm' });
    expect(r).toMatchObject({ estado: 'INFORMATIVO', umbralM: null, nombre: 'Tottus Mall Aventura', tipo: 'supermercado' });
    expect(r.dentroDeMall).toEqual({ osm: 'way/3', nombre: 'Mall Aventura', verificado: true });
  });
});

// ------------------------------------------------------------------------------ Ficha (Equipamiento.evaluar)

const archivo = (features: object[]) => ({
  type: 'FeatureCollection',
  metadata: { fuente: 'OpenStreetMap (ODbL)', fecha_extraccion: '2026-11-10', deduplicacion: { radio_m: 150 } },
  features,
});
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
const TODOS = { mercados: archivo([MERCADO]), supermercados: archivo([SUPER_DENTRO, SUPER_FUERA]), malls: archivo([MALL, GALERIA, GALERIA_POLIGONO]) };
const ev = (datos: Record<string, object> = TODOS) => cargarEquipamiento(datos).evaluar(P.lat, P.lon);

describe('Equipamiento.evaluar: tres necesidades, todas informativas', () => {
  it('devuelve abastecimiento, compras_ocio y comercio_barrio (y ya no mercado / supermercado / mall sueltos)', async () => {
    const e = await ev();
    for (const k of ['abastecimiento', 'compras_ocio', 'comercio_barrio']) expect(e[k]).toMatchObject({ estado: 'INFORMATIVO', umbralM: null });
    expect(e.mall).toBeUndefined();
    expect(e.mallVerificado).toBeUndefined();
    expect(e.mercado).toBeUndefined();
  });

  it('abastecimiento: el más cercano entre mercados y supermercados, con el de cada tipo', async () => {
    const e = await ev();
    expect(e.abastecimiento).toMatchObject({ nombre: 'Mercado San Camilo', tipo: 'mercado', osm: 'node/1', fuenteElemento: 'OSM' });
    expect(e.abastecimiento.distanciaM).toBeCloseTo(400, 0);
    expect(e.abastecimiento.porTipo.mercado).toMatchObject({ nombre: 'Mercado San Camilo', estado: 'INFORMATIVO' });
    expect(e.abastecimiento.porTipo.supermercado).toMatchObject({ nombre: 'Tottus Mall Aventura', tipo: 'supermercado' });
    expect(e.abastecimiento.porTipo.supermercado.dentroDeMall).toMatchObject({ osm: 'way/3', verificado: true });
    expect(e.abastecimiento.metodo).toMatch(/sin umbral/i);
  });

  it('el supermercado dentro de un mall es el punto de abastecimiento: se mide hasta él, no hasta el borde del mall', async () => {
    const e = await ev({ mercados: archivo([]), supermercados: archivo([SUPER_DENTRO]), malls: archivo([MALL]) });
    expect(e.abastecimiento).toMatchObject({ nombre: 'Tottus Mall Aventura', tipo: 'supermercado' });
    expect(e.abastecimiento.distanciaM).toBeCloseTo(500, 0); // el borde del mall está a 200 m, pero el mall no abastece
    expect(e.compras_ocio.distanciaM).toBeCloseTo(200, 0);
  });

  it('si el supermercado es un punto del que el usuario está dentro del mall, la distancia al supermercado no es 0', async () => {
    const dentro = cuadrado(-100, -100, 200, { fuente: 'OSM', osm: 'way/4', nombre: 'Mall Grande', tags: { shop: 'mall' }, verificado: VERIFICADO });
    const sup = punto(alNorte(150), { fuente: 'OSM', osm: 'node/22', nombre: 'Súper interior', tags: { shop: 'supermarket' } });
    const e = await ev({ mercados: archivo([]), supermercados: archivo([sup]), malls: archivo([dentro]) });
    expect(e.compras_ocio.distanciaM).toBe(0);
    expect(e.abastecimiento.distanciaM).toBeCloseTo(150, 0);
  });

  it('compras_ocio: solo los malls confirmados, con su fuente y la distancia al BORDE', async () => {
    const e = await ev();
    expect(e.compras_ocio).toMatchObject({ nombre: 'Mall Aventura', osm: 'way/3' });
    expect(e.compras_ocio.distanciaM).toBeGreaterThan(190);
    expect(e.compras_ocio.distanciaM).toBeLessThan(210);
    expect(e.compras_ocio.forma.type).toBe('Polygon');
    expect(e.compras_ocio.verificado.url).toBe('https://mallaventura.pe/arequipa/');
  });

  it('comercio_barrio: las galerías (shop=mall sin fuente), nunca un mall confirmado; polígono: distancia al borde', async () => {
    const e = await ev();
    expect(e.comercio_barrio.nombre).toBe('Galería Los Álamos'); // el borde del polígono, a 50 m, le gana a la galería puntual a 80 m
    expect(e.comercio_barrio.distanciaM).toBeGreaterThan(45);
    expect(e.comercio_barrio.distanciaM).toBeLessThan(55);
    expect(e.comercio_barrio.forma.type).toBe('Polygon');
    expect(e.comercio_barrio.verificado).toBeNull();
  });

  it('un mall confirmado más cerca que una galería no aparece en comercio_barrio y viceversa', async () => {
    const e = await ev({ malls: archivo([MALL, GALERIA]) });
    expect(e.comercio_barrio.nombre).toBe('Galería Unicentro');
    expect(e.compras_ocio.nombre).toBe('Mall Aventura');
  });

  it('sin ningún mall confirmado, compras_ocio es SIN DATO (no se rellena con galerías)', async () => {
    const e = await ev({ mercados: archivo([MERCADO]), supermercados: archivo([SUPER_FUERA]), malls: archivo([GALERIA]) });
    expect(e.compras_ocio).toMatchObject({ estado: 'SIN DATO', distanciaM: null, umbralM: null });
    expect(e.comercio_barrio.nombre).toBe('Galería Unicentro');
  });

  it('nunca es NO CUMPLE aunque esté lejísimos', async () => {
    const lejos = punto(alNorte(30000), { fuente: 'OSM', osm: 'node/9', nombre: 'Mercado remoto', tags: { amenity: 'marketplace' } });
    const e = await ev({ mercados: archivo([lejos]), supermercados: archivo([]), malls: archivo([]) });
    expect(e.abastecimiento.estado).toBe('INFORMATIVO');
  });

  it('sin los archivos dice SIN DATO, no consulta nada en vivo y no afecta a lo demás', async () => {
    const e = await ev({});
    for (const k of ['abastecimiento', 'compras_ocio', 'comercio_barrio']) expect(e[k]).toMatchObject({ estado: 'SIN DATO', distanciaM: null, umbralM: null });
    expect(e.salud.estado).toBe('SIN DATO');
  });

  it('los archivos de comercio se leen aparte de lo que busca el asistente', async () => {
    const eq = cargarEquipamiento(TODOS);
    expect(Object.keys(await eq.datosCongelados()).sort()).toEqual(['areasVerdes', 'educacion', 'salud', 'transporte']);
    const c = await eq.comercio();
    expect(c.mercados.features).toHaveLength(1);
    expect(c.supermercados.features).toHaveLength(2);
    expect(c.malls.features).toHaveLength(3);
  });
});

// ------------------------------------------------------------------------------ Búsqueda de zonas: sin efecto

const UMBRALES = { salud: 1000, consultorio: null, abastecimiento: null, compras_ocio: null, comercio_barrio: null, mercado: null, supermercado: null, mall: null, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };
const DISTRITO = [[[[-71.55, -16.42], [-71.53, -16.42], [-71.53, -16.40], [-71.55, -16.40], [-71.55, -16.42]]]];
const en = (i: number) => [-71.54, -16.41 + i * 0.0002];
const M1 = punto(en(0), { fuente: 'OSM', osm: 'node/1', nombre: 'Mercado A', tags: { amenity: 'marketplace' } });
const S1 = punto(en(1), { fuente: 'OSM', osm: 'node/2', nombre: 'Super B', tags: { shop: 'supermarket' } });
const poligonoMall = (osm: string, nombre: string, x0: number, verificado?: object) => ({
  type: 'Feature',
  properties: { fuente: 'OSM', osm, nombre, tags: { shop: 'mall' }, ...(verificado ? { verificado } : {}) },
  geometry: { type: 'Polygon', coordinates: [[[x0, -16.415], [x0 + 0.002, -16.415], [x0 + 0.002, -16.413], [x0, -16.413], [x0, -16.415]]] },
});
const MALL_C = poligonoMall('way/3', 'Mall C', -71.545, VERIFICADO);
const S_EN_C = punto([-71.544, -16.414], { fuente: 'OSM', osm: 'node/5', nombre: 'Súper en C', tags: { shop: 'supermarket' } });
const GALERIA_D = poligonoMall('way/8', 'Galería D', -71.538);
const MALL_FUERA = punto([-71.6, -16.5], { fuente: 'OSM', osm: 'node/7', nombre: 'Mall lejano', tags: { shop: 'mall' } });
const entrada = { salud: [], mercados: [M1], supermercados: [S1, S_EN_C], malls: [MALL_C, GALERIA_D, MALL_FUERA], educacion: [], transporte: [], areasVerdes: [] };
const datos = Asistente.prepararDatos(entrada, [], UMBRALES);

describe('el comercio no entra en la búsqueda de zonas ni en el puntaje', () => {
  it('los tres grupos no son criterios del asistente', () => {
    for (const id of ['abastecimiento', 'compras_ocio', 'comercio_barrio', 'mercado', 'supermercado', 'mall']) expect(Asistente.CRITERIOS[id]).toBeUndefined();
  });
  it('evaluar una celda da lo mismo con o sin datos de comercio', () => {
    const sin = Asistente.prepararDatos({ ...entrada, mercados: [], supermercados: [], malls: [] }, [], UMBRALES);
    const celda = { lat: -16.41, lon: -71.54, zona: { codigo: 'RDM' } };
    const criterios = [{ id: 'salud' }, { id: 'areaVerde' }];
    expect(Asistente.evaluarCelda(celda, datos, criterios, UMBRALES)).toEqual(Asistente.evaluarCelda(celda, sin, criterios, UMBRALES));
  });
  it('«un parque cerca de un mall» busca solo por el parque', () => {
    expect(Asistente.interpretar('quiero un parque cerca de un mall').criterios.map((c: { id: string }) => c.id)).toEqual(['areaVerde']);
  });
});

// ------------------------------------------------------------------------------ Mapa y conteo

describe('Asistente.prepararDatos: el comercio queda agrupado por necesidad', () => {
  it('trae abastecimiento, compras_ocio y comercio_barrio con la fuente, el centro, la forma y el tipo', () => {
    expect(datos.abastecimiento.map((p: any) => p.nombre).sort()).toEqual(['Mercado A', 'Super B', 'Súper en C']);
    expect(datos.compras_ocio.map((p: any) => p.nombre)).toEqual(['Mall C']);
    expect(datos.comercio_barrio.map((p: any) => p.nombre).sort()).toEqual(['Galería D', 'Mall lejano']);
    expect(datos.abastecimiento.find((p: any) => p.nombre === 'Súper en C')).toMatchObject({ tipo: 'supermercado', fuente: 'OSM', forma: null, dentroDeMall: { nombre: 'Mall C', verificado: true } });
    expect(datos.compras_ocio[0].forma.type).toBe('Polygon');
    expect(datos.compras_ocio[0].lat).toBeCloseTo(-16.414, 3);
  });
  it('sin comercio en la entrada, las listas están vacías', () => {
    const d = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);
    expect([d.abastecimiento, d.compras_ocio, d.comercio_barrio]).toEqual([[], [], []]);
  });
});

describe('Capas: tres capas de comercio por necesidad, sin círculo de distancia', () => {
  const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UMBRALES, area: { polys: DISTRITO } };
  it('están entre las capas de servicio con su etiqueta', () => {
    for (const [id, etiqueta] of [['abastecimiento', 'Abastecimiento (mercados y supermercados)'], ['compras_ocio', 'Compras y ocio (malls)'], ['comercio_barrio', 'Comercio de barrio (galerías)']]) {
      expect(Capas.CAPAS.find((c: { id: string }) => c.id === id)).toMatchObject({ etiqueta, grupo: 'servicio' });
    }
    expect(Capas.CAPAS.find((c: { id: string }) => ['mercados', 'supermercados', 'malls'].includes(c.id))).toBeUndefined();
  });
  it('dibuja los puntos con su fuente y el polígono del mall, solo lo que cae en el distrito, y sin radio', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'abastecimiento' }, { id: 'compras_ocio' }, { id: 'comercio_barrio' }] });
    expect(c.puntos.map((p: { nombre: string }) => p.nombre).sort()).toEqual(['Galería D', 'Mall C', 'Mercado A', 'Super B', 'Súper en C']);
    const mall = c.puntos.find((p: { nombre: string }) => p.nombre === 'Mall C');
    expect(mall).toMatchObject({ capa: 'compras_ocio', tipo: 'mall', detalle: 'Compras y ocio', fuente: 'OSM' });
    expect(mall.verificado.url).toBe('https://mallaventura.pe/arequipa/');
    expect(c.puntos.find((p: { nombre: string }) => p.nombre === 'Mercado A')).toMatchObject({ capa: 'abastecimiento', tipo: 'mercado', detalle: 'Abastecimiento (comida): mercado de abastos' });
    expect(c.puntos.find((p: { nombre: string }) => p.nombre === 'Galería D')).toMatchObject({ capa: 'comercio_barrio', tipo: 'galeria', detalle: 'Comercio de barrio' });
    expect(c.puntos.every((p: { radioM?: number }) => p.radioM === undefined)).toBe(true);
    expect(c.circulos).toEqual([]);
    expect(c.poligonos.map((p: { capa: string; nombre: string }) => [p.capa, p.nombre]).sort()).toEqual([['comercio_barrio', 'Galería D'], ['compras_ocio', 'Mall C']]);
    expect(c.leyenda.map((l: { texto: string }) => l.texto)).toEqual(['Abastecimiento (comida): 3', 'Compras y ocio: 1', 'Comercio de barrio: 1']);
  });
  it('el supermercado dentro de un mall dice en cuál está', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'abastecimiento' }] });
    expect(c.puntos.find((p: { nombre: string }) => p.nombre === 'Súper en C').detalle).toMatch(/dentro de Mall C/);
  });
  it('una búsqueda del asistente no genera estas capas', () => {
    expect(Capas.deCriterios([{ id: 'salud', umbralEfectivoM: 1000 }]).map((c: { id: string }) => c.id)).toEqual(['salud']);
  });
  it('si no hay en la zona lo dice', () => {
    const d = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);
    const c = Capas.construir({ ...base, datos: d, capas: [{ id: 'abastecimiento' }] });
    expect(c.resumen).toMatch(/no hay puntos de abastecimiento/i);
  });
});

describe('Entidades.contarComercio', () => {
  it('cuenta lo del distrito por necesidad y deja fuera lo de afuera', () => {
    expect(Entidades.contarComercio(datos, DISTRITO, 'abastecimiento')).toMatchObject({ total: 3, fuentes: { OSM: 3 } });
    expect(Entidades.contarComercio(datos, DISTRITO, 'compras_ocio')).toMatchObject({ total: 1, fuentes: { OSM: 1 } });
    expect(Entidades.contarComercio(datos, DISTRITO, 'comercio_barrio').lista.map((p: { nombre: string }) => p.nombre)).toEqual(['Galería D']);
  });
});

// ------------------------------------------------------------------------------ Chat

describe('chat: cada frase va a su necesidad', () => {
  const ids = (t: string) => Asistente.interpretar(t).criterios.map((c: { id: string }) => c.id);
  const comercio = (t: string) => Asistente.interpretar(t, { hayPunto: true });

  it('mercado, supermercado y «dónde comprar comida» son abastecimiento', () => {
    for (const t of ['¿hay un mercado cerca?', '¿hay un supermercado cerca?', '¿dónde puedo comprar comida cerca?', '¿hay víveres cerca de mi punto?', '¿hay un hipermercado cerca?']) {
      expect(comercio(t)).toMatchObject({ tipo: 'comercio', comercio: ['abastecimiento'], criterios: [] });
    }
  });
  it('mall, centro comercial, shopping, outlet y ocio son compras y ocio', () => {
    for (const t of ['¿hay un mall cerca de mi punto?', '¿hay un centro comercial cerca?', '¿hay un shopping cerca?', '¿hay un outlet cerca?', '¿dónde puedo ir de ocio?']) {
      expect(comercio(t)).toMatchObject({ tipo: 'comercio', comercio: ['compras_ocio'], criterios: [] });
    }
  });
  it('galería y comercio de barrio son comercio de barrio, no una zona comercial del plano', () => {
    for (const t of ['¿hay una galería cerca de mi punto?', '¿hay galerías comerciales cerca?', '¿hay comercio de barrio cerca?']) {
      expect(comercio(t)).toMatchObject({ tipo: 'comercio', comercio: ['comercio_barrio'], criterios: [] });
    }
  });
  it('ninguna de estas palabras es el criterio de zona comercial del plano', () => {
    for (const t of ['un mall', 'un centro comercial', 'centros comerciales', 'un supermercado', 'un mercado', 'una galería comercial', 'comprar comida']) expect(ids(`busco cerca de ${t}`)).toEqual([]);
  });
  it('varias necesidades en una frase salen en el orden fijo', () => {
    expect(comercio('¿hay un mall y un mercado cerca de mi punto?').comercio).toEqual(['abastecimiento', 'compras_ocio']);
  });
  it('buscar zonas cerca de ellas no se puede; «zona comercial» sigue siendo la zona del plano', () => {
    for (const t of ['busco una zona cerca de un mall', 'quiero vivir cerca de un mercado', 'busco una zona cerca de una galería']) {
      expect(Asistente.interpretar(t)).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'comercio_busqueda' });
      expect(ids(t)).toEqual([]);
    }
    expect(ids('busco una zona comercial')).toEqual(['comercial']);
  });
  it('«¿cuántos mercados hay en Cayma?» cuenta el abastecimiento del distrito', () => {
    expect(Asistente.interpretar('¿cuántos mercados hay en Cayma?')).toMatchObject({ tipo: 'comercio', comercio: ['abastecimiento'], distrito: 'CAYMA' });
  });
  it('mencionaComercio detecta las tres necesidades (y no manda la frase al modelo)', () => {
    for (const t of ['¿Hay un Mall cerca?', 'mercados en Cayma', 'el supermercado más cercano', 'una galería', 'dónde comprar comida']) expect(Asistente.mencionaComercio(t)).toBe(true);
    expect(Asistente.mencionaComercio('busco una posta')).toBe(false);
    expect(Asistente.mencionaComercio('zona comercial')).toBe(false);
  });

  const informativo = (nombre: string, distanciaM: number, extra: object = {}) => ({ estado: 'INFORMATIVO', nombre, distanciaM, umbralM: null, fuenteElemento: 'OSM', osm: 'node/1', ...extra });
  const entorno: any = {
    abastecimiento: informativo('Tottus Mall Aventura', 300, {
      tipo: 'supermercado', osm: 'node/20', dentroDeMall: { osm: 'way/3', nombre: 'Mall Aventura', verificado: true },
      porTipo: { mercado: informativo('Mercado San Camilo', 900), supermercado: informativo('Tottus Mall Aventura', 300, { tipo: 'supermercado', dentroDeMall: { osm: 'way/3', nombre: 'Mall Aventura', verificado: true } }) },
    }),
    compras_ocio: informativo('Mall Aventura', 0, { osm: 'way/3', verificado: VERIFICADO }),
    comercio_barrio: informativo('Galería Unicentro', 80, { osm: 'node/50' }),
    salud: { estado: 'NO CUMPLE', nombre: 'HOSPITAL LEJANO', distanciaM: 2500, umbralM: 1000, fuenteElemento: 'RENIPRESS', codigo: '00000010', categoria: 'II-1' },
    educacion: { inicial: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 500 }, primaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 1500 }, secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000 } },
    transporte: { estado: 'CUMPLE', nombre: 'Paradero', distanciaM: 100, umbralM: 400 },
    areaVerde: { estado: 'CUMPLE', nombre: 'Parque', distanciaM: 100, umbralM: 300 },
  };
  const ctx = { punto: { lat: -16.4, lon: -71.5 }, zona: null, entorno, estadoPDM: null };
  const pregunta = (comercioIds: string[], c: object = ctx) => Asistente.responder({ tipo: 'comercio', comercio: comercioIds, criterios: [] }, c).texto;

  it('abastecimiento: el más cercano, el mercado y el supermercado, su fuente, dónde está el supermercado, sin cumple / no cumple', () => {
    const t = pregunta(['abastecimiento']);
    expect(t).toMatch(/abastecimiento/i);
    expect(t).toContain('Tottus Mall Aventura');
    expect(t).toContain('300 m');
    expect(t).toContain('Mercado San Camilo');
    expect(t).toContain('900 m');
    expect(t).toMatch(/dentro de Mall Aventura/);
    expect(t).toContain('OpenStreetMap');
    expect(t).toMatch(/informativ/i);
    expect(t).not.toMatch(/cumple|referencia \d/i);
  });
  it('compras y ocio: el mall confirmado con su fuente y que el punto está dentro, sin mencionar la galería', () => {
    const t = pregunta(['compras_ocio']);
    expect(t).toMatch(/compras y ocio/i);
    expect(t).toContain('Mall Aventura');
    expect(t).toMatch(/dentro|0 m/);
    expect(t).toContain('https://mallaventura.pe/arequipa/');
    expect(t).not.toContain('Galería Unicentro');
    expect(t).not.toMatch(/cumple/i);
  });
  it('comercio de barrio: la galería, aclarando que es comercio de barrio y no un mall', () => {
    const t = pregunta(['comercio_barrio']);
    expect(t).toContain('Galería Unicentro');
    expect(t).toMatch(/comercio de barrio/i);
    expect(t).toMatch(/galería/i);
    expect(t).not.toContain('Mall Aventura');
  });
  it('varias necesidades en una respuesta, solo las preguntadas', () => {
    const t = pregunta(['abastecimiento', 'comercio_barrio']);
    expect(t).toContain('Tottus Mall Aventura');
    expect(t).toContain('Galería Unicentro');
    expect(t).not.toContain('https://mallaventura.pe');
  });
  it('compras y ocio sin mall confirmado dice sin dato y no ofrece una galería en su lugar', () => {
    const t = pregunta(['compras_ocio'], { ...ctx, entorno: { ...entorno, compras_ocio: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: null } } });
    expect(t).toMatch(/sin dato|no tengo/i);
    expect(t).not.toContain('Galería Unicentro');
  });
  it('sin punto pide elegir uno o preguntar por un distrito', () => {
    expect(pregunta(['compras_ocio'], {})).toMatch(/punto|distrito/);
  });
  it('el conteo de un distrito da el total por fuente, desglosa mercados y supermercados, avisa que es informativo y manda la capa al mapa', () => {
    const lista = [{ tipo: 'mercado' }, { tipo: 'mercado' }, { tipo: 'supermercado' }];
    const r = Asistente.responder({ tipo: 'comercio', comercio: ['abastecimiento'], distrito: 'CAYMA', criterios: [] }, { distritoTitulo: 'Cayma', fecha: '2026-11-10', comercio: { abastecimiento: { total: 3, fuentes: { OSM: 3 }, lista } } });
    expect(r.texto).toContain('3 puntos de abastecimiento');
    expect(r.texto).toMatch(/2 mercados/);
    expect(r.texto).toMatch(/1 supermercado/);
    expect(r.texto).toContain('OpenStreetMap');
    expect(r.texto).toMatch(/informativ/i);
    expect(r.mapa).toMatchObject({ distrito: 'CAYMA', capas: ['abastecimiento'] });
  });
  it('un distrito sin ninguno lo dice sin afirmar que no existe', () => {
    const r = Asistente.responder({ tipo: 'comercio', comercio: ['compras_ocio'], distrito: 'YURA', criterios: [] }, { distritoTitulo: 'Yura', fecha: '2026-11-10', comercio: { compras_ocio: { total: 0, fuentes: {}, lista: [] } } });
    expect(r.texto).toMatch(/no encontr/i);
    expect(r.texto).toMatch(/puede que existan/i);
  });
  it('el resumen del punto trae las tres necesidades como líneas informativas', () => {
    const t = Asistente.responder({ tipo: 'ficha', criterios: [] }, ctx).texto;
    expect(t).toMatch(/Abastecimiento \(comida\) \(informativo\): Tottus Mall Aventura a 300 m/);
    expect(t).toMatch(/Compras y ocio \(informativo\): Mall Aventura/);
    expect(t).toMatch(/Comercio de barrio \(informativo\): Galería Unicentro/);
  });
  it('«fuentes» y la nota de búsqueda describen las tres necesidades', () => {
    const f = Asistente.explicar('fuentes');
    expect([...f.fuente, ...f.limites].join(' ')).toMatch(/abastecimiento/i);
    expect(Asistente.notaComercio()).toMatch(/abastecimiento/i);
    expect(Asistente.notaComercio()).toMatch(/informativ/i);
  });
});

// ------------------------------------------------------------------------------ Informe

describe('Reporte: el comercio es una sección informativa con los tres grupos', () => {
  const servicio = (extra: object) => ({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'POSTA X', fecha: '2026-10-30', fuente: 'RENIPRESS (SUSALUD) (fuente primaria) y OpenStreetMap (ODbL, respaldo)', metodo: 'Distancia en línea recta.', ...extra });
  const info = (nombre: string, d: number, extra: object = {}) => servicio({ estado: 'INFORMATIVO', nombre, distanciaM: d, umbralM: null, fuenteElemento: 'OSM', osm: 'node/1', fuente: 'OpenStreetMap (ODbL)', metodo: 'Distancia en línea recta. Sin umbral.', ...extra });
  const d = (comercio: boolean) => ({
    punto: { lat: -16.4, lon: -71.5, etiqueta: 'Punto' }, zona: null, modulos: {}, avisoPDM: null, verificaciones: {}, umbrales: UMBRALES,
    fuentesUmbral: { ...CONFIG.fuentesUmbral },
    fuentes: { zonificacion: 'Plano', peligros: 'p', distritos: 'd', delitos: 'e' },
    variables: {
      salud: servicio({}),
      ...(comercio ? {
        abastecimiento: info('Tottus Mall Aventura', 300, { tipo: 'supermercado', dentroDeMall: { osm: 'way/3', nombre: 'Mall Aventura', verificado: true }, porTipo: { mercado: info('Mercado San Camilo', 900), supermercado: info('Tottus Mall Aventura', 300) } }),
        compras_ocio: info('Mall Aventura', 0, { verificado: VERIFICADO }),
        comercio_barrio: info('Galería Unicentro', 80),
      } : {}),
      educacion: { inicial: servicio({}), primaria: servicio({}), secundaria: servicio({}) },
      transporte: servicio({ nombre: 'Paradero' }), areaVerde: servicio({ nombre: 'Parque' }),
    },
  });
  const seccion = (datos: object, t: string) => Reporte.construirSecciones(datos).find((s: { titulo: string }) => s.titulo.includes(t));

  it('hay una sección de comercio informativa con cada grupo, su nombre, su distancia, su fuente y el estado INFORMATIVO', () => {
    const s = seccion(d(true), 'Comercio');
    expect(s.titulo).toMatch(/informativo/i);
    for (const t of ['Abastecimiento (comida)', 'Compras y ocio', 'Comercio de barrio', 'Tottus Mall Aventura', 'Mercado San Camilo', 'Mall Aventura', 'Galería Unicentro', '300 m', 'INFORMATIVO', 'https://mallaventura.pe/arequipa/']) expect(s.cuerpo).toContain(t);
    expect(s.cuerpo).toMatch(/dentro de Mall Aventura/);
    expect(s.cuerpo).not.toMatch(/Umbral/);
    expect(s.cuerpo).not.toMatch(/NO CUMPLE/);
  });
  it('sin comercio en las variables, el informe no cambia', () => {
    expect(seccion(d(false), 'Comercio')).toBeUndefined();
  });
  it('las limitaciones dicen que el comercio es informativo y su umbral sigue pendiente', () => {
    expect(Reporte.limites(d(true)).join(' ')).toMatch(/(abastecimiento|mall|mercado)[^.]*informativ/i);
  });
});

// ------------------------------------------------------------------------------ Datos reales

describe('datos reales: el reparto por necesidad cubre todo y es coherente', () => {
  const leer = (n: string) => JSON.parse(readFileSync(join(__dirname, '..', 'public', 'data', 'equipamiento', `${n}.geojson`), 'utf8')).features;
  const mercados = leer('mercados');
  const supermercados = leer('supermercados');
  const malls = leer('malls');
  const g = Calculos.agruparComercio({ mercados, supermercados, malls });

  it('cada elemento cae en exactamente un grupo y ninguno se pierde', () => {
    expect(g.abastecimiento.length).toBe(mercados.length + supermercados.length);
    expect(g.compras_ocio.length + g.comercio_barrio.length).toBe(malls.length);
  });
  it('compras_ocio son exactamente los malls con fuente (verificado); el resto son galerías', () => {
    expect(g.compras_ocio.length).toBe(malls.filter((m: any) => m.properties.verificado).length);
    expect(g.compras_ocio.length).toBeGreaterThan(0);
    expect(g.compras_ocio.every((f: any) => f.properties.verificado)).toBe(true);
    expect(g.comercio_barrio.some((f: any) => f.properties.verificado)).toBe(false);
  });
  it('un supermercado cuyo punto está dentro de un polígono de mall lo dice y el polígono lo contiene de verdad', () => {
    const dentro = g.abastecimiento.filter((f: any) => f.properties.dentro_de_mall);
    expect(dentro.length).toBeGreaterThan(0);
    for (const f of dentro) {
      const mall = malls.find((m: any) => m.properties.osm === f.properties.dentro_de_mall.osm);
      const [lon, lat] = f.geometry.type === 'Point' ? f.geometry.coordinates : [Calculos.centroDe(f.geometry).lon, Calculos.centroDe(f.geometry).lat];
      expect(Calculos.distanciaAGeometriaM(lat, lon, mall.geometry)).toBe(0);
    }
    const tottus = dentro.find((f: any) => /Tottus/.test(f.properties.nombre) && /Aventura/.test(f.properties.dentro_de_mall.nombre));
    expect(tottus.properties.dentro_de_mall.verificado).toBe(true);
  });
});
