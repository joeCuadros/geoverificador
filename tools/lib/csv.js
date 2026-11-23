/**
 * csv.js — Lector de CSV mínimo y sin dependencias (RFC 4180): comillas, comas y saltos de línea dentro de comillas, comillas dobles escapadas, BOM y CRLF.
 * Devuelve una lista de objetos con los nombres de la primera fila como claves.
 */
function parsearCsv(texto) {
  const s = String(texto).replace(/^﻿/, '');
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comillas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      filas.push(fila); fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const [cabecera, ...resto] = filas;
  if (!cabecera) return [];
  return resto.filter((f) => !(f.length === 1 && f[0] === '')).map((f) => Object.fromEntries(cabecera.map((k, i) => [k, f[i] ?? ''])));
}

module.exports = { parsearCsv };
