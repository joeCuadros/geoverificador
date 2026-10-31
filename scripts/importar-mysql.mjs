import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import { loadMysqlConfig, ROOT } from './mysql-config.mjs';

const require = createRequire(import.meta.url);
const Calculos = require(join(ROOT, 'public', 'js', 'calculos.js'));
const DATA_DIR = join(ROOT, 'public', 'data');
const REPAIR_REPORT = join(ROOT, 'scripts', 'reportes', 'reparaciones-zonificacion.json');
const BATCH_SIZE = 200;
const MAX_AREA_CHANGE_PCT = 1;
const EXPECTED = {
  zones: 793,
  health: 164,
  education: 2174,
  transport: 414,
  greenAreas: 1320,
  districts: 25,
  hazards: 394,
};
const EDUCATION_LEVEL = {
  inicial: 'initial',
  primaria: 'primary',
  secundaria: 'secondary',
};

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertFeatureCollection(data, label) {
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error(`${label}: se esperaba un GeoJSON FeatureCollection.`);
  }
}

function coordinate(value, axis) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Coordenada ${axis} inválida: ${value}.`);
  }
  const limit = axis === 'longitude' ? 180 : 90;
  if (Math.abs(value) > limit) throw new Error(`Coordenada ${axis} fuera de rango: ${value}.`);
  return String(value);
}

function pointWkt(geometry) {
  if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
    throw new Error('Se esperaba una geometría GeoJSON Point.');
  }
  const [longitude, latitude] = geometry.coordinates;
  return `POINT(${coordinate(longitude, 'longitude')} ${coordinate(latitude, 'latitude')})`;
}

function multiPolygonWkt(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error(`Geometría de superficie no compatible: ${geometry?.type || 'sin tipo'}.`);
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) throw new Error('Polígono sin anillos.');

  const ringWkt = (ring) => {
    if (!Array.isArray(ring) || ring.length < 4) throw new Error('Anillo GeoJSON incompleto.');
    const points = ring.map((point) => {
      if (!Array.isArray(point) || point.length < 2) throw new Error('Coordenada GeoJSON incompleta.');
      return `${coordinate(point[0], 'longitude')} ${coordinate(point[1], 'latitude')}`;
    });
    if (points[0] !== points[points.length - 1]) throw new Error('Anillo GeoJSON no cerrado.');
    return `(${points.join(',')})`;
  };

  return `MULTIPOLYGON(${polygons.map((polygon) => `(${polygon.map(ringWkt).join(',')})`).join(',')})`;
}

function requireCount(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label}: se esperaban ${expected} elementos, se encontraron ${actual}.`);
  }
}

