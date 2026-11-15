/**
 * convertir-acopio-sedapar.mjs — Congela los puntos de acopio de agua potable de SEDAPAR de Arequipa metropolitana en
 *   public/data/agua/puntos_acopio.geojson
 *
 * Fuente: «Directorio de Puntos de Acopio de Agua Potable Arequipa», guía de SEDAPAR publicada en gob.pe el 2024-02-16 (16 PDF, uno por distrito):
 *   https://www.gob.pe/institucion/sedapar/informes-publicaciones/5198948-directorio-de-puntos-de-acopio-de-agua-potable-arequipa
 * El CONTENIDO es de 2017: las fichas dicen «Fecha toma de data: Abril del 2017» (versión 0.1) y los mapas «Fecha de actualización: Junio 2017». Es el plan de
 * abastecimiento por tanques cisterna ante una emergencia (Municipalidad Provincial de Arequipa y Gerencia de Ingeniería, Catastro Empresarial de SEDAPAR).
 *
 * Uso:   node scripts/convertir-acopio-sedapar.mjs      (o: pnpm datos:acopio)
 * Opción:  --verificar-pdf   además descarga los 16 PDF (con tiempo máximo y reintentos; guardados en .cache-acopio/), los pasa a texto con `pdftotext` y comprueba
 *                            que las coordenadas del CSV coinciden ficha por ficha con las del PDF. Si algo no coincide, NO escribe nada. Si no hay red o `pdftotext`,
 *                            avisa y no escribe nada (no se afirma una verificación que no se hizo).
 *
 * Qué hace: lee scripts/fuentes/puntos_acopio_sedapar_2017.csv (580 fichas, extraídas del texto de los PDF), pasa el UTM 19 sur (WGS-84, EPSG:32719) a longitud y
 * latitud (scripts/lib/utm.js), descarta con su motivo las fichas sin coordenada o con una imposible (nunca inventa una), restituye la Ñ solo donde es segura
 * (scripts/lib/acopio.js) y escribe el GeoJSON con `metadata`: fuente, enlaces, fechas, descartados, conteos y lo que el dato no dice.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const A = require('./lib/acopio.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(RAIZ, 'scripts', 'fuentes', 'puntos_acopio_sedapar_2017.csv');
const SALIDA = join(RAIZ, 'public', 'data', 'agua');
const CACHE = join(RAIZ, '.cache-acopio');
const PAGINA = 'https://www.gob.pe/institucion/sedapar/informes-publicaciones/5198948-directorio-de-puntos-de-acopio-de-agua-potable-arequipa';
const CDN = 'https://cdn.www.gob.pe/uploads/document/file';
const PDFS = {
  'alto-selva-alegre': '5867702/5198948-alto-selva-alegre.pdf?v=1708090635', cayma: '5867703/5198948-cayma.pdf?v=1708090636', cercado: '5867705/5198948-cercado.pdf?v=1708090636',
  'cerro-colorado': '5867752/5198948-cerro-colorado.pdf?v=1708090961', hunter: '5867753/5198948-hunter.pdf?v=1708090963',
  'jose-luis-bustamante-y-rivero': '5867754/5198948-jose-luis-bustamante-y-rivero.pdf?v=1708090964', 'mariano-melgar': '5867755/5198948-mariano-melgar.pdf?v=1708090965',
  miraflores: '5867756/5198948-miraflores.pdf?v=1708090966', paucarpata: '5867757/5198948-paucarpata.pdf?v=1708090966', sabandia: '5867758/5198948-sabandia.pdf?v=1708090967',
  sachaca: '5867759/5198948-sachaca.pdf?v=1708090968', socabaya: '5867760/5198948-socabaya.pdf?v=1708090969', tiabaya: '5867761/5198948-tiabaya.pdf?v=1708090970',
  uchumayo: '5867762/5198948-uchumayo.pdf?v=1708090971', yanahuara: '5867763/5198948-yanahuara.pdf?v=1708090972', yura: '5867764/5198948-yura.pdf?v=1708090973',
};
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'; // gob.pe responde 418 a clientes sin navegador
const TIMEOUT_MS = 120000;
const REINTENTOS = 3;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function bajar(slug) {
  const ruta = join(CACHE, `${slug}.pdf`);
  if (existsSync(ruta)) return ruta;
  let ultimo = null;
  for (let i = 1; i <= REINTENTOS; i++) {
    try {
      const res = await fetch(`${CDN}/${PDFS[slug]}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(ruta, Buffer.from(await res.arrayBuffer()));
      return ruta;
    } catch (err) {
      ultimo = err?.cause?.code || err.message;
      console.warn(`  ${slug}: falló (intento ${i}/${REINTENTOS}): ${ultimo}`);
      if (i < REINTENTOS) await esperar(5000 * i);
    }
  }
  throw new Error(`No se pudo bajar el PDF de ${slug} (${ultimo}). No se escribió nada.`);
}

/** Compara, por distrito, las coordenadas de las fichas del CSV con las del texto de su PDF. Devuelve el resumen o lanza un error con lo que no coincide. */
async function verificarContraPdf(filas) {
  const prueba = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  if (prueba.error) throw new Error('No hay `pdftotext` en el PATH: no se puede verificar contra los PDF. No se escribió nada.');
  mkdirSync(CACHE, { recursive: true });
  let fichasPdf = 0;
  let completasPdf = 0;
  let comparadas = 0;
  const sinCoincidencia = [];
  const descartadosEnPdf = [];
  for (const slug of Object.keys(PDFS)) {
    console.log(`  verificando ${slug}…`);
    const ruta = await bajar(slug);
    const texto = spawnSync('pdftotext', ['-layout', ruta, '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout;
    const pares = A.extraerParesDePdf(texto);
    fichasPdf += pares.length;
    const delPdf = new Map();
    pares.filter((p) => p.length === 2).forEach((p) => { completasPdf++; delPdf.set(p.join('|'), (delPdf.get(p.join('|')) || 0) + 1); });
    for (const f of filas.filter((x) => x.distrito_archivo === slug && x.utm19s_norte && x.utm19s_este)) {
      comparadas++;
      const k = `${f.utm19s_norte}|${f.utm19s_este}`;
      if (delPdf.get(k) > 0) delPdf.set(k, delPdf.get(k) - 1);
      else sinCoincidencia.push(`${slug} p.${f.pagina_pdf}: ${k}`);
    }
    // Lo que el PDF trae y ninguna ficha del CSV recoge: las fichas con una coordenada imposible (se descartan) y cualquier ficha que el CSV no leyó.
    for (const [k, n] of delPdf) for (let i = 0; i < n; i++) descartadosEnPdf.push({ distrito: A.DISTRITOS[slug], numeros_que_trae_el_pdf: k.split('|') });
  }
  const sinFicha = filas.length;
  if (sinCoincidencia.length) throw new Error(`Hay ${sinCoincidencia.length} fichas del CSV cuyas coordenadas no están en el PDF: ${sinCoincidencia.slice(0, 5).join('; ')}. No se escribió nada.`);
  return { fecha: new Date().toISOString().slice(0, 10), pdf_comprobados: Object.keys(PDFS).length, fichas_en_los_pdf: fichasPdf, fichas_en_el_csv: sinFicha, fichas_con_las_dos_coordenadas_en_los_pdf: completasPdf, fichas_del_csv_comparadas: comparadas, sin_coincidencia: 0, fichas_del_pdf_que_el_csv_no_recoge: descartadosEnPdf, nota_de_esas_fichas: 'Son los números de 5 a 9 cifras que trae el texto del PDF en esas fichas, que no son coordenadas UTM válidas de Arequipa (p. ej. norte de ocho cifras, o un este escrito 2.31767E+11, que aparece como 31767).' };
}

async function main() {
  const filas = A.parsearCsv(readFileSync(CSV, 'utf8'));
  if (filas.length === 0) throw new Error('El CSV de fichas está vacío. No se escribió nada.');
  const { features, descartados, reparados, sinReparar } = A.convertir(filas);
  if (features.length === 0) throw new Error('Ninguna ficha dio un punto válido. No se escribió nada.');
  const verificacion = process.argv.includes('--verificar-pdf') ? await verificarContraPdf(filas) : null;
  features.sort((a, b) => (a.properties.distrito < b.properties.distrito ? -1 : a.properties.distrito > b.properties.distrito ? 1 : (a.properties.pagina_pdf || 0) - (b.properties.pagina_pdf || 0)));
  const resumen = A.resumir(features);
  const claves = new Map();
  features.forEach((f) => { const k = f.geometry.coordinates.join(','); claves.set(k, (claves.get(k) || 0) + 1); });
  const metadata = {
    fuente: 'SEDAPAR (Servicio de Agua Potable y Alcantarillado de Arequipa) con la Municipalidad Provincial de Arequipa: Directorio de Puntos de Acopio de Agua Potable Arequipa',
    url_pagina: PAGINA,
    url_pdf: Object.fromEntries(Object.entries(PDFS).map(([k, v]) => [k, `${CDN}/${v}`])),
    fecha_publicacion: '2024-02-16',
    periodo_de_los_datos: 'abril a junio de 2017',
    fecha_de_los_datos: 'Fichas: «Fecha toma de data: Abril del 2017» (versión 0.1); mapas: «Fecha de actualización: Junio 2017». Los datos tienen unos nueve años: los puntos pueden haber cambiado.',
    elaborado_por: 'Gerencia de Ingeniería, Catastro Empresarial de SEDAPAR, y Municipalidad Provincial de Arequipa (según las propias fichas)',
    fecha_conversion: new Date().toISOString().slice(0, 10),
    extraccion: `El texto de los 16 PDF se pasó con pdftotext a scripts/fuentes/puntos_acopio_sedapar_2017.csv (${filas.length} fichas: 580 de la primera pasada y 2 que esa pasada no leyó, Cercado n.º 19 y Miraflores n.º 8, agregadas a partir del texto del PDF). Las coordenadas del CSV se comprobaron contra las de los PDF` + (verificacion ? ' (ver verificacion_contra_pdf).' : ' (esta ejecución no repitió la comprobación; usa --verificar-pdf).'),
    ...(verificacion ? { verificacion_contra_pdf: verificacion } : {}),
    sistema_de_coordenadas: 'Las fichas dan «WGS-84, UTM zona 19 sur» (EPSG:32719). Se pasaron a longitud y latitud WGS84 con scripts/lib/utm.js, que coincide con PROJ a menos de 1 cm (test/acopio.spec.ts).',
    licencia: 'La página no declara una licencia. Es información pública publicada por el Estado en gob.pe; se atribuye a SEDAPAR y a la Municipalidad Provincial de Arequipa.',
    fichas_en_la_fuente: filas.length,
    registros: features.length,
    descartados,
    conteo_por_distrito: resumen.por_distrito,
    direcciones_con_enie_reparada: reparados,
    caracteres_danados_sin_reparar: sinReparar,
    nota_caracteres: 'El texto de los PDF pierde algunos caracteres (U+FFFD): la Ñ y también vocales con tilde (COMITÉ, JOSÉ) y el signo de número (N°). Solo se restituyó la Ñ, y solo en palabras españolas conocidas (scripts/lib/acopio.js); lo demás queda con el carácter dañado, y `reparada: true` marca las direcciones tocadas.',
    puntos_con_coordenadas_repetidas: [...claves.values()].filter((n) => n > 1).length,
    informativo: 'Sin umbral: variable informativa, no entra en el puntaje ni en la búsqueda de zonas del asistente.',
    no_dice: 'Es un directorio de lugares donde SEDAPAR y la Municipalidad previeron repartir agua con camiones cisterna ante un desabastecimiento (plan de emergencia). NO dice que haya agua en ese punto hoy, que el punto siga vigente (los datos son de 2017), que el reparto sea permanente ni que la zona tenga o no conexión a la red; tampoco es la red de agua. La ubicación de la ficha es una dirección y un par de coordenadas, no un polígono.',
    generado: new Date().toISOString().slice(0, 10),
  };
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata }).slice(0, -1);
  const cuerpo = `${cabecera},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  await mkdir(SALIDA, { recursive: true });
  await writeFile(join(SALIDA, 'puntos_acopio.geojson'), cuerpo);
  console.log(`\nEscrito public/data/agua/puntos_acopio.geojson: ${features.length} puntos de ${filas.length} fichas (${descartados.length} descartados), ${(Buffer.byteLength(cuerpo) / 1024).toFixed(0)} kB`);
  descartados.forEach((d) => console.log(`  descartado: ${d.distrito} p.${d.pagina_pdf}: ${d.motivo}`));
  console.log(`  Ñ reparadas: ${reparados}; caracteres dañados sin reparar: ${sinReparar}${verificacion ? `; verificado contra ${verificacion.pdf_comprobados} PDF (${verificacion.fichas_del_csv_comparadas} fichas)` : ''}`);
}

main().catch((err) => { console.error(`\nERROR: ${err.message}`); process.exit(1); });
