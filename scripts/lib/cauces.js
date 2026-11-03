/**
 * cauces.js — Une los cauces de varias fuentes (ANA, IGP, OpenStreetMap) en una sola lista, sin duplicados (puro, sin red).
 * Lo usa scripts/descargar-quebradas.mjs y lo prueban test/cauces-fuentes.spec.ts.
 *
 * Una candidata es { fuente, capa?, nombre, tipo, categoria, cuenca, longKm, geometry } con geometry LineString o MultiLineString.
 *
 *   nombreLegible(nombre)                  «Qda. San Lazaro» → «Quebrada San Lázaro»; vacío → null
 *   fraccionCubierta(cand, existentes, o)  qué parte de la línea candidata está a `tolM` o menos de las ya aceptadas (0 a 1)
 *   unirCauces(grupos, opciones)           grupos = [[candidatas de la fuente de mayor prioridad], [siguiente], …]
 *                                          → { features, resumen: [{ fuente, capa, recibidos, incluidos, duplicados }] }
 *
 * Regla de duplicados: una candidata es duplicada si al menos `minFraccion` (70 %) de su longitud, medida con puntos cada
 * `pasoM` (25 m), queda a `tolM` (30 m) o menos de líneas ya aceptadas de OTRA entrada (juntas). Gana la de mayor prioridad
 * (el orden de los grupos). Ningún nombre se pierde: las líneas aceptadas que la duplicada cubre (al menos 25 % de ella)
 * heredan su nombre si no tenían uno, o lo guardan como `alias` ({ nombre, fuente }) si tenían otro distinto. La fuente que
 * repetía el tramo se anota en `tambienEn`.
 */
const Calculos = require('../../public/js/calculos.js');

const sinTildes = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Grafías: el IGP escribe sin tildes («Qda. San Lazaro») y OpenStreetMap tiene «Anashuayco». Solo se restituyen nombres
// que los informes de INGEMMET escriben con tilde o eñe; el resto se deja como viene.
const GRAFIAS = {
  'san lazaro': 'San Lázaro',
  anashuayco: 'Añashuayco',
  belen: 'Belén',
  'cuesta belen': 'Cuesta Belén',
  'rio chili': 'Río Chili',
};

/** Nombre para mostrar: expande «Qda.» y corrige tildes conocidas. null si el nombre está vacío. */
function nombreLegible(nombre) {
  let t = String(nombre == null ? '' : nombre).replace(/\s+/g, ' ').trim();
  if (t.length <= 2 || /^sin nombre$/i.test(t)) return null; // «R», «QS»: códigos de tipo, no nombres
  if (t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(t)) t = t.toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()); // «POROTO» → «Poroto»
  const m = t.replace(/^qda\.?\s+/i, 'Quebrada ').replace(/^rio\s+/i, 'Río ');
  const partes = /^(Quebrada|Río|Torrentera)\s+(.+)$/i.exec(m);
  const prefijo = partes ? `${partes[1].charAt(0).toUpperCase()}${partes[1].slice(1).toLowerCase()} ` : '';
  const resto = partes ? partes[2] : m;
  const clave = sinTildes(resto);
  if (GRAFIAS[clave]) return `${prefijo}${GRAFIAS[clave]}`;
  if (GRAFIAS[sinTildes(m)]) return GRAFIAS[sinTildes(m)];
  return m;
}

const lineasDe = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

function cajaDe(geometry) {
  let oeste = Infinity; let sur = Infinity; let este = -Infinity; let norte = -Infinity;
  for (const l of lineasDe(geometry)) for (const [x, y] of l) { oeste = Math.min(oeste, x); este = Math.max(este, x); sur = Math.min(sur, y); norte = Math.max(norte, y); }
  return [oeste, sur, este, norte];
}

/** Puntos a lo largo de la línea: los vértices y puntos intermedios cada ~pasoM metros. */
function muestrear(geometry, pasoM) {
  const out = [];
  for (const l of lineasDe(geometry)) {
    for (let i = 0; i < l.length; i++) {
      out.push(l[i]);
      if (i + 1 >= l.length) continue;
      const d = Calculos.haversine(l[i][1], l[i][0], l[i + 1][1], l[i + 1][0]);
      const n = Math.floor(d / pasoM);
      for (let k = 1; k <= n; k++) { const t = k / (n + 1); out.push([l[i][0] + t * (l[i + 1][0] - l[i][0]), l[i][1] + t * (l[i + 1][1] - l[i][1])]); }
    }
  }
  return out;
}

