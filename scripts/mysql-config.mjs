import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = join(ROOT, '.env');

export function loadMysqlConfig({ withDatabase = true } = {}) {
  if (existsSync(ENV_PATH)) {
    process.loadEnvFile(ENV_PATH);
  }

  const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD'];
  if (withDatabase) required.push('DB_NAME');
  const missing = required.filter((key) => process.env[key] === undefined || process.env[key].trim() === '');
  if (missing.length) {
    throw new Error(`Faltan variables ${missing.join(', ')}. Copia .env.example a .env y complétalo.`);
  }

  const port = Number(process.env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT debe ser un puerto válido entre 1 y 65535.');
  }

  const database = process.env.DB_NAME;
  if (withDatabase && !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('DB_NAME solo puede contener letras, números y guion bajo.');
  }

  return {
    host: process.env.DB_HOST,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ...(withDatabase ? { database } : {}),
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  };
}
