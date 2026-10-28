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
const distritos = json('data/distritos_aqp.geojson');
const e030 = json('data/zonas_sismicas_e030.json');
const equipamiento = Object.fromEntries(['salud', 'educacion', 'transporte', 'areas_verdes'].map((n) => [n, json(`data/equipamiento/${n}.geojson`)]));

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
  // Superficie: la Memoria oficial (Reglamento, Título II) da 37 107 ha de área urbana. Se compara la suma de áreas de los
  // polígonos (proyección local; los polígonos no se superponen) como control de escala y cobertura. NO valida cada polígono.
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const areaAnillo = (r) => {
    const lat0 = r.reduce((t, p) => t + p[1], 0) / r.length;
    const kx = Math.cos(rad(lat0)) * R * (Math.PI / 180);
    const ky = R * (Math.PI / 180);
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * kx * (r[i][1] * ky) - r[i][0] * kx * (r[j][1] * ky);
    return Math.abs(a) / 2;
  };
  const ha = f.reduce((t, x) => {
    const polis = x.geometry.type === 'Polygon' ? [x.geometry.coordinates] : x.geometry.coordinates;
    return t + polis.reduce((u, p) => u + areaAnillo(p[0]) - p.slice(1).reduce((v, h) => v + areaAnillo(h), 0), 0) / 1e4;
  }, 0);
  const oficial = 37107;
  comprobar('Zonas: la superficie total está a ±10 % del área urbana oficial (37 107 ha, Memoria del PDM, Título II)', Math.abs(ha / oficial - 1) <= 0.1, `${Math.round(ha)} ha (${((ha / oficial - 1) * 100).toFixed(1)} % frente al oficial)`);
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

// Distritos y zona sísmica (E.030)
{
  const f = distritos.features;
  comprobar('Distritos: metadata.registros coincide con el número de features', distritos.metadata.registros === f.length, `${f.length} distritos`);
  comprobar('Distritos: todos tienen ubigeo, nombre y fuente del límite', f.every((x) => /^\d{6}$/.test(x.properties.ubigeo) && x.properties.distrito && x.properties.fuente_limite));
  comprobar('Distritos: ubigeos únicos', new Set(f.map((x) => x.properties.ubigeo)).size === f.length);
  const prov = e030.anexo_ii.AREQUIPA.AREQUIPA;
  const z3 = Object.values(prov).filter((z) => z === 3).length;
  const z4 = Object.values(prov).filter((z) => z === 4).length;
  comprobar('E.030: la provincia de Arequipa tiene 21 distritos en zona 3 y 8 en zona 4 (como dice el Anexo II)', z3 === 21 && z4 === 8, `${z3} y ${z4}`);
  comprobar('E.030: factores Z de la Tabla N.° 1 (4: 0,45; 3: 0,35; 2: 0,25; 1: 0,10)', e030.z['4'] === 0.45 && e030.z['3'] === 0.35 && e030.z['2'] === 0.25 && e030.z['1'] === 0.1);
  const sinZona = f.filter((x) => !e030.anexo_ii?.[x.properties.departamento]?.[x.properties.provincia]?.[x.properties.distrito]);
  comprobar('Distritos: todos tienen zona sísmica en la transcripción del Anexo II', sinZona.length === 0, sinZona.map((x) => x.properties.distrito).join(', '));
}

