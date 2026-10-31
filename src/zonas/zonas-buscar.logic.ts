import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import TopologyPreservingSimplifier from 'jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier.js';
import proj4 from 'proj4';

export const CRITERIA = [
  'salud',
  'colegio_inicial',
  'colegio_primaria',
  'colegio_secundaria',
  'paradero',
  'area_verde',
] as const;

export type Criterion = (typeof CRITERIA)[number];
export type Stars = Record<Criterion, number>;
export type Buildability = 'si' | 'condicionado' | 'no';
export type Coordinate = number[];
export type NestedCoordinates = Coordinate | NestedCoordinates[];

export interface GeoJsonGeometry {
  type: string;
  coordinates: NestedCoordinates;
}

export interface SearchParameters {
  stars: Stars;
  minimumScore: number;
  minimumZoneCells: number;
  includeConditional: boolean;
}

export interface SearchCell {
  cellKey: string;
  geometry: GeoJsonGeometry;
  areaM2: number;
  buildability: Buildability | null;
  zoneCode: string | null;
  districts: string[];
  healthDistanceM: number | null;
  initialDistanceM: number | null;
  primaryDistanceM: number | null;
  secondaryDistanceM: number | null;
  transitDistanceM: number | null;
  greenDistanceM: number | null;
}

export interface ScoredCell extends SearchCell {
  score: number;
  criterionScores: Partial<Record<Criterion, number>>;
}

export interface ZoneFeature {
  type: 'Feature';
  geometry: GeoJsonGeometry;
  properties: {
    nombre: string;
    puntajePromedio: number;
    puntajeMaximo: number;
    cantidadCeldas: number;
    areaAproximadaM2: number;
    distritos: string[];
    codigosZonificacion: string[];
    incluyeConstruccionCondicional: boolean;
    desglosePromedioPorCriterio: Partial<Record<Criterion, number>>;
  };
}

export interface ZoneSearchResult {
  type: 'FeatureCollection';
  features: ZoneFeature[];
  metadata: Record<string, unknown>;
}

interface Thresholds {
  salud: number;
  educacion: { inicial: number; primaria: number; secundaria: number };
  transporte: number;
  areaVerde: { distanciaM: number };
}

const CRITERION_DISTANCE: Record<Criterion, keyof SearchCell> = {
  salud: 'healthDistanceM',
  colegio_inicial: 'initialDistanceM',
  colegio_primaria: 'primaryDistanceM',
  colegio_secundaria: 'secondaryDistanceM',
  paradero: 'transitDistanceM',
  area_verde: 'greenDistanceM',
};

function readThresholds(): Thresholds {
  const configPath = [
    join(__dirname, '..', '..', 'public', 'js', 'config.js'),
    join(__dirname, '..', '..', '..', 'public', 'js', 'config.js'),
    join(process.cwd(), 'public', 'js', 'config.js'),
  ].find(existsSync);
  if (!configPath) throw new Error('No se encontró public/js/config.js para cargar los umbrales.');
  const source = readFileSync(configPath, 'utf8');
  const thresholds = runInNewContext(`${source}\nCONFIG.umbrales`) as Thresholds;
  const values = [
    thresholds.salud,
    thresholds.educacion.inicial,
    thresholds.educacion.primaria,
    thresholds.educacion.secundaria,
    thresholds.transporte,
    thresholds.areaVerde.distanciaM,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Los umbrales de public/js/config.js son inválidos.');
  }
  return thresholds;
}

export const THRESHOLDS = readThresholds();

