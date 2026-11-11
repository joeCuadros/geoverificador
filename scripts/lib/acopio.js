/**
 * acopio.js — Lógica pura (sin red ni archivos) detrás de scripts/convertir-acopio-sedapar.mjs: los puntos de acopio de agua potable del directorio de SEDAPAR
 * (https://www.gob.pe/institucion/sedapar/informes-publicaciones/5198948-directorio-de-puntos-de-acopio-de-agua-potable-arequipa). La usan ese script y test/acopio.spec.ts.
 *
 *   parsearCsv(texto)          → filas del CSV de fichas (scripts/fuentes/puntos_acopio_sedapar_2017.csv)
 *   repararEnie(texto)         → { texto, reparados, sinReparar }: restituye la Ñ solo donde es segura
 *   convertir(filas)           → { features, descartados, reparados, sinReparar }: UTM 19 sur a WGS84, un Point por ficha con coordenadas válidas
 *   resumir(features)          → { total, por_distrito }
 *   extraerParesDePdf(texto)   → por ficha, los números (metros) que el PDF trae en «GEOREFERENCIACION»: sirve para comprobar el CSV contra el texto de cada PDF
 *
 * El texto de los PDF pierde algunos caracteres (salen como U+FFFD): la Ñ, pero también vocales con tilde (COMITÉ, JOSÉ) y el signo de número (N°). Solo se repara
 * la Ñ, y solo si el carácter dañado está entre dos vocales Y la palabra completa está en una lista cerrada de palabras españolas que llevan Ñ (un CA?A podría ser
 * CAÑA o CAÍA: no se toca). Todo lo demás queda como vino y se cuenta en `sinReparar`.
 */
const { parsearCsv } = require('./csv.js');
const { utmAWgs84 } = require('./utm.js');

/** Nombre de archivo del distrito en gob.pe → nombre del distrito en public/data/distritos_aqp.geojson. */
const DISTRITOS = {
  'alto-selva-alegre': 'ALTO SELVA ALEGRE', cayma: 'CAYMA', cercado: 'AREQUIPA', 'cerro-colorado': 'CERRO COLORADO', hunter: 'JACOBO HUNTER',
  'jose-luis-bustamante-y-rivero': 'JOSE LUIS BUSTAMANTE Y RIVERO', 'mariano-melgar': 'MARIANO MELGAR', miraflores: 'MIRAFLORES', paucarpata: 'PAUCARPATA',
  sabandia: 'SABANDIA', sachaca: 'SACHACA', socabaya: 'SOCABAYA', tiabaya: 'TIABAYA', uchumayo: 'UCHUMAYO', yanahuara: 'YANAHUARA', yura: 'YURA',
};

/** Palabras españolas con Ñ que aparecen en las direcciones del directorio (con el carácter dañado entre vocales). Lista cerrada. */
const PALABRAS_CON_ENIE = new Set([
  'arequipeña', 'breña', 'cabaña', 'campiña', 'ensueño', 'españa', 'ferreñafe', 'ibañez', 'muñoz', 'niño', 'peña', 'peñas', 'peñón', 'peñon',
  'pequeños', 'quequeña', 'quiñones', 'romaña', 'señor', 'señora', 'señorial', 'viña',
]);

const VOCAL = /[AEIOUaeiouÁÉÍÓÚáéíóú]/;
const LETRA = /[A-Za-zÁÉÍÓÚÑáéíóúñ]/;
const DANADO = '�';

/** Restituye la Ñ en `texto` donde es segura (ver la nota de arriba). Devuelve { texto, reparados, sinReparar }. */
function repararEnie(texto) {
  let reparados = 0;
  const t = String(texto == null ? '' : texto);
  let salida = '';
  let i = 0;
  while (i < t.length) {
    if (!LETRA.test(t[i]) && t[i] !== DANADO) { salida += t[i]; i++; continue; }
    let j = i;
    while (j < t.length && (LETRA.test(t[j]) || t[j] === DANADO)) j++;
    const palabra = t.slice(i, j);
    let nueva = palabra;
    if (palabra.includes(DANADO)) {
      const k = palabra.indexOf(DANADO);
      const segura = palabra.split(DANADO).length === 2 && k > 0 && k < palabra.length - 1 && VOCAL.test(palabra[k - 1]) && VOCAL.test(palabra[k + 1])
        && PALABRAS_CON_ENIE.has(palabra.replace(DANADO, 'ñ').toLowerCase());
      if (segura) {
        const mayuscula = palabra[k - 1] === palabra[k - 1].toUpperCase() && palabra[k - 1] !== palabra[k - 1].toLowerCase();
        nueva = palabra.replace(DANADO, mayuscula ? 'Ñ' : 'ñ');
        reparados++;
      }
    }
    salida += nueva;
    i = j;
  }
  return { texto: salida, reparados, sinReparar: (salida.match(/�/g) || []).length };
}

