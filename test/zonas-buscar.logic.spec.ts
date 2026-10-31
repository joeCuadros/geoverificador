import {
  clusterCells,
  createZoneFeatures,
  parseSearchParameters,
  scoreCell,
  type ScoredCell,
  type SearchCell,
  type Stars,
} from '../src/zonas/zonas-buscar.logic';

const noStars: Stars = {
  salud: 0,
  colegio_inicial: 0,
  colegio_primaria: 0,
  colegio_secundaria: 0,
  paradero: 0,
  area_verde: 0,
};

function cell(cellKey: string, healthDistanceM: number | null): SearchCell {
  return {
    cellKey,
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
    },
    areaM2: 10_000,
    buildability: 'si',
    zoneCode: 'RDM',
    districts: ['Cercado'],
    healthDistanceM,
    initialDistanceM: null,
    primaryDistanceM: null,
    secondaryDistanceM: null,
    transitDistanceM: null,
    greenDistanceM: null,
  };
}

function scored(cellKey: string, score = 80): ScoredCell {
  return {
    ...cell(cellKey, null),
    score,
    criterionScores: { salud: score },
  };
}

function square(
  cellKey: string,
  west: number,
  south: number,
  east: number,
  north: number,
): ScoredCell {
  const result = scored(cellKey);
  result.geometry = {
    type: 'Polygon',
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };
  return result;
}

describe('puntaje de celdas', () => {
  it('puntúa un solo criterio y alcanza 100 dentro de su umbral', () => {
    const stars = { ...noStars, salud: 5 };
    const result = scoreCell(cell('32719:10:10', 1000), stars);

    expect(result.score).toBe(100);
    expect(result.criterionScores.salud).toBe(100);
  });

  it('promedia criterios con estrellas iguales', () => {
    const stars = { ...noStars, salud: 1, colegio_inicial: 1 };
    const result = scoreCell({
      ...cell('32719:10:10', 2000),
      initialDistanceM: 500,
    }, stars);

    expect(result.criterionScores.salud).toBe(50);
    expect(result.criterionScores.colegio_inicial).toBe(100);
    expect(result.score).toBe(75);
  });

  it('asigna cero a una distancia NULL', () => {
    const result = scoreCell(cell('32719:10:10', null), { ...noStars, salud: 5 });

    expect(result.score).toBe(0);
    expect(result.criterionScores.salud).toBe(0);
  });
});

describe('agrupamiento de celdas', () => {
  it('considera contiguas las celdas vecinas por diagonal', () => {
    const groups = clusterCells([
      scored('32719:10:10'),
      scored('32719:11:11'),
    ], 2);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('descarta componentes con menos celdas que el mínimo', () => {
    const groups = clusterCells([
      scored('32719:10:10'),
      scored('32719:11:10'),
      scored('32719:30:30'),
    ], 2);

    expect(groups).toHaveLength(1);
    expect(groups[0].map((item) => item.cellKey)).toEqual(['32719:10:10', '32719:11:10']);
  });

  it('disuelve las celdas contiguas en un polígono simplificado', () => {
    const features = createZoneFeatures([[
      square('32719:10:10', -71.54, -16.4, -71.539, -16.399),
      square('32719:11:10', -71.539, -16.4, -71.538, -16.399),
    ]]);

    expect(features[0].geometry.type).toBe('Polygon');
    expect(features[0].properties.cantidadCeldas).toBe(2);
  });

  it('mantiene como multipolígono las celdas conectadas solo por diagonal', () => {
    const features = createZoneFeatures([[
      square('32719:10:10', -71.54, -16.4, -71.539, -16.399),
      square('32719:11:11', -71.539, -16.399, -71.538, -16.398),
    ]]);

    expect(features[0].geometry.type).toBe('MultiPolygon');
  });
});

describe('validación de búsqueda', () => {
  it('rechaza una búsqueda sin criterios activos', () => {
    expect(() => parseSearchParameters({ estrellas: {} })).toThrow('Asigna al menos una estrella');
  });

  it('rechaza estrellas fuera de rango y parámetros desconocidos', () => {
    expect(() => parseSearchParameters({ estrellas: { salud: 6 } })).toThrow('entero de 0 a 5');
    expect(() => parseSearchParameters({ estrellas: { salud: 1 }, sql: 'select' })).toThrow('no reconocido');
    expect(() => parseSearchParameters({ estrellas: { salud: null } })).toThrow('entero de 0 a 5');
    expect(() => parseSearchParameters({ estrellas: { salud: 1 }, puntajeMinimo: null })).toThrow('puntajeMinimo');
  });
});
