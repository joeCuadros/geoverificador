import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { loadMysqlConfig, ROOT } from './mysql-config.mjs';

const MIGRATIONS_DIR = join(ROOT, 'src', 'database', 'migrations');
const LOCK_NAME = 'geoverificador:migraciones';

function splitStatements(sql) {
  return sql.split(';').map((statement) => statement.trim()).filter(Boolean);
}

function indexDefinition(statement) {
  const match = statement.match(
    /^CREATE\s+(?:SPATIAL\s+)?INDEX\s+`?([A-Za-z0-9_]+)`?\s+ON\s+`?([A-Za-z0-9_]+)`?/i,
  );
  return match ? { index: match[1], table: match[2] } : null;
}

async function ensureMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (migration_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function applyStatement(connection, statement) {
  const definition = indexDefinition(statement);
  if (definition) {
    const [[existing]] = await connection.execute(
      `SELECT 1 AS present
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
       LIMIT 1`,
      [definition.table, definition.index],
    );
    if (existing) return false;
  }
  await connection.query(statement);
  return true;
}

async function main() {
  const connection = await mysql.createConnection(loadMysqlConfig());
  let lockAcquired = false;
  try {
    const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [LOCK_NAME]);
    if (lock.acquired !== 1) throw new Error('No se pudo obtener el bloqueo para ejecutar migraciones.');
    lockAcquired = true;
    await ensureMigrationTable(connection);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();
    if (files.length === 0) throw new Error(`No hay migraciones SQL en ${MIGRATIONS_DIR}.`);

    for (const filename of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const [[applied]] = await connection.execute(
        'SELECT checksum FROM schema_migrations WHERE migration_name = ?',
        [filename],
      );
      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(`La migración aplicada ${filename} fue modificada; crea una migración nueva en vez de editarla.`);
        }
        console.log(`Sin cambios: ${filename}`);
        continue;
      }

      for (const statement of splitStatements(sql)) {
        await applyStatement(connection, statement);
      }
      await connection.execute(
        'INSERT INTO schema_migrations (migration_name, checksum) VALUES (?, ?)',
        [filename, checksum],
      );
      console.log(`Aplicada: ${filename}`);
    }
  } finally {
    if (lockAcquired) await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Error al ejecutar migraciones MySQL: ${error.message}`);
  process.exitCode = 1;
});