// Equipamiento de OpenStreetMap (salud, educación, transporte y áreas verdes)
{
  const caja = [-71.75, -16.6, -71.35, -16.2];
  const enCaja = ([x, y]) => x >= caja[0] && x <= caja[2] && y >= caja[1] && y <= caja[3];
  for (const [nombre, fc] of Object.entries(equipamiento)) {
    const f = fc.features;
    const m = fc.metadata || {};
    comprobar(`Equipamiento/${nombre}: metadata con fuente ODbL, fecha de extracción y consulta`, m.fuente === 'OpenStreetMap (ODbL)' && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha_extraccion) && typeof m.consulta === 'string' && m.consulta.includes('[out:json]'), m.fecha_extraccion);
    comprobar(`Equipamiento/${nombre}: metadata.registros coincide con el número de features`, m.registros === f.length && f.length > 0, `${f.length}`);
    comprobar(`Equipamiento/${nombre}: id de OSM único, con nombre y etiquetas`, new Set(f.map((x) => x.properties.osm)).size === f.length && f.every((x) => /^(node|way|relation)\/\d+$/.test(x.properties.osm) && 'nombre' in x.properties && x.properties.tags));
    if (nombre === 'areas_verdes') {
      const anillos = f.flatMap((x) => (x.geometry.type === 'Polygon' ? [x.geometry.coordinates] : x.geometry.coordinates).flat());
      comprobar('Equipamiento/areas_verdes: solo Polygon/MultiPolygon, con anillos cerrados dentro de la caja de Arequipa', f.every((x) => /^(Multi)?Polygon$/.test(x.geometry.type)) && anillos.every((a) => a.length >= 4 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1] && a.every(enCaja)), `${anillos.length} anillos`);
    } else {
      comprobar(`Equipamiento/${nombre}: solo puntos dentro de la caja de Arequipa`, f.every((x) => x.geometry.type === 'Point' && enCaja(x.geometry.coordinates)));
    }
  }
  const sinSalud = equipamiento.salud.features.filter((x) => !(['hospital', 'clinic', 'doctors'].includes(x.properties.tags.amenity) || x.properties.tags.healthcare));
  comprobar('Equipamiento/salud: todo elemento tiene amenity=hospital|clinic|doctors o healthcare', sinSalud.length === 0);
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
for (const f of ['js/config.js', 'js/calculos.js', 'js/geo.js', 'js/zonificacion.js', 'js/peligros.js', 'js/delitos.js', 'js/distritos.js', 'js/riesgos.js']) {
  vm.runInContext(leer(f), ctx, { filename: f });
}
const app = (expr) => vm.runInContext(expr, ctx);
const Zon = app('Zonificacion');
const Calc = app('Calculos');
const Pel = app('Peligros');
const Del = app('Delitos');
const Dis = app('Distritos');
const Rsg = app('Riesgos');
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