const GRADOS_POR_M = 1 / 111195;

/** Fracción (0 a 1) de la línea candidata que queda a `tolM` o menos de alguna de las `existentes` (cada una con `caja`). */
function fraccionCubierta(candidata, existentes, { tolM = 30, pasoM = 25 } = {}) {
  const puntos = muestrear(candidata.geometry, pasoM);
  if (puntos.length === 0) return 0;
  const margen = tolM * GRADOS_POR_M * 1.5;
  const cerca = existentes.filter((e) => {
    const c = candidata.caja;
    return !(e.caja[2] + margen < c[0] || e.caja[0] - margen > c[2] || e.caja[3] + margen < c[1] || e.caja[1] - margen > c[3]);
  });
  if (cerca.length === 0) return 0;
  let dentro = 0;
  for (const [x, y] of puntos) {
    for (const e of cerca) {
      if (Calculos.distanciaAGeometriaLineaM(y, x, e.geometry) <= tolM) { dentro++; break; }
    }
  }
  return dentro / puntos.length;
}

/**
 * Une los grupos en orden de prioridad. Cada feature de salida lleva `fuente` (ANA, IGP, OSM), `capa` si la hay, `nombre`
 * (legible o null) y, si otra fuente la repetía, `tambienEn`.
 */
function unirCauces(grupos, { tolM = 30, minFraccion = 0.7, pasoM = 25 } = {}) {
  const aceptadas = [];
  const resumen = [];
  for (const grupo of grupos) {
    const r = { fuente: grupo.length ? grupo[0].fuente : null, capa: grupo.length ? grupo[0].capa || null : null, recibidos: grupo.length, incluidos: 0, duplicados: 0 };
    // Las candidatas de un mismo grupo no se comparan entre sí: solo contra lo aceptado de grupos anteriores.
    const previas = aceptadas.slice();
    const nuevas = [];
    for (const c of grupo) {
      const cand = { ...c, nombre: nombreLegible(c.nombre), caja: cajaDe(c.geometry) };
      if (!Number.isFinite(cand.caja[0])) continue;
      const fraccion = fraccionCubierta(cand, previas, { tolM, pasoM });
      if (fraccion >= minFraccion) {
        r.duplicados++;
        // Las líneas previas que esta duplicada cubre: reciben su fuente y su nombre (el más parecido primero).
        const puntuadas = previas.map((p) => ({ p, f: fraccionCubierta(cand, [p], { tolM, pasoM }) })).sort((x, y) => y.f - x.f);
        const cubiertas = puntuadas.filter((x) => x.f >= 0.25);
        if (cubiertas.length === 0 && puntuadas.length) cubiertas.push(puntuadas[0]);
        for (const { p } of cubiertas) {
          if (p.fuente !== cand.fuente) p.tambienEn = [...new Set([...(p.tambienEn || []), cand.fuente])];
          if (!cand.nombre) continue;
          if (!p.nombre) { p.nombre = cand.nombre; p.nombreDe = cand.fuente; }
          else if (sinTildes(p.nombre) !== sinTildes(cand.nombre) && !(p.alias || []).some((a) => sinTildes(a.nombre) === sinTildes(cand.nombre))) {
            p.alias = [...(p.alias || []), { nombre: cand.nombre, fuente: cand.fuente }];
          }
        }
        continue;
      }
      nuevas.push(cand);
      r.incluidos++;
    }
    aceptadas.push(...nuevas);
    resumen.push(r);
  }
  const features = aceptadas.map((a, i) => {
    const props = { id: i + 1, fuente: a.fuente, capa: a.capa || null, nombre: a.nombre || null, tipo: a.tipo || null, categoria: a.categoria || null, cuenca: a.cuenca || null, longKm: a.longKm ?? null };
    if (a.nombreDe) props.nombreDe = a.nombreDe;
    if (a.alias && a.alias.length) props.alias = a.alias;
    if (a.tambienEn && a.tambienEn.length) props.tambienEn = a.tambienEn;
    return { type: 'Feature', geometry: a.geometry, properties: props };
  });
  return { features, resumen };
}

module.exports = { nombreLegible, sinTildes, cajaDe, muestrear, fraccionCubierta, unirCauces };
