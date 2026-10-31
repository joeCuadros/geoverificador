import {
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import mysql from 'mysql2/promise';
import Flatbush from 'flatbush';
import { loadMysqlConfig } from '../../scripts/mysql-config.mjs';
import {
  prepareProjectedGeometries,
  searchZones,
  type Buildability,
  type Coordinate,
  type GeoJsonGeometry,
  type NestedCoordinates,
  type SearchCell,
  type SearchParameters,
  type ZoneSearchResult,
} from './zonas-buscar.logic';

interface DatasetStateRow extends RowDataPacket {
  cell_count: number;
  max_cell_id: number | string | null;
  district_count: number;
  max_district_id: number | string | null;
  data_date: Date | string | null;
}

interface GridMetricRow extends RowDataPacket {
  cell_key: string;
  geometry_json: string | GeoJsonGeometry;
  area_m2: number | string;
  health_distance_m: number | string | null;
  school_initial_distance_m: number | string | null;
  school_primary_distance_m: number | string | null;
  school_secondary_distance_m: number | string | null;
  transit_distance_m: number | string | null;
  green_5000_distance_m: number | string | null;
  zone_code: string | null;
  buildability: Buildability | null;
  center_lon: number | string;
  center_lat: number | string;
}

interface DistrictRow extends RowDataPacket {
  name: string;
  geometry_json: string | GeoJsonGeometry;
}

interface DistrictBoundary {
  name: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  edges: DistrictEdge[];
  edgeIndex: Flatbush;
}

interface DistrictEdge {
  start: Coordinate;
  end: Coordinate;
}

interface GridSnapshot {
  cells: SearchCell[];
  fingerprint: string;
  dataDate: string;
}

const GRID_ROWS_QUERY = `
  SELECT c.cell_key, ST_AsGeoJSON(c.geom, 7) AS geometry_json, c.area_m2,
    m.health_distance_m, m.school_initial_distance_m, m.school_primary_distance_m,
    m.school_secondary_distance_m, m.transit_distance_m, m.green_5000_distance_m,
    m.zone_code, m.buildability, m.calculated_at,
    ST_Longitude(c.center) AS center_lon, ST_Latitude(c.center) AS center_lat
  FROM grid_cell c
  JOIN grid_cell_metrics m ON m.cell_id = c.id
  ORDER BY c.cell_key
`;

@Injectable()
export class ZonasService implements OnModuleDestroy {
  private pool: Pool | null = null;
  private snapshot: GridSnapshot | null = null;
  private loadingSnapshot: Promise<GridSnapshot> | null = null;

  async buscar(parameters: SearchParameters): Promise<ZoneSearchResult> {
    const snapshot = await this.getSnapshot();
    return searchZones(snapshot.cells, parameters, snapshot.dataDate);
  }

  async warmCache(): Promise<void> {
    await this.getSnapshot();
  }

  invalidateCache(): void {
    this.snapshot = null;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
  }

  private async getSnapshot(): Promise<GridSnapshot> {
    if (this.loadingSnapshot) return this.loadingSnapshot;
    this.loadingSnapshot = this.refreshSnapshot();
    try {
      return await this.loadingSnapshot;
    } finally {
      this.loadingSnapshot = null;
    }
  }

  private async refreshSnapshot(): Promise<GridSnapshot> {
    const pool = this.getPool();
    let state: DatasetStateRow | undefined;
    try {
      const [rows] = await pool.query<DatasetStateRow[]>(`
        SELECT COUNT(*) AS cell_count, MAX(c.id) AS max_cell_id,
          MAX(m.calculated_at) AS data_date,
          (SELECT COUNT(*) FROM district) AS district_count,
          (SELECT MAX(id) FROM district) AS max_district_id
        FROM grid_cell c
        JOIN grid_cell_metrics m ON m.cell_id = c.id
      `);
      state = rows[0];
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo consultar la cuadrícula. Verifica que MySQL esté disponible y que las migraciones y métricas estén cargadas.',
      );
    }
    const cellCount = Number(state?.cell_count ?? 0);
    if (cellCount === 0 || !state?.data_date) {
      throw new ServiceUnavailableException(
        'La cuadrícula de búsqueda aún no está cargada. Ejecuta las migraciones y pnpm db:grid.',
      );
    }
    const dataDate = state.data_date instanceof Date
      ? state.data_date.toISOString()
      : new Date(state.data_date).toISOString();
    const fingerprint = [
      cellCount,
      state.max_cell_id ?? 0,
      state.district_count,
      state.max_district_id ?? 0,
      dataDate,
    ].join(':');
    if (this.snapshot?.fingerprint === fingerprint) return this.snapshot;

    let rows: GridMetricRow[];
    try {
      [rows] = await pool.query<GridMetricRow[]>(GRID_ROWS_QUERY);
    } catch {
      throw new ServiceUnavailableException(
        'No se pudieron cargar las métricas de búsqueda desde MySQL.',
      );
    }
    if (rows.length !== cellCount) {
      throw new ServiceUnavailableException(
        'La cuadrícula tiene celdas sin métricas. Ejecuta nuevamente pnpm db:grid.',
      );
    }

    let cells: SearchCell[];
    const districts = await this.loadDistrictBoundaries(pool);
    try {
      cells = rows.map((row) => ({
        cellKey: row.cell_key,
        geometry: parseGeometry(row.geometry_json),
        areaM2: finiteNonNegative(row.area_m2, 'área de celda'),
        buildability: row.buildability,
        zoneCode: row.zone_code,
        districts: districtNamesAt(
          finiteCoordinate(row.center_lon, 'longitud'),
          finiteCoordinate(row.center_lat, 'latitud'),
          districts,
        ),
        healthDistanceM: nullableDistance(row.health_distance_m, 'salud'),
        initialDistanceM: nullableDistance(row.school_initial_distance_m, 'colegio inicial'),
        primaryDistanceM: nullableDistance(row.school_primary_distance_m, 'colegio primaria'),
        secondaryDistanceM: nullableDistance(row.school_secondary_distance_m, 'colegio secundaria'),
        transitDistanceM: nullableDistance(row.transit_distance_m, 'paradero'),
        greenDistanceM: nullableDistance(row.green_5000_distance_m, 'área verde'),
      }));
      prepareProjectedGeometries(cells);
    } catch {
      throw new InternalServerErrorException(
        'La cuadrícula contiene geometrías o métricas inválidas y no se puede generar la búsqueda.',
      );
    }

    this.snapshot = { cells, fingerprint, dataDate };
    return this.snapshot;
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;
    try {
      this.pool = mysql.createPool({ ...loadMysqlConfig(), connectTimeout: 2000 });
      return this.pool;
    } catch {
      throw new ServiceUnavailableException(
        'Falta configurar la conexión MySQL. Completa las variables DB_* en .env.',
      );
    }
  }

  private async loadDistrictBoundaries(pool: Pool): Promise<DistrictBoundary[]> {
    let rows: DistrictRow[];
    try {
      [rows] = await pool.query<DistrictRow[]>(`
        SELECT name, ST_AsGeoJSON(geom, 7) AS geometry_json
        FROM district
        ORDER BY name
      `);
    } catch {
      throw new ServiceUnavailableException('No se pudieron cargar los límites distritales desde MySQL.');
    }
    if (rows.length === 0) {
      throw new ServiceUnavailableException('No hay límites distritales cargados en MySQL.');
    }

    try {
      return rows.flatMap((row) => {
        const geometry = parseGeometry(row.geometry_json);
        return polygonsOfGeoJson(geometry).map((polygon) => indexDistrictPolygon(row.name, polygon));
      });
    } catch {
      throw new InternalServerErrorException('Los límites distritales contienen geometrías inválidas.');
    }
  }
}

