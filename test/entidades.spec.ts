/**
 * Pruebas de public/js/entidades.js: contar y listar los colegios, la salud, los paraderos y los parques que hay dentro de un
 * distrito o cerca de un punto, con los datos congelados de OpenStreetMap ya ordenados por Asistente.prepararDatos.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');
const Entidades = require('../public/js/entidades.js');

const UMBRALES = {
  salud: 1000,
  educacion: { inicial: 500, primaria: 1500, secundaria: 3000 },
  transporte: 400,
  areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 },
  zona: { campina: 500, comercial: 600, historico: 800 },
};

// Un «distrito» cuadrado de 0,02° de lado con la esquina suroeste en (-16.42, -71.55).
const DISTRITO = [[[[-71.55, -16.42], [-71.53, -16.42], [-71.53, -16.40], [-71.55, -16.40], [-71.55, -16.42]]]];
const dentro = (i: number) => ({ lat: -16.41 + i * 0.0001, lon: -71.54 });
const fuera = { lat: -16.3, lon: -71.3 };

const punto = (osm: string, p: { lat: number; lon: number }, tags: Record<string, string>, nombre: string | null = null) => ({
  type: 'Feature',
  properties: { osm, nombre, tags },
  geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
});
const parque = (osm: string, lat: number, lon: number, ladoGrados: number, nombre: string | null = null) => ({
  type: 'Feature',
  properties: { osm, nombre, tags: { leisure: 'park' } },
  geometry: { type: 'Polygon', coordinates: [[[lon, lat], [lon + ladoGrados, lat], [lon + ladoGrados, lat + ladoGrados], [lon, lat + ladoGrados], [lon, lat]]] },
});

const datos = Asistente.prepararDatos(
  {
    educacion: [
      punto('node/1', dentro(0), { amenity: 'kindergarten' }, 'Jardín Arco Iris'),
      punto('node/2', dentro(1), { amenity: 'school', 'isced:level': '1' }, 'I.E. Primaria 40001'),
      punto('node/3', dentro(2), { amenity: 'school', 'isced:level': '1;2' }, 'I.E. Mixto 40002'),
      punto('node/4', dentro(3), { amenity: 'school' }, null), // sin nivel: se asume primaria y secundaria
      punto('node/5', fuera, { amenity: 'school', 'isced:level': '2' }, 'Colegio lejano'),
      punto('node/6', dentro(4), { amenity: 'school', 'isced:level': '6' }, 'Instituto superior'), // no es educación básica
    ],
    salud: [
      punto('node/10', dentro(5), { amenity: 'clinic' }, 'Posta Central'),
      punto('node/11', fuera, { amenity: 'hospital' }, 'Hospital lejano'),
    ],
    transporte: [punto('node/20', dentro(6), { highway: 'bus_stop' }), punto('node/21', dentro(7), { highway: 'bus_stop' }), punto('node/22', fuera, { highway: 'bus_stop' })],
    areasVerdes: [
      parque('way/30', -16.415, -71.545, 0.003, 'Parque Grande'), // ~ 11 ha
      parque('way/31', -16.412, -71.541, 0.0002, null), // ~ 500 m²: un jardín
      parque('way/32', -16.2, -71.2, 0.003, 'Parque lejano'),
    ],
  },
  [],
  UMBRALES,
);

describe('Asistente.prepararDatos conserva lo necesario para listar entidades', () => {
  it('guarda osm y etiquetas de cada punto', () => {
    expect(datos.colegiosLista[0]).toMatchObject({ osm: 'node/1', nombre: 'Jardín Arco Iris', niveles: ['inicial'], tags: { amenity: 'kindergarten' } });
    expect(datos.salud[0]).toMatchObject({ osm: 'node/10', tags: { amenity: 'clinic' } });
    expect(datos.transporte[0].osm).toBe('node/20');
  });
  it('lista cada colegio una sola vez, aunque tenga varios niveles, y deja fuera lo que no es educación básica', () => {
    expect(datos.colegiosLista.map((c: { osm: string }) => c.osm)).toEqual(['node/1', 'node/2', 'node/3', 'node/4', 'node/5']);
  });
  it('conserva todas las áreas verdes y marca cuáles superan el mínimo de los criterios', () => {
    expect(datos.verdesTodos).toHaveLength(3);
    expect(datos.verdes.map((v: { osm: string }) => v.osm)).toEqual(['way/30', 'way/32']);
    expect(datos.verdesTodos[0].centro.lat).toBeCloseTo(-16.4135, 4);
  });
});

describe('Entidades.contar (dentro de un distrito)', () => {
  const r = Entidades.contar(datos, DISTRITO);

  it('cuenta los colegios por nivel; uno con varios niveles suma en cada uno', () => {
    expect(r.colegios.total).toBe(4);
    expect(r.colegios.inicial).toBe(1);
    expect(r.colegios.primaria).toBe(3);
    expect(r.colegios.secundaria).toBe(2);
    expect(r.colegios.lista.map((c: { osm: string }) => c.osm)).toEqual(['node/1', 'node/2', 'node/3', 'node/4']);
  });

  it('dice cuántos colegios no declaran su nivel en OpenStreetMap (se cuentan en primaria y secundaria)', () => {
    expect(r.colegios.sinNivel).toBe(1);
  });

  it('cuenta salud y paraderos solo dentro del distrito', () => {
    expect(r.salud.total).toBe(1);
    expect(r.salud.lista[0].nombre).toBe('Posta Central');
    expect(r.paraderos.total).toBe(2);
  });

  it('cuenta los parques con su área y separa los de al menos 0,5 ha', () => {
    expect(r.parques.total).toBe(2);
    expect(r.parques.grandes).toBe(1);
    expect(r.parques.areaTotalM2).toBeGreaterThan(100000);
    expect(r.parques.lista[0].nombre).toBe('Parque Grande');
  });

  it('con un distrito vacío todo es cero', () => {
    const v = Entidades.contar(datos, [[[[-70, -15], [-69.9, -15], [-69.9, -14.9], [-70, -14.9], [-70, -15]]]]);
    expect([v.colegios.total, v.salud.total, v.paraderos.total, v.parques.total]).toEqual([0, 0, 0, 0]);
  });

  it('los datos vacíos no rompen', () => {
    const vacio = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);
    expect(Entidades.contar(vacio, DISTRITO).colegios).toMatchObject({ total: 0, inicial: 0, primaria: 0, secundaria: 0 });
  });
});

describe('Entidades.cercaDe (cerca de un punto)', () => {
  const centro = dentro(0);
  const c = Entidades.cercaDe(datos, centro, UMBRALES);

  it('trae lo que está dentro de la distancia de referencia de cada tipo, del más cercano al más lejano', () => {
    expect(c.colegios.inicial.map((e: { osm: string }) => e.osm)).toEqual(['node/1']);
    expect(c.colegios.inicial[0].distanciaM).toBeLessThan(1);
    expect(c.colegios.primaria.map((e: { osm: string }) => e.osm)).toEqual(['node/1', 'node/2', 'node/3', 'node/4'].filter((o) => o !== 'node/1'));
    expect(c.salud.map((e: { osm: string }) => e.osm)).toEqual(['node/10']);
    expect(c.paraderos.length).toBe(2);
    expect(c.paraderos[0].distanciaM).toBeLessThanOrEqual(c.paraderos[1].distanciaM);
  });

  it('un parque cuenta si el punto está dentro o su borde queda a la distancia de referencia', () => {
    const dentroDelParque = Entidades.cercaDe(datos, { lat: -16.4135, lon: -71.5435 }, UMBRALES);
    expect(dentroDelParque.parques.map((p: { osm: string }) => p.osm)).toEqual(['way/30']);
    expect(dentroDelParque.parques[0].distanciaM).toBe(0);
  });

  it('acepta distancias propias', () => {
    const corto = Entidades.cercaDe(datos, centro, UMBRALES, { transporteM: 10, saludM: 10 });
    expect(corto.paraderos).toHaveLength(0);
    expect(corto.salud).toHaveLength(0);
  });
});

describe('Entidades.frases', () => {
  it('dice los colegios por nivel y avisa cuando un colegio cuenta en más de un nivel', () => {
    const r = Entidades.contar(datos, DISTRITO);
    expect(Entidades.fraseColegios(r.colegios)).toBe('4 colegios: 1 inicial, 3 primaria, 2 secundaria');
    expect(Entidades.fraseColegios({ total: 1, inicial: 1, primaria: 0, secundaria: 0 })).toBe('1 colegio: 1 inicial, 0 primaria, 0 secundaria');
    expect(Entidades.fraseColegios({ total: 0, inicial: 0, primaria: 0, secundaria: 0 })).toBe('ningún colegio');
  });
});
