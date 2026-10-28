/**
 * validar-zonificacion-plano.mjs — Compara public/data/zonas_aqp.geojson con el PDF oficial del plano.
 *
 * El plano de zonificación publicado con la Ordenanza 975 es un PDF exportado de ArcMap con los polígonos como rellenos
 * vectoriales de color, una etiqueta de texto por polígono y puntos de control geográficos (GPTS). Este script
 * RE-EXTRAE esos polígonos y etiquetas directamente del PDF, sin QGIS ni el GeoJSON del equipo, y los compara:
 *   1. Georreferenciación: el marco del PDF debe ser un rectángulo UTM 19S y su cuadrícula impresa debe coincidir.
 *   2. Polígonos: número y color por código, y área por código (par-impar para los huecos).
 *   3. Puntos al azar: el color que el PDF pinta en el punto frente a la zona que devuelve la aplicación (zonificacion.js).
 *   4. Etiquetas: el texto impreso de cada polígono frente a la zona que devuelve la aplicación en su posición.
 *
 * Uso:   node scripts/validar-zonificacion-plano.mjs "ruta/al/plano.pdf"
 * Sale:  docs/validacion/resultado-plano.json
 * El PDF no se versiona (16 MB); se registra su huella SHA-256 para identificar la fuente exacta.
 *
 * Límites: valida que el GeoJSON reproduce el plano del PDF; no valida que el PDF sea la última versión oficial ni que
 * el plano represente la realidad. El color del relleno es la única prueba de qué zona es cada polígono, igual que para el equipo.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(RAIZ, 'public');
const RUTA = process.argv[2];
if (!RUTA) { console.error('Falta la ruta al PDF del plano.\nUso: node scripts/validar-zonificacion-plano.mjs "ruta/al/plano.pdf"'); process.exit(1); }

// ------------------------------------------------------------------ UTM 19S (WGS84), series de Krüger
const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996, lon0 = (-69 * Math.PI) / 180, FE = 500000, FN = 10000000;
const n = f / (2 - f);
const A = (a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
const al = [n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16, (13 * n * n) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
const be = [n / 2 - (2 * n * n) / 3 + (37 * n ** 3) / 96, (n * n) / 48 + n ** 3 / 15, (17 * n ** 3) / 480];
const e = Math.sqrt(f * (2 - f));
function llToUtm(latDeg, lonDeg) {
  const phi = (latDeg * Math.PI) / 180, lam = (lonDeg * Math.PI) / 180 - lon0;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let X = xi, Y = eta;
  for (let j = 1; j <= 3; j++) { X += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); Y += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  return { E: FE + k0 * A * Y, N: FN + k0 * A * X };
}
function utmToLl(E, N) {
  const xi = (N - FN) / (k0 * A), eta = (E - FE) / (k0 * A);
  let X = xi, Y = eta;
  for (let j = 1; j <= 3; j++) { X -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); Y -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const chi = Math.asin(Math.sin(X) / Math.cosh(Y));
  let phi = chi;
  for (let i = 0; i < 8; i++) phi = Math.asin(Math.tanh(Math.atanh(Math.sin(chi)) + e * Math.atanh(e * Math.sin(phi))));
  return { lat: (phi * 180) / Math.PI, lon: ((Math.atan2(Math.sinh(Y), Math.cos(X)) + lon0) * 180) / Math.PI };
}

// ------------------------------------------------------------------ Lectura del PDF
const pdf = readFileSync(RUTA);
const huella = createHash('sha256').update(pdf).digest('hex');
const s = pdf.toString('latin1');
const pagina = s.match(/\/Type\s*\/Page[^s][\s\S]*?>>\s*endobj/);
if (!pagina) throw new Error('No se encontró el diccionario de la página en el PDF.');
const idContenido = pagina[0].match(/\/Contents\s+(\d+)\s+0\s+R/)?.[1];
const bbox = pagina[0].match(/\/BBox\s*\[\s*([-\d.\s]+)\]/)?.[1].trim().split(/\s+/).map(Number);
const gpts = s.match(/\/GPTS\s*\[\s*([-\d.\s]+)\]/)?.[1].trim().split(/\s+/).map(Number);
const lpts = s.match(/\/LPTS\s*\[\s*([-\d.\s]+)\]/)?.[1].trim().split(/\s+/).map(Number);
if (!idContenido || !bbox || !gpts || !lpts) throw new Error('El PDF no tiene flujo de contenido, marco (BBox) o puntos de control geográficos (GPTS/LPTS).');
const ini = s.indexOf(`${idContenido} 0 obj`);
let ps = s.indexOf('stream', ini); ps += s[ps + 6] === '\r' ? 8 : 7;
const contenido = inflateSync(pdf.subarray(ps, s.indexOf('endstream', ps))).toString('latin1');

// Georreferenciación: LPTS (0,0) = primera esquina del BBox; (1,1) = la segunda. Se convierten las 4 esquinas a UTM.
const [bx0, by0, bx1, by1] = bbox;
const esquinas = [];
for (let i = 0; i < 4; i++) esquinas.push({ lx: lpts[2 * i], ly: lpts[2 * i + 1], ...llToUtm(gpts[2 * i], gpts[2 * i + 1]) });
const E0 = Math.min(...esquinas.map((c) => c.E)), E1 = Math.max(...esquinas.map((c) => c.E));
const N0 = Math.min(...esquinas.map((c) => c.N)), N1 = Math.max(...esquinas.map((c) => c.N));
const rectOk = esquinas.every((c) => Math.min(Math.abs(c.E - E0), Math.abs(c.E - E1)) < 2 && Math.min(Math.abs(c.N - N0), Math.abs(c.N - N1)) < 2);
const xMin = Math.min(bx0, bx1), xMax = Math.max(bx0, bx1), yMin = Math.min(by0, by1), yMax = Math.max(by0, by1);
const pdfAUtm = (x, y) => ({ E: E0 + ((x - xMin) / (xMax - xMin)) * (E1 - E0), N: N0 + ((y - yMin) / (yMax - yMin)) * (N1 - N0) });
const pdfALl = (x, y) => { const p = pdfAUtm(x, y); return utmToLl(p.E, p.N); };
const MPP = (E1 - E0) / (xMax - xMin); // metros de cuadrícula por punto del PDF

// ------------------------------------------------------------------ Intérprete del flujo de contenido (solo lo necesario)
let pos = 0;
function* tokens() {
  const t = contenido, L = t.length;
  while (pos < L) {
    const c = t[pos];
    if (/\s|\0/.test(c)) { pos++; continue; }
    if (c === '(') {
      let depth = 1, str = ''; pos++;
      while (pos < L && depth > 0) {
        const d = t[pos];
        if (d === '\\') { const nx = t[pos + 1]; if (/[0-7]/.test(nx)) { let o = '', k = 0; while (k < 3 && /[0-7]/.test(t[pos + 1 + k])) { o += t[pos + 1 + k]; k++; } str += String.fromCharCode(parseInt(o, 8)); pos += 1 + k; continue; } str += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[nx] ?? nx; pos += 2; continue; }
        if (d === '(') depth++;
        if (d === ')') { depth--; if (depth === 0) { pos++; break; } }
        str += d; pos++;
      }
      yield { type: 'str', v: str }; continue;
    }
    if (c === '[' || c === ']') { pos++; yield { type: 'arr' }; continue; }
    if ((c === '<' || c === '>') && t[pos + 1] === c) { pos += 2; yield { type: 'op', v: c + c }; continue; }
    if (c === '/') { let j = pos + 1; while (j < L && !/[\s/[\]()<>]/.test(t[j])) j++; pos = j; yield { type: 'name' }; continue; }
    let j = pos; while (j < L && !/[\s/[\]()<>]/.test(t[j])) j++;
    const w = t.slice(pos, j); pos = j;
    yield /^[-+]?(\d+\.?\d*|\.\d+)$/.test(w) ? { type: 'num', v: parseFloat(w) } : { type: 'op', v: w };
  }
}
const mul = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const cat = (m1, m2) => [m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3], m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3], m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5]];

let ctm = [1, 0, 0, 1, 0, 0]; const pila = [];
let fill = [0, 0, 0]; let rings = []; let cur = null;
const rellenos = []; const textos = [];
let ops = []; let tm = null; let tlm = null; let bloque = null;
for (const tk of tokens()) {
  if (tk.type !== 'op') { ops.push(tk); continue; }
  const nums = ops.filter((x) => x.type === 'num').map((x) => x.v);
  switch (tk.v) {
    case 'q': pila.push({ ctm: ctm.slice(), fill: fill.slice() }); break;
    case 'Q': { const st = pila.pop(); if (st) { ctm = st.ctm; fill = st.fill; } break; }
    case 'cm': ctm = cat(nums, ctm); break;
    case 'rg': fill = nums.slice(0, 3); break;
    case 'g': fill = [nums[0], nums[0], nums[0]]; break;
    case 'm': cur = [mul(ctm, nums)]; rings.push(cur); break;
    case 'l': if (cur) cur.push(mul(ctm, nums)); break;
    case 're': rings.push([mul(ctm, [nums[0], nums[1]]), mul(ctm, [nums[0] + nums[2], nums[1]]), mul(ctm, [nums[0] + nums[2], nums[1] + nums[3]]), mul(ctm, [nums[0], nums[1] + nums[3]])]); break;
    case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
      rellenos.push({ color: fill.map((v) => Math.round(v * 255)), rings: rings.filter((r) => r.length >= 3) }); rings = []; cur = null; break;
    case 'S': case 's': case 'n': rings = []; cur = null; break;
    case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); bloque = { partes: [], origenes: [], matriz: null }; break;
    case 'ET': if (bloque && bloque.partes.length) textos.push(bloque); bloque = null; break;
    case 'Tm': tm = nums.slice(0, 6); tlm = tm.slice(); break;
    case 'Td': case 'TD': tlm = cat([1, 0, 0, 1, nums[0], nums[1]], tlm); tm = tlm.slice(); break;
    case 'Tj': if (bloque) { bloque.partes.push(ops.find((x) => x.type === 'str')?.v ?? ''); bloque.origenes.push(mul(ctm, [tm[4], tm[5]])); bloque.matriz = cat(tm, ctm); } break;
    default: break;
  }
  ops = [];
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ Aplicación (mismo código que corre en el navegador)
const ctx = vm.createContext({ console, fetch: async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(join(PUBLIC, u), 'utf8')) }) });
for (const fl of ['js/config.js', 'js/geo.js', 'js/zonificacion.js']) vm.runInContext(readFileSync(join(PUBLIC, fl), 'utf8'), ctx, { filename: fl });
const Zon = vm.runInContext('Zonificacion', ctx);
const geo = JSON.parse(readFileSync(join(PUBLIC, 'data', 'zonas_aqp.geojson'), 'utf8'));
const reglas = JSON.parse(readFileSync(join(PUBLIC, 'data', 'reglas_zonas.json'), 'utf8'));
const colorACodigo = {};
geo.features.forEach((ft) => { colorACodigo[ft.properties.color.toLowerCase()] = ft.properties.codigo; });

const resultado = { fuente: { archivo: RUTA.split(/[\\/]/).pop(), sha256: huella, bytes: pdf.length, marcoUtm: { E: [E0, E1], N: [N0, N1] }, metrosPorPunto: MPP } };
const linea = (t) => console.log(t);
linea(`PDF: ${resultado.fuente.archivo} (${(pdf.length / 1048576).toFixed(1)} MB, SHA-256 ${huella.slice(0, 16)}…)`);

// 1. Georreferenciación
linea('\n== 1. Georreferenciación ==');
linea(`marco UTM 19S: E ${E0.toFixed(0)}–${E1.toFixed(0)}, N ${N0.toFixed(0)}–${N1.toFixed(0)}; esquinas forman un rectángulo alineado (±2 m): ${rectOk ? 'sí' : 'NO'}; ${MPP.toFixed(4)} m por punto`);
const rE = [], rN = [];
for (const b of textos) {
  const tx = b.partes.join('').trim();
  if (!/^\d{6,7}$/.test(tx)) continue;
  const v = parseInt(tx, 10); const [x, y] = b.origenes[b.origenes.length - 1]; const p = pdfAUtm(x, y);
  (v < 1e6 ? rE : rN).push((v < 1e6 ? p.E : p.N) - v);
}
const med = (arr) => [...arr].sort((p, q) => p - q)[Math.floor(arr.length / 2)];
linea(`cuadrícula impresa (el origen del último dígito de cada valor marca la línea): Este ${rE.length} etiquetas, desfase mediano ${med(rE).toFixed(1)} m (rango ${Math.min(...rE).toFixed(1)} a ${Math.max(...rE).toFixed(1)}); Norte ${rN.length} etiquetas, mediano ${med(rN).toFixed(1)} m (rango ${Math.min(...rN).toFixed(1)} a ${Math.max(...rN).toFixed(1)}; texto rotado, anclaje constante)`);
resultado.georreferenciacion = { rectanguloAlineado: rectOk, cuadriculaEste: { n: rE.length, medianaM: med(rE) }, cuadriculaNorte: { n: rN.length, medianaM: med(rN) } };

// 2. Polígonos
linea('\n== 2. Polígonos del PDF frente al GeoJSON ==');
const bbDe = (r) => { const xs = r.rings.flat().map((p) => p[0]), ys = r.rings.flat().map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
// Rellenos del mapa: tienen un color de zona y tocan el marco (la leyenda y las muestras quedan fuera)
const mapa = rellenos.map((r) => ({ ...r, bb: bbDe(r), codigo: colorACodigo[hex(r.color)] })).filter((r) => r.codigo && r.bb[3] > yMin + 5 && r.bb[1] < yMax && r.bb[2] > xMin - 200 && r.bb[0] < xMax + 200);
const coloresPdf = new Set(rellenos.map((r) => hex(r.color)));
const faltanEnPdf = Object.keys(colorACodigo).filter((c) => !coloresPdf.has(c));
linea(`rellenos de zona en el PDF: ${mapa.length}; polígonos del GeoJSON: ${geo.features.length}; colores del GeoJSON ausentes del PDF: ${faltanEnPdf.length}`);
const areaAn = (r) => { let q = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) q += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(q / 2); };
const inRing = (x, y, r) => { let q = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) q = !q; } return q; };
const areaParImpar = (rs) => rs.reduce((t, r, i) => t + (rs.filter((o, j) => j !== i && inRing(r[0][0], r[0][1], o)).length % 2 === 0 ? 1 : -1) * areaAn(r), 0);
const cPdf = {}, hPdf = {};
mapa.forEach((r) => { cPdf[r.codigo] = (cPdf[r.codigo] || 0) + 1; hPdf[r.codigo] = (hPdf[r.codigo] || 0) + (areaParImpar(r.rings) * MPP * MPP) / 1e4; });
const R = 6371008.8, rad = (x) => (x * Math.PI) / 180;
const areaLL = (r) => { const lat0 = r.reduce((t, p) => t + p[1], 0) / r.length; const kx = Math.cos(rad(lat0)) * R * (Math.PI / 180), ky = R * (Math.PI / 180); let q = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) q += r[j][0] * kx * r[i][1] * ky - r[i][0] * kx * r[j][1] * ky; return Math.abs(q) / 2; };
const cGeo = {}, hGeo = {};
geo.features.forEach((ft) => { const polis = ft.geometry.type === 'Polygon' ? [ft.geometry.coordinates] : ft.geometry.coordinates; let q = 0; for (const p of polis) { q += areaLL(p[0]); for (const h of p.slice(1)) q -= areaLL(h); } hGeo[ft.properties.codigo] = (hGeo[ft.properties.codigo] || 0) + q / 1e4; cGeo[ft.properties.codigo] = (cGeo[ft.properties.codigo] || 0) + 1; });
const codigos = Object.keys(cGeo);
const distintos = codigos.filter((c) => (cPdf[c] || 0) !== cGeo[c]);
const rel = codigos.map((c) => (hPdf[c] / hGeo[c] - 1) * 100).sort((p, q) => p - q);
linea(`códigos con distinto número de polígonos: ${distintos.length} de ${codigos.length}${distintos.length ? ` (${distintos.join(', ')})` : ''}`);
linea(`diferencia de área por código (PDF en metros de cuadrícula frente a GeoJSON en tierra esférica): mínima ${rel[0].toFixed(2)} %, mediana ${rel[Math.floor(rel.length / 2)].toFixed(2)} %, máxima ${rel[rel.length - 1].toFixed(2)} % (la diferencia uniforme viene de la proyección y de la esfera, no de los datos)`);
const totPdf = Object.values(hPdf).reduce((p, q) => p + q, 0);
linea(`superficie total en el PDF: ${totPdf.toFixed(0)} ha (cuadrícula UTM); la Memoria oficial da 37 107 ha de área urbana: ${((totPdf / 37107 - 1) * 100).toFixed(1)} %`);
resultado.poligonos = { rellenosPdf: mapa.length, poligonosGeoJson: geo.features.length, codigosConDistintoNumero: distintos, coloresDelGeoJsonAusentes: faltanEnPdf, diferenciaAreaPorCodigoPct: { min: rel[0], mediana: rel[Math.floor(rel.length / 2)], max: rel[rel.length - 1] }, hectareasPdf: totPdf };

// 3. Puntos al azar
linea('\n== 3. Puntos al azar: color del PDF frente a la zona de la aplicación ==');
const dentroPdf = (r, x, y) => { if (x < r.bb[0] || x > r.bb[2] || y < r.bb[1] || y > r.bb[3]) return false; let c = 0; for (const ring of r.rings) if (inRing(x, y, ring)) c++; return c % 2 === 1; };
let sem = 12345; const az = () => { sem = (sem * 1664525 + 1013904223) % 4294967296; return sem / 4294967296; };
const NP = 30000; let conZona = 0, coinciden = 0; const difs = {};
for (let k = 0; k < NP; k++) {
  const x = xMin + az() * (xMax - xMin), y = yMin + az() * (yMax - yMin);
  let cp = null; for (const r of mapa) if (dentroPdf(r, x, y)) cp = r.codigo; // el último relleno dibujado queda encima
  const { lat, lon } = pdfALl(x, y);
  const ap = (await Zon.lookup(lat, lon))?.codigo ?? null;
  if (!cp && !ap) continue;
  conZona++;
  if (cp === ap) coinciden++; else { const kk = `${cp} → ${ap}`; difs[kk] = (difs[kk] || 0) + 1; }
}
linea(`${NP} puntos en el marco; ${conZona} con zona en el PDF o en la aplicación; coinciden ${coinciden} (${((100 * coinciden) / conZona).toFixed(3)} %)`);
linea(`discrepancias: ${Object.entries(difs).map(([k, v]) => `${k}: ${v}`).join(' | ') || 'ninguna'}`);
resultado.puntosAlAzar = { total: NP, conZona, coinciden, tasa: coinciden / conZona, discrepancias: difs };

// 4. Etiquetas
linea('\n== 4. Etiquetas impresas frente a la zona de la aplicación ==');
const alias = { 'E-1': 'E', 'E-2': 'E', 'E-3': 'E', 'E-4': 'E', 'H-1': 'H', 'H-2': 'H', 'H-3': 'H', 'H-4': 'H', EA: 'ZA', ZRP: 'RP' };
const etiquetas = [];
for (const b of textos) {
  const t = b.partes.join('').trim(); const cod = alias[t] || t;
  if (!(cod in reglas) || !b.matriz) continue;
  const tam = Math.hypot(b.matriz[0], b.matriz[1]); const horiz = Math.abs(b.matriz[1]) < 1e-6;
  const [x0, y0] = b.origenes[0], [x1, y1] = b.origenes[b.origenes.length - 1]; const ancho = 0.55 * tam;
  const cx = horiz ? (x0 + x1 + ancho) / 2 : (x0 + x1) / 2, cy = horiz ? y0 + 0.35 * tam : (y0 + y1 + ancho) / 2;
  if (cx < xMin || cx > xMax || cy < yMin || cy > yMax) continue;
  etiquetas.push({ t, cod, cx, cy });
}
const distA = (lat, lon, cod) => { const mLat = 111320, mLon = 111320 * Math.cos(rad(lat)); let best = Infinity; for (const ft of geo.features) { if (ft.properties.codigo !== cod) continue; const polis = ft.geometry.type === 'Polygon' ? [ft.geometry.coordinates] : ft.geometry.coordinates; for (const an of polis) { const r = an[0]; for (let i = 0; i < r.length - 1; i++) { const ax = (r[i][0] - lon) * mLon, ay = (r[i][1] - lat) * mLat, bx = (r[i + 1][0] - lon) * mLon, by = (r[i + 1][1] - lat) * mLat; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)); best = Math.min(best, Math.hypot(ax + u * dx, ay + u * dy)); } } } return best; };
let okE = 0; const lej = [];
for (const et of etiquetas) { const { lat, lon } = pdfALl(et.cx, et.cy); const z = await Zon.lookup(lat, lon); if (z && z.codigo === et.cod) okE++; else lej.push(Math.round(distA(lat, lon, et.cod))); }
lej.sort((p, q) => p - q);
linea(`etiquetas de zona dentro del marco: ${etiquetas.length} (una por polígono); la aplicación da la zona impresa en ${okE} (${((100 * okE) / etiquetas.length).toFixed(1)} %)`);
linea(`las ${lej.length} que no coinciden están a ${lej.join(', ')} m del polígono de su propio código (el centro de la etiqueta es aproximado)`);
resultado.etiquetas = { total: etiquetas.length, coinciden: okE, desacuerdosMetrosAlPoligonoPropio: lej };

// 5. Discrepancias de la validación con OpenStreetMap: ¿qué pinta el PDF oficial en esos puntos?
linea('\n== 5. Discrepancias de OpenStreetMap frente al PDF oficial ==');
try {
  const osm = JSON.parse(readFileSync(join(RAIZ, 'docs', 'validacion', 'resultado-osm.json'), 'utf8'));
  const aPdf = (lat, lon) => { const u = llToUtm(lat, lon); return [xMin + ((u.E - E0) / (E1 - E0)) * (xMax - xMin), yMin + ((u.N - N0) / (N1 - N0)) * (yMax - yMin)]; };
  const zonaPdf = (lat, lon) => { const [x, y] = aPdf(lat, lon); let cp = null; for (const r of mapa) if (dentroPdf(r, x, y)) cp = r.codigo; return cp; };
  const dscs = Object.values(osm.tipos).flatMap((t) => t.discrepancias || []).filter((d0) => d0.zona);
  const iguales = dscs.filter((d0) => zonaPdf(d0.lat, d0.lon) === d0.zona).length;
  linea(`${dscs.length} discrepancias (lugar de OSM fuera de la zona esperada); el PDF oficial pinta la misma zona que la aplicación en ${iguales}`);
  resultado.discrepanciasOsm = { total: dscs.length, elPdfPintaLaMismaZona: iguales };
} catch (err) { linea(`no se pudo hacer: ${err.message} (primero corre scripts/validar-zonificacion-osm.mjs)`); }

writeFileSync(join(RAIZ, 'docs', 'validacion', 'resultado-plano.json'), JSON.stringify(resultado, null, 2));
linea('\nResultado guardado en docs/validacion/resultado-plano.json');
