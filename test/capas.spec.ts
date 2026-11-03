/**
 * Pruebas de public/js/capas.js: qué se dibuja en el mapa para cada cosa que la persona pide. El mapa muestra las entidades
 * reales (los colegios mismos, los parques, las quebradas, los sismos) y, si hay varios criterios, una sola región «donde se
 * cumplen todos». Nunca se pinta lo que no cumple y nunca se ven celdas de la cuadrícula.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');
const Capas = require('../public/js/capas.js');

const UMBRALES = {
  salud: 1000,
  educacion: { inicial: 500, primaria: 1500, secundaria: 3000 },
  transporte: 400,
  areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 },
  zona: { campina: 500, comercial: 600, historico: 800 },
};
const M = (Math.PI / 180) * 6371008.8;
const DISTRITO = [[[[-71.55, -16.42], [-71.53, -16.42], [-71.53, -16.40], [-71.55, -16.40], [-71.55, -16.42]]]];
const dentro = (i: number) => ({ lat: -16.41 + i * 0.0002, lon: -71.54 });
const fuera = { lat: -16.3, lon: -71.3 };
const punto = (osm: string, p: { lat: number; lon: number }, tags: Record<string, string>, nombre: string | null = null) => ({
  type: 'Feature', properties: { osm, nombre, tags }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
});
const cuadrado = (lat: number, lon: number, g: number) => [[[lon, lat], [lon + g, lat], [lon + g, lat + g], [lon, lat + g], [lon, lat]]];
const parque = (osm: string, lat: number, lon: number, g: number, nombre: string | null = null) => ({
  type: 'Feature', properties: { osm, nombre, tags: { leisure: 'park' } }, geometry: { type: 'Polygon', coordinates: cuadrado(lat, lon, g) },
});

const datos = Asistente.prepararDatos(
  {
    educacion: [
      punto('node/1', dentro(0), { amenity: 'kindergarten' }, 'Jardín Arco Iris'),
      punto('node/2', dentro(1), { amenity: 'school', 'isced:level': '1' }, 'Primaria 1'),
      punto('node/3', dentro(2), { amenity: 'school', 'isced:level': '2' }, 'Secundaria 1'),
      punto('node/4', fuera, { amenity: 'school', 'isced:level': '1' }, 'Primaria lejana'),
    ],
    salud: [punto('node/10', dentro(3), { amenity: 'clinic' }, 'Posta Central'), punto('node/11', fuera, { amenity: 'hospital' }, 'Hospital lejano')],
    transporte: [punto('node/20', dentro(4), { highway: 'bus_stop' })],
    areasVerdes: [parque('way/30', -16.415, -71.545, 0.003, 'Parque Grande'), parque('way/31', -16.412, -71.541, 0.0002), parque('way/32', -16.2, -71.2, 0.003, 'Parque lejano')],
  },
  [],
  UMBRALES,
);
const zona = (codigo: string, grupo: string, lat: number, lon: number, g: number) => ({
  codigo, bbox: [lon, lat, lon + g, lat + g], polys: [cuadrado(lat, lon, g)], regla: { nombre: codigo, grupo, edificable: 'si' },
});
const zonas = [zona('RDM-1', 'residencial', -16.415, -71.549, 0.004), zona('CE', 'comercial', -16.405, -71.545, 0.003), zona('ZA', 'proteccion', -16.41, -71.535, 0.003), zona('RDM-1', 'residencial', -16.3, -71.3, 0.004)];
const linea = (nombre: string, coords: number[][]) => ({ nombre, tipo: 'Río', geometry: { type: 'LineString', coordinates: coords } });
const cauces = [linea('Río Chili', [[-71.545, -16.419], [-71.54, -16.41]]), linea('Quebrada lejana', [[-71.3, -16.3], [-71.29, -16.29]])];
const sismos = [
  { lat: -16.4, lon: -71.5, magnitud: 3.1, fecha: '2026-03-01', profundidadKm: 20, ref: 'a' },
  { lat: -16.5, lon: -71.6, magnitud: 5.1, fecha: '2026-05-01', profundidadKm: 80, ref: 'b' },
];
const base = { datos, zonas, cauces, sismos, umbrales: UMBRALES };

describe('Capas.deCriterios', () => {
  it('traduce los criterios de una búsqueda a capas del mapa, juntando los niveles de colegio', () => {
    const c = Capas.deCriterios([{ id: 'inicial' }, { id: 'primaria' }, { id: 'areaVerde' }, { id: 'residencial' }, { id: 'lejosQuebrada', umbralM: 200 }]);
    expect(c.map((x: { id: string }) => x.id)).toEqual(['colegios', 'parques', 'residencial', 'quebradas']);
    expect(c[0].niveles).toEqual(['inicial', 'primaria']);
  });
  it('«colegio» a secas son inicial y primaria, como en la búsqueda', () => {
    expect(Capas.deCriterios([{ id: 'colegio' }])[0].niveles).toEqual(['inicial', 'primaria']);
  });
  it('ignora lo que no tiene capa', () => {
    expect(Capas.deCriterios([{ id: 'inventado' }])).toEqual([]);
  });
});

describe('Capas.construir: colegios', () => {
  const r = Capas.construir({ ...base, capas: [{ id: 'colegios' }], area: { polys: DISTRITO } });

  it('dibuja los colegios mismos dentro del distrito, no los de afuera', () => {
    expect(r.puntos.map((p: { osm: string }) => p.osm).sort()).toEqual(['node/1', 'node/2', 'node/3']);
  });

  it('cada colegio dice su nivel para elegir el icono', () => {
    const por = Object.fromEntries(r.puntos.map((p: { osm: string; subtipo: string }) => [p.osm, p.subtipo]));
    expect(por).toEqual({ 'node/1': 'inicial', 'node/2': 'primaria', 'node/3': 'secundaria' });
  });

  it('con pocos colegios añade un círculo tenue con la distancia de referencia de su nivel', () => {
    const radios = Object.fromEntries(r.circulos.map((c: { radioM: number; nivel: string }) => [c.nivel, c.radioM]));
    expect(radios).toEqual({ inicial: 500, primaria: 1500, secundaria: 3000 });
  });

  it('con muchos colegios no dibuja círculos', () => {
    const muchos = Capas.construir({ ...base, capas: [{ id: 'colegios' }], area: { polys: DISTRITO }, maxCirculos: 2 });
    expect(muchos.circulos).toEqual([]);
  });

  it('una búsqueda por nivel dibuja solo ese nivel', () => {
    const r2 = Capas.construir({ ...base, capas: [{ id: 'colegios', niveles: ['inicial'] }], area: { polys: DISTRITO } });
    expect(r2.puntos.map((p: { osm: string }) => p.osm)).toEqual(['node/1']);
  });

  it('la leyenda explica la capa en una línea con su cantidad', () => {
    expect(r.leyenda[0].texto).toMatch(/colegios/i);
    expect(r.leyenda[0].n).toBe(3);
  });
});

describe('Capas.construir: salud, paraderos y parques', () => {
  it('salud: los establecimientos, con un círculo de 1000 m si son pocos', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'salud' }], area: { polys: DISTRITO } });
    expect(r.puntos.map((p: { osm: string }) => p.osm)).toEqual(['node/10']);
    expect(r.circulos[0].radioM).toBe(1000);
  });
  it('paraderos: con un círculo de 400 m', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'paraderos' }], area: { polys: DISTRITO } });
    expect(r.puntos).toHaveLength(1);
    expect(r.circulos[0].radioM).toBe(400);
  });
  it('parques: los polígonos de al menos media hectárea dentro del distrito, rellenos de verde', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'parques' }], area: { polys: DISTRITO } });
    expect(r.poligonos.map((p: { osm: string }) => p.osm)).toEqual(['way/30']);
    expect(r.poligonos[0]).toMatchObject({ capa: 'parques', nombre: 'Parque Grande' });
    expect(r.puntos).toEqual([]);
  });
});

describe('Capas.construir: zonificación', () => {
  it('residencial: solo los polígonos de zona residencial del distrito, no los de otras zonas ni los de afuera', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'residencial' }], area: { polys: DISTRITO } });
    expect(r.poligonos).toHaveLength(1);
    expect(r.poligonos[0]).toMatchObject({ capa: 'residencial', codigo: 'RDM-1' });
  });
  it('campiña: solo la zona agrícola', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'campina' }], area: { polys: DISTRITO } });
    expect(r.poligonos.map((p: { codigo: string }) => p.codigo)).toEqual(['ZA']);
  });
  it('comercial: solo las zonas comerciales', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'comercial' }], area: { polys: DISTRITO } });
    expect(r.poligonos.map((p: { codigo: string }) => p.codigo)).toEqual(['CE']);
  });
  it('sin área (todo el mapa) trae todas las zonas de ese tipo', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'residencial' }], area: null });
    expect(r.poligonos).toHaveLength(2);
  });
});

describe('Capas.construir: quebradas y sismos', () => {
  it('quebradas: líneas con su nombre, solo las que pasan por el área', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'quebradas' }], area: { polys: DISTRITO } });
    expect(r.lineas.map((l: { nombre: string }) => l.nombre)).toEqual(['Río Chili']);
  });
  it('sismos: círculos pequeños cuyo tamaño crece con la magnitud', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'sismos' }], area: null });
    expect(r.sismos).toHaveLength(2);
    const [chico, grande] = [...r.sismos].sort((a: { magnitud: number }, b: { magnitud: number }) => a.magnitud - b.magnitud);
    expect(grande.radioPx).toBeGreaterThan(chico.radioPx);
    expect(chico.radioPx).toBeGreaterThanOrEqual(3);
    expect(grande.radioPx).toBeLessThanOrEqual(16);
    expect(r.leyenda.find((l: { capa: string }) => l.capa === 'sismos').texto).toMatch(/magnitud/i);
  });
  it('sin archivo de quebradas o de sismos no inventa nada y lo dice', () => {
    const r = Capas.construir({ ...base, cauces: null, sismos: null, capas: [{ id: 'quebradas' }, { id: 'sismos' }], area: null });
    expect(r.lineas).toEqual([]);
    expect(r.sismos).toEqual([]);
    expect(r.sinDatos.sort()).toEqual(['quebradas', 'sismos']);
  });
});

describe('Capas.construir: una búsqueda con sectores', () => {
  const sector = (n: number, lat: number, lon: number) => ({
    n, centro: { lat, lon }, hectareas: 12, distrito: 'PAUCARPATA', nombre: null,
    contorno: [[[lon - 0.001, lat - 0.001], [lon + 0.001, lat - 0.001], [lon + 0.001, lat + 0.001], [lon - 0.001, lat - 0.001]]],
    centros: [[lat, lon]],
  });
  const sectores = [sector(1, -16.4108, -71.54)];

  it('dibuja los sectores como la región donde se cumple todo y no pinta nada más que las entidades que cuentan', () => {
    const r = Capas.construir({
      ...base, capas: [{ id: 'colegios', niveles: ['inicial'], umbralPorNivel: { inicial: 500 } }, { id: 'parques', umbralM: 300 }], area: { polys: DISTRITO }, sectores,
    });
    expect(r.sectores).toHaveLength(1);
    expect(r.leyenda.map((l: { capa: string }) => l.capa)).toEqual(['colegios', 'parques', 'sectores']);
    expect(r.leyenda[2].texto).toMatch(/donde se cumple todo lo que pediste/i);
  });

  it('solo muestra las entidades que quedan a la distancia de referencia de algún sector', () => {
    const r = Capas.construir({
      ...base, capas: [{ id: 'colegios', niveles: ['inicial', 'primaria', 'secundaria'], umbralPorNivel: { inicial: 100, primaria: 100, secundaria: 100 } }], area: { polys: DISTRITO },
      sectores: [sector(1, -16.41, -71.54)],
    });
    // El sector está a ~0 m del colegio 1 y a 22 m del 2, pero a 44 m del 3: con 100 m entran los tres. Con 30 m, solo los dos primeros.
    expect(r.puntos).toHaveLength(3);
    const r2 = Capas.construir({
      ...base, capas: [{ id: 'colegios', niveles: ['inicial', 'primaria', 'secundaria'], umbralPorNivel: { inicial: 30, primaria: 30, secundaria: 30 } }], area: { polys: DISTRITO },
      sectores: [sector(1, -16.41, -71.54)],
    });
    expect(r2.puntos.map((p: { osm: string }) => p.osm).sort()).toEqual(['node/1', 'node/2']);
  });

  it('el encuadre abarca los sectores', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'colegios' }], area: { polys: DISTRITO }, sectores });
    expect(r.limites[0]).toBeLessThan(-71.54);
    expect(r.limites[2]).toBeGreaterThan(-71.54);
  });
});

describe('Capas.construir: encuadre y resumen', () => {
  it('con un distrito encuadra el distrito', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'colegios' }], area: { polys: DISTRITO } });
    expect(r.limites).toEqual([-71.55, -16.42, -71.53, -16.40]);
  });
  it('resume lo que se muestra y avisa de las capas sin elementos', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'colegios' }, { id: 'salud' }], area: { polys: [[[[-71.2, -16.0], [-71.19, -16.0], [-71.19, -15.99], [-71.2, -15.99], [-71.2, -16.0]]]] } });
    expect(r.vacias.sort()).toEqual(['colegios', 'salud']);
    expect(r.resumen).toMatch(/no hay/i);
  });
  it('dice cuántos elementos muestra', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'colegios' }], area: { polys: DISTRITO } });
    expect(r.resumen).toMatch(/3 colegios/);
  });
});

describe('Capas.sismoRadioPx', () => {
  it('crece con la magnitud y se mantiene entre 3 y 16 px', () => {
    expect(Capas.sismoRadioPx(1)).toBe(3);
    expect(Capas.sismoRadioPx(9)).toBe(16);
    expect(Capas.sismoRadioPx(5)).toBeGreaterThan(Capas.sismoRadioPx(3));
  });
});

describe('Los datos de este archivo de prueba están en Arequipa', () => {
  it('un grado de latitud mide unos 111 km', () => {
    expect(Math.round(M / 1000)).toBe(111);
  });
});

describe('Capas.sismosDeFeatures', () => {
  it('convierte el GeoJSON del IGP en una lista simple y descarta lo que no es un punto con magnitud', () => {
    const f = [
      { type: 'Feature', properties: { magnitud: 4.2, fecha: '2026-01-08', profundidadKm: 74, ref: '30 km al NE de Punta de Bombón' }, geometry: { type: 'Point', coordinates: [-71.5, -16.5] } },
      { type: 'Feature', properties: { fecha: '2026-01-09' }, geometry: { type: 'Point', coordinates: [-71.5, -16.5] } },
      { type: 'Feature', properties: { magnitud: 3 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
    ];
    expect(Capas.sismosDeFeatures(f)).toEqual([{ lon: -71.5, lat: -16.5, magnitud: 4.2, fecha: '2026-01-08', profundidadKm: 74, ref: '30 km al NE de Punta de Bombón' }]);
    expect(Capas.sismosDeFeatures(null)).toEqual([]);
  });
});

describe('Capas.construir: solo el distrito (perfil)', () => {
  it('marca el distrito y dice cómo ver más, sin un «Muestro .» vacío', () => {
    const r = Capas.construir({ ...base, capas: [], area: { polys: DISTRITO } });
    expect(r.resumen).toBe('Marqué el distrito en el mapa. Elige arriba qué quieres ver dentro de él.');
    expect(r.limites).toEqual([-71.55, -16.42, -71.53, -16.40]);
  });
});
