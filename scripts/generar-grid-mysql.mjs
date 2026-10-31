import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import Flatbush from 'flatbush';
import proj4 from 'proj4';
import ArrayList from 'jsts/java/util/ArrayList.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import WKTReader from 'jsts/org/locationtech/jts/io/WKTReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import { loadMysqlConfig, ROOT } from './mysql-config.mjs';

const require = createRequire(import.meta.url);
const Calculos = require(join(ROOT, 'public', 'js', 'calculos.js'));
const DATA_DIR = join(ROOT, 'public', 'data');
const GRID_SIZE_M = 100;
const MIN_CLIP_FRAGMENT_M2 = 1;
const GEOMETRY_SNAP_M = 0.01;
const HAZARD_RADIUS_M = 500;
const EARTH_RADIUS_M = Calculos.RADIO_TIERRA_M;
const METERS_PER_RADIAN = EARTH_RADIUS_M;
const GRID_LOCK = 'geoverificador:generar-grid';
const UTM_19S = '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs +type=crs';
const WGS84 = 'EPSG:4326';
const VALIDATION_POINTS = [
  { name: 'Plaza de Armas', cellKey: '32719:2290:81852' },
  { name: 'Yanahuara', cellKey: '32719:2274:81862' },
  { name: 'Cayma', cellKey: '32719:2277:81906' },
  { name: 'Cerro Colorado', cellKey: '32719:2237:81888' },
  { name: 'Miraflores', cellKey: '32719:2310:81854' },
  { name: 'Paucarpata', cellKey: '32719:2326:81818' },
  { name: 'José Luis Bustamante y Rivero', cellKey: '32719:2302:81822' },
  { name: 'Sachaca', cellKey: '32719:2259:81822' },
  { name: 'Socabaya', cellKey: '32719:2301:81780' },
  { name: 'Tiabaya', cellKey: '32719:2230:81793' },
];
const METRIC_COLUMNS = [
  'health_distance_m',
  'school_initial_distance_m',
  'school_primary_distance_m',
  'school_secondary_distance_m',
  'transit_distance_m',
  'green_5000_distance_m',
  'green_10000_distance_m',
];

proj4.defs('EPSG:32719', UTM_19S);

function readGeoJson(value, label) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || !['Polygon', 'MultiPolygon'].includes(parsed.type)) {
    throw new Error(`${label}: geometría inesperada (${parsed?.type || 'sin tipo'}).`);
  }
  return parsed;
}

function mapCoordinates(coordinates, transform) {
  if (typeof coordinates[0] === 'number') return transform(coordinates);
  return coordinates.map((coordinate) => mapCoordinates(coordinate, transform));
}

function projectGeometry(geometry) {
  return {
    ...geometry,
    coordinates: mapCoordinates(geometry.coordinates, ([lon, lat]) => proj4(WGS84, 'EPSG:32719', [lon, lat])),
  };
}

function geographicGeometry(geometry) {
  return {
    ...geometry,
    coordinates: mapCoordinates(geometry.coordinates, ([x, y]) => proj4('EPSG:32719', WGS84, [x, y])),
  };
}

function polygonsOfGeometry(geometry) {
  if (geometry.getGeometryType() === 'Polygon') return [geometry];
  const polygons = [];
  for (let index = 0; index < geometry.getNumGeometries(); index += 1) {
    polygons.push(...polygonsOfGeometry(geometry.getGeometryN(index)));
  }
  return polygons;
}

function geometryToMultiPolygonWkt(geometry, writer) {
  const polygons = polygonsOfGeometry(geometry).map((polygon) => writer.write(polygon).coordinates);
  if (polygons.length === 0) throw new Error('La celda recortada no contiene polígonos.');
  const ringWkt = (ring) => `(${ring.map(([lon, lat]) => `${lon} ${lat}`).join(',')})`;
  const polygonWkt = (rings) => `(${rings.map(ringWkt).join(',')})`;
  return `MULTIPOLYGON(${polygons.map(polygonWkt).join(',')})`;
}

function bboxOfGeometry(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coordinates) => {
    if (typeof coordinates[0] === 'number') {
      bounds[0] = Math.min(bounds[0], coordinates[0]);
      bounds[1] = Math.min(bounds[1], coordinates[1]);
      bounds[2] = Math.max(bounds[2], coordinates[0]);
      bounds[3] = Math.max(bounds[3], coordinates[1]);
      return;
    }
    coordinates.forEach(visit);
  };
  visit(geometry.coordinates);
  return bounds;
}

