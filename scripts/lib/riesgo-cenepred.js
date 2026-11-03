/**
 * riesgo-cenepred.js — Lógica pura (sin red ni archivos) para armar el archivo del escenario de riesgo del CENEPRED ante El Niño
 * (inundaciones y movimientos en masa, por distrito). La usan scripts/descargar-riesgo-cenepred.mjs y test/riesgo-cenepred-datos.spec.ts.
 *
 * Fuente: servicio SIGRID del CENEPRED, capas 4 («Riesgos a inundación») y 5 («Riesgos a movimientos en masa») de
 * https://sigrid.cenepred.gob.pe/arcgis/rest/services/FEN/ER_NINO2027_BD/MapServer. El servicio no documenta sus campos (el alias de cada
 * campo es su propio nombre), así que el significado de los que se usan se confirmó con el «Estudio de escenarios de riesgo por
 * inundaciones y movimientos en masa ante lluvias intensas asociadas al Fenómeno El Niño» (CENEPRED, mayo de 2026):
 *   - nivel de riesgo (nriesgo_in / nriesgo_mm): «cuatro niveles de riesgo: muy alto, alto, medio y bajo» por distrito (cap. 3, §5.3);
 *   - viviendas, instituciones educativas y establecimientos de salud «en áreas altamente susceptibles» (indicadores de exposición,
 *     §5.2 y Tablas 5 y 6): viv_sinu / iiee_sinu / eess_sinu (inundación) y vivsm_ma_a / iiee_smm / eess_smm (movimientos en masa).
 *     La correspondencia campo → indicador se comprueba con las clases 1 a 5 de esas tablas, que el propio servicio trae calculadas en
 *     viv_1 y eess_1 (si no coinciden, el significado cambió y no se escribe nada).
 * Campos que NO se usan porque su significado no está confirmado en un documento: pob_2017 y viv_2017 (las cifras no cuadran entre sí
 * en varios distritos), vsinu, pc, zc, inv_mm y el resto de los intermedios.
 */

const NIVELES = ['Bajo', 'Medio', 'Alto', 'Muy alto'];

/** Campos de cada capa que se usan. Las dos últimas claves son las clases 1 a 5 que el servicio ya trae calculadas (para comprobar). */
const CAMPOS = {
  inundacion: { nivel: 'nriesgo_in', viviendas: 'viv_sinu', instituciones_educativas: 'iiee_sinu', establecimientos_salud: 'eess_sinu', claseViviendas: 'viv_1', claseSalud: 'eess_1' },
  movimientos_masa: { nivel: 'nriesgo_mm', viviendas: 'vivsm_ma_a', instituciones_educativas: 'iiee_smm', establecimientos_salud: 'eess_smm', claseViviendas: 'viv_1', claseSalud: 'eess_1' },
};

/** «Muy Alto» (capa 5) y «Muy alto» (capa 4) son el mismo nivel; devuelve el nombre canónico o null si no es un nivel conocido. */
function normalizarNivel(texto) {
  const t = String(texto == null ? '' : texto).trim().toLowerCase().replace(/\s+/g, ' ');
  return NIVELES.find((n) => n.toLowerCase() === t) || null;
}

/** Clase de exposición por viviendas según las Tablas 5 y 6 del estudio: 0 → 1; 1-100 → 2; 101-250 → 3; 251-1000 → 4; más de 1000 → 5. */
function claseViviendas(n) {
  return n <= 0 ? 1 : n <= 100 ? 2 : n <= 250 ? 3 : n <= 1000 ? 4 : 5;
}

/** Clase por establecimientos de salud (Tablas 5 y 6): 0 → 1; 1 → 2; 2 → 3; 3 a 5 → 4; más de 5 → 5. */
function claseSalud(n) {
  return n <= 0 ? 1 : n === 1 ? 2 : n === 2 ? 3 : n <= 5 ? 4 : 5;
}

const entero = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Una capa → el bloque de un distrito. Lanza un Error con la causa si falta un dato o si el significado de los campos no cuadra con las
 * tablas del estudio.
 */
