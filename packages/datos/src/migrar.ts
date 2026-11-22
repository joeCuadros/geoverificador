/**
 * migrar.ts — Migraciones versionadas (tarea 2.1). Cada archivo de packages/datos/migraciones se aplica una vez, en orden y en una transacción.
 * Una migración ya aplicada no se edita: se escribe otra. Si el contenido de una aplicada cambió, migrar() se detiene.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Base } from './cliente.ts';

export const CARPETA_MIGRACIONES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migraciones');

export interface Migracion {
  nombre: string;
  sql: string;
  sha256: string;
}

export function leerMigraciones(carpeta: string = CARPETA_MIGRACIONES): Migracion[] {
  return fs
    .readdirSync(carpeta)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((nombre) => {
      const sql = fs.readFileSync(path.join(carpeta, nombre), 'utf8').replace(/\r\n/g, '\n');
      return { nombre, sql, sha256: createHash('sha256').update(sql).digest('hex') };
    });
}

/** Aplica las migraciones pendientes. Devuelve los nombres de las que aplicó. */
export async function migrar(base: Base, migraciones: Migracion[] = leerMigraciones()): Promise<string[]> {
  await base.ejecutar('CREATE TABLE IF NOT EXISTS migracion (nombre text PRIMARY KEY, sha256 text NOT NULL, aplicada_en timestamptz NOT NULL DEFAULT now())');
  const hechas = new Map((await base.consulta<{ nombre: string; sha256: string }>('SELECT nombre, sha256 FROM migracion')).map((m) => [m.nombre, m.sha256]));
  const aplicadas: string[] = [];
  for (const m of migraciones) {
    const previa = hechas.get(m.nombre);
    if (previa === m.sha256) continue;
    if (previa) throw new Error(`La migración ${m.nombre} ya se aplicó y su contenido cambió. No se edita una migración aplicada: escriba una nueva.`);
    await base.transaccion(async (tx) => {
      await tx.ejecutar(m.sql);
      await tx.consulta('INSERT INTO migracion (nombre, sha256) VALUES ($1, $2)', [m.nombre, m.sha256]);
    });
    aplicadas.push(m.nombre);
  }
  return aplicadas;
}