function parseGeometry(value: string | GeoJsonGeometry): GeoJsonGeometry {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('type' in parsed)
    || !('coordinates' in parsed)
    || !['Polygon', 'MultiPolygon'].includes(String(parsed.type))
  ) {
    throw new Error('La geometría de celda no es Polygon ni MultiPolygon.');
  }
  return parsed as GeoJsonGeometry;
}

function finiteNonNegative(value: number | string, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`El valor de ${label} no es válido.`);
  return numeric;
}

function nullableDistance(value: number | string | null, criterion: string): number | null {
  if (value === null) return null;
  return finiteNonNegative(value, `distancia de ${criterion}`);
}

function finiteCoordinate(value: number | string, axis: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`La coordenada ${axis} de celda no es válida.`);
  return numeric;
}

function districtNamesAt(
  longitude: number,
  latitude: number,
  districts: DistrictBoundary[],
): string[] {
  return [...new Set(districts
    .filter((district) =>
      longitude >= district.minX
      && longitude <= district.maxX
      && latitude >= district.minY
      && latitude <= district.maxY
      && polygonContainsPoint(district, longitude, latitude),
    )
    .map((district) => district.name))];
}

function polygonsOfGeoJson(geometry: GeoJsonGeometry): NestedCoordinates[][] {
  return geometry.type === 'Polygon'
    ? [geometry.coordinates as NestedCoordinates[]]
    : geometry.coordinates as NestedCoordinates[][];
}

function indexDistrictPolygon(name: string, coordinates: NestedCoordinates[]): DistrictBoundary {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const rings = coordinates as Coordinate[][];
  const edges: DistrictEdge[] = [];
  for (const ring of rings) {
    for (let index = 1; index < ring.length; index += 1) {
      const start = ring[index - 1];
      const end = ring[index];
      bounds[0] = Math.min(bounds[0], start[0], end[0]);
      bounds[1] = Math.min(bounds[1], start[1], end[1]);
      bounds[2] = Math.max(bounds[2], start[0], end[0]);
      bounds[3] = Math.max(bounds[3], start[1], end[1]);
      edges.push({ start, end });
    }
  }
  if (edges.length === 0 || bounds.some((value) => !Number.isFinite(value))) {
    throw new Error(`El distrito ${name} no contiene anillos válidos.`);
  }
  const edgeIndex = new Flatbush(edges.length);
  for (const edge of edges) {
    edgeIndex.add(
      Math.min(edge.start[0], edge.end[0]),
      Math.min(edge.start[1], edge.end[1]),
      Math.max(edge.start[0], edge.end[0]),
      Math.max(edge.start[1], edge.end[1]),
    );
  }
  edgeIndex.finish();
  return {
    name,
    minX: bounds[0],
    minY: bounds[1],
    maxX: bounds[2],
    maxY: bounds[3],
    edges,
    edgeIndex,
  };
}

function polygonContainsPoint(polygon: DistrictBoundary, longitude: number, latitude: number): boolean {
  let inside = false;
  for (const edgeIndex of polygon.edgeIndex.search(longitude, latitude, polygon.maxX, latitude)) {
    const edge = polygon.edges[edgeIndex];
    const [currentLongitude, currentLatitude] = edge.start;
    const [previousLongitude, previousLatitude] = edge.end;
    if (
      (currentLatitude > latitude) !== (previousLatitude > latitude)
      && longitude < (
        ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
        / (previousLatitude - currentLatitude)
      ) + currentLongitude
    ) {
      inside = !inside;
    }
  }
  return inside;
}
