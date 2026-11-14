/**
 * robots.js — Lectura de robots.txt y decisión de si una ruta se puede pedir (puro, sin red).
 * Lo usa scripts/lib/avisos/http.js y lo prueban test/avisos-http.spec.ts.
 *
 * Sigue las reglas de RFC 9309: se elige el grupo cuyo nombre de agente coincide con el nuestro (el más específico) o, si no
 * hay, el grupo «*»; dentro del grupo manda la regla de patrón más largo y, en un empate, Allow. Los patrones aceptan «*»
 * (cualquier secuencia) y «$» (fin de la ruta). Un «Disallow:» vacío no prohíbe nada.
 *
 *   parsearRobots(texto)           → grupos [{ agentes, reglas: [{ permitir, patron }], retardo }]
 *   reglasPara(grupos, userAgent)  → { reglas, retardo }   (retardo = Crawl-delay en segundos o null)
 *   permitido({ reglas }, ruta)    → boolean (ruta incluye la consulta: «/a/b?x=1»)
 */

/** Grupos de reglas de un robots.txt. */
function parsearRobots(texto) {
  const grupos = [];
  let actual = null;
  let aceptaAgentes = false; // true mientras las últimas líneas fueron User-agent (comparten grupo)
  for (const bruta of String(texto || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const linea = bruta.replace(/#.*$/, '').trim();
    if (!linea) continue;
    const i = linea.indexOf(':');
    if (i < 0) continue;
    const clave = linea.slice(0, i).trim().toLowerCase();
    const valor = linea.slice(i + 1).trim();
    if (clave === 'user-agent') {
      if (!actual || !aceptaAgentes) {
        actual = { agentes: [], reglas: [], retardo: null };
        grupos.push(actual);
      }
      actual.agentes.push(valor.toLowerCase());
      aceptaAgentes = true;
      continue;
    }
    if (!actual) continue;
    aceptaAgentes = false;
    if (clave === 'allow' || clave === 'disallow') {
      if (valor !== '') actual.reglas.push({ permitir: clave === 'allow', patron: valor });
    } else if (clave === 'crawl-delay') {
      const n = Number(valor);
      if (Number.isFinite(n) && n >= 0) actual.retardo = n;
    }
  }
  return grupos;
}

/** Reglas que aplican a `userAgent`: el grupo del agente más específico que coincide, o el de «*». */
function reglasPara(grupos, userAgent) {
  const token = String(userAgent || '').split(/[/\s]/)[0].toLowerCase();
  let mejor = '';
  for (const g of grupos) {
    for (const a of g.agentes) {
      if (a !== '*' && a !== '' && token.startsWith(a) && a.length > mejor.length) mejor = a;
    }
  }
  const elegidos = grupos.filter((g) => (mejor ? g.agentes.includes(mejor) : g.agentes.includes('*')));
  const reglas = elegidos.flatMap((g) => g.reglas);
  const retardos = elegidos.map((g) => g.retardo).filter((r) => r !== null);
  return { reglas, retardo: retardos.length ? Math.max(...retardos) : null };
}

const regexDe = (patron) => {
  const ancla = patron.endsWith('$');
  const cuerpo = (ancla ? patron.slice(0, -1) : patron).split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${cuerpo}${ancla ? '$' : ''}`);
};

/** ¿Se puede pedir esta ruta (con su consulta)? Sin reglas que coincidan, sí. */
function permitido(conjunto, ruta) {
  let mejor = null;
  for (const r of conjunto.reglas || []) {
    if (!regexDe(r.patron).test(ruta)) continue;
    if (!mejor || r.patron.length > mejor.patron.length || (r.patron.length === mejor.patron.length && r.permitir && !mejor.permitir)) mejor = r;
  }
  return mejor ? mejor.permitir : true;
}

module.exports = { parsearRobots, reglasPara, permitido };