export function parseSearchParameters(body: unknown): SearchParameters {
  if (!isRecord(body)) {
    throw new Error('El cuerpo debe ser un objeto JSON.');
  }
  rejectUnknownKeys(body, ['estrellas', 'puntajeMinimo', 'minimoCeldasZona', 'incluirCondicional']);

  const rawStars = hasOwn(body, 'estrellas') ? body.estrellas : {};
  if (!isRecord(rawStars)) {
    throw new Error('"estrellas" debe ser un objeto con valores enteros de 0 a 5.');
  }
  rejectUnknownKeys(rawStars, CRITERIA);
  const stars = Object.fromEntries(
    CRITERIA.map((criterion) => {
      const value = hasOwn(rawStars, criterion) ? rawStars[criterion] : 0;
      if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 5) {
        throw new Error(`La cantidad de estrellas de "${criterion}" debe ser un entero de 0 a 5.`);
      }
      return [criterion, Number(value)];
    }),
  ) as Stars;
  if (Object.values(stars).every((value) => value === 0)) {
    throw new Error('Asigna al menos una estrella a un criterio para buscar zonas.');
  }

  const minimumScore = hasOwn(body, 'puntajeMinimo') ? body.puntajeMinimo : 60;
  if (typeof minimumScore !== 'number' || !Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 100) {
    throw new Error('"puntajeMinimo" debe ser un número entre 0 y 100.');
  }

  const minimumZoneCells = hasOwn(body, 'minimoCeldasZona') ? body.minimoCeldasZona : 4;
  if (!Number.isInteger(minimumZoneCells) || Number(minimumZoneCells) < 1 || Number(minimumZoneCells) > 1000) {
    throw new Error('"minimoCeldasZona" debe ser un entero entre 1 y 1000.');
  }

  const includeConditional = hasOwn(body, 'incluirCondicional') ? body.incluirCondicional : false;
  if (typeof includeConditional !== 'boolean') {
    throw new Error('"incluirCondicional" debe ser true o false.');
  }

  return {
    stars,
    minimumScore,
    minimumZoneCells: Number(minimumZoneCells),
    includeConditional,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`Parámetro(s) no reconocido(s): ${unknown.join(', ')}.`);
  }
}

function thresholdFor(criterion: Criterion): number {
  switch (criterion) {
    case 'salud':
      return THRESHOLDS.salud;
    case 'colegio_inicial':
      return THRESHOLDS.educacion.inicial;
    case 'colegio_primaria':
      return THRESHOLDS.educacion.primaria;
    case 'colegio_secundaria':
      return THRESHOLDS.educacion.secundaria;
    case 'paradero':
      return THRESHOLDS.transporte;
    case 'area_verde':
      return THRESHOLDS.areaVerde.distanciaM;
  }
}

export function scoreDistance(distanceM: number | null, thresholdM: number): number {
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM < 0) return 0;
  if (distanceM <= thresholdM) return 1;
  const maximumDistance = thresholdM * 3;
  if (distanceM >= maximumDistance) return 0;
  return (maximumDistance - distanceM) / (maximumDistance - thresholdM);
}

export function scoreCell(cell: SearchCell, stars: Stars): ScoredCell {
  let weightedScore = 0;
  let totalWeight = 0;
  const criterionScores: Partial<Record<Criterion, number>> = {};
  for (const criterion of CRITERIA) {
    const weight = stars[criterion];
    if (weight === 0) continue;
    const distance = cell[CRITERION_DISTANCE[criterion]];
    if (typeof distance !== 'number' && distance !== null) {
      throw new Error(`La métrica de distancia "${criterion}" no es válida.`);
    }
    const normalized = scoreDistance(distance, thresholdFor(criterion));
    criterionScores[criterion] = normalized * 100;
    weightedScore += normalized * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) throw new Error('Asigna al menos una estrella a un criterio para buscar zonas.');
  return {
    ...cell,
    score: (weightedScore / totalWeight) * 100,
    criterionScores,
  };
}

export function clusterCells(cells: ScoredCell[], minimumCells: number): ScoredCell[][] {
  const remaining = new Map(cells.map((cell) => [cell.cellKey, cell]));
  const components: ScoredCell[][] = [];
  for (const cell of cells) {
    if (!remaining.has(cell.cellKey)) continue;
    const component: ScoredCell[] = [];
    const queue = [cell];
    remaining.delete(cell.cellKey);
    while (queue.length > 0) {
      const current = queue.pop();
      if (!current) continue;
      component.push(current);
      const { column, row } = gridCoordinates(current.cellKey);
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
          if (columnOffset === 0 && rowOffset === 0) continue;
          const neighborKey = `32719:${column + columnOffset}:${row + rowOffset}`;
          const neighbor = remaining.get(neighborKey);
          if (neighbor) {
            remaining.delete(neighborKey);
            queue.push(neighbor);
          }
        }
      }
    }
    if (component.length >= minimumCells) components.push(component);
  }
  return components;
}

