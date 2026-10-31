import mysql from 'mysql2/promise';
import { loadMysqlConfig } from './mysql-config.mjs';

function versionMajorMinor(version) {
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) throw new Error(`No se pudo interpretar la versión del servidor MySQL: ${version}`);
  return [Number(match[1]), Number(match[2])];
}

function requireMysql8(version) {
  const [major] = versionMajorMinor(version);
  if (major < 8) {
    throw new Error(`MySQL ${version} no está soportado. Se requiere MySQL 8.0 o superior.`);
  }
}

async function main() {
  const config = loadMysqlConfig({ withDatabase: false });
  const database = process.env.DB_NAME;
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('Define DB_NAME en .env; solo puede contener letras, números y guion bajo.');
  }

  const connection = await mysql.createConnection(config);
  try {
    const [[server]] = await connection.query('SELECT VERSION() AS version');
    requireMysql8(server.version);
    console.log(`Conectado a MySQL ${server.version}.`);
    const [[existing]] = await connection.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [database],
    );
    if (existing) {
      console.log(`La base de datos \`${database}\` ya existe.`);
    } else {
      await connection.query(
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      console.log(`Base de datos \`${database}\` creada.`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Error al preparar MySQL: ${error.message}`);
  process.exitCode = 1;
});