function indexBounds(index, boxes) {
  const tree = new Flatbush(boxes.length);
  boxes.forEach(([minX, minY, maxX, maxY]) => tree.add(minX, minY, maxX, maxY));
  tree.finish();
  return tree;
}

function degreeSearchBounds(lat, radiusM, spherical = false) {
  const radiansPerDegree = Math.PI / 180;
  const latRadius = radiusM / METERS_PER_RADIAN;
  const latDelta = latRadius / radiansPerDegree;
  const maxAbsLat = Math.min(Math.PI / 2 - 1e-10, Math.abs(lat * radiansPerDegree) + latRadius);
  const longitudeScale = spherical ? Math.cos(maxAbsLat) : Math.abs(Math.cos(lat * radiansPerDegree));
  const lonDelta = longitudeScale < 1e-10
    ? 180
    : (latRadius / longitudeScale) / radiansPerDegree;
  return { latDelta, lonDelta };
}

function pointDistanceIndex(items, distance, spherical = true) {
  if (items.length === 0) return null;
  const tree = indexBounds(items, items.map((item) => [item.lon, item.lat, item.lon, item.lat]));
  return (lat, lon) => {
    let radius = 100;
    while (true) {
      const { latDelta, lonDelta } = degreeSearchBounds(lat, radius, spherical);
      const candidates = tree.search(lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta);
      let nearest = Infinity;
      for (const candidateIndex of candidates) {
        const item = items[candidateIndex];
        const current = distance(lat, lon, item);
        if (current < nearest) nearest = current;
      }
      if (nearest <= radius) return nearest;
      radius *= 2;
      if (radius > 40_000_000) return null;
    }
  };
}

function polygonDistanceIndex(items) {
  const eligible = items.filter((item) => item.areaM2 >= 5000);
  if (eligible.length === 0) return () => null;
  const tree = indexBounds(eligible, eligible.map((item) => item.bbox));
  return (lat, lon) => {
    let radius = 100;
    while (true) {
      const { latDelta, lonDelta } = degreeSearchBounds(lat, radius);
      const candidates = tree.search(lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta);
      let nearest = Infinity;
      for (const candidateIndex of candidates) {
        const current = Calculos.distanciaAGeometriaM(lat, lon, eligible[candidateIndex].geometry);
        if (current < nearest) nearest = current;
      }
      if (nearest <= radius) return nearest;
      radius *= 2;
      if (radius > 40_000_000) return null;
    }
  };
}

function hazardCountIndex(hazards) {
  if (hazards.length === 0) return () => 0;
  const tree = indexBounds(hazards, hazards.map((item) => [item.lon, item.lat, item.lon, item.lat]));
  return (lat, lon) => {
    const { latDelta, lonDelta } = degreeSearchBounds(lat, HAZARD_RADIUS_M, true);
    return tree.search(lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta)
      .reduce((count, candidateIndex) => {
        const hazard = hazards[candidateIndex];
        return count + (Calculos.haversine(lat, lon, hazard.lat, hazard.lon) <= HAZARD_RADIUS_M ? 1 : 0);
      }, 0);
  };
}

function buildZoneIndex(zones) {
  const tree = indexBounds(zones, zones.map((zone) => zone.bbox));
  return (lat, lon) => {
    const candidates = tree.search(lon, lat, lon, lat).sort((a, b) => a - b);
    let result = null;
    for (const index of candidates) {
      const zone = zones[index];
      if (lon < zone.bbox[0] || lon > zone.bbox[2] || lat < zone.bbox[1] || lat > zone.bbox[3]) continue;
      const polygons = zone.geometry.type === 'Polygon' ? [zone.geometry.coordinates] : zone.geometry.coordinates;
      if (polygons.some((rings) => Calculos.puntoEnPoligono(lat, lon, rings))) result = zone;
    }
    return result;
  };
}