// Caja de Arequipa metropolitana (la de CONFIG.viewbox): lo que cae fuera no es de este directorio o es un error de la fuente.
const CAJA = { sur: -16.6, oeste: -71.75, norte: -16.2, este: -71.35 };
const entero = (v) => (/^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : null);

/** Convierte las fichas del CSV en Features Point (WGS84). Lo que no se puede ubicar con certeza se descarta y se dice por qué: nunca se inventa una coordenada. */
function convertir(filas) {
  const features = [];
  const descartados = [];
  let reparados = 0;
  let sinReparar = 0;
  for (const f of filas || []) {
    const distrito = DISTRITOS[f.distrito_archivo] || String(f.distrito_archivo || '').toUpperCase();
    const pagina = entero(f.pagina_pdf);
    const base = { distrito, pagina_pdf: pagina, codigo: f.codigo_punto || null };
    const norte = entero(f.utm19s_norte);
    const este = entero(f.utm19s_este);
    if (norte === null) { descartados.push({ ...base, motivo: 'el norte (Y) de la ficha no es utilizable: falta o el PDF trae un valor que no es una coordenada UTM válida' }); continue; }
    if (este === null) { descartados.push({ ...base, motivo: 'el este (X) de la ficha no es utilizable: falta o el PDF trae un valor que no es una coordenada UTM válida' }); continue; }
    let lat = NaN;
    let lon = NaN;
    if (norte > 7500000 && norte < 8700000 && este > 100000 && este < 900000) ({ lat, lon } = utmAWgs84(norte, este));
    if (!(lat > CAJA.sur && lat < CAJA.norte && lon > CAJA.oeste && lon < CAJA.este)) {
      descartados.push({ ...base, motivo: `fuera de Arequipa metropolitana: norte ${f.utm19s_norte}, este ${f.utm19s_este} no dan un punto dentro de la caja (error de la fuente)` });
      continue;
    }
    const r = repararEnie(f.direccion);
    reparados += r.reparados;
    sinReparar += r.sinReparar;
    const props = { ...base, direccion: r.texto, utm_norte: norte, utm_este: este };
    if (r.reparados > 0) props.reparada = true;
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [Number(lon.toFixed(7)), Number(lat.toFixed(7))] } });
  }
  return { features, descartados, reparados, sinReparar };
}

function resumir(features) {
  const por = {};
  features.forEach((f) => { por[f.properties.distrito] = (por[f.properties.distrito] || 0) + 1; });
  return { total: features.length, por_distrito: por };
}

/**
 * De un PDF del directorio (ya pasado a texto con `pdftotext -layout`): por cada ficha («CODIGO DE PUNTO:»), la lista de números de 5 a 9 cifras (con « m», con decimales «.0000» o sin nada: el formato varía) que hay entre
 * «GEOREFERENCIACION:» y «DESCRIPCION:», con el norte (siete cifras) antes que el este (seis) sin importar el orden en que cada PDF los imprime (varía de una
 * ficha a otra). Una ficha completa trae dos; una con la coordenada ausente trae menos.
 */
function extraerParesDePdf(texto) {
  return String(texto).split(/CODIGO DE PUNTO:/).slice(1).map((bloque) => {
    const georef = (bloque.split('GEOREFERENCIACION:')[1] || '').split('DESCRIPCION:')[0];
    return [...georef.matchAll(/(?<!\d)(\d{5,9})(?:\.0+)?(?!\d)/g)].map((m) => m[1]).sort((x, y) => y.length - x.length || (x < y ? 1 : -1));
  });
}

module.exports = { parsearCsv, repararEnie, convertir, resumir, extraerParesDePdf, DISTRITOS, PALABRAS_CON_ENIE };
