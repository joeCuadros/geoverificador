/**
 * salida.js — Escritores JSON y CSV de los avisos y ruta de salida (sin red). Lo prueba test/avisos-cli.spec.ts.
 *
 * La salida por defecto es datos-crudos/avisos/ (ignorada por git). Son avisos de terceros: no se escriben en public/
 * porque esa carpeta se publica en la web.
 */
const fs = require('fs');
const path = require('path');
const E = require('./esquema.js');

const AVISO_DE_USO =
  'Datos crudos de avisos publicados por terceros en portales, recogidos para análisis interno. No se publican ni se redistribuyen; ' +
  'respetan el robots.txt de cada sitio. No incluyen vendedores, teléfonos ni perfiles.';

/** Una celda CSV: texto entrecomillado si hace falta; texto que parece fórmula lleva un apóstrofo delante. */
function celda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV (RFC 4180, separador coma, saltos \n, con BOM para que Excel lea bien las tildes). */
function aCsv(avisos) {
  const filas = [E.COLUMNAS.join(','), ...avisos.map((a) => E.COLUMNAS.map((c) => celda(a[c])).join(','))];
  return `﻿${filas.join('\n')}\n`;
}

/** JSON con metadatos (fecha, filtros, resumen por fuente) y los avisos. */
function aJson({ avisos, resumen, filtros, ahora }) {
  return `${JSON.stringify({ metadatos: { generado: ahora.toISOString(), total: avisos.length, filtros, fuentes: resumen, aviso: AVISO_DE_USO }, avisos }, null, 2)}\n`;
}

const dentroDe = (hijo, padre) => {
  const rel = path.relative(padre, hijo);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Ruta del archivo de salida. Lanza un error si cae dentro de public/ de la raíz del proyecto. */
function rutaSalida({ salida, formato, ahora, raiz }) {
  const ruta = salida ? path.resolve(salida) : path.join(raiz, 'datos-crudos', 'avisos', `avisos-${ahora.toISOString().slice(0, 10)}.${formato}`);
  if (dentroDe(ruta, path.join(raiz, 'public'))) throw new Error(`No se escribe dentro de public/ (${ruta}): esa carpeta se publica en la web y estos avisos son datos crudos de terceros.`);
  return ruta;
}

async function escribir(ruta, contenido) {
  await fs.promises.mkdir(path.dirname(ruta), { recursive: true });
  await fs.promises.writeFile(ruta, contenido, 'utf8');
}

module.exports = { AVISO_DE_USO, celda, aCsv, aJson, rutaSalida, escribir };
