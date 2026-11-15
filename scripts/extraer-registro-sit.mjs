/**
 * extraer-registro-sit.mjs — Congela el registro OFICIAL del Sistema Integrado de Transporte (SIT) de Arequipa que publica la Municipalidad Provincial de Arequipa en
 *   public/data/sit_registro_oficial.json   (unidades de negocio C-1A a C-11: nombre, concesionario, rutas que las componen y su longitud)
 *
 * Fuente: «Anexos» de las bases integradas de la tercera licitación de operación de rutas del SIT (2017-06-08) y contratos de concesión, publicados por la MPA en
 *   https://www.muniarequipa.gob.pe/sistema_transporte/
 *   https://www.muniarequipa.gob.pe/descargas/transportes/operaciones/anexos_08_06_2017.pdf
 * Es el registro de 2017. La Ordenanza N.° 1355-MPA (2024-12-26, El Peruano 2025-01-25) aprobó el Plan de Optimización de Rutas (97 circuitos según la prensa) y lo cambió,
 * pero ni el plan ni sus anexos están publicados en el portal de la MPA ni en El Peruano: por eso este archivo dice «2017» y no se usa como lista vigente.
 *
 * Uso:   node scripts/extraer-registro-sit.mjs      (o: pnpm datos:sit)       Necesita `pdftotext` (poppler) en el PATH.
 * Qué hace: baja el PDF (tiempo máximo, reintentos, caché en .cache-sit/), lo pasa a texto, lee con scripts/lib/registro-sit.js la tabla de rutas por unidad y la matriz
 * de longitudes, y escribe el JSON con su `metadata`. Si algo falla (red, sin `pdftotext`, tabla que cambió) NO escribe nada y sale con código 1.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Reg = require('./lib/registro-sit.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(RAIZ, '.cache-sit');
const SALIDA = join(RAIZ, 'public', 'data', 'sit_registro_oficial.json');
const PAGINA = 'https://www.muniarequipa.gob.pe/sistema_transporte/';
const BASE = 'https://www.muniarequipa.gob.pe/descargas/transportes/operaciones/';
const ANEXOS = `${BASE}anexos_08_06_2017.pdf`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'; // el portal de la MPA responde mejor a un navegador
const TIMEOUT_MS = 180000;
const REINTENTOS = 3;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function bajar() {
  mkdirSync(CACHE, { recursive: true });
  const ruta = join(CACHE, 'anexos_08_06_2017.pdf');
  if (existsSync(ruta)) return ruta;
  let ultimo = null;
  for (let i = 1; i <= REINTENTOS; i++) {
    try {
      console.log(`Descargando ${ANEXOS} (intento ${i}/${REINTENTOS})…`);
      const res = await fetch(ANEXOS, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(ruta, Buffer.from(await res.arrayBuffer()));
      return ruta;
    } catch (err) {
      ultimo = err?.cause?.code || err.message;
      console.warn(`  falló: ${ultimo}`);
      if (i < REINTENTOS) await esperar(5000 * i);
    }
  }
  throw new Error(`No se pudo bajar el anexo (${ultimo}). No se escribió nada.`);
}

async function main() {
  if (spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).error) throw new Error('No hay `pdftotext` en el PATH. No se escribió nada.');
  const pdf = await bajar();
  const texto = spawnSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout;
  const unidades = Reg.armarUnidades(texto);
  if (unidades.length < 11) throw new Error(`Solo se leyeron ${unidades.length} unidades de negocio (se esperaban 12): la tabla del anexo cambió. No se escribió nada.`);
  const rutas = unidades.reduce((t, u) => t + u.rutas.length, 0);
  const metadata = {
    fuente: 'Municipalidad Provincial de Arequipa (MPA): bases integradas de la tercera licitación de operación de rutas del Sistema Integrado de Transporte (anexos) y contratos de concesión',
    url_pagina: PAGINA,
    url_anexos: ANEXOS,
    url_contratos: BASE,
    fecha_de_los_datos: '2017-06-08 (bases integradas); los contratos y adendas son posteriores',
    fecha_extraccion: new Date().toISOString().slice(0, 10),
    sha256_anexos: createHash('sha256').update(readFileSync(pdf)).digest('hex'),
    licencia: 'La página no declara una licencia. Es información pública de una entidad del Estado (transparencia); se atribuye a la Municipalidad Provincial de Arequipa.',
    conteos: { unidades: unidades.length, rutas, rutas_con_longitud: unidades.reduce((t, u) => t + u.rutas.filter((r) => r.longitud_km !== null).length, 0) },
    vigente: false,
    plan_vigente: {
      norma: 'Ordenanza Municipal N.° 1355-MPA, que aprueba el Plan de Optimización de Rutas para la etapa pre operativa del Sistema Integrado de Transportes de la Ciudad de Arequipa',
      fecha: '2024-12-26 (sesión extraordinaria del 2024-12-18); publicada en El Peruano el 2025-01-25',
      url: 'https://busquedas.elperuano.pe/dispositivo/NL/2360973-1',
      nota: 'La ordenanza solo aprueba el plan y delega las actualizaciones en la Gerencia de Transporte Urbano y Circulación Vial; el texto del plan (los circuitos, 97 según la prensa) y sus anexos no están publicados en el portal de la MPA ni en El Peruano. Hay que pedirlos por la Ley 27806 (transparencia).',
    },
    nota: 'Es el registro de 2017: 12 unidades de negocio (C-1A y C-1B troncales, C-2 a C-11) con las rutas (códigos A#, T#, BT#) que las componen y su longitud en km por sentido. Los códigos de ruta no son los nombres de ramal de OpenStreetMap; no trae terminales, paraderos, frecuencias ni horarios. El concesionario sale de los contratos y adendas publicados en la misma página; C-1B no tiene uno identificado.',
    generado: new Date().toISOString().slice(0, 10),
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, `${JSON.stringify({ metadata, unidades }, null, 1)}\n`);
  console.log(`Escrito public/data/sit_registro_oficial.json: ${unidades.length} unidades, ${rutas} rutas (${metadata.conteos.rutas_con_longitud} con longitud)`);
}

main().catch((err) => { console.error(`\nERROR: ${err.message}`); process.exit(1); });
