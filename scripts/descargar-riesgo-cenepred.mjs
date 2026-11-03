/**
 * descargar-riesgo-cenepred.mjs — Congela el escenario de riesgo del CENEPRED ante El Niño 2026-2027 (inundaciones y movimientos en masa)
 * para los distritos de public/data/distritos_aqp.geojson.
 *
 * Fuente: servicio SIGRID del CENEPRED, capas 4 («Riesgos a inundación») y 5 («Riesgos a movimientos en masa») de
 * https://sigrid.cenepred.gob.pe/arcgis/rest/services/FEN/ER_NINO2027_BD/MapServer (consulta pública, sin llave; CORS abierto).
 * Metodología: «Estudio de escenarios de riesgo por inundaciones y movimientos en masa ante lluvias intensas asociadas al Fenómeno El Niño»
 * (CENEPRED, mayo de 2026). La capa dice estar «actualizada en base al Informe Técnico N.° 69-2026/SENAMHI-DMA-SPC».
 *
 * Uso:   node scripts/descargar-riesgo-cenepred.mjs
 * Sale:  public/data/riesgo_cenepred_fen2027.json
 *
 * Decisiones:
 *  - Se pide solo atributos (sin geometría): los distritos se emparejan por UBIGEO con distritos_aqp.geojson y se dibujan con esos límites.
 *  - Es una estimación por DISTRITO para un escenario de lluvias como las de los veranos de 1983, 1998, 2017 y 2023. No es una evaluación del predio.
 *  - Solo se guardan los campos cuyo significado se confirmó con el estudio (ver scripts/lib/riesgo-cenepred.js). Si el significado de un campo
 *    deja de cuadrar con las tablas del estudio, o falta un distrito, o aparece un nivel desconocido, no se escribe nada.
 *  - Si algo falla (red, formato, cobertura), se conserva el archivo existente y se sale con código 1.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const R = require('./lib/riesgo-cenepred.js');

const SERVICIO = process.env.CENEPRED_FEN_URL || 'https://sigrid.cenepred.gob.pe/arcgis/rest/services/FEN/ER_NINO2027_BD/MapServer';
const CAPAS = { inundacion: 4, movimientos_masa: 5 };
const VISOR = 'https://sigrid.cenepred.gob.pe/sigridv3/';
const ESTUDIO_URL = 'https://sigrid.cenepred.gob.pe/sigridv3/storage/biblioteca//22033_estudio-de-escenarios-de-riesgo-por-inundaciones-y-movimientos-en-masa-ante-lluvias-intensas-asociadas-al-fenomeno-el-nino.pdf';
const METODO_URL = 'https://sigrid.cenepred.gob.pe/sigridv3/storage/biblioteca/17791_escenarios-de-riesgo-por-inundaciones-y-movimientos-en-masa-en-el-marco-del-plan-multisectorial-2025-2027.pdf';
const AGENTE = 'geoverificador-datos/1.0 (descarga de datos abiertos)';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const SALIDA = join(RAIZ, 'riesgo_cenepred_fen2027.json');
const DISTRITOS = join(RAIZ, 'distritos_aqp.geojson');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedirJson(url, params = {}) {
  const qs = new URLSearchParams({ f: 'json', ...params }).toString();
  const direccion = `${url}?${qs}`;
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(direccion, { headers: { 'User-Agent': AGENTE } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`el servicio respondió ${json.error.code}: ${json.error.message}`);
      return json;
    } catch (err) {
      if (intento >= 3) throw new Error(`Falló la consulta tras 3 intentos (${err.message}).\nURL: ${url}`);
      await esperar(2000 * intento);
    }
  }
}

async function main() {
  const geojson = JSON.parse(await readFile(DISTRITOS, 'utf8'));
  const ubigeos = geojson.features.map((f) => f.properties.ubigeo);
  if (ubigeos.length === 0 || ubigeos.some((u) => !/^\d{6}$/.test(u))) throw new Error('distritos_aqp.geojson no trae ubigeos válidos.');
  const campos = ['ubigeo', 'nombdist', 'viv_1', 'eess_1'];
  const donde = `ubigeo IN (${ubigeos.map((u) => `'${u}'`).join(',')})`;

  const entrada = {};
  const capas = {};
  for (const [fenomeno, id] of Object.entries(CAPAS)) {
    const url = `${SERVICIO}/${id}`;
    const meta = await pedirJson(url);
    const usados = Object.values(R.CAMPOS[fenomeno]);
    const datos = await pedirJson(`${url}/query`, { where: donde, outFields: [...new Set([...campos, ...usados])].join(','), returnGeometry: 'false' });
    if (datos.exceededTransferLimit) throw new Error(`La capa ${id} llegó a su tope de registros.`);
    entrada[fenomeno] = datos.features.map((f) => f.attributes);
    capas[fenomeno] = { id, nombre: String(meta.name || '').trim(), url, descripcion: String(meta.description || '').replace(/<BR>/gi, ' ').replace(/\s+/g, ' ').trim() };
    console.log(`Capa ${id} (${capas[fenomeno].nombre}): ${entrada[fenomeno].length} registros.`);
  }

  const distritos = R.armar(entrada, geojson); // falla si falta un distrito o si el significado de un campo no cuadra con las tablas del estudio
  const resumen = R.resumenPorNivel(distritos);

  const salida = {
    fuente: 'CENEPRED (SIGRID), escenario de riesgo por inundaciones y movimientos en masa ante lluvias intensas asociadas al Fenómeno El Niño 2026-2027',
    url: SERVICIO,
    url_visor: VISOR,
    capas,
    estudio: {
      titulo: 'Estudio de escenarios de riesgo por inundaciones y movimientos en masa ante lluvias intensas asociadas al Fenómeno El Niño',
      autor: 'CENEPRED',
      fecha: 'mayo de 2026',
      url: ESTUDIO_URL,
      metodologia_previa: 'Escenarios de riesgo por inundaciones y movimientos en masa en el marco del Plan Multisectorial 2025-2027 (CENEPRED, julio de 2024)',
      metodologia_previa_url: METODO_URL,
      actualizacion_de_la_capa: 'Informe Técnico N.° 69-2026/SENAMHI-DMA-SPC, según la descripción de la capa',
    },
    escenario: 'Lluvias intensas como las de los veranos de 1983, 1998, 2017 y 2023 (años El Niño). Es un escenario, no un pronóstico.',
    fecha_descarga: new Date().toISOString().slice(0, 10),
    nota: 'Escala distrital: un solo nivel por distrito y fenómeno. Escenario El Niño 2027, no una predicción. No es una evaluación del riesgo del predio.',
    niveles: R.NIVELES,
    campos: {
      nivel: 'Nivel de riesgo del distrito (bajo, medio, alto o muy alto), que el estudio obtiene de combinar la susceptibilidad y la vulnerabilidad del distrito.',
      viviendas: 'Viviendas del distrito ubicadas en áreas de mayor susceptibilidad (indicador de exposición del estudio).',
      instituciones_educativas: 'Locales educativos del distrito ubicados en áreas de mayor susceptibilidad.',
      establecimientos_salud: 'Establecimientos de salud del distrito ubicados en áreas de mayor susceptibilidad.',
    },
    campos_servicio: Object.fromEntries(Object.entries(R.CAMPOS).map(([f, c]) => [f, { nivel: c.nivel, viviendas: c.viviendas, instituciones_educativas: c.instituciones_educativas, establecimientos_salud: c.establecimientos_salud }])),
    resumen_por_nivel: resumen,
    distritos,
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida, null, 2) + '\n');

  console.log(`\nGuardado en ${SALIDA}: ${Object.keys(distritos).length} distritos.`);
  for (const [f, niveles] of Object.entries(resumen)) console.log(`  ${f}: ${R.NIVELES.map((n) => `${n} ${niveles[n]}`).join(', ')}`);
}

main().catch((err) => {
  console.error(`\nNo se pudo completar la descarga: ${err.message}\nSe conserva el archivo existente (si lo había).`);
  process.exit(1);
});
