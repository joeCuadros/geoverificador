/**
 * cliente.ts — Una sola forma de hablar con la base, sea PostgreSQL real o PGlite (PostgreSQL + PostGIS embebido, sin servidor).
 *
 *   DATABASE_URL=postgres://…        producción y vista previa (proveedor del Marketplace de Vercel) o un PostGIS local
 *   DATABASE_URL=pglite://.pglite    desarrollo sin Docker: la base vive en esa carpeta
 *   DATABASE_URL=pglite://memoria    pruebas: en memoria
 */
import path from 'node:path';

export type Fila = Record<string, any>;

export interface Base {
  /** Ejecuta una consulta con parámetros ($1, $2…) y devuelve las filas. */
  consulta<T extends Fila = Fila>(sql: string, parametros?: unknown[]): Promise<T[]>;
  /** Ejecuta varias sentencias sin parámetros (migraciones). */
  ejecutar(sql: string): Promise<void>;
  /** Corre `trabajo` dentro de una transacción: si lanza, no queda nada escrito. */
  transaccion<T>(trabajo: (tx: Base) => Promise<T>): Promise<T>;
  cerrar(): Promise<void>;
  readonly motor: 'postgres' | 'pglite';
}

export class ErrorDeBase extends Error {}

/** Abre la base que indique `url` (por omisión, DATABASE_URL). */
export async function abrirBase(url: string | undefined = process.env.DATABASE_URL): Promise<Base> {
  if (!url) throw new ErrorDeBase('Falta DATABASE_URL. Para desarrollo sin servidor use DATABASE_URL=pglite://.pglite');
  if (url.startsWith('pglite://')) return abrirPglite(url.slice('pglite://'.length));
  if (/^postgres(ql)?:\/\//.test(url)) return abrirPostgres(url);
  throw new ErrorDeBase('DATABASE_URL debe empezar con postgres:// o pglite://');
}

async function abrirPglite(destino: string): Promise<Base> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { postgis } = await import('@electric-sql/pglite-postgis');
  const carpeta = destino === 'memoria' || destino === '' ? undefined : path.resolve(destino);
  const db = await PGlite.create({ dataDir: carpeta, extensions: { postgis } });
  const envolver = (c: { query: (sql: string, p?: any[]) => Promise<{ rows: any[] }>; exec: (sql: string) => Promise<unknown> }, raiz: boolean): Base => ({
    motor: 'pglite',
    consulta: async (sql, parametros = []) => (await c.query(sql, parametros as any[])).rows,
    ejecutar: async (sql) => {
      await c.exec(sql);
    },
    transaccion: (trabajo) => (raiz ? (db.transaction((tx) => trabajo(envolver(tx as any, false))) as Promise<any>) : trabajo(envolver(c, false))),
    cerrar: async () => {
      if (raiz) await db.close();
    },
  });
  return envolver(db as any, true);
}

async function abrirPostgres(url: string): Promise<Base> {
  const pg = await import('pg');
  const Pool = pg.default?.Pool ?? (pg as any).Pool;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({ connectionString: url, max: Number(process.env.PGPOOL_MAX || 5), ssl: local || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: true } });
  const envolver = (c: { query: (sql: string, p?: any[]) => Promise<{ rows: any[] }> }): Omit<Base, 'transaccion' | 'cerrar'> => ({
    motor: 'postgres',
    consulta: async (sql, parametros = []) => (await c.query(sql, parametros as any[])).rows,
    ejecutar: async (sql) => {
      await c.query(sql);
    },
  });
  return {
    ...envolver(pool),
    transaccion: async (trabajo) => {
      const cliente = await pool.connect();
      const tx: Base = { ...envolver(cliente), transaccion: (t) => t(tx), cerrar: async () => {} };
      try {
        await cliente.query('BEGIN');
        const r = await trabajo(tx);
        await cliente.query('COMMIT');
        return r;
      } catch (e) {
        await cliente.query('ROLLBACK');
        throw e;
      } finally {
        cliente.release();
      }
    },
    cerrar: () => pool.end(),
  };
}