function bloque(fenomeno, atr, nombre) {
  const c = CAMPOS[fenomeno];
  const nivel = normalizarNivel(atr[c.nivel]);
  if (!nivel) throw new Error(`${nombre} (${fenomeno}): nivel de riesgo desconocido «${atr[c.nivel]}».`);
  const b = { nivel };
  ['viviendas', 'instituciones_educativas', 'establecimientos_salud'].forEach((k) => {
    const v = entero(atr[c[k]]);
    if (v === null) throw new Error(`${nombre} (${fenomeno}): ${c[k]} no es un entero válido («${atr[c[k]]}»).`);
    b[k] = v;
  });
  if (claseViviendas(b.viviendas) !== atr[c.claseViviendas]) {
    throw new Error(`${nombre} (${fenomeno}): ${c.viviendas}=${b.viviendas} da la clase ${claseViviendas(b.viviendas)} en la tabla del estudio, pero el servicio trae ${c.claseViviendas}=${atr[c.claseViviendas]}. El significado del campo cambió.`);
  }
  if (claseSalud(b.establecimientos_salud) !== atr[c.claseSalud]) {
    throw new Error(`${nombre} (${fenomeno}): ${c.establecimientos_salud}=${b.establecimientos_salud} da la clase ${claseSalud(b.establecimientos_salud)} en la tabla del estudio, pero el servicio trae ${c.claseSalud}=${atr[c.claseSalud]}. El significado del campo cambió.`);
  }
  return b;
}

/**
 * Arma `distritos` (clave: ubigeo) con los distritos de `distritosGeojson` (FeatureCollection de public/data/distritos_aqp.geojson),
 * emparejando por ubigeo con los registros de cada capa. Falla si algún distrito no está en las dos capas.
 *   entrada: { inundacion: [atributos], movimientos_masa: [atributos] }
 */
function armar(entrada, distritosGeojson) {
  const distritos = {};
  const porUbigeo = (lista) => new Map((lista || []).map((a) => [String(a.ubigeo), a]));
  const inu = porUbigeo(entrada.inundacion);
  const mm = porUbigeo(entrada.movimientos_masa);
  const faltan = [];
  const rotulos = [];
  distritosGeojson.features.forEach((f) => {
    const { ubigeo, distrito } = f.properties;
    const a = inu.get(ubigeo);
    const b = mm.get(ubigeo);
    if (!a || !b) { faltan.push(`${distrito} (${ubigeo})${!a ? ' sin inundación' : ''}${!b ? ' sin movimientos en masa' : ''}`); return; }
    distritos[ubigeo] = { distrito, inundacion: bloque('inundacion', a, distrito), movimientos_masa: bloque('movimientos_masa', b, distrito) };
    // Control de nombre: el nombre del servicio debe ser el del distrito (hay un solo ubigeo por distrito).
    const n = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    if (n(a.nombdist) !== n(distrito) || n(b.nombdist) !== n(distrito)) rotulos.push(`${distrito}: el servicio lo llama «${a.nombdist}» / «${b.nombdist}»`);
  });
  if (faltan.length) throw new Error(`Distritos que no están en las dos capas del CENEPRED: ${faltan.join('; ')}.`);
  if (rotulos.length) throw new Error(`El ubigeo no coincide con el nombre del distrito: ${rotulos.join('; ')}.`);
  return distritos;
}

/** Cuántos distritos hay en cada nivel, por fenómeno: { inundacion: { 'Muy alto': n, … }, movimientos_masa: { … } }. */
function resumenPorNivel(distritos) {
  const out = { inundacion: {}, movimientos_masa: {} };
  Object.keys(out).forEach((f) => NIVELES.forEach((n) => { out[f][n] = 0; }));
  Object.values(distritos).forEach((d) => { out.inundacion[d.inundacion.nivel]++; out.movimientos_masa[d.movimientos_masa.nivel]++; });
  return out;
}

module.exports = { NIVELES, CAMPOS, normalizarNivel, claseViviendas, claseSalud, bloque, armar, resumenPorNivel };
