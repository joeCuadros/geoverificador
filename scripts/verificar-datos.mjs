/**
 * verificar-datos.mjs — Comprueba que los datos de public/data estén íntegros y que el código del
 * navegador calcule lo mismo que un método independiente.
 *
 * Uso:   node scripts/verificar-datos.mjs
 * Sale con código 1 si alguna comprobación falla. No necesita internet ni dependencias.
 *
 * Qué comprueba (y qué NO):
 *  A. Integridad de los archivos: formato, campos obligatorios, rangos, conteos que cuadran con los metadatos,
 *     y que los datos de delitos no incluyan dirección, cuadra ni hora.
 *  B. Corrección de los cálculos: se ejecuta el MISMO código del navegador (zonificacion.js, peligros.js,
 *     delitos.js) y se compara con un cálculo independiente hecho aquí (número de vueltas para
 *     punto-en-polígono, ley esférica de los cosenos para distancias, fuerza bruta sin índice).
 *  NO comprueba que la zonificación coincida con el plano oficial ni que las denuncias reflejen la realidad:
 *  eso se valida contra fuentes externas (ver docs/VALIDACION.md).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const leer = (ruta) => readFileSync(join(RAIZ, ruta), 'utf8');
const json = (ruta) => JSON.parse(leer(ruta));

let fallos = 0;
let pruebas = 0;
function comprobar(nombre, ok, detalle = '') {
  pruebas++;
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

// Semilla fija para que el resultado sea reproducible.
let semilla = 20260101;
const azar = () => {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
};

// ---------------------------------------------------------------- Carga
const zonas = json('data/zonas_aqp.geojson');
const reglas = json('data/reglas_zonas.json');
const delitos = json('data/delitos_aqp.geojson');
const peligros = json('data/peligros_aqp.geojson');

// ------------------------------------------------------------------ A. Integridad
console.log('\n== A. Integridad de los archivos ==');

// Zonificación
{
  const f = zonas.features;
  comprobar('Zonas: es una FeatureCollection con polígonos', zonas.type === 'FeatureCollection' && f.every((x) => /Polygon/.test(x.geometry?.type)), `${f.length} polígonos`);
  comprobar('Zonas: todas tienen `codigo` y `color`', f.every((x) => x.properties?.codigo && x.properties?.color));
  const sinRegla = [...new Set(f.map((x) => x.properties.codigo))].filter((c) => !reglas[c]);
  comprobar('Zonas: todo código del plano existe en la tabla de reglas', sinRegla.length === 0, sinRegla.length ? `faltan: ${sinRegla.join(', ')}` : '');
  const usados = new Set(f.map((x) => x.properties.codigo));
  const sinPoligono = Object.keys(reglas).filter((c) => !usados.has(c));
  console.log(`INFO  Códigos de la tabla sin polígono en el archivo: ${sinPoligono.join(', ') || 'ninguno'}`);
  const colorDe = {};
  const codigosDe = {};
  f.forEach((x) => {
    (colorDe[x.properties.color] ||= new Set()).add(x.properties.codigo);
    (codigosDe[x.properties.codigo] ||= new Set()).add(x.properties.color);
  });
  const conflictos = [...Object.entries(colorDe), ...Object.entries(codigosDe)].filter(([, s]) => s.size > 1);
  comprobar('Zonas: cada color corresponde a un solo código y cada código a un solo color (la asignación por color es consistente)', conflictos.length === 0, `${Object.keys(colorDe).length} colores, ${Object.keys(codigosDe).length} códigos`);
  const coords = f.flatMap((x) => (x.geometry.type === 'Polygon' ? [x.geometry.coordinates] : x.geometry.coordinates).flat(2));
  comprobar('Zonas: coordenadas dentro de Arequipa (lon -72…-71, lat -17…-16)', coords.every(([x, y]) => x > -72 && x < -71 && y > -17 && y < -16));
}

// Reglas
{
  const validos = ['si', 'condicionado', 'no'];
  const malos = Object.entries(reglas).filter(([, r]) => !r.nombre || !validos.includes(r.edificable));
  comprobar('Reglas: cada código tiene nombre y `edificable` válido', malos.length === 0, `${Object.keys(reglas).length} códigos`);
  const sinCoef = Object.entries(reglas).filter(([, r]) => r.edificable === 'si' && typeof r.coef_base !== 'number');
  console.log(`INFO  Códigos «si» sin coeficiente numérico (el potencial no se calcula): ${sinCoef.map(([c]) => c).join(', ') || 'ninguno'}`);
  const incoherentes = Object.entries(reglas).filter(([, r]) => typeof r.coef_base === 'number' && typeof r.coef_max === 'number' && r.coef_max < r.coef_base);
  comprobar('Reglas: coef_max nunca es menor que coef_base', incoherentes.length === 0);
}

// Delitos
{
  const f = delitos.features;
  const m = delitos.metadata;
  comprobar('Delitos: metadata.registros coincide con el número de features', m.registros === f.length, `${f.length}`);
  comprobar('Delitos: solo ROBO y HURTO', f.every((x) => ['ROBO', 'HURTO'].includes(x.properties.subtipo)));
  const prohibidos = ['direccion', 'direccion_hecho', 'cuadra', 'cuadra_hecho', 'hora', 'hora_hecho', 'fecha_hora_hecho'];
  const filtrados = new Set(f.flatMap((x) => Object.keys(x.properties)).filter((k) => prohibidos.includes(k)));
  comprobar('Delitos: no guarda dirección, cuadra ni hora exacta', filtrados.size === 0, [...filtrados].join(', '));
  comprobar('Delitos: fechas con formato AAAA-MM-DD', f.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.properties.fecha)));
  comprobar('Delitos: metadata.desde/hasta coinciden con las fechas reales', (() => {
    const fs = f.map((x) => x.properties.fecha).sort();
    return fs[0] === m.desde && fs[fs.length - 1] === m.hasta;
  })(), `${m.desde} a ${m.hasta}`);
  comprobar('Delitos: coordenadas dentro de Arequipa', f.every((x) => x.geometry.coordinates[0] > -72.2 && x.geometry.coordinates[0] < -70.9 && x.geometry.coordinates[1] > -16.8 && x.geometry.coordinates[1] < -16));
  comprobar('Delitos: ids únicos', new Set(f.map((x) => x.properties.id)).size === f.length);
  comprobar('Delitos: el filtro registrado usa solo coordenadas INVERTIDA', /ESTADO_COORD = 'INVERTIDA'/.test(m.filtro));
  const porMes = {};
  f.forEach((x) => { const k = x.properties.fecha.slice(0, 7); porMes[k] = (porMes[k] || 0) + 1; });
  const desfases = Object.entries(m.cobertura).filter(([k, c]) => c.conUbicacion !== (porMes[k] || 0) || c.conUbicacion > c.total);
  comprobar('Delitos: la cobertura mensual cuadra con los registros descargados (por mes, con ubicación = features del mes)', desfases.length === 0 && Object.keys(porMes).every((k) => m.cobertura[k]), `${Object.keys(m.cobertura).length} meses${desfases.length ? `; desfasados: ${desfases.map(([k]) => k).join(', ')}` : ''}`);
}

// Peligros
{
  const f = peligros.features;
  const m = peligros.metadata;
  comprobar('Peligros: metadata.registros coincide con el número de features', m.registros === f.length, `${f.length}`);
  comprobar('Peligros: ningún código crudo (1000|1500…) quedó sin traducir', f.every((x) => !/\d{3,4}\|/.test(`${x.properties.tipo ?? ''}${x.properties.subtipo ?? ''}`)));
  comprobar('Peligros: ids únicos', new Set(f.map((x) => x.properties.id)).size === f.length);
  comprobar('Peligros: años de registro entre 1990 y hoy', f.every((x) => x.properties.anio === null || (x.properties.anio >= 1990 && x.properties.anio <= new Date().getFullYear())));
  comprobar('Peligros: metadata.anioDesde/anioHasta coinciden con los registros', (() => {
    const a = f.map((x) => x.properties.anio).filter(Boolean).sort();
    return a[0] === m.anioDesde && a[a.length - 1] === m.anioHasta;
  })(), `${m.anioDesde} a ${m.anioHasta}`);
  console.log(`INFO  Códigos que el diccionario oficial no define: ${(m.codigosSinDefinir || []).join(', ') || 'ninguno'}`);
}

// ------------------------------------------------- B. Corrección de los cálculos
console.log('\n== B. Cálculos del navegador frente a un método independiente ==');

// Se carga el código real del navegador en un contexto aislado, con un fetch que lee public/.
const ctx = vm.createContext({
  console,
  fetch: async (url) => {
    try {
      const texto = leer(url);
      return { ok: true, status: 200, json: async () => JSON.parse(texto) };
    } catch (_) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  },
});
for (const f of ['js/config.js', 'js/geo.js', 'js/zonificacion.js', 'js/peligros.js', 'js/delitos.js']) {
  vm.runInContext(leer(f), ctx, { filename: f });
}
const app = (expr) => vm.runInContext(expr, ctx);
const Zon = app('Zonificacion');
const Pel = app('Peligros');
const Del = app('Delitos');
const CONFIG = app('CONFIG');
const [oeste, norte, este, sur] = CONFIG.viewbox.split(',').map(Number);

// Distancia por otra fórmula (ley esférica de los cosenos), distinta de la haversine del código.
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const distCosenos = (la1, lo1, la2, lo2) => {
  const c = Math.sin(rad(la1)) * Math.sin(rad(la2)) + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1));
  return R * Math.acos(Math.min(1, Math.max(-1, c)));
};

// Punto en polígono por número de vueltas (winding number), distinto del ray casting del código.
function vueltas(x, y, anillo) {
  let w = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[j];
    const [xj, yj] = anillo[i];
    const lado = (xj - xi) * (y - yi) - (x - xi) * (yj - yi);
    if (yi <= y) { if (yj > y && lado > 0) w++; } else if (yj <= y && lado < 0) w--;
  }
  return w !== 0;
}
const dentro = (x, y, anillos) => vueltas(x, y, anillos[0]) && !anillos.slice(1).some((h) => vueltas(x, y, h));

// B1. Zonificación: 2000 puntos al azar; el resultado debe coincidir con el último polígono que contiene el punto.
{
  let distintos = 0;
  let conZona = 0;
  const detalles = [];
  for (let k = 0; k < 2000; k++) {
    const lat = sur + azar() * (norte - sur);
    const lon = oeste + azar() * (este - oeste);
    let esperado = null;
    for (const f of zonas.features) {
      const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (polis.some((p) => dentro(lon, lat, p))) esperado = f.properties.codigo;
    }
    const obtenido = (await Zon.lookup(lat, lon))?.codigo ?? null;
    if (obtenido) conZona++;
    if (obtenido !== esperado) { distintos++; if (detalles.length < 3) detalles.push(`${lat.toFixed(5)},${lon.toFixed(5)}: código ${obtenido} vs ${esperado}`); }
  }
  comprobar('Zonificación: 2000 puntos al azar coinciden con el método independiente', distintos === 0, `${conZona} cayeron dentro del plano; ${detalles.join(' | ')}`);
}

// B2. Potencial constructivo: aritmética comprobada a mano con una regla real del archivo.
{
  const [cod, r] = Object.entries(reglas).find(([, x]) => x.edificable === 'si' && typeof x.coef_base === 'number' && typeof x.coef_max === 'number' && x.area_libre_pct !== null && x.area_libre_pct !== undefined);
  const lote = 300;
  const pot = Zon.potencial(r, lote);
  const [l0, l1] = String(r.area_libre_pct).split('-').map(Number);
  const libreMin = Math.min(l0, l1 ?? l0);
  const libreMax = Math.max(l0, l1 ?? l0);
  const okConstruible = Math.abs(pot.construible[0] - lote * r.coef_base) < 1e-9 && Math.abs(pot.construible[1] - lote * r.coef_max) < 1e-9;
  const okOcupable = Math.abs(pot.ocupable[0] - lote * (1 - libreMax / 100)) < 1e-9 && Math.abs(pot.ocupable[1] - lote * (1 - libreMin / 100)) < 1e-9;
  comprobar(`Potencial (${cod}, lote de ${lote} m²): construible = lote × coeficiente`, okConstruible, `${pot.construible.map((n) => Math.round(n))} m²`);
  comprobar(`Potencial (${cod}): ocupable = lote × (1 − área libre)`, okOcupable, `${pot.ocupable.map((n) => Math.round(n))} m²`);
  comprobar('Potencial: zonas no construibles o condicionadas devuelven null', Object.values(reglas).filter((x) => x.edificable !== 'si').every((x) => Zon.potencial(x, 300) === null));
}

// B3. Peligros: conteo a 500 m y más cercano frente a fuerza bruta con otra fórmula de distancia.
{
  let malos = 0;
  const radio = CONFIG.peligros.radio;
  for (let k = 0; k < 200; k++) {
    // la mitad de los puntos sobre un peligro real, para que haya resultados no triviales
    let lat; let lon;
    if (k % 2 === 0) { const [x, y] = peligros.features[Math.floor(azar() * peligros.features.length)].geometry.coordinates; lat = y + (azar() - 0.5) * 0.008; lon = x + (azar() - 0.5) * 0.008; }
    else { lat = sur + azar() * (norte - sur); lon = oeste + azar() * (este - oeste); }
    const esp = peligros.features.map((f) => distCosenos(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]));
    const total = esp.filter((d) => d <= radio).length;
    const minimo = Math.min(...esp);
    const r = await Pel.indicador(lat, lon);
    if (r.total !== total || Math.abs(r.masCercano.distancia - minimo) > 0.5) malos++;
  }
  comprobar('Peligros: 200 puntos (conteo a 500 m y distancia al más cercano) coinciden', malos === 0, `${malos} diferencias`);
}

// B4. Delitos: periodo elegido y conteo a 500 m por tipo frente a fuerza bruta sobre ese periodo.
{
  const hasta = delitos.metadata.hasta;
  const cob = delitos.metadata.cobertura;
  // Regla escrita aparte: desde el último mes, retroceder mientras la cobertura sea ≥ mínima (tope maxMeses).
  const claves = Object.keys(cob).sort().reverse().filter((k) => k <= hasta.slice(0, 7));
  const elegidos = [];
  for (const k of claves) {
    if (elegidos.length >= CONFIG.delitos.maxMeses || cob[k].conUbicacion / cob[k].total < CONFIG.delitos.coberturaMinima) break;
    elegidos.push(k);
  }
  const desde = `${elegidos[elegidos.length - 1]}-01`;
  const meta = await Del.load();
  comprobar('Delitos: el periodo que usa el navegador coincide con la regla de cobertura', meta.ventanaDesde === desde && meta.meses === elegidos.length, `${desde} a ${hasta} (${elegidos.length} meses)`);
  const ventana = delitos.features.filter((f) => f.properties.fecha >= desde && f.properties.fecha <= hasta);
  comprobar('Delitos: la cobertura de cada mes del periodo es ≥ 80 %', elegidos.every((k) => cob[k].conUbicacion / cob[k].total >= 0.8));
  let malos = 0;
  let conDenuncias = 0;
  const radio = CONFIG.delitos.radio;
  for (let k = 0; k < 300; k++) {
    let lat; let lon;
    if (k % 2 === 0) { const [x, y] = ventana[Math.floor(azar() * ventana.length)].geometry.coordinates; lat = y + (azar() - 0.5) * 0.01; lon = x + (azar() - 0.5) * 0.01; }
    else { lat = sur + azar() * (norte - sur); lon = oeste + azar() * (este - oeste); }
    const cerca = ventana.filter((f) => distCosenos(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) <= radio);
    const esp = { total: cerca.length, ROBO: cerca.filter((f) => f.properties.subtipo === 'ROBO').length, HURTO: cerca.filter((f) => f.properties.subtipo === 'HURTO').length };
    if (esp.total > 0) conDenuncias++;
    const r = (await Del.indicador(lat, lon)).conteo;
    if (r.total !== esp.total || r.ROBO !== esp.ROBO || r.HURTO !== esp.HURTO) malos++;
  }
  comprobar(`Delitos: 300 puntos (total, robo, hurto a 500 m) coinciden con el método independiente`, malos === 0, `${malos} diferencias; ${conDenuncias} puntos con al menos 1 denuncia; ${ventana.length} de ${delitos.features.length} registros en el periodo`);
}

console.log(`
${pruebas - fallos} de ${pruebas} comprobaciones correctas.`);
if (fallos) {
  console.error(`${fallos} FALLARON.`);
  process.exit(1);
}