function gridCoordinates(cellKey: string): { column: number; row: number } {
  const match = /^32719:(-?\d+):(-?\d+)$/.exec(cellKey);
  if (!match) throw new Error(`Identificador de celda inválido: ${cellKey}.`);
  return { column: Number(match[1]), row: Number(match[2]) };
}

function mapCoordinates(coordinates: NestedCoordinates, transform: (coordinate: Coordinate) => Coordinate): NestedCoordinates {
  if (typeof coordinates[0] === 'number') {
    return transform(coordinates as Coordinate);
  }
  return (coordinates as NestedCoordinates[]).map((coordinate) => mapCoordinates(coordinate, transform));
}

function transformGeometry(
  geometry: GeoJsonGeometry,
  transform: (coordinate: Coordinate) => Coordinate,
): GeoJsonGeometry {
  return { ...geometry, coordinates: mapCoordinates(geometry.coordinates, transform) };
}

function buildComponentGeometry(component: ScoredCell[]): GeoJsonGeometry {
  const points = new Map<string, [number, number]>();
  const edges = new Map<number, { id: number; from: string; to: string }>();
  const edgesByDirection = new Map<string, number[]>();
  let nextEdgeId = 0;

  const addEdge = (from: string, to: string): void => {
    if (from === to) return;
    const reverse = `${to}>${from}`;
    const reverseIds = edgesByDirection.get(reverse);
    if (reverseIds?.length) {
      const reverseId = reverseIds.pop();
      if (reverseIds.length === 0) edgesByDirection.delete(reverse);
      if (reverseId !== undefined) edges.delete(reverseId);
      return;
    }
    const edge = { id: nextEdgeId, from, to };
    nextEdgeId += 1;
    edges.set(edge.id, edge);
    const direction = `${from}>${to}`;
    const directionIds = edgesByDirection.get(direction) ?? [];
    directionIds.push(edge.id);
    edgesByDirection.set(direction, directionIds);
  };

  for (const cell of component) {
    for (const polygon of polygonsOfGeoJson(cell.geometry)) {
      for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
        const ring = polygon[ringIndex] as Coordinate[];
        const projected = ring.map(([longitude, latitude]) => {
          const [x, y] = proj4('EPSG:4326', 'EPSG:32719', [longitude, latitude]);
          const coordinate: [number, number] = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
          const key = `${Math.round(coordinate[0] * 100)},${Math.round(coordinate[1] * 100)}`;
          points.set(key, coordinate);
          return key;
        });
        const orientation = Math.sign(signedRingArea(projected.map((key) => points.get(key) as Coordinate)));
        const requiredOrientation = ringIndex === 0 ? 1 : -1;
        if (orientation !== 0 && orientation !== requiredOrientation) {
          projected.reverse();
        }
        for (let index = 1; index < projected.length; index += 1) {
          addEdge(projected[index - 1], projected[index]);
        }
      }
    }
  }

  const outgoingEdges = new Map<string, { id: number; from: string; to: string }[]>();
  for (const edge of edges.values()) {
    const outgoing = outgoingEdges.get(edge.from) ?? [];
    outgoing.push(edge);
    outgoingEdges.set(edge.from, outgoing);
  }
  const rings: Coordinate[][] = [];
  while (edges.size > 0) {
    const start = edges.values().next().value?.from;
    if (!start) throw new Error('No se pudo reconstruir el contorno de una zona.');
    const stack = [start];
    const walk: string[] = [];
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const outgoing = outgoingEdges.get(current);
      let next: { id: number; from: string; to: string } | undefined;
      while (outgoing?.length && !next) {
        const candidate = outgoing.pop();
        if (candidate && edges.delete(candidate.id)) next = candidate;
      }
      if (next) stack.push(next.to);
      else walk.push(stack.pop() as string);
    }
    walk.reverse();
    if (walk.length < 4 || walk[0] !== walk[walk.length - 1]) {
      throw new Error('El contorno de las celdas no forma anillos cerrados.');
    }
    rings.push(...splitClosedWalk(walk, points));
  }

  const exteriorRings = rings.filter((ring) => Math.sign(signedRingArea(ring)) === 1);
  const holeRings = rings.filter((ring) => Math.sign(signedRingArea(ring)) === -1);
  const polygons = exteriorRings.map((ring) => ({ exterior: ring, holes: [] as Coordinate[][] }));
  for (const hole of holeRings) {
    const candidates = polygons
      .filter((polygon) => hole.some((point) => pointInRing(point, polygon.exterior)))
      .sort((left, right) => Math.abs(signedRingArea(left.exterior)) - Math.abs(signedRingArea(right.exterior)));
    if (candidates.length === 0) {
      const exterior = [...hole].reverse();
      polygons.push({ exterior, holes: [] });
      continue;
    }
    candidates[0].holes.push(hole);
  }
  if (polygons.length === 0) throw new Error('La zona no produjo polígonos exteriores.');

  const projectedGeometry: GeoJsonGeometry = polygons.length === 1
    ? { type: 'Polygon', coordinates: [polygons[0].exterior, ...polygons[0].holes] }
    : { type: 'MultiPolygon', coordinates: polygons.map((polygon) => [polygon.exterior, ...polygon.holes]) };
  const reader = new GeoJSONReader(new GeometryFactory());
  const writer = new GeoJSONWriter();
  let geometry = reader.read(projectedGeometry);
  if (!IsValidOp.isValid(geometry)) geometry = BufferOp.bufferOp(geometry, 0);
  let simplified = TopologyPreservingSimplifier.simplify(geometry, 5);
  if (!IsValidOp.isValid(simplified)) {
    simplified = BufferOp.bufferOp(simplified, 0);
  }
  const validity = simplified ? new IsValidOp(simplified) : null;
  if (!simplified || simplified.isEmpty() || !validity?.isValid()) {
    const reason = validity?.getValidationError()?.toString() ?? 'geometría vacía';
    throw new Error(`No se pudo generar una geometría válida para una zona: ${reason}.`);
  }
  return transformGeometry(
    writer.write(simplified) as GeoJsonGeometry,
    ([x, y]) => proj4('EPSG:32719', 'EPSG:4326', [x, y]),
  );
}

