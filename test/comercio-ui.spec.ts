/**
 * Mercados, supermercados y malls en la aplicación: categorías INFORMATIVAS (sin umbral), con el mismo trato que el consultorio. Aquí: la
 * configuración, la ficha (Equipamiento), el mapa (Capas), el conteo por distrito (Entidades), el chat (Asistente) y el informe (Reporte).
 * La lógica de datos está en test/comercio.spec.ts. Sin red: `fetch` devuelve los archivos de prueba.
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

// ------------------------------------------------------------------------------ Configuración

describe('CONFIG: mercado, supermercado y mall no tienen umbral', () => {
  it('sus umbrales son null y dicen que falta una decisión; los demás umbrales no cambian', () => {
    for (const k of ['mercado', 'supermercado', 'mall']) {
      expect(CONFIG.umbrales[k]).toBeNull();
      expect(CONFIG.fuentesUmbral[k]).toMatch(/decisi[oó]n/i);
    }
    expect(CONFIG.umbrales.salud).toBe(1000);
    expect(CONFIG.umbrales.consultorio).toBeNull();
    expect(CONFIG.umbrales.educacion).toEqual({ inicial: 500, primaria: 1500, secundaria: 3000 });
    expect(CONFIG.umbrales.transporte).toBe(400);
    expect(CONFIG.umbrales.areaVerde).toEqual({ distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 });
  });
  it('cada categoría tiene su propio archivo de datos', () => {
    expect(CONFIG.equipamiento.archivos.mercados).toBe('data/equipamiento/mercados.geojson');
    expect(CONFIG.equipamiento.archivos.supermercados).toBe('data/equipamiento/supermercados.geojson');
    expect(CONFIG.equipamiento.archivos.malls).toBe('data/equipamiento/malls.geojson');
  });
});

describe('Calculos.COMERCIO', () => {
  it('describe las tres categorías con su nombre en singular y plural', () => {
    expect(Object.keys(Calculos.COMERCIO)).toEqual(['mercado', 'supermercado', 'mall']);
    expect(Calculos.COMERCIO.mall).toMatchObject({ capa: 'malls', singular: 'mall (centro comercial)' });
    expect(Calculos.COMERCIO.mercado.plural).toMatch(/mercados/);
  });
});

// ------------------------------------------------------------------------------ Ficha

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

const MERCADO = punto(alNorte(300), { fuente: 'OSM', osm: 'node/1', nombre: 'Mercado San Camilo', tags: { amenity: 'marketplace' } });
const SUPER = punto(alNorte(700), { fuente: 'OSM', osm: 'node/2', nombre: 'Tottus', tags: { shop: 'supermarket' } });
const MALL = cuadrado(200, -300, 600, { fuente: 'OSM', osm: 'way/3', nombre: 'Mall Aventura', tags: { shop: 'mall' }, verificado: { id: 'aventura', nombre: 'Mall Aventura Arequipa', url: 'https://mallaventura.pe/arequipa/', entidad: 'Mall Aventura' } });

describe('Equipamiento.evaluar: mercado, supermercado y mall son informativos', () => {
  const ev = async (datos: Record<string, object> = { mercados: archivo([MERCADO]), supermercados: archivo([SUPER]), malls: archivo([MALL]) }) => cargarEquipamiento(datos).evaluar(P.lat, P.lon);
  it('da el más cercano de cada categoría y su distancia, INFORMATIVO, sin umbral', async () => {
    const e = await ev();
    expect(e.mercado).toMatchObject({ estado: 'INFORMATIVO', nombre: 'Mercado San Camilo', umbralM: null, fuenteElemento: 'OSM', osm: 'node/1' });
    expect(e.mercado.distanciaM).toBeCloseTo(300, 0);
    expect(e.supermercado).toMatchObject({ estado: 'INFORMATIVO', nombre: 'Tottus', umbralM: null });
    expect(e.mercado.metodo).toMatch(/sin umbral/i);
    expect(e.mercado.fecha).toBe('2026-11-10');
  });
  it('del mall mide la distancia al BORDE del polígono (200 m), no al centro', async () => {
    const e = await ev();
    expect(e.mall.nombre).toBe('Mall Aventura');
    expect(e.mall.distanciaM).toBeGreaterThan(190);
    expect(e.mall.distanciaM).toBeLessThan(210);
    expect(e.mall.forma.type).toBe('Polygon');
    expect(e.mall.verificado.url).toBe('https://mallaventura.pe/arequipa/');
  });
  it('si el punto está dentro del polígono del mall la distancia es 0', async () => {
    const dentro = cuadrado(-100, -100, 200, { fuente: 'OSM', osm: 'way/4', nombre: 'Mall Grande', tags: { shop: 'mall' } });
    const e = await ev({ malls: archivo([dentro]) });
    expect(e.mall.distanciaM).toBe(0);
  });
  it('nunca es NO CUMPLE aunque esté lejísimos', async () => {
    const lejos = punto(alNorte(30000), { fuente: 'OSM', osm: 'node/9', nombre: 'Mercado remoto', tags: { amenity: 'marketplace' } });
    expect((await ev({ mercados: archivo([lejos]) })).mercado.estado).toBe('INFORMATIVO');
  });
  it('sin el archivo dice SIN DATO, no consulta nada en vivo y no afecta a lo demás', async () => {
    const e = await ev({});
    expect(e.mercado).toMatchObject({ estado: 'SIN DATO', distanciaM: null, umbralM: null });
    expect(e.mall.estado).toBe('SIN DATO');
    expect(e.salud.estado).toBe('SIN DATO');
  });
});

describe('Equipamiento: datos de comercio aparte de lo que busca el asistente', () => {
  it('datosCongelados no incluye el comercio y comercio() lo lee aparte (null si falta)', async () => {
    const eq = cargarEquipamiento({ mercados: archivo([MERCADO]), malls: archivo([MALL]) });
    expect(Object.keys(await eq.datosCongelados()).sort()).toEqual(['areasVerdes', 'educacion', 'salud', 'transporte']);
    const c = await eq.comercio();
    expect(c.mercados.features).toHaveLength(1);
    expect(c.malls.features).toHaveLength(1);
    expect(c.supermercados).toBeNull();
  });
});

// ------------------------------------------------------------------------------ Mapa y conteo

const UMBRALES = { salud: 1000, consultorio: null, mercado: null, supermercado: null, mall: null, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };
const DISTRITO = [[[[-71.55, -16.42], [-71.53, -16.42], [-71.53, -16.40], [-71.55, -16.40], [-71.55, -16.42]]]];
const en = (i: number) => [-71.54, -16.41 + i * 0.0002];
const M1 = punto(en(0), { fuente: 'OSM', osm: 'node/1', nombre: 'Mercado A', tags: { amenity: 'marketplace' } });
const S1 = punto(en(1), { fuente: 'OSM', osm: 'node/2', nombre: 'Super B', tags: { shop: 'supermarket' } });
const MALL1 = {
  type: 'Feature',
  properties: { fuente: 'OSM', osm: 'way/3', nombre: 'Mall C', tags: { shop: 'mall' } },
  geometry: { type: 'Polygon', coordinates: [[[-71.545, -16.415], [-71.543, -16.415], [-71.543, -16.413], [-71.545, -16.413], [-71.545, -16.415]]] },
};
const MALL_FUERA = punto([-71.6, -16.5], { fuente: 'OSM', osm: 'node/7', nombre: 'Mall lejano', tags: { shop: 'mall' } });
const datos = Asistente.prepararDatos({ salud: [], mercados: [M1], supermercados: [S1], malls: [MALL1, MALL_FUERA], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);

describe('Asistente.prepararDatos: el comercio va aparte', () => {
  it('datos.mercados, supermercados y malls traen la fuente, el centro y la forma del polígono', () => {
    expect(datos.mercados[0]).toMatchObject({ nombre: 'Mercado A', fuente: 'OSM', osm: 'node/1', forma: null });
    expect(datos.malls[0].forma.type).toBe('Polygon');
    expect(datos.malls[0].lat).toBeCloseTo(-16.414, 3);
    expect(datos.malls).toHaveLength(2);
  });
  it('sin comercio en la entrada, las listas están vacías', () => {
    const d = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);
    expect([d.mercados, d.supermercados, d.malls]).toEqual([[], [], []]);
  });
});

describe('Capas: mercados, supermercados y malls son capas propias, sin círculo de distancia', () => {
  const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UMBRALES, area: { polys: DISTRITO } };
  it('están entre las capas de servicio con su etiqueta', () => {
    for (const [id, etiqueta] of [['mercados', 'Mercados'], ['supermercados', 'Supermercados'], ['malls', 'Malls (centros comerciales)']]) {
      expect(Capas.CAPAS.find((c: { id: string }) => c.id === id)).toMatchObject({ etiqueta, grupo: 'servicio' });
    }
  });
  it('dibuja los puntos con su fuente y el polígono del mall, y solo lo que cae en el distrito', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'mercados' }, { id: 'supermercados' }, { id: 'malls' }] });
    expect(c.puntos.map((p: { nombre: string }) => p.nombre)).toEqual(['Mercado A', 'Super B', 'Mall C']);
    expect(c.puntos[0]).toMatchObject({ capa: 'mercados', tipo: 'mercado', detalle: 'Mercado', fuente: 'OSM' });
    expect(c.puntos[2]).toMatchObject({ capa: 'malls', tipo: 'mall' });
    expect(c.puntos.every((p: { radioM?: number }) => p.radioM === undefined)).toBe(true);
    expect(c.circulos).toEqual([]);
    expect(c.poligonos.map((p: { capa: string; nombre: string }) => [p.capa, p.nombre])).toEqual([['malls', 'Mall C']]);
    expect(c.leyenda.map((l: { texto: string }) => l.texto)).toEqual(['Mercados: 1', 'Supermercados: 1', 'Malls (centros comerciales): 1']);
  });
  it('una búsqueda del asistente no genera estas capas', () => {
    expect(Capas.deCriterios([{ id: 'salud', umbralEfectivoM: 1000 }]).map((c: { id: string }) => c.id)).toEqual(['salud']);
  });
  it('si no hay en la zona lo dice', () => {
    const d = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);
    const c = Capas.construir({ ...base, datos: d, capas: [{ id: 'mercados' }] });
    expect(c.resumen).toMatch(/no hay mercados/i);
  });
});

describe('Entidades.contarComercio', () => {
  it('cuenta lo del distrito por fuente (un polígono, por su centro) y deja fuera lo de afuera', () => {
    expect(Entidades.contarComercio(datos, DISTRITO, 'mercado')).toMatchObject({ total: 1, fuentes: { OSM: 1 } });
    expect(Entidades.contarComercio(datos, DISTRITO, 'mall')).toMatchObject({ total: 1, fuentes: { OSM: 1 } });
    expect(Entidades.contarComercio(datos, DISTRITO, 'supermercado').lista.map((p: { nombre: string }) => p.nombre)).toEqual(['Super B']);
  });
});

// ------------------------------------------------------------------------------ Chat

describe('chat: mall, supermercado y mercado son datos informativos, no la zona comercial del plano', () => {
  const ids = (t: string) => Asistente.interpretar(t).criterios.map((c: { id: string }) => c.id);

  it('«mall», «centro comercial», «supermercado» y «mercado» ya no son el criterio de zona comercial', () => {
    for (const t of ['un mall', 'un centro comercial', 'centros comerciales', 'un supermercado', 'un mercado']) expect(ids(`busco cerca de ${t}`)).toEqual([]);
  });
  it('«zona comercial» sigue siendo la zona del plano (aproximada)', () => {
    expect(ids('busco una zona comercial')).toEqual(['comercial']);
  });
  it('«¿hay un mall cerca de mi punto?» es una pregunta de comercio', () => {
    expect(Asistente.interpretar('¿hay un mall cerca de mi punto?', { hayPunto: true })).toMatchObject({ tipo: 'comercio', comercio: ['mall'], criterios: [] });
    expect(Asistente.interpretar('¿hay un mercado cerca?', { hayPunto: true })).toMatchObject({ tipo: 'comercio', comercio: ['mercado'] });
    expect(Asistente.interpretar('¿hay un supermercado cerca?', { hayPunto: true })).toMatchObject({ tipo: 'comercio', comercio: ['supermercado'] });
  });
  it('«¿hay un mall y un mercado cerca de mi punto?» pregunta por los dos; «quiero vivir cerca de un mall y un mercado» pide zonas y no se puede', () => {
    const i = Asistente.interpretar('¿hay un mall y un mercado cerca de mi punto?');
    expect(i).toMatchObject({ tipo: 'comercio', criterios: [] });
    expect(i.comercio).toEqual(['mercado', 'mall']);
    expect(Asistente.interpretar('quiero vivir cerca de un mall y un mercado')).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'comercio_busqueda' });
  });
  it('«¿cuántos mercados hay en Cayma?» cuenta los del distrito', () => {
    expect(Asistente.interpretar('¿cuántos mercados hay en Cayma?')).toMatchObject({ tipo: 'comercio', comercio: ['mercado'], distrito: 'CAYMA' });
  });
  it('una búsqueda que mezcla un parque y un mall busca solo por el parque y avisa del mall', () => {
    const i = Asistente.interpretar('quiero un parque cerca de un mall');
    expect(i.tipo).toBe('buscar');
    expect(i.criterios.map((c: { id: string }) => c.id)).toEqual(['areaVerde']);
    expect(i.comercio).toEqual(['mall']);
    expect(Asistente.interpretar('quiero un parque').comercio).toEqual([]);
    expect(Asistente.notaComercio()).toMatch(/informativ/i);
  });
  it('buscar zonas solo por comercio no se puede: lo dice, sin inventar un criterio ni una distancia', () => {
    const i = Asistente.interpretar('busco una zona cerca de un centro comercial');
    expect(i).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'comercio_busqueda' });
    const r = Asistente.responder(i, {});
    expect(r.texto).toMatch(/informativ/i);
    expect(r.texto).not.toMatch(/cumple/i);
  });
  it('mencionaComercio detecta las palabras de comercio (para no mandar la frase al modelo)', () => {
    expect(Asistente.mencionaComercio('¿Hay un Mall cerca?')).toBe(true);
    expect(Asistente.mencionaComercio('mercados en Cayma')).toBe(true);
    expect(Asistente.mencionaComercio('el supermercado más cercano')).toBe(true);
    expect(Asistente.mencionaComercio('busco una posta')).toBe(false);
    expect(Asistente.mencionaComercio('zona comercial')).toBe(false);
  });

  const informativo = (nombre: string, distanciaM: number, extra: object = {}) => ({ estado: 'INFORMATIVO', nombre, distanciaM, umbralM: null, fuenteElemento: 'OSM', osm: 'node/1', ...extra });
  const entorno: any = {
    mercado: informativo('Mercado San Camilo', 300),
    supermercado: informativo('Tottus', 700),
    mall: informativo('Mall Aventura', 0, { osm: 'way/3', verificado: { id: 'aventura', nombre: 'Mall Aventura Arequipa', url: 'https://mallaventura.pe/arequipa/', entidad: 'Mall Aventura' } }),
    salud: { estado: 'NO CUMPLE', nombre: 'HOSPITAL LEJANO', distanciaM: 2500, umbralM: 1000, fuenteElemento: 'RENIPRESS', codigo: '00000010', categoria: 'II-1' },
    educacion: { inicial: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 500 }, primaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 1500 }, secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000 } },
    transporte: { estado: 'CUMPLE', nombre: 'Paradero', distanciaM: 100, umbralM: 400 },
    areaVerde: { estado: 'CUMPLE', nombre: 'Parque', distanciaM: 100, umbralM: 300 },
  };
  const ctx = { punto: { lat: -16.4, lon: -71.5 }, zona: null, entorno, estadoPDM: null };

  it('la respuesta del punto da lo más cercano, su distancia y su fuente, sin cumple / no cumple', () => {
    const t = Asistente.responder({ tipo: 'comercio', comercio: ['mall', 'mercado'], criterios: [] }, ctx).texto;
    expect(t).toContain('Mercado San Camilo');
    expect(t).toContain('300 m');
    expect(t).toContain('Mall Aventura');
    expect(t).toMatch(/dentro|0 m/);
    expect(t).toContain('OpenStreetMap');
    expect(t).toMatch(/informativ/i);
    expect(t).not.toMatch(/cumple|referencia \d/i);
    expect(t).not.toContain('Tottus'); // solo lo que se preguntó
  });
  it('un mall verificado dice contra qué fuente se verificó', () => {
    expect(Asistente.responder({ tipo: 'comercio', comercio: ['mall'], criterios: [] }, ctx).texto).toContain('https://mallaventura.pe/arequipa/');
  });
  it('sin punto pide elegir uno o preguntar por un distrito', () => {
    expect(Asistente.responder({ tipo: 'comercio', comercio: ['mall'], criterios: [] }, {}).texto).toMatch(/punto|distrito/);
  });
  it('sin dato lo dice sin inventar', () => {
    const t = Asistente.responder({ tipo: 'comercio', comercio: ['mall'], criterios: [] }, { ...ctx, entorno: { ...entorno, mall: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: null } } }).texto;
    expect(t).toMatch(/sin dato|no tengo/i);
  });
  it('el conteo de un distrito da el total por fuente, avisa que es informativo y manda la capa al mapa', () => {
    const r = Asistente.responder({ tipo: 'comercio', comercio: ['mercado'], distrito: 'CAYMA', criterios: [] }, { distritoTitulo: 'Cayma', fecha: '2026-11-10', comercio: { mercado: { total: 3, fuentes: { OSM: 3 }, lista: [] } } });
    expect(r.texto).toContain('3 mercados');
    expect(r.texto).toContain('OpenStreetMap');
    expect(r.texto).toMatch(/informativ/i);
    expect(r.mapa).toMatchObject({ distrito: 'CAYMA', capas: ['mercados'] });
  });
  it('un distrito sin ninguno lo dice sin afirmar que no existe', () => {
    const r = Asistente.responder({ tipo: 'comercio', comercio: ['mall'], distrito: 'YURA', criterios: [] }, { distritoTitulo: 'Yura', fecha: '2026-11-10', comercio: { mall: { total: 0, fuentes: {}, lista: [] } } });
    expect(r.texto).toMatch(/no encontr/i);
    expect(r.texto).toMatch(/puede que existan/i);
  });
  it('el resumen del punto trae el comercio como líneas informativas', () => {
    const t = Asistente.responder({ tipo: 'ficha', criterios: [] }, ctx).texto;
    expect(t).toMatch(/Mercado \(informativo\): Mercado San Camilo a 300 m/);
    expect(t).toMatch(/Mall \(informativo\): Mall Aventura/);
  });
  it('«fuentes» menciona el comercio como informativo', () => {
    const f = Asistente.explicar('fuentes');
    expect([...f.fuente, ...f.limites].join(' ')).toMatch(/mall|mercado/i);
  });
});

// ------------------------------------------------------------------------------ Informe

describe('Reporte: el comercio es una sección informativa', () => {
  const servicio = (extra: object) => ({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'POSTA X', fecha: '2026-10-30', fuente: 'RENIPRESS (SUSALUD) (fuente primaria) y OpenStreetMap (ODbL, respaldo)', metodo: 'Distancia en línea recta.', ...extra });
  const info = (nombre: string, d: number) => servicio({ estado: 'INFORMATIVO', nombre, distanciaM: d, umbralM: null, fuenteElemento: 'OSM', osm: 'node/1', fuente: 'OpenStreetMap (ODbL)', metodo: 'Distancia en línea recta. Sin umbral.' });
  const d = (comercio: boolean) => ({
    punto: { lat: -16.4, lon: -71.5, etiqueta: 'Punto' }, zona: null, modulos: {}, avisoPDM: null, verificaciones: {}, umbrales: UMBRALES,
    fuentesUmbral: { ...CONFIG.fuentesUmbral },
    fuentes: { zonificacion: 'Plano', peligros: 'p', distritos: 'd', delitos: 'e' },
    variables: {
      salud: servicio({}),
      ...(comercio ? { mercado: info('Mercado San Camilo', 300), supermercado: info('Tottus', 700), mall: info('Mall Aventura', 0) } : {}),
      educacion: { inicial: servicio({}), primaria: servicio({}), secundaria: servicio({}) },
      transporte: servicio({ nombre: 'Paradero' }), areaVerde: servicio({ nombre: 'Parque' }),
    },
  });
  const seccion = (datos: object, t: string) => Reporte.construirSecciones(datos).find((s: { titulo: string }) => s.titulo.includes(t));

  it('hay una sección «Comercio (informativo)» con cada nombre, su distancia, su fuente y el estado INFORMATIVO', () => {
    const s = seccion(d(true), 'Comercio');
    expect(s.titulo).toMatch(/informativo/i);
    expect(s.cuerpo).toContain('Mercado San Camilo');
    expect(s.cuerpo).toContain('300 m');
    expect(s.cuerpo).toContain('Tottus');
    expect(s.cuerpo).toContain('Mall Aventura');
    expect(s.cuerpo).toContain('INFORMATIVO');
    expect(s.cuerpo).not.toMatch(/Umbral/);
    expect(s.cuerpo).not.toMatch(/NO CUMPLE/);
  });
  it('sin comercio en las variables, el informe no cambia', () => {
    expect(seccion(d(false), 'Comercio')).toBeUndefined();
  });
  it('las limitaciones dicen que el comercio es informativo y su umbral sigue pendiente', () => {
    expect(Reporte.limites(d(true)).join(' ')).toMatch(/(mall|mercado)[^.]*informativ/i);
  });
});