async function loadDatabaseData(connection) {
  const [zoneRows] = await connection.query(`
    SELECT z.feature_number, z.zone_code, r.buildability,
      ST_AsGeoJSON(z.geom, 10, 0) AS geojson
    FROM zone_feature z
    LEFT JOIN zone_rule r ON r.zone_code = z.zone_code
    ORDER BY z.feature_number
  `);
  const zones = zoneRows.map((row) => {
    const geometry = readGeoJson(row.geojson, `Zonificación ${row.feature_number}`);
    return { featureNumber: Number(row.feature_number), code: row.zone_code, buildability: row.buildability, geometry, bbox: bboxOfGeometry(geometry) };
  });
  if (zones.length === 0) throw new Error('No hay polígonos de zonificación cargados; ejecuta pnpm db:import.');

  const [equipmentRows] = await connection.query(`
    SELECT source_id, category, education_level,
      ST_Longitude(geom) AS lon, ST_Latitude(geom) AS lat
    FROM equipment_point
    ORDER BY id
  `);
  const equipment = equipmentRows.map((row) => ({
    sourceId: row.source_id,
    category: row.category,
    level: row.education_level,
    lon: Number(row.lon),
    lat: Number(row.lat),
  }));
  const [greenRows] = await connection.query(`
    SELECT source_id, ST_AsGeoJSON(geom, 10, 0) AS geojson
    FROM green_area
    ORDER BY id
  `);
  const greenAreas = greenRows.map((row) => {
    const geometry = readGeoJson(row.geojson, `Área verde ${row.source_id}`);
    return { sourceId: row.source_id, geometry, bbox: bboxOfGeometry(geometry), areaM2: Calculos.areaGeometriaM2(geometry) };
  });
  const [hazardRows] = await connection.query(`
    SELECT source_id, ST_Longitude(geom) AS lon, ST_Latitude(geom) AS lat
    FROM geologic_hazard
    ORDER BY id
  `);
  const hazards = hazardRows.map((row) => ({ sourceId: row.source_id, lon: Number(row.lon), lat: Number(row.lat) }));

  const educations = equipment.filter((item) => item.category === 'education' && item.level !== null);
  const unclassifiedEducationCount = equipment.filter((item) => item.category === 'education' && item.level === null).length;
  const pointIndices = {
    health: pointDistanceIndex(equipment.filter((item) => item.category === 'health'), (lat, lon, item) => Calculos.haversine(lat, lon, item.lat, item.lon)),
    initial: pointDistanceIndex(educations.filter((item) => item.level === 'initial'), (lat, lon, item) => Calculos.haversine(lat, lon, item.lat, item.lon)),
    primary: pointDistanceIndex(educations.filter((item) => item.level === 'primary'), (lat, lon, item) => Calculos.haversine(lat, lon, item.lat, item.lon)),
    secondary: pointDistanceIndex(educations.filter((item) => item.level === 'secondary'), (lat, lon, item) => Calculos.haversine(lat, lon, item.lat, item.lon)),
    transport: pointDistanceIndex(equipment.filter((item) => item.category === 'transport'), (lat, lon, item) => Calculos.haversine(lat, lon, item.lat, item.lon)),
    green: polygonDistanceIndex(greenAreas),
    hazards: hazardCountIndex(hazards),
    zone: buildZoneIndex(zones),
  };
  return { zones, greenAreas, hazards, pointIndices, unclassifiedEducationCount };
}

