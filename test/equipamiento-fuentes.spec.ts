/**
 * public/js/equipamiento.js con los archivos de salud y de educación que arma scripts/descargar-equipamiento-oficial.mjs:
 * RENIPRESS y ESCALE como fuente primaria y OpenStreetMap como respaldo. Se comprueba que la ficha sabe de qué fuente es el
 * establecimiento más cercano (con su código oficial), que los niveles de un local de ESCALE no se infieren de etiquetas y
 * que los archivos anteriores (solo OpenStreetMap) siguen funcionando igual. Sin red: `fetch` devuelve los archivos de prueba.
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

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const P = { lat: -16.409, lon: -71.5375 };
const alNorte = (m: number) => [P.lon, P.lat + m / M_POR_GRADO_LAT];
const punto = (coords: number[], properties: object) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: coords } });

const FUENTES_SALUD = [
  { rol: 'primaria', id: 'RENIPRESS', nombre: 'RENIPRESS (SUSALUD)', fecha: '2026-10-30' },
  { rol: 'respaldo', id: 'OSM', nombre: 'OpenStreetMap', fecha: '2026-10-28' },
];
const salud = (features: object[], metadata: object = {}) => ({
  type: 'FeatureCollection',
  metadata: { fuente: 'RENIPRESS (SUSALUD) (fuente primaria) y OpenStreetMap (ODbL, respaldo)', fecha_extraccion: '2026-10-30', fuentes: FUENTES_SALUD, deduplicacion: { radio_m: 200 }, ...metadata },
  features,
});

const ARCHIVOS: Record<string, any> = {};
const instalarArchivos = (datos: Record<string, object>) => {
  for (const k of Object.keys(ARCHIVOS)) delete ARCHIVOS[k];
  Object.assign(ARCHIVOS, datos);
};
(globalThis as any).fetch = async (url: string) => {
  const hallado = Object.entries(CONFIG.equipamiento.archivos).find(([, ruta]) => ruta === url);
  const datos = hallado ? ARCHIVOS[hallado[0]] : undefined;
  return datos ? { ok: true, status: 200, json: async () => datos } : { ok: false, status: 404, json: async () => ({}) };
};

const vacio = { type: 'FeatureCollection', metadata: { fecha_extraccion: '2026-10-28' }, features: [] };

// Cada prueba carga una copia nueva del módulo: guarda en memoria los archivos que lee.
const cargarEquipamiento = () => {
  jest.resetModules();
  Object.assign(globalThis, { CONFIG, Calculos: require('../public/js/calculos.js'), Services: {}, Rutas: {} });
  return require('../public/js/equipamiento.js');
};

describe('Equipamiento: salud con RENIPRESS como fuente primaria', () => {
  const evaluar = async (features: object[], metadata: object = {}) => {
    instalarArchivos({ salud: salud(features, metadata), educacion: vacio, transporte: vacio, areasVerdes: vacio });
    return (await cargarEquipamiento().evaluar(P.lat, P.lon)).salud;
  };

  it('dice que el más cercano es de RENIPRESS, con su código y su categoría', async () => {
    const r = await evaluar([
      punto(alNorte(300), { fuente: 'RENIPRESS', nombre: 'POLICLINICO X', codigo_renipress: '00001231', categoria: 'I-3', clasificacion: 'POLICLINICOS' }),
      punto(alNorte(600), { fuente: 'OSM', osm: 'node/5', nombre: 'Clínica Vallesur', tags: { amenity: 'clinic' } }),
    ]);
    expect(r).toMatchObject({ estado: 'CUMPLE', nombre: 'POLICLINICO X', fuenteElemento: 'RENIPRESS', codigo: '00001231', categoria: 'I-3', osm: null, etiqueta: null });
    expect(r.distanciaM).toBeCloseTo(300, 0);
  });

  it('si el más cercano es de OpenStreetMap, lo dice y conserva su identificador y su etiqueta', async () => {
    const r = await evaluar([
      punto(alNorte(500), { fuente: 'OSM', osm: 'node/5', nombre: 'Clínica Vallesur', tags: { amenity: 'clinic' } }),
      punto(alNorte(900), { fuente: 'RENIPRESS', nombre: 'HOSPITAL Y', codigo_renipress: '00000002', categoria: 'II-1' }),
    ]);
    expect(r).toMatchObject({ nombre: 'Clínica Vallesur', fuenteElemento: 'OSM', osm: 'node/5', etiqueta: 'amenity=clinic', codigo: null });
  });

  it('la fuente del dato nombra las dos fuentes y la fecha es la de la fuente primaria', async () => {
    const r = await evaluar([punto(alNorte(300), { fuente: 'RENIPRESS', nombre: 'X', codigo_renipress: '1', categoria: 'I-1' })]);
    expect(r.fuente).toBe('RENIPRESS (SUSALUD) (fuente primaria) y OpenStreetMap (ODbL, respaldo)');
    expect(r.fecha).toBe('2026-10-30');
  });

  it('el método explica qué se usó: la fuente primaria, el respaldo con su fecha y el radio de deduplicación', async () => {
    const r = await evaluar([punto(alNorte(300), { fuente: 'RENIPRESS', nombre: 'X', codigo_renipress: '1', categoria: 'I-1' })]);
    expect(r.metodo).toMatch(/RENIPRESS \(SUSALUD\).*2026-10-30/);
    expect(r.metodo).toMatch(/OpenStreetMap.*2026-10-28.*respaldo/);
    expect(r.metodo).toMatch(/200 m/);
    expect(r.metodo).not.toMatch(/Datos congelados de OpenStreetMap \(ODbL\)\./);
  });

  it('un archivo anterior, solo de OpenStreetMap y sin `fuente`, se comporta como antes', async () => {
    instalarArchivos({
      salud: { type: 'FeatureCollection', metadata: { fuente: 'OpenStreetMap (ODbL)', fecha_extraccion: '2026-10-28' }, features: [punto(alNorte(400), { osm: 'node/9', nombre: 'Posta Z', tags: { amenity: 'clinic' } })] },
      educacion: vacio, transporte: vacio, areasVerdes: vacio,
    });
    const r = (await cargarEquipamiento().evaluar(P.lat, P.lon)).salud;
    expect(r).toMatchObject({ nombre: 'Posta Z', fuenteElemento: 'OSM', osm: 'node/9', etiqueta: 'amenity=clinic', fuente: 'OpenStreetMap (ODbL)', fecha: '2026-10-28' });
    expect(r.metodo).toContain('Datos congelados de OpenStreetMap (ODbL).');
  });
});

describe('Equipamiento: educación con ESCALE como fuente primaria', () => {
  const ESCALE = punto(alNorte(200), {
    fuente: 'ESCALE', nombre: 'ESCUELA 1', codigo_modular: '0100001', codigo_local: '100001', niveles: ['primaria', 'secundaria'], distrito: 'CERCADO',
    instituciones: [
      { codigo_modular: '0100001', nombre: 'ESCUELA 1', nivel: 'primaria', gestion: 'Pública' },
      { codigo_modular: '0100002', nombre: 'COLEGIO 2', nivel: 'secundaria', gestion: 'Privada' },
    ],
  });
  const JARDIN_OSM = punto(alNorte(400), { fuente: 'OSM', osm: 'node/7', nombre: 'Kínder Arco Iris', tags: { amenity: 'kindergarten' }, niveles: ['inicial'] });
  const SIN_NIVEL_OSM = punto(alNorte(100), { fuente: 'OSM', osm: 'node/8', nombre: 'Escuela sin etiqueta', tags: { amenity: 'school' }, niveles: ['secundaria'] });

  const evaluar = async (features: object[]) => {
    instalarArchivos({
      salud: vacio,
      educacion: { type: 'FeatureCollection', metadata: { fuente: 'ESCALE (MINEDU) (fuente primaria) y OpenStreetMap (ODbL, respaldo)', fecha_extraccion: '2026-10-30', fuentes: [{ rol: 'primaria', id: 'ESCALE', nombre: 'Padrón de ESCALE (MINEDU)', fecha: '2026-10-30' }, { rol: 'respaldo', id: 'OSM', nombre: 'OpenStreetMap', fecha: '2026-10-28' }], deduplicacion: { radio_m: 200 } }, features },
      transporte: vacio, areasVerdes: vacio,
    });
    return (await cargarEquipamiento().evaluar(P.lat, P.lon)).educacion;
  };

  it('usa los niveles del local de ESCALE y, en cada nivel, el nombre, el código modular y la gestión de su institución', async () => {
    const e = await evaluar([ESCALE]);
    expect(e.primaria).toMatchObject({ estado: 'CUMPLE', nombre: 'ESCUELA 1', fuenteElemento: 'ESCALE', codigo: '0100001', gestion: 'Pública' });
    expect(e.secundaria).toMatchObject({ estado: 'CUMPLE', nombre: 'COLEGIO 2', fuenteElemento: 'ESCALE', codigo: '0100002', gestion: 'Privada' });
    expect(e.inicial.estado).not.toBe('CUMPLE');
    expect(e.inicial.fuenteElemento).toBeNull();
  });

  it('lo de OpenStreetMap que quedó como respaldo cuenta solo en los niveles que trae, aunque su etiqueta dijera primaria y secundaria', async () => {
    const e = await evaluar([ESCALE, SIN_NIVEL_OSM, JARDIN_OSM]);
    expect(e.inicial).toMatchObject({ nombre: 'Kínder Arco Iris', fuenteElemento: 'OSM', osm: 'node/7' });
    expect(e.secundaria).toMatchObject({ nombre: 'Escuela sin etiqueta', fuenteElemento: 'OSM', osm: 'node/8' });
    // La escuela de respaldo está más cerca (100 m) que la de ESCALE (200 m), pero no cubre primaria: ahí manda ESCALE.
    expect(e.primaria).toMatchObject({ nombre: 'ESCUELA 1', fuenteElemento: 'ESCALE' });
    // El respaldo sin etiqueta de nivel sigue avisándolo en la ficha.
    expect(e.secundaria.etiqueta).toContain('sin etiqueta de nivel');
  });

  it('el método y la fuente dicen que ESCALE es la fuente primaria', async () => {
    const e = await evaluar([ESCALE]);
    expect(e.primaria.fuente).toContain('ESCALE (MINEDU)');
    expect(e.primaria.metodo).toMatch(/ESCALE.*2026-10-30/);
    expect(e.primaria.metodo).toMatch(/OpenStreetMap.*respaldo/);
  });

  it('un archivo anterior, solo de OpenStreetMap, infiere los niveles de las etiquetas como siempre', async () => {
    instalarArchivos({
      salud: vacio,
      educacion: { type: 'FeatureCollection', metadata: { fuente: 'OpenStreetMap (ODbL)', fecha_extraccion: '2026-10-28' }, features: [punto(alNorte(150), { osm: 'node/1', nombre: 'Jardín viejo', tags: { amenity: 'kindergarten' } })] },
      transporte: vacio, areasVerdes: vacio,
    });
    const e = (await cargarEquipamiento().evaluar(P.lat, P.lon)).educacion;
    expect(e.inicial).toMatchObject({ estado: 'CUMPLE', nombre: 'Jardín viejo', fuenteElemento: 'OSM', osm: 'node/1', etiqueta: 'amenity=kindergarten' });
    expect(e.primaria.nombre).toBeNull();
  });
});