// B1b. Equipamiento: haversine, área, punto en polígono, distancia al borde y más cercano frente a métodos independientes.
{
  // Haversine frente a la ley esférica de los cosenos.
  let malosH = 0;
  for (let k = 0; k < 500; k++) {
    const la1 = sur + azar() * (norte - sur); const lo1 = oeste + azar() * (este - oeste);
    const la2 = sur + azar() * (norte - sur); const lo2 = oeste + azar() * (este - oeste);
    if (Math.abs(Calc.haversine(la1, lo1, la2, lo2) - distCosenos(la1, lo1, la2, lo2)) > 0.5) malosH++;
  }
  comprobar('Equipamiento: haversine coincide con la ley de los cosenos en 500 pares (≤ 0,5 m)', malosH === 0, `${malosH} diferencias`);

  const verdes = equipamiento.areas_verdes.features;
  const poligonosDe = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
  // Área geodésica frente a la proyección local con la fórmula del topógrafo (shoelace), anillo por anillo.
  const areaLocal = (r) => {
    const lat0 = r.reduce((t, p) => t + p[1], 0) / r.length;
    const kx = Math.cos(rad(lat0)) * R * (Math.PI / 180);
    const ky = R * (Math.PI / 180);
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * kx * (r[i][1] * ky) - r[i][0] * kx * (r[j][1] * ky);
    return Math.abs(a) / 2;
  };
  let peorArea = 0; let comparados = 0;
  verdes.forEach((f) => {
    const esp = poligonosDe(f.geometry).reduce((t, p) => t + areaLocal(p[0]) - p.slice(1).reduce((u, h) => u + areaLocal(h), 0), 0);
    if (esp < 100) return; // por debajo de 100 m² la diferencia relativa no dice nada
    comparados++;
    peorArea = Math.max(peorArea, Math.abs(Calc.areaGeometriaM2(f.geometry) / esp - 1));
  });
  comprobar(`Equipamiento: área geodésica coincide con la proyección local (peor diferencia ${(peorArea * 100).toFixed(2)} %, tope 2 %)`, peorArea < 0.02, `${comparados} polígonos`);

  // Punto en polígono frente al número de vueltas; distancia al borde: 0 dentro y nunca mayor que la distancia al vértice más cercano.
  let malosP = 0; let malosD = 0;
  for (let k = 0; k < 400; k++) {
    const f = verdes[Math.floor(azar() * verdes.length)];
    const polis = poligonosDe(f.geometry);
    const [x, y] = polis[0][0][Math.floor(azar() * (polis[0][0].length - 1))];
    const lat = y + (azar() - 0.5) * 0.004; const lon = x + (azar() - 0.5) * 0.004;
    const esDentro = polis.some((p) => dentro(lon, lat, p));
    if (polis.some((p) => Calc.puntoEnPoligono(lat, lon, p)) !== esDentro) malosP++;
    const d = Calc.distanciaAGeometriaM(lat, lon, f.geometry);
    if (esDentro) { if (d !== 0) malosD++; continue; }
    const aVertice = Math.min(...polis.flatMap((p) => p.flat().map(([vx, vy]) => distCosenos(lat, lon, vy, vx))));
    if (d > aVertice + 0.5 || d <= 0) malosD++;
  }
  comprobar('Equipamiento: punto en polígono y distancia al borde (400 puntos) coinciden con el método independiente', malosP === 0 && malosD === 0, `${malosP} y ${malosD} diferencias`);

  // Más cercano de salud y transporte frente a fuerza bruta con la ley de los cosenos.
  let malosC = 0;
  const umbral = 1000;
  for (let k = 0; k < 200; k++) {
    const lat = sur + azar() * (norte - sur); const lon = oeste + azar() * (este - oeste);
    for (const n of ['salud', 'transporte']) {
      const cand = equipamiento[n].features.map((f) => ({ nombre: f.properties.nombre, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
      const r = Calc.evaluarMasCercano({ lat, lon }, cand, { umbralM: umbral, fuente: 'x', fecha: 'x', metodo: 'x' });
      const minimo = Math.min(...cand.map((c) => distCosenos(lat, lon, c.lat, c.lon)));
      if (Math.abs(r.distanciaM - minimo) > 0.5 || (r.estado === 'CUMPLE') !== (minimo <= umbral)) malosC++;
    }
  }
  comprobar('Equipamiento: más cercano de salud y transporte (200 puntos × 2) coincide con fuerza bruta', malosC === 0, `${malosC} diferencias`);
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

// B5. Distritos: el distrito del navegador frente al número de vueltas, y un punto conocido.
{
  let malos = 0;
  let dentroN = 0;
  for (let k = 0; k < 1500; k++) {
    const lat = sur + azar() * (norte - sur);
    const lon = oeste + azar() * (este - oeste);
    let esperado = null;
    for (const f of distritos.features) {
      const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (polis.some((p) => dentro(lon, lat, p))) { esperado = f.properties.ubigeo; break; }
    }
    const r = await Dis.lookup(lat, lon);
    if (r) dentroN++;
    if ((r?.ubigeo ?? null) !== esperado) malos++;
  }
  comprobar('Distritos: 1 500 puntos al azar coinciden con el método independiente', malos === 0, `${malos} diferencias; ${dentroN} dentro de algún distrito`);
  const plaza = await Dis.lookup(-16.3988, -71.5369);
  comprobar('Distritos: la Plaza de Armas cae en el distrito AREQUIPA, zona sísmica 3, Z = 0,35', plaza?.distrito === 'AREQUIPA' && plaza.zona === 3 && plaza.z === 0.35);
}

// B6. Gestión de riesgos: catálogo con fuentes, reglas que se activan solo con su dato, sin valores precargados y matriz.
{
  const cat = Rsg.CATALOGO;
  comprobar('Riesgos: cada riesgo del catálogo tiene id único, categoría, título y fuente del dato', new Set(cat.map((r) => r.id)).size === cat.length && cat.every((r) => r.categoria && r.titulo && r.fuente));
  comprobar('Riesgos: cada acción de tratamiento tiene texto y fuente', cat.every((r) => r.acciones.length > 0 && r.acciones.every((a) => a.texto && a.fuente)));
  const ids = (ctx) => Rsg.identificar(ctx).map((r) => r.id).join(',');
  const regla = (codigo) => ({ codigo, regla: reglas[codigo] });
  const casos = [
    ['sin datos: no se identifica ningún riesgo', { zonaStatus: 'loading' }, ''],
    ['fuera del plano: N5 y N7', { zonaStatus: 'outside' }, 'N5,N7'],
    ['zona RDM-2 sin otros datos: N5 y N6', { zonaStatus: 'ok', zona: regla('RDM-2') }, 'N5,N6'],
    ['zona ZA (no edificable): N1', { zonaStatus: 'ok', zona: regla('ZA') }, 'N1,N5,N6'],
    ['zona ZRE-CH (condicionada): N2', { zonaStatus: 'ok', zona: regla('ZRE-CH') }, 'N2,N5,N6'],
    ['zona CZ (comercial): N4', { zonaStatus: 'ok', zona: regla('CZ') }, 'N4,N5,N6'],
    ['zona ZRE-RI1: N1 y D1', { zonaStatus: 'ok', zona: regla('ZRE-RI1') }, 'N1,N5,N6,D1'],
    ['lote de 100 m² en RDB (mínimo 300): N3', { zonaStatus: 'ok', zona: regla('RDB'), lote: 100 }, 'N3,N5,N6'],
    ['lote de 300 m² en RDB: sin N3', { zonaStatus: 'ok', zona: regla('RDB'), lote: 300 }, 'N5,N6'],
    ['peligros a 500 m: D2', { zonaStatus: 'loading', peligro: { total: 2, radio: 500, porTipo: [['Caida', 2]], masCercano: { distancia: 120 } } }, 'D2'],
    ['peligros = 0: sin D2', { zonaStatus: 'loading', peligro: { total: 0, radio: 500, porTipo: [], masCercano: { distancia: 900 } } }, ''],
    ['distrito conocido: D3 y D4', { zonaStatus: 'loading', distrito: { distrito: 'UCHUMAYO', zona: 4, z: 0.45 } }, 'D3,D4'],
    ['denuncias > 0: S1', { zonaStatus: 'loading', delito: { radio: 500, conteo: { total: 3, ROBO: 1, HURTO: 2 }, meta: { meses: 7 } } }, 'S1'],
    ['denuncias = 0: sin S1', { zonaStatus: 'loading', delito: { radio: 500, conteo: { total: 0, ROBO: 0, HURTO: 0 }, meta: { meses: 7 } } }, ''],
  ];
  const fallan = casos.filter(([, ctx, esperado]) => ids(ctx) !== esperado).map(([n, ctx, e]) => `${n}: obtuvo «${ids(ctx)}», esperaba «${e}»`);
  comprobar(`Riesgos: ${casos.length} casos de prueba activan exactamente los riesgos esperados`, fallan.length === 0, fallan.join(' | '));
  const todos = Rsg.identificar({ zonaStatus: 'ok', zona: regla('ZRE-RI1'), lote: 1, peligro: { total: 1, radio: 500, porTipo: [['Caida', 1]], masCercano: { distancia: 10 } }, distrito: { distrito: 'X', zona: 3, z: 0.35 }, delito: { radio: 500, conteo: { total: 1, ROBO: 1, HURTO: 0 }, meta: { meses: 7 } } });
  comprobar('Riesgos: la herramienta no precarga probabilidad, impacto ni decisión', todos.every((r) => !('p' in r) && !('i' in r) && !('decision' in r) && !('nivel' in r)));
  const m = [[1, 1, 'Bajo'], [1, 2, 'Bajo'], [2, 1, 'Bajo'], [1, 3, 'Medio'], [3, 1, 'Medio'], [2, 2, 'Medio'], [2, 3, 'Alto'], [3, 2, 'Alto'], [3, 3, 'Alto']];
  comprobar('Riesgos: matriz 3 × 3 (1-2 bajo, 3-4 medio, 6-9 alto) y sin nivel si falta un valor', m.every(([p, i, n]) => Rsg.nivel(p, i)?.texto === n) && Rsg.nivel(null, 2) === null && Rsg.nivel(2, null) === null);
}

console.log(`\n${pruebas - fallos} de ${pruebas} comprobaciones correctas.`);
if (fallos) {
  console.error(`${fallos} FALLARON.`);
  process.exit(1);
}