function buildGrid(zones, pointIndices, reader, writer) {
  const projectedZones = zones.map((zone) => {
    const geometry = reader.read(projectGeometry(zone.geometry));
    geometry.setSRID(32719);
    if (!IsValidOp.isValid(geometry)) throw new Error(`Zona ${zone.featureNumber} inválida al proyectar a EPSG:32719.`);
    const envelope = geometry.getEnvelopeInternal();
    return {
      geometry,
      bounds: [envelope.getMinX(), envelope.getMinY(), envelope.getMaxX(), envelope.getMaxY()],
    };
  });
  const gridIndex = indexBounds(projectedZones, projectedZones.map((zone) => zone.bounds));
  const bounds = projectedZones.reduce((aggregate, zone) => [
    Math.min(aggregate[0], zone.bounds[0]),
    Math.min(aggregate[1], zone.bounds[1]),
    Math.max(aggregate[2], zone.bounds[2]),
    Math.max(aggregate[3], zone.bounds[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  const minColumn = Math.floor(bounds[0] / GRID_SIZE_M);
  const maxColumn = Math.ceil(bounds[2] / GRID_SIZE_M) - 1;
  const minRow = Math.floor(bounds[1] / GRID_SIZE_M);
  const maxRow = Math.ceil(bounds[3] / GRID_SIZE_M) - 1;
  const cells = [];
  let intersectingSquares = 0;
  let excludedOutsideCenter = 0;
  let discardedFragments = 0;
  let discardedAreaM2 = 0;
  let visitedSquares = 0;
  const gridStartedAt = performance.now();

  for (let column = minColumn; column <= maxColumn; column += 1) {
    const minX = column * GRID_SIZE_M;
    for (let row = minRow; row <= maxRow; row += 1) {
      visitedSquares += 1;
      const minY = row * GRID_SIZE_M;
      const candidates = gridIndex.search(minX, minY, minX + GRID_SIZE_M, minY + GRID_SIZE_M);
      if (candidates.length === 0) continue;
      const squareGeoJson = {
        type: 'Polygon',
        coordinates: [[
          [minX, minY],
          [minX + GRID_SIZE_M, minY],
          [minX + GRID_SIZE_M, minY + GRID_SIZE_M],
          [minX, minY + GRID_SIZE_M],
          [minX, minY],
        ]],
      };
      const square = reader.read(squareGeoJson);
      square.setSRID(32719);
      const clippedParts = new ArrayList();
      for (const candidateIndex of candidates) {
        const part = OverlayOp.intersection(projectedZones[candidateIndex].geometry, square);
        for (const polygon of polygonsOfGeometry(part)) {
          if (polygon.getArea() < MIN_CLIP_FRAGMENT_M2) {
            discardedFragments += 1;
            discardedAreaM2 += polygon.getArea();
          } else {
            clippedParts.add(polygon);
          }
        }
      }
      if (clippedParts.isEmpty()) continue;
      let clipped = clippedParts.size() === 1 ? clippedParts.get(0) : UnaryUnionOp.union(clippedParts);
      if (clipped.isEmpty() || clipped.getArea() <= 0) continue;
      const projectedGeoJson = writer.write(clipped);
      const snappedGeoJson = {
        ...projectedGeoJson,
        coordinates: mapCoordinates(projectedGeoJson.coordinates, ([x, y]) => [
          Math.round(x / GEOMETRY_SNAP_M) * GEOMETRY_SNAP_M,
          Math.round(y / GEOMETRY_SNAP_M) * GEOMETRY_SNAP_M,
        ]),
      };
      clipped = reader.read(snappedGeoJson);
      clipped.setSRID(32719);
      if (clipped.isEmpty() || clipped.getArea() <= 0) {
        throw new Error(`La cuadrícula de precisión ${GEOMETRY_SNAP_M} m colapsó la celda UTM ${column}:${row}.`);
      }
      if (!IsValidOp.isValid(clipped)) {
        clipped = BufferOp.bufferOp(clipped, 0);
        clipped.setSRID(32719);
        if (clipped.isEmpty() || !IsValidOp.isValid(clipped)) {
          throw new Error(`El recorte de la celda UTM ${column}:${row} quedó vacío o inválido tras repararlo.`);
        }
      }
      intersectingSquares += 1;

      const [lon, lat] = proj4('EPSG:32719', WGS84, [minX + GRID_SIZE_M / 2, minY + GRID_SIZE_M / 2]);
      const zone = pointIndices.zone(lat, lon);
      if (!zone) {
        excludedOutsideCenter += 1;
        continue;
      }
      const geographicClipped = geographicGeometry(writer.write(clipped));
      const cellKey = `32719:${column}:${row}`;
      const metrics = {
        health_distance_m: pointIndices.health(lat, lon),
        school_initial_distance_m: pointIndices.initial(lat, lon),
        school_primary_distance_m: pointIndices.primary(lat, lon),
        school_secondary_distance_m: pointIndices.secondary(lat, lon),
        transit_distance_m: pointIndices.transport(lat, lon),
        green_5000_distance_m: pointIndices.green(lat, lon),
        green_10000_distance_m: null,
        zone_code: zone.code,
        buildability: zone.buildability,
        hazard_count_500m: pointIndices.hazards(lat, lon),
      };
      if (Object.values(metrics).some((value) => typeof value === 'number' && !Number.isFinite(value))) {
        throw new Error(`La celda ${cellKey} generó una métrica no finita.`);
      }
      cells.push({
        cellKey,
        geometryWkt: geometryToMultiPolygonWkt(reader.read(geographicClipped), writer),
        centerWkt: `POINT(${lon} ${lat})`,
        areaM2: clipped.getArea(),
        metrics,
      });
    }
    if ((column - minColumn + 1) % 25 === 0) {
      console.log(`Progreso de cuadrícula: ${visitedSquares}/${(maxColumn - minColumn + 1) * (maxRow - minRow + 1)} cuadrados revisados; ${cells.length} celdas admitidas (${((performance.now() - gridStartedAt) / 1000).toFixed(1)} s).`);
    }
  }
  return { cells, intersectingSquares, excludedOutsideCenter, discardedFragments, discardedAreaM2 };
}

async function loadFrontendData() {
  const paths = {
    zones: join(DATA_DIR, 'zonas_aqp.geojson'),
    greenAreas: join(DATA_DIR, 'equipamiento', 'areas_verdes.geojson'),
    health: join(DATA_DIR, 'equipamiento', 'salud.geojson'),
    education: join(DATA_DIR, 'equipamiento', 'educacion.geojson'),
    transport: join(DATA_DIR, 'equipamiento', 'transporte.geojson'),
    hazards: join(DATA_DIR, 'peligros_aqp.geojson'),
    rules: join(DATA_DIR, 'reglas_zonas.json'),
  };
  const entries = await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, JSON.parse(await readFile(path, 'utf8'))]));
  return Object.fromEntries(entries);
}

function appZoneLookup(lat, lon, zones) {
  let hit = null;
  for (const feature of zones.features) {
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (polygons.some((rings) => Calculos.puntoEnPoligono(lat, lon, rings))) hit = feature;
  }
  return hit;
}

function nearestAppPoint(lat, lon, collection, category, level = null) {
  let nearest = Infinity;
  for (const feature of collection.features) {
    const properties = feature.properties || {};
    if (category === 'education' && !Calculos.nivelesEducativos(properties.tags || {}).includes(level)) continue;
    const [targetLon, targetLat] = feature.geometry.coordinates;
    nearest = Math.min(nearest, Calculos.haversine(lat, lon, targetLat, targetLon));
  }
  return Number.isFinite(nearest) ? nearest : null;
}

function appGreenDistance(lat, lon, greenCollection) {
  let nearest = Infinity;
  for (const feature of greenCollection.features) {
    if (Calculos.areaGeometriaM2(feature.geometry) < 5000) continue;
    nearest = Math.min(nearest, Calculos.distanciaAGeometriaM(lat, lon, feature.geometry));
  }
  return Number.isFinite(nearest) ? nearest : null;
}

function appHazardCount(lat, lon, hazardCollection) {
  return hazardCollection.features.reduce((count, feature) => {
    const [targetLon, targetLat] = feature.geometry.coordinates;
    return count + (Calculos.haversine(lat, lon, targetLat, targetLon) <= HAZARD_RADIUS_M ? 1 : 0);
  }, 0);
}

function validateTenPoints(cells, frontendData) {
  const byKey = new Map(cells.map((cell) => [cell.cellKey ?? cell.cell_key, cell]));
  const validation = [];
  for (const point of VALIDATION_POINTS) {
    const cell = byKey.get(point.cellKey);
    if (!cell) throw new Error(`Punto de validación ${point.name} no cae en una celda incluida; elige un punto de la zona zonificada.`);
    const [lon, lat] = cell.centerWkt
      ? cell.centerWkt.match(/POINT\(([-0-9.]+) ([-0-9.]+)\)/).slice(1).map(Number)
      : [Number(cell.center_lon), Number(cell.center_lat)];
    const metrics = cell.metrics || cell;
    const appZone = appZoneLookup(lat, lon, frontendData.zones);
    const appRule = appZone ? frontendData.rules[appZone.properties.codigo] : null;
    const expected = {
      health_distance_m: nearestAppPoint(lat, lon, frontendData.health, 'health'),
      school_initial_distance_m: nearestAppPoint(lat, lon, frontendData.education, 'education', 'inicial'),
      school_primary_distance_m: nearestAppPoint(lat, lon, frontendData.education, 'education', 'primaria'),
      school_secondary_distance_m: nearestAppPoint(lat, lon, frontendData.education, 'education', 'secundaria'),
      transit_distance_m: nearestAppPoint(lat, lon, frontendData.transport, 'transport'),
      green_5000_distance_m: appGreenDistance(lat, lon, frontendData.greenAreas),
      zone_code: appZone?.properties.codigo ?? null,
      buildability: appRule?.edificable ?? null,
      hazard_count_500m: appHazardCount(lat, lon, frontendData.hazards),
    };
    const diffs = METRIC_COLUMNS.filter((column) => column !== 'green_10000_distance_m')
      .map((column) => ({
        metric: column,
        diff: metrics[column] === null && expected[column] === null
          ? 0
          : metrics[column] === null || expected[column] === null
            ? Infinity
            : Math.abs(Number(metrics[column]) - expected[column]),
      }));
    const failed = diffs.some(({ diff }) => diff > 0.000001)
      || metrics.zone_code !== expected.zone_code
      || metrics.buildability !== expected.buildability
      || Number(metrics.hazard_count_500m) !== expected.hazard_count_500m;
    validation.push({
      punto: point.name,
      cellKey: cell.cellKey ?? cell.cell_key,
      centro: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
      diferencias_m: diffs.map(({ diff }) => diff),
      zona_ok: metrics.zone_code === expected.zone_code && metrics.buildability === expected.buildability,
      peligros_ok: Number(metrics.hazard_count_500m) === expected.hazard_count_500m,
      correcto: !failed,
    });
  }
  if (validation.some((result) => !result.correcto)) {
    throw new Error(`Falló la validación directa contra la app: ${JSON.stringify(validation.filter((result) => !result.correcto))}`);
  }
  return validation;
}

async function insertGrid(connection, cells) {
  const cellBatchSize = 100;
  for (let offset = 0; offset < cells.length; offset += cellBatchSize) {
    const batch = cells.slice(offset, offset + cellBatchSize);
    const template = "(?, ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?)";
    const values = batch.flatMap((cell) => [cell.cellKey, cell.geometryWkt, cell.centerWkt, cell.areaM2]);
    await connection.execute(
      `INSERT INTO grid_cell (cell_key, geom, center, area_m2) VALUES ${batch.map(() => template).join(', ')}`,
      values,
    );
  }

  const [ids] = await connection.query('SELECT id, cell_key FROM grid_cell');
  const idByKey = new Map(ids.map((row) => [row.cell_key, row.id]));
  const metricBatchSize = 250;
  const metricColumns = ['cell_id', ...METRIC_COLUMNS, 'zone_code', 'buildability', 'hazard_count_500m'];
  for (let offset = 0; offset < cells.length; offset += metricBatchSize) {
    const batch = cells.slice(offset, offset + metricBatchSize);
    const rowTemplate = `(${metricColumns.map(() => '?').join(', ')})`;
    const values = batch.flatMap((cell) => [
      idByKey.get(cell.cellKey),
      ...METRIC_COLUMNS.map((column) => cell.metrics[column]),
      cell.metrics.zone_code,
      cell.metrics.buildability,
      cell.metrics.hazard_count_500m,
    ]);
    await connection.execute(
      `INSERT INTO grid_cell_metrics (${metricColumns.join(', ')}) VALUES ${batch.map(() => rowTemplate).join(', ')}`,
      values,
    );
  }
}

async function repairMysqlInvalidCells(connection, cells, reader, writer) {
  const [invalidRows] = await connection.query(`
    SELECT cell_key FROM grid_cell
    WHERE ST_SRID(geom) <> 4326 OR NOT ST_IsValid(geom)
    ORDER BY cell_key
  `);
  if (invalidRows.length === 0) return 0;
  const cellsByKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
  const wktReader = new WKTReader();
  for (const { cell_key: cellKey } of invalidRows) {
    const cell = cellsByKey.get(cellKey);
    if (!cell) throw new Error(`MySQL detectó una celda inválida que no está en la carga actual: ${cellKey}.`);
    const original = wktReader.read(cell.geometryWkt);
    original.setSRID(4326);
    let fixed = BufferOp.bufferOp(original, 0);
    fixed.setSRID(4326);
    if (fixed.isEmpty() || !IsValidOp.isValid(fixed) || !['Polygon', 'MultiPolygon'].includes(fixed.getGeometryType())) {
      throw new Error(`La reparación de la geometría MySQL ${cellKey} quedó vacía, inválida o con tipo incompatible.`);
    }
    const geographic = writer.write(fixed);
    const projected = reader.read(projectGeometry(geographic));
    const repairedAreaM2 = projected.getArea();
    const geometryWkt = geometryToMultiPolygonWkt(fixed, writer);
    await connection.execute(`
      UPDATE grid_cell
      SET geom = ST_GeomFromText(?, 4326, 'axis-order=long-lat'), area_m2 = ?
      WHERE cell_key = ?
    `, [geometryWkt, repairedAreaM2, cellKey]);
    cell.geometryWkt = geometryWkt;
    cell.areaM2 = repairedAreaM2;
  }
  const [stillInvalid] = await connection.query(`
    SELECT cell_key FROM grid_cell
    WHERE ST_SRID(geom) <> 4326 OR NOT ST_IsValid(geom)
    ORDER BY cell_key
  `);
  if (stillInvalid.length) throw new Error(`MySQL aún rechaza geometrías de celda: ${stillInvalid.map((row) => row.cell_key).join(', ')}.`);
  return invalidRows.length;
}

async function reportStoredGrid(connection, previousCells) {
  const [[counts]] = await connection.query(`
    SELECT COUNT(*) AS cells,
      (SELECT COUNT(*) FROM grid_cell_metrics) AS metrics,
      SUM(ST_SRID(geom) <> 4326) AS wrong_srid,
      SUM(NOT ST_IsValid(geom)) AS invalid_geom
    FROM grid_cell
  `);
  if (Number(counts.cells) !== previousCells.length || Number(counts.metrics) !== previousCells.length) {
    throw new Error(`Conteos grid inconsistentes: ${counts.cells} celdas, ${counts.metrics} métricas, ${previousCells.length} esperadas.`);
  }
  if (Number(counts.wrong_srid) !== 0 || Number(counts.invalid_geom) !== 0) {
    const [invalidRows] = await connection.query('SELECT cell_key FROM grid_cell WHERE ST_SRID(geom) <> 4326 OR NOT ST_IsValid(geom) LIMIT 20');
    const labels = invalidRows.map((row) => row.cell_key).join(', ');
    throw new Error(`Grid con SRID incorrecto (${counts.wrong_srid}) o geometrías inválidas (${counts.invalid_geom}); celdas: ${labels}.`);
  }
  const [values] = await connection.query(`
    SELECT c.cell_key, c.area_m2, m.health_distance_m, m.school_initial_distance_m,
      m.school_primary_distance_m, m.school_secondary_distance_m, m.transit_distance_m,
      m.green_5000_distance_m, m.green_10000_distance_m, m.zone_code, m.buildability, m.hazard_count_500m,
      ST_Longitude(c.center) AS center_lon, ST_Latitude(c.center) AS center_lat
    FROM grid_cell c
    JOIN grid_cell_metrics m ON m.cell_id = c.id
    ORDER BY c.cell_key
  `);
  return { cells: values, counts };
}

function canonicalValues(rows) {
  return rows.toSorted((a, b) => a.cell_key.localeCompare(b.cell_key)).map((row) => [
    row.cell_key,
    Number(row.area_m2).toFixed(2),
    row.centerWkt
      ? row.centerWkt.match(/POINT\(([-0-9.]+) ([-0-9.]+)\)/).slice(1).map(Number).map((value) => value.toFixed(9)).join(',')
      : `${Number(row.center_lon).toFixed(9)},${Number(row.center_lat).toFixed(9)}`,
    ...METRIC_COLUMNS.map((column) => row[column] === null ? '' : Number(row[column]).toFixed(6)),
    row.zone_code || '',
    row.buildability || '',
    row.hazard_count_500m === null ? '' : String(row.hazard_count_500m),
  ].join('|')).join('\n');
}

function assertPersistedValues(expectedRows, storedRows) {
  const storedByKey = new Map(storedRows.map((row) => [row.cell_key, row]));
  if (expectedRows.length !== storedRows.length) {
    throw new Error(`Conteo del grid persistido distinto al calculado: ${storedRows.length} frente a ${expectedRows.length}.`);
  }
  for (const expected of expectedRows) {
    const stored = storedByKey.get(expected.cell_key);
    if (!stored) throw new Error(`Falta la celda ${expected.cell_key} en la lectura posterior a la inserción.`);
    const [expectedLon, expectedLat] = expected.centerWkt.match(/POINT\(([-0-9.]+) ([-0-9.]+)\)/).slice(1).map(Number);
    if (Math.abs(Number(stored.center_lon) - expectedLon) > 1e-9
      || Math.abs(Number(stored.center_lat) - expectedLat) > 1e-9) {
      throw new Error(`El centro persistido de ${expected.cell_key} difiere del centro UTM calculado.`);
    }
    if (Math.abs(Number(stored.area_m2) - expected.area_m2) > 0.0050001) {
      throw new Error(`El área persistida de ${expected.cell_key} difiere más del redondeo a 2 decimales.`);
    }
    for (const column of METRIC_COLUMNS) {
      const expectedValue = expected[column];
      const storedValue = stored[column];
      if (expectedValue === null && storedValue === null) continue;
      if (expectedValue === null || storedValue === null
        || Math.abs(Number(storedValue) - expectedValue) > 0.00000051) {
        throw new Error(`La métrica ${column} de ${expected.cell_key} difiere más del redondeo a 6 decimales.`);
      }
    }
    if (stored.zone_code !== expected.zone_code
      || stored.buildability !== expected.buildability
      || Number(stored.hazard_count_500m) !== expected.hazard_count_500m) {
      throw new Error(`La zonificación o el conteo de peligros de ${expected.cell_key} no coincide con lo calculado.`);
    }
  }
}

async function main() {
  const startedAt = performance.now();
  const connection = await mysql.createConnection(loadMysqlConfig());
  let lockAcquired = false;
  let transactionOpen = false;
  try {
    const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [GRID_LOCK]);
    if (lock.acquired !== 1) throw new Error('No se pudo obtener el bloqueo exclusivo para generar la cuadrícula.');
    lockAcquired = true;
    const reader = new GeoJSONReader();
    const writer = new GeoJSONWriter();
    const data = await loadDatabaseData(connection);
    const {
      cells,
      intersectingSquares,
      excludedOutsideCenter,
      discardedFragments,
      discardedAreaM2,
    } = buildGrid(data.zones, data.pointIndices, reader, writer);
    if (cells.length === 0) throw new Error('La cuadrícula no produjo celdas con centro dentro de la zonificación.');
    const frontendData = await loadFrontendData();
    validateTenPoints(cells, frontendData);

    await connection.beginTransaction();
    transactionOpen = true;
    await connection.query('DELETE FROM grid_cell_metrics');
    await connection.query('DELETE FROM grid_cell');
    await insertGrid(connection, cells);
    const repairedMysqlCells = await repairMysqlInvalidCells(connection, cells, reader, writer);
    const stored = await reportStoredGrid(connection, cells);
    const persistedValidation = validateTenPoints(stored.cells, frontendData);
    const expectedRows = cells.map((cell) => ({
      cell_key: cell.cellKey,
      centerWkt: cell.centerWkt,
      area_m2: cell.areaM2,
      ...cell.metrics,
    }));
    const storedHash = createHash('sha256').update(canonicalValues(stored.cells)).digest('hex');
    assertPersistedValues(expectedRows, stored.cells);
    await connection.commit();
    transactionOpen = false;

    console.log(`Resolución: ${GRID_SIZE_M} m; proyección: EPSG:32719; geometrías persistidas: SRID 4326.`);
    console.log(`Cuadrados que intersectan la zonificación: ${intersectingSquares}; centros fuera y excluidos: ${excludedOutsideCenter}; celdas guardadas: ${cells.length}.`);
    console.log('Política de recorte: se guarda la intersección del cuadrado con la unión zonificada; se excluye el cuadrado si su centro UTM original queda fuera de una zona.');
    console.log(`Precisión geométrica: ajuste a ${GEOMETRY_SNAP_M} m en UTM; fragmentos por zona menores que ${MIN_CLIP_FRAGMENT_M2} m² excluidos como slivers (${discardedFragments}, ${discardedAreaM2.toFixed(4)} m² acumulados).`);
    console.log(`Colegios sin nivel básico asignable excluidos de las distancias por nivel: ${data.unclassifiedEducationCount} elementos OSM.`);
    console.log('Validación de los valores leídos de MySQL contra funciones y datos locales actuales de la app (centro de la celda):');
    console.log('Punto | Diferencias salud/inicial/primaria/secundaria/transporte/área verde (m) | zona | peligros');
    for (const result of persistedValidation) {
      console.log(`${result.punto} | ${result.diferencias_m.map((difference) => difference.toFixed(6)).join('/')} | ${result.zona_ok ? 'OK' : 'ERROR'} | ${result.peligros_ok ? 'OK' : 'ERROR'}`);
    }
    console.log(`Celdas/métricas persistidas: ${stored.counts.cells}/${stored.counts.metrics}; geometrías inválidas: ${stored.counts.invalid_geom}; SRID incorrectos: ${stored.counts.wrong_srid}.`);
    console.log(`Geometrías de celda reparadas tras ST_IsValid de MySQL: ${repairedMysqlCells}.`);
    console.log(`SHA-256 de los valores persistidos ordenados por cell_key: ${storedHash}.`);
    console.log(`Generación, validación e importación: ${((performance.now() - startedAt) / 1000).toFixed(2)} s.`);
  } catch (error) {
    if (transactionOpen) await connection.rollback();
    throw error;
  } finally {
    if (lockAcquired) await connection.execute('SELECT RELEASE_LOCK(?)', [GRID_LOCK]);
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Error al generar la cuadrícula MySQL: ${error.message}`);
  process.exitCode = 1;
});