function polygonsOfGeoJson(geometry: GeoJsonGeometry): NestedCoordinates[][] {
  return geometry.type === 'Polygon'
    ? [geometry.coordinates as NestedCoordinates[]]
    : geometry.coordinates as NestedCoordinates[][];
}

function signedRingArea(ring: Coordinate[]): number {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) {
    area += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
  }
  return area / 2;
}

function splitClosedWalk(
  walk: string[],
  points: Map<string, [number, number]>,
): Coordinate[][] {
  const result: Coordinate[][] = [];
  let remainder = walk;
  while (remainder.length >= 4) {
    const positions = new Map<string, number>();
    let split: { start: number; end: number } | null = null;
    for (let index = 0; index < remainder.length - 1; index += 1) {
      const previous = positions.get(remainder[index]);
      if (previous !== undefined) {
        split = { start: previous, end: index };
        break;
      }
      positions.set(remainder[index], index);
    }
    if (!split) {
      if (remainder[0] !== remainder[remainder.length - 1]) {
        throw new Error('El contorno de una zona quedó abierto.');
      }
      const ring = remainder.map((key) => points.get(key));
      if (ring.some((coordinate) => coordinate === undefined)) throw new Error('Falta una coordenada de contorno.');
      result.push(ring as Coordinate[]);
      break;
    }
    const ring = remainder.slice(split.start, split.end + 1).map((key) => points.get(key));
    if (ring.some((coordinate) => coordinate === undefined)) throw new Error('Falta una coordenada de contorno.');
    if (ring.length >= 4 && Math.abs(signedRingArea(ring as Coordinate[])) > 0) result.push(ring as Coordinate[]);
    remainder = remainder.slice(0, split.start + 1).concat(remainder.slice(split.end + 1));
  }
  return result;
}