function chunked(items, size = BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function insertRows(connection, table, columns, rows, geometryColumn = null) {
  if (rows.length === 0) return;
  const rowTemplate = `(${columns.map((column) => (
    column === geometryColumn
      ? "ST_GeomFromText(?, 4326, 'axis-order=long-lat')"
      : '?'
  )).join(', ')})`;

  for (const batch of chunked(rows)) {
    const values = batch.flat();
    const placeholders = batch.map(() => rowTemplate).join(', ');
    await connection.execute(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`,
      values,
    );
  }
}

function equipmentRows(sources) {
  const rowsByKey = new Map();
  const categories = [
    { source: 'health', label: 'salud', category: 'health', sourceCategory: 'salud' },
    { source: 'education', label: 'educacion', category: 'education', sourceCategory: 'educacion' },
    { source: 'transport', label: 'transporte', category: 'transport', sourceCategory: 'transporte' },
  ];
  const expected = { health: EXPECTED.health, education: EXPECTED.education, transport: EXPECTED.transport };

  for (const { source, label, category, sourceCategory } of categories) {
    const features = sources[source].features;
    requireCount(`Equipamiento ${label} en el archivo`, features.length, expected[category]);
    for (const feature of features) {
      const properties = feature.properties || {};
      const sourceId = properties.osm;
      const tags = properties.tags;
      if (typeof sourceId !== 'string' || !tags || !Calculos.categoriasDe(tags).includes(sourceCategory)) {
        throw new Error(`Equipamiento ${file}: elemento sin id OSM o que no coincide con Calculos.FILTROS.`);
      }
      const classTag = Calculos.etiquetaDe(tags, sourceCategory);
      if (!classTag) throw new Error(`No se pudo clasificar ${sourceId} con Calculos.etiquetaDe.`);
      const levels = category === 'education'
        ? Calculos.nivelesEducativos(tags).map((level) => EDUCATION_LEVEL[level])
        : [null];
      const levelRows = levels.length ? levels : [null];
      for (const educationLevel of levelRows) {
        const key = `${sourceId}|${category}|${educationLevel || 'none'}`;
        if (!rowsByKey.has(key)) {
          rowsByKey.set(key, [
            sourceId,
            category,
            classTag,
            educationLevel,
            properties.nombre || null,
            JSON.stringify(tags),
            pointWkt(feature.geometry),
          ]);
        }
      }
    }
  }

  return [...rowsByKey.values()];
}

async function loadSources() {
  const paths = {
    zones: join(DATA_DIR, 'zonas_aqp.geojson'),
    rules: join(DATA_DIR, 'reglas_zonas.json'),
    health: join(DATA_DIR, 'equipamiento', 'salud.geojson'),
    education: join(DATA_DIR, 'equipamiento', 'educacion.geojson'),
    transport: join(DATA_DIR, 'equipamiento', 'transporte.geojson'),
    greenAreas: join(DATA_DIR, 'equipamiento', 'areas_verdes.geojson'),
    districts: join(DATA_DIR, 'distritos_aqp.geojson'),
    hazards: join(DATA_DIR, 'peligros_aqp.geojson'),
  };
  const data = {};
  for (const [name, path] of Object.entries(paths)) data[name] = await readJson(path);
  for (const name of ['zones', 'health', 'education', 'transport', 'greenAreas', 'districts', 'hazards']) {
    assertFeatureCollection(data[name], name);
  }
  return data;
}

function validateSourceCounts(data) {
  requireCount('Zonificación en el archivo', data.zones.features.length, EXPECTED.zones);
  requireCount('Áreas verdes en el archivo', data.greenAreas.features.length, EXPECTED.greenAreas);
  requireCount('Distritos en el archivo', data.districts.features.length, EXPECTED.districts);
  requireCount('Peligros geológicos en el archivo', data.hazards.features.length, EXPECTED.hazards);
  if (Object.keys(data.rules).length !== 29) {
    throw new Error(`Reglas de zonificación: se esperaban 29 códigos, se encontraron ${Object.keys(data.rules).length}.`);
  }
}

function repairInvalidPolygonGeometries(features, { layer, idProperty, nameProperty, codeProperty }) {
  const reader = new GeoJSONReader();
  const writer = new GeoJSONWriter();
  const preparedFeatures = [];
  const report = [];
  const failures = [];

  features.forEach((feature, index) => {
    const properties = feature.properties || {};
    try {
      const sourceGeometry = reader.read(feature.geometry);
      sourceGeometry.setSRID(4326);
      if (IsValidOp.isValid(sourceGeometry)) {
        preparedFeatures.push(feature);
        return;
      }

      const entry = {
        tipo_capa: layer,
        id: idProperty ? properties[idProperty] ?? index + 1 : index + 1,
        nombre: properties[nameProperty] || null,
        codigo: codeProperty ? properties[codeProperty] || null : null,
        cambio_area_pct: null,
        validacion_jsts: false,
        validacion_mysql: null,
        srid: null,
        tipo_geometria: null,
      };
      const fixedGeometry = BufferOp.bufferOp(sourceGeometry, 0);
      fixedGeometry.setSRID(4326);
      const fixedGeoJson = writer.write(fixedGeometry);
      const geometryType = fixedGeometry.getGeometryType();
      const nonEmpty = !fixedGeometry.isEmpty();
      const compatibleType = ['Polygon', 'MultiPolygon'].includes(geometryType);
      const originalArea = Calculos.areaGeometriaM2(feature.geometry);
      const repairedArea = nonEmpty && compatibleType ? Calculos.areaGeometriaM2(fixedGeoJson) : NaN;
      const changePct = originalArea > 0 && Number.isFinite(repairedArea)
        ? (Math.abs(repairedArea - originalArea) / originalArea) * 100
        : Infinity;
      const valid = IsValidOp.isValid(fixedGeometry);
      const srid = fixedGeometry.getSRID();
      entry.cambio_area_pct = Number.isFinite(changePct) ? Number(changePct.toFixed(8)) : null;
      entry.validacion_jsts = valid && nonEmpty && compatibleType && srid === 4326 && changePct <= MAX_AREA_CHANGE_PCT;
      entry.srid = srid;
      entry.tipo_geometria = geometryType;
      if (!nonEmpty) entry.error = 'La geometría reparada está vacía.';
      else if (!compatibleType) entry.error = `Tipo de geometría incompatible con MULTIPOLYGON: ${geometryType}.`;
      else if (!valid) entry.error = 'JSTS IsValidOp rechazó la geometría reparada.';
      else if (srid !== 4326) entry.error = `SRID JSTS inesperado: ${srid}.`;
      else if (!Number.isFinite(changePct) || changePct > MAX_AREA_CHANGE_PCT) {
        entry.error = `Cambio de área superior a ${MAX_AREA_CHANGE_PCT} % o no calculable.`;
      }
      report.push(entry);
      preparedFeatures.push({ ...feature, geometry: fixedGeoJson });
      if (!entry.validacion_jsts) failures.push(entry);
    } catch (error) {
      const entry = {
        tipo_capa: layer,
        id: idProperty ? properties[idProperty] ?? index + 1 : index + 1,
        nombre: properties[nameProperty] || null,
        codigo: codeProperty ? properties[codeProperty] || null : null,
        cambio_area_pct: null,
        validacion_jsts: false,
        validacion_mysql: null,
        srid: null,
        tipo_geometria: null,
        error: error.message,
      };
      report.push(entry);
      failures.push(entry);
      preparedFeatures.push(feature);
    }
  });

  return { features: preparedFeatures, report, failures };
}

async function writeRepairReport(report) {
  await mkdir(join(ROOT, 'scripts', 'reportes'), { recursive: true });
  await writeFile(REPAIR_REPORT, `${JSON.stringify({
    fuentes: ['public/data/zonas_aqp.geojson', 'public/data/equipamiento/areas_verdes.geojson'],
    metodo: 'JSTS BufferOp.bufferOp(geometry, 0); validación topológica con IsValidOp y área geodésica con Calculos.areaGeometriaM2.',
    limite_cambio_area_pct: MAX_AREA_CHANGE_PCT,
    total_reparaciones: report.length,
    reparaciones: report,
  }, null, 2)}\n`);
}

function logRepairFailures(failures) {
  if (!failures.length) return;
  console.error('Polígonos no importados: falla la regla de reparación (capa, id, nombre/código, cambio de área, validación).');
  for (const entry of failures) {
    console.error(
      `  ${entry.tipo_capa}, ${entry.id}, ${entry.nombre || '(sin nombre/código)'}, ${entry.cambio_area_pct ?? 'no calculable'} %, validación JSTS=${entry.validacion_jsts}${entry.error ? ` (${entry.error})` : ''}`,
    );
  }
}

function ruleRows(rules) {
  return Object.entries(rules).map(([zoneCode, rule]) => [
    zoneCode,
    rule.nombre,
    rule.grupo,
    rule.edificable,
    rule.pisos_base,
    rule.pisos_max,
    rule.coef_base,
    rule.coef_max,
    rule.area_libre_pct === null || rule.area_libre_pct === undefined ? null : String(rule.area_libre_pct),
    rule.lote_min_m2,
    rule.frente_min_m,
    rule.nota || null,
  ]);
}

function zoneRows(features) {
  return features.map((feature, index) => {
    const properties = feature.properties || {};
    if (!properties.codigo || !properties.color) throw new Error(`Zona ${index + 1} sin código o color.`);
    return [index + 1, properties.codigo, properties.color, multiPolygonWkt(feature.geometry)];
  });
}

function greenAreaRows(features) {
  return features.map((feature) => {
    const properties = feature.properties || {};
    if (!properties.osm) throw new Error('Área verde sin identificador OSM.');
    return [
      properties.osm,
      properties.nombre || null,
      Calculos.areaGeometriaM2(feature.geometry),
      multiPolygonWkt(feature.geometry),
    ];
  });
}

function districtRows(features) {
  return features.map((feature) => {
    const properties = feature.properties || {};
    if (!properties.ubigeo || !properties.distrito || !properties.provincia || !properties.departamento) {
      throw new Error('Distrito sin ubigeo o nombre administrativo.');
    }
    return [
      String(properties.ubigeo),
      properties.distrito,
      properties.provincia,
      properties.departamento,
      properties.fuente_limite || null,
      properties.fecha_ingreso || null,
      multiPolygonWkt(feature.geometry),
    ];
  });
}

function hazardRows(features) {
  return features.map((feature) => {
    const properties = feature.properties || {};
    if (properties.id === undefined || properties.id === null) throw new Error('Peligro geológico sin id de origen.');
    return [
      String(properties.id),
      properties.tipo || null,
      properties.subtipo || null,
      properties.distrito || null,
      properties.sector || null,
      properties.anio || null,
      properties.fuente || null,
      pointWkt(feature.geometry),
    ];
  });
}

async function deleteImportedData(connection) {
  for (const table of [
    'grid_cell_metrics',
    'equipment_point',
    'green_area',
    'geologic_hazard',
    'district',
    'zone_feature',
    'zone_rule',
  ]) {
    await connection.query(`DELETE FROM ${table}`);
  }
}

async function assertValidGeometries(connection, repairs) {
  for (const table of ['zone_feature', 'equipment_point', 'green_area', 'district', 'geologic_hazard']) {
    if (table === 'zone_feature' || table === 'green_area') {
      const layer = table === 'zone_feature' ? 'zonificacion' : 'areas_verdes';
      const [invalidRows] = await connection.query(table === 'zone_feature'
        ? 'SELECT feature_number AS id, zone_code AS name FROM zone_feature WHERE NOT ST_IsValid(geom)'
        : 'SELECT source_id AS id, name FROM green_area WHERE NOT ST_IsValid(geom)');
      if (invalidRows.length) {
        const details = invalidRows.map((row) => {
          const repair = repairs.find((entry) => entry.tipo_capa === layer && String(entry.id) === String(row.id));
          if (repair) repair.validacion_mysql = false;
          const label = layer === 'zonificacion' ? `código ${row.name}` : row.name || 'sin nombre';
          return `${row.id} (${label}, ${repair?.cambio_area_pct ?? 'no calculable'} %, validación MySQL=false)`;
        });
        throw new Error(`${table}: geometrías inválidas según ST_IsValid: ${details.join('; ')}.`);
      }
    } else {
      const [[result]] = await connection.query(`SELECT COUNT(*) AS invalid_count FROM ${table} WHERE NOT ST_IsValid(geom)`);
      if (Number(result.invalid_count) !== 0) {
        throw new Error(`${table}: ${result.invalid_count} geometrías inválidas según ST_IsValid.`);
      }
    }
    const layer = table === 'zone_feature' ? 'zonificacion' : table === 'green_area' ? 'areas_verdes' : null;
    if (layer) {
      for (const repair of repairs.filter((entry) => entry.tipo_capa === layer)) {
        repair.validacion_mysql = true;
      }
    }
  }
}

async function reportCounts(connection, sources) {
  const [[zoneCount]] = await connection.query('SELECT COUNT(*) AS n FROM zone_feature');
  const [[ruleCount]] = await connection.query('SELECT COUNT(*) AS n FROM zone_rule');
  const [[greenCount]] = await connection.query('SELECT COUNT(*) AS n FROM green_area');
  const [[districtCount]] = await connection.query('SELECT COUNT(*) AS n FROM district');
  const [[hazardCount]] = await connection.query('SELECT COUNT(*) AS n FROM geologic_hazard');
  const [equipmentCounts] = await connection.query(`
    SELECT category, COUNT(DISTINCT source_id) AS source_features, COUNT(*) AS rows_by_level
    FROM equipment_point
    GROUP BY category
    ORDER BY category
  `);
  const counts = {
    zones: Number(zoneCount.n),
    rules: Number(ruleCount.n),
    greenAreas: Number(greenCount.n),
    districts: Number(districtCount.n),
    hazards: Number(hazardCount.n),
  };
  requireCount('Zonificación importada', counts.zones, EXPECTED.zones);
  requireCount('Reglas importadas', counts.rules, 29);
  requireCount('Áreas verdes importadas', counts.greenAreas, EXPECTED.greenAreas);
  requireCount('Distritos importados', counts.districts, EXPECTED.districts);
  requireCount('Peligros geológicos importados', counts.hazards, EXPECTED.hazards);

  const byCategory = Object.fromEntries(equipmentCounts.map((row) => [row.category, {
    sourceFeatures: Number(row.source_features),
    rowsByLevel: Number(row.rows_by_level),
  }]));
  for (const [category, expected] of Object.entries({
    health: EXPECTED.health,
    education: EXPECTED.education,
    transport: EXPECTED.transport,
  })) {
    requireCount(`Equipamiento ${category} (features OSM distintos)`, byCategory[category]?.sourceFeatures || 0, expected);
  }

  console.log('Conteos importados:');
  console.log(`  zone_feature: ${counts.zones} (esperado ${EXPECTED.zones})`);
  console.log(`  zone_rule: ${counts.rules} (esperado 29)`);
  for (const [category, expected] of Object.entries({
    health: EXPECTED.health,
    education: EXPECTED.education,
    transport: EXPECTED.transport,
  })) {
    console.log(`  equipment_point/${category}: ${byCategory[category].sourceFeatures} features OSM; ${byCategory[category].rowsByLevel} filas (esperado ${expected} features)`);
  }
  console.log(`  green_area: ${counts.greenAreas} (esperado ${EXPECTED.greenAreas})`);
  console.log(`  district: ${counts.districts} (esperado ${EXPECTED.districts})`);
  console.log(`  geologic_hazard: ${counts.hazards} (esperado ${EXPECTED.hazards})`);
  console.log(`  grid_cell / grid_cell_metrics: conservadas sin precálculo; fuente con ${sources.zones.features.length} zonas.`);
  return byCategory;
}

async function compareNearestHospital(connection, healthFeatures) {
  const pointWktValue = 'POINT(-71.53697 -16.39883)';
  const point = { lat: -16.39883, lon: -71.53697 };
  let appNearest = null;
  for (const feature of healthFeatures) {
    const properties = feature.properties || {};
    const [lon, lat] = feature.geometry.coordinates;
    const distance = Calculos.haversine(point.lat, point.lon, lat, lon);
    if (!appNearest || distance < appNearest.distance) {
      appNearest = { sourceId: properties.osm, name: properties.nombre, distance };
    }
  }

  const [[mysqlNearest]] = await connection.execute(`
    SELECT source_id, name,
      ST_Distance_Sphere(
        geom,
        ST_GeomFromText(?, 4326, 'axis-order=long-lat'),
        6371008.8
      ) AS distance_m
    FROM equipment_point
    WHERE category = 'health'
    ORDER BY distance_m
    LIMIT 1
  `, [pointWktValue]);
  if (!mysqlNearest || !appNearest) throw new Error('No se pudo calcular el hospital más cercano.');

  const mysqlDistance = Number(mysqlNearest.distance_m);
  const difference = Math.abs(mysqlDistance - appNearest.distance);
  console.log('Comparación del hospital más cercano desde Plaza de Armas (-16.39883, -71.53697):');
  console.log(`  App (Calculos.haversine): ${appNearest.name || appNearest.sourceId}, ${appNearest.distance.toFixed(3)} m`);
  console.log(`  MySQL (ST_Distance_Sphere, R=6371008.8): ${mysqlNearest.name || mysqlNearest.source_id}, ${mysqlDistance.toFixed(3)} m`);
  console.log(`  Diferencia absoluta: ${difference.toFixed(6)} m`);
  if (mysqlNearest.source_id !== appNearest.sourceId || difference > 0.05) {
    throw new Error('La distancia o el elemento más cercano difiere de la lógica actual de la app (> 5 cm o id distinto).');
  }
}

async function main() {
  const sources = await loadSources();
  validateSourceCounts(sources);
  const zoneRepair = repairInvalidPolygonGeometries(sources.zones.features, {
    layer: 'zonificacion',
    idProperty: null,
    nameProperty: 'codigo',
    codeProperty: 'codigo',
  });
  const greenAreaRepair = repairInvalidPolygonGeometries(sources.greenAreas.features, {
    layer: 'areas_verdes',
    idProperty: 'osm',
    nameProperty: 'nombre',
    codeProperty: null,
  });
  const repairs = [...zoneRepair.report, ...greenAreaRepair.report];
  await writeRepairReport(repairs);
  const failures = [...zoneRepair.failures, ...greenAreaRepair.failures];
  if (failures.length) {
    logRepairFailures(failures);
    throw new Error('No se importó ninguna tabla: una o más reparaciones exceden el límite o no son válidas.');
  }
  const equipment = equipmentRows(sources);
  const rules = ruleRows(sources.rules);
  const zones = zoneRows(zoneRepair.features);
  const greenAreas = greenAreaRows(greenAreaRepair.features);
  const districts = districtRows(sources.districts.features);
  const hazards = hazardRows(sources.hazards.features);
  const connection = await mysql.createConnection(loadMysqlConfig());

  try {
    await connection.beginTransaction();
    await deleteImportedData(connection);

    await insertRows(connection, 'zone_rule', [
      'zone_code', 'name', 'group_name', 'buildability', 'floors_base', 'floors_max',
      'coefficient_base', 'coefficient_max', 'open_space_pct', 'min_lot_m2', 'min_front_m', 'note',
    ], rules);
    await insertRows(connection, 'zone_feature', [
      'feature_number', 'zone_code', 'color', 'geom',
    ], zones, 'geom');
    await insertRows(connection, 'equipment_point', [
      'source_id', 'category', 'class_tag', 'education_level', 'name', 'tags', 'geom',
    ], equipment, 'geom');
    await insertRows(connection, 'green_area', [
      'source_id', 'name', 'area_m2', 'geom',
    ], greenAreas, 'geom');
    await insertRows(connection, 'district', [
      'ubigeo', 'name', 'province', 'department', 'boundary_source', 'boundary_date', 'geom',
    ], districts, 'geom');
    await insertRows(connection, 'geologic_hazard', [
      'source_id', 'kind', 'subtype', 'district_name', 'sector', 'event_year', 'source_name', 'geom',
    ], hazards, 'geom');

    await assertValidGeometries(connection, repairs);
    const categoryCounts = await reportCounts(connection, sources);
    await compareNearestHospital(connection, sources.health.features);
    await connection.commit();
    await writeRepairReport(repairs);
    console.log(`Polígonos reparados y validados: zonificación ${zoneRepair.report.length}, áreas verdes ${greenAreaRepair.report.length}.`);
    console.log(`Reporte: ${REPAIR_REPORT}.`);
    console.log('Importación confirmada; todas las tablas recargadas dentro de una transacción.');
    return categoryCounts;
  } catch (error) {
    await connection.rollback();
    await writeRepairReport(repairs);
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Error al importar datos a MySQL: ${error.message}`);
  process.exitCode = 1;
});
