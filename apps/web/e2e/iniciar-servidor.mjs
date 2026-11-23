/**
 * Arma una base nueva y arranca la aplicación para las pruebas de extremo a extremo (lo invoca `webServer` de playwright.config.ts).
 *
 *  1. Borra y recrea `.pglite-e2e/` (en la raíz del repositorio, ignorada por git): migra, carga `apps/estatica/public/data` y guarda los avisos de `e2e/datos/avisos.json`
 *     con la misma función de ingesta que usa `pnpm avisos:ingerir`. No usa `data/`.
 *  2. Compila la aplicación en `.next-e2e/` (no toca la `.next/` de un servidor de desarrollo) y la sirve con `next start`.
 *
 * Levanta tres servidores (puertos E2E_PUERTO, +1 y +2): el principal (AVISOS_PUBLICAR=todas), uno sin publicar (la configuración por omisión del ADR 0002,
 * sobre una copia de la base) y uno degradado (base vacía y límites bajos, para los errores internos y el 429).
 *
 * Variables: E2E_PUERTO (3210 por omisión), E2E_SIN_COMPILAR=1 reutiliza la compilación anterior de `.next-e2e/`.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ = path.resolve(WEB, '..', '..');
const CARPETA_BASE = path.join(RAIZ, '.pglite-e2e');
const CARPETA_SIN_PUBLICAR = path.join(RAIZ, '.pglite-e2e-sin-publicar');
const PUERTO = process.env.E2E_PUERTO ?? '3210';
const NEXT = path.join(WEB, 'node_modules', 'next', 'dist', 'bin', 'next');

const pathToUrl = (p) => pathToFileURL(p).href;
const { abrirBase } = await import(pathToUrl(path.join(RAIZ, 'packages/datos/src/cliente.ts')));
const { migrar } = await import(pathToUrl(path.join(RAIZ, 'packages/datos/src/migrar.ts')));
const { cargarTodo } = await import(pathToUrl(path.join(RAIZ, 'packages/datos/src/cargar.ts')));
const { ingerirCorrida } = await import(pathToUrl(path.join(RAIZ, 'packages/datos/src/avisos.ts')));

async function prepararBase() {
  fs.rmSync(CARPETA_BASE, { recursive: true, force: true });
  const base = await abrirBase(`pglite://${CARPETA_BASE}`);
  try {
    await migrar(base);
    await cargarTodo(base, path.join(RAIZ, 'apps', 'estatica', 'public', 'data'));
    const ahora = new Date();
    const avisos = JSON.parse(fs.readFileSync(path.join(WEB, 'e2e', 'datos', 'avisos.json'), 'utf8')).map((a) => ({ ...a, fecha_captura: ahora.toISOString() }));
    const r = await ingerirCorrida(base, avisos, { ahora, fuentes: ['urbania'], tipoCambio: null });
    console.log(`[e2e] Base lista en ${CARPETA_BASE}: ${r.nuevos} avisos de prueba, ${r.conEntorno} con ficha de entorno.`);
  } finally {
    await base.cerrar();
  }
  // PGlite admite un solo proceso por carpeta: el servidor «sin publicar» usa una copia.
  fs.rmSync(CARPETA_SIN_PUBLICAR, { recursive: true, force: true });
  fs.cpSync(CARPETA_BASE, CARPETA_SIN_PUBLICAR, { recursive: true });
}

const entornoBase = { ...process.env, NEXT_DIST_DIR: '.next-e2e', NEXT_TELEMETRY_DISABLED: '1', AGENTE_LIMITE_HORA: '100000', FICHA_LIMITE_HORA: '100000', BUSCAR_LIMITE_HORA: '100000' };
delete entornoBase.AVISOS_PUBLICAR;

/** Las tres configuraciones: principal (publicación activada), sin publicar (ADR 0002 por omisión) y degradada (sin base y con límites bajos). */
const servidores = [
  { nombre: 'sin publicar', puerto: Number(PUERTO) + 1, entorno: { ...entornoBase, DATABASE_URL: `pglite://${CARPETA_SIN_PUBLICAR}` } },
  // Base vacía en memoria: toda consulta falla (error interno real) y los límites bajos permiten probar el 429.
  { nombre: 'degradado', puerto: Number(PUERTO) + 2, entorno: { ...entornoBase, DATABASE_URL: 'pglite://memoria', AGENTE_LIMITE_HORA: '4', FICHA_LIMITE_HORA: '4', BUSCAR_LIMITE_HORA: '4' } },
  { nombre: 'principal', puerto: Number(PUERTO), entorno: { ...entornoBase, DATABASE_URL: `pglite://${CARPETA_BASE}`, AVISOS_PUBLICAR: 'todas' } },
];

await prepararBase();

if (process.env.E2E_SIN_COMPILAR !== '1') {
  console.log('[e2e] Compilando la aplicación (next build)…');
  const r = spawnSync(process.execPath, [NEXT, 'build'], { cwd: WEB, env: servidores[2].entorno, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const hijos = [];
const terminar = (codigo) => {
  for (const h of hijos) h.kill();
  process.exit(codigo);
};
for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => terminar(0));

async function esperar(puerto) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${puerto}/`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`El servidor del puerto ${puerto} no respondió.`);
}

// El principal va al final: Playwright espera su URL, así que cuando responde ya están listos los otros.
for (const sv of servidores) {
  console.log(`[e2e] Servidor «${sv.nombre}» en el puerto ${sv.puerto}.`);
  const hijo = spawn(process.execPath, [NEXT, 'start', '-p', String(sv.puerto), '-H', '127.0.0.1'], { cwd: WEB, env: sv.entorno, stdio: 'inherit' });
  hijo.on('exit', (codigo) => terminar(codigo ?? 1));
  hijos.push(hijo);
  await esperar(sv.puerto);
}
