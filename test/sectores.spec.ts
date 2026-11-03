/**
 * Pruebas de public/js/sectores.js: juntar las celdas que cumplen todo en sectores (zonas continuas), dibujar su contorno y
 * nombrarlos con la entidad con nombre más cercana. La cuadrícula es solo un andamio interno: el resultado habla de sectores.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');
const Sectores = require('../public/js/sectores.js');

const PASO = 250;
const M = (Math.PI / 180) * 6371008.8;
const LAT0 = -16.4;

// Una «zona» rectangular de 3 km x 3 km que genera celdas de 250 m con índices i, j.
const anillo = (lat: number, lon: number, ladoM: number) => {
  const a = lat + ladoM / M;
  const o = lon + ladoM / (M * Math.cos((lat * Math.PI) / 180));
  return [[lon, lat], [o, lat], [o, a], [lon, a], [lon, lat]];
};
const zonas = [{ codigo: 'RDM-1', bbox: [-71.55, -16.4, -71.52, -16.37], polys: [[anillo(LAT0, -71.55, 3000)]], regla: { nombre: 'x', grupo: 'residencial', edificable: 'si' } }];
const celdas = Asistente.generarCeldas(zonas, { pasoM: PASO });
const en = (i: number, j: number) => celdas.find((c: { i: number; j: number }) => c.i === i && c.j === j);

describe('Asistente.generarCeldas', () => {
  it('numera cada celda con su fila i y su columna j, sin repetir', () => {
    expect(celdas.length).toBeGreaterThan(100);
    const claves = new Set(celdas.map((c: { i: number; j: number }) => `${c.i},${c.j}`));
    expect(claves.size).toBe(celdas.length);
    expect(Number.isInteger(celdas[0].i) && Number.isInteger(celdas[0].j)).toBe(true);
  });
});

describe('Sectores.agrupar', () => {
  it('une las celdas que se tocan, también por la esquina, y separa las que no', () => {
    const grupo = [en(2, 2), en(2, 3), en(3, 4), en(8, 8), en(8, 9)]; // (3,4) toca (2,3) por la esquina
    const s = Sectores.agrupar(grupo, { pasoM: PASO });
    expect(s).toHaveLength(2);
    const tamanos = s.map((x: { celdas: unknown[] }) => x.celdas.length).sort();
    expect(tamanos).toEqual([2, 3]);
  });

  it('calcula las hectáreas, el distrito principal y un punto representativo dentro del sector', () => {
    const grupo = [en(2, 2), en(2, 3), en(2, 4)].map((c: object) => ({ ...c, distrito: 'PAUCARPATA' }));
    const [s] = Sectores.agrupar(grupo, { pasoM: PASO });
    expect(s.hectareas).toBeCloseTo(18.75, 2);
    expect(s.distrito).toBe('PAUCARPATA');
    const medio = grupo[1];
    expect(s.centro.lat).toBeCloseTo(medio.lat, 6);
    expect(s.centro.lon).toBeCloseTo(medio.lon, 6);
  });

  it('ordena de mayor a menor extensión y numera desde 1', () => {
    const s = Sectores.agrupar([en(8, 8), en(2, 2), en(2, 3), en(2, 4)], { pasoM: PASO });
    expect(s.map((x: { n: number }) => x.n)).toEqual([1, 2]);
    expect(s[0].celdas).toHaveLength(3);
  });

  it('sin celdas no hay sectores', () => {
    expect(Sectores.agrupar([], { pasoM: PASO })).toEqual([]);
  });
});

describe('Sectores.contorno', () => {
  const lados = (anillo: number[][]) => anillo.length - 1; // el anillo se cierra repitiendo el primer vértice

  it('una celda es un cuadrado', () => {
    const c = Sectores.contorno([en(2, 2)], { suavizar: 0 });
    expect(c).toHaveLength(1);
    expect(lados(c[0])).toBe(4);
  });

  it('dos celdas vecinas forman un solo contorno (se borra el borde compartido)', () => {
    const c = Sectores.contorno([en(2, 2), en(2, 3)], { suavizar: 0 });
    expect(c).toHaveLength(1);
    expect(lados(c[0])).toBe(6);
  });

  it('un anillo de celdas deja un hueco: contorno exterior y contorno interior', () => {
    const anilloDeCeldas = [];
    for (let i = 2; i <= 4; i += 1) for (let j = 2; j <= 4; j += 1) if (!(i === 3 && j === 3)) anilloDeCeldas.push(en(i, j));
    const c = Sectores.contorno(anilloDeCeldas, { suavizar: 0 });
    expect(c).toHaveLength(2);
  });

  it('suavizar redondea las esquinas (más vértices) sin salirse del sector', () => {
    const crudo = Sectores.contorno([en(2, 2), en(2, 3), en(3, 2)], { suavizar: 0 })[0];
    const suave = Sectores.contorno([en(2, 2), en(2, 3), en(3, 2)], { suavizar: 2 })[0];
    expect(suave.length).toBeGreaterThan(crudo.length);
    const lons = crudo.map((p: number[]) => p[0]);
    const lats = crudo.map((p: number[]) => p[1]);
    suave.forEach((p: number[]) => {
      expect(p[0]).toBeGreaterThanOrEqual(Math.min(...lons) - 1e-9);
      expect(p[0]).toBeLessThanOrEqual(Math.max(...lons) + 1e-9);
      expect(p[1]).toBeGreaterThanOrEqual(Math.min(...lats) - 1e-9);
      expect(p[1]).toBeLessThanOrEqual(Math.max(...lats) + 1e-9);
    });
  });

  it('los vértices están en lon, lat sobre Arequipa', () => {
    const [lon, lat] = Sectores.contorno([en(2, 2)], { suavizar: 0 })[0][0];
    expect(lon).toBeGreaterThan(-72);
    expect(lat).toBeLessThan(-16);
  });
});

describe('Sectores.nombrar', () => {
  const centro = { lat: -16.39, lon: -71.54 };
  const aMetros = (m: number) => m / M;
  const datos = {
    colegiosLista: [
      { lat: centro.lat + aMetros(200), lon: centro.lon, nombre: 'I.E. San Martín', niveles: ['primaria'], tags: {} },
      { lat: centro.lat + aMetros(100), lon: centro.lon, nombre: null, niveles: ['primaria'], tags: {} },
    ],
    salud: [{ lat: centro.lat + aMetros(900), lon: centro.lon, nombre: 'Posta lejana', tags: {} }],
    transporte: [],
    verdesTodos: [{ nombre: 'Parque Grande', areaM2: 20000, geometry: { type: 'Polygon', coordinates: [anillo(centro.lat + aMetros(300), centro.lon, 50)] }, centro: { lat: centro.lat + aMetros(325), lon: centro.lon } }],
  };

  it('usa el elemento con nombre más cercano; ignora los que no tienen nombre', () => {
    expect(Sectores.nombrar(centro, datos, [])).toMatchObject({ nombre: 'I.E. San Martín', tipo: 'colegio' });
  });

  it('prefiere el tipo de lo que la persona pidió, si está a una distancia razonable', () => {
    expect(Sectores.nombrar(centro, datos, ['areaVerde'])).toMatchObject({ nombre: 'Parque Grande', tipo: 'parque' });
  });

  it('no inventa nombres: si no hay nada con nombre cerca, devuelve null', () => {
    expect(Sectores.nombrar({ lat: -16.5, lon: -71.4 }, datos, [])).toBeNull();
    expect(Sectores.nombrar(centro, datos, [], { maxM: 50 })).toBeNull();
  });

  it('escribe con mayúsculas y minúsculas normales los nombres que vienen en mayúsculas', () => {
    const d = { ...datos, colegiosLista: [{ lat: centro.lat, lon: centro.lon, nombre: 'COLEGIO NACIONAL SAN JOSE', niveles: ['primaria'], tags: {} }], verdesTodos: [] };
    expect(Sectores.nombrar(centro, d, [])?.nombre).toBe('Colegio Nacional San Jose');
  });
});
