/**
 * preparar-base.ts — Arma una vez la base de pruebas: PostgreSQL + PostGIS embebido (PGlite) con las migraciones y los archivos de public/data.
 * Las pruebas la abren con `baseDePrueba()`. Vive en una carpeta temporal que se borra al terminar.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBase } from '../src/cliente.ts';
import { cargarTodo } from '../src/cargar.ts';
import { migrar } from '../src/migrar.ts';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DATOS = path.join(RAIZ, 'public', 'data');

export default async function preparar() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'geoverificador-pruebas-'));
  const url = `pglite://${carpeta}`;
  const base = await abrirBase(url);
  await migrar(base);
  await cargarTodo(base, DATOS);
  await base.cerrar();
  process.env.BASE_DE_PRUEBA = url;
  return () => fs.rmSync(carpeta, { recursive: true, force: true });
}