function pointInRing(point: Coordinate, ring: Coordinate[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];
    if (
      (currentY > point[1]) !== (previousY > point[1])
      && point[0] < ((previousX - currentX) * (point[1] - currentY)) / (previousY - currentY) + currentX
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createZoneFeatures(components: ScoredCell[][]): ZoneFeature[] {
  const features = components.map((component) => {
    const averageScore = component.reduce((sum, cell) => sum + cell.score, 0) / component.length;
    const maximumScore = Math.max(...component.map((cell) => cell.score));
    const criterionAverages: Partial<Record<Criterion, number>> = {};
    for (const criterion of CRITERIA) {
      const values = component
        .map((cell) => cell.criterionScores[criterion])
        .filter((value): value is number => value !== undefined);
      if (values.length > 0) {
        criterionAverages[criterion] = rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
      }
    }
    const zoneCodes = [...new Set(component.map((cell) => cell.zoneCode).filter((code): code is string => code !== null))].sort();
    const districts = [...new Set(component.flatMap((cell) => cell.districts))].sort();
    return {
      type: 'Feature' as const,
      geometry: buildComponentGeometry(component),
      properties: {
        nombre: '',
        puntajePromedio: rounded(averageScore),
        puntajeMaximo: rounded(maximumScore),
        cantidadCeldas: component.length,
        areaAproximadaM2: rounded(component.reduce((sum, cell) => sum + cell.areaM2, 0)),
        distritos: districts,
        codigosZonificacion: zoneCodes,
        incluyeConstruccionCondicional: component.some((cell) => cell.buildability === 'condicionado'),
        desglosePromedioPorCriterio: criterionAverages,
      },
    };
  });
  features.sort((left, right) =>
    right.properties.puntajePromedio - left.properties.puntajePromedio
    || right.properties.puntajeMaximo - left.properties.puntajeMaximo
    || right.properties.cantidadCeldas - left.properties.cantidadCeldas,
  );
  features.forEach((feature, index) => {
    feature.properties.nombre = `Zona ${index + 1}`;
  });
  return features;
}

export function searchZones(
  cells: SearchCell[],
  parameters: SearchParameters,
  dataDate: string | null,
): ZoneSearchResult {
  const startedAt = performance.now();
  const scoredCells: ScoredCell[] = [];
  let eligibleCellCount = 0;
  for (const cell of cells) {
    if (cell.buildability === 'no' || cell.buildability === null) continue;
    if (cell.buildability === 'condicionado' && !parameters.includeConditional) continue;
    eligibleCellCount += 1;
    const scored = scoreCell(cell, parameters.stars);
    if (scored.score >= parameters.minimumScore) scoredCells.push(scored);
  }
  const components = clusterCells(scoredCells, parameters.minimumZoneCells);
  const features = createZoneFeatures(components);
  return {
    type: 'FeatureCollection',
    features,
    metadata: {
      cantidadCeldasEvaluadas: cells.length,
      cantidadCeldasElegibles: eligibleCellCount,
      cantidadCeldasSobrePuntajeMinimo: scoredCells.length,
      parametrosAplicados: {
        estrellas: parameters.stars,
        puntajeMinimo: parameters.minimumScore,
        minimoCeldasZona: parameters.minimumZoneCells,
        incluirCondicional: parameters.includeConditional,
        distanciaMaximaMultiploUmbral: 3,
        conectividad: '8 vecinos (incluye diagonales)',
      },
      fechaDatos: dataDate,
      tiempoCalculoMs: rounded(performance.now() - startedAt),
    },
  };
}
