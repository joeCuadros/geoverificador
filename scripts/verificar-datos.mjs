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
import { createRequire } from 'node:module';

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
const quebradas = json('data/quebradas_aqp.geojson');
const sismos = json('data/sismos_igp.geojson');
const volcan = json('data/peligro_volcanico_misti.geojson');
const e030 = json('data/zonas_sismicas_e030.json');
const precios = json('data/precios_m2_distrito.json');
const riesgoCenepred = json('data/riesgo_cenepred_fen2027.json');
const equipamiento = Object.fromEntries(['salud', 'consultorios', 'educacion', 'transporte', 'areas_verdes'].map((n) => [n, json(`data/equipamiento/${n}.geojson`)]));

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

// Quebradas y cauces (ANA, IGP y OpenStreetMap): congelados con scripts/descargar-quebradas.mjs
{
  const f = quebradas.features;
  const m = quebradas.metadata || {};
  comprobar('Quebradas: FeatureCollection con solo líneas (LineString o MultiLineString) y al menos 2 puntos por línea', quebradas.type === 'FeatureCollection' && f.length > 0 && f.every((x) => {
    const lineas = x.geometry?.type === 'LineString' ? [x.geometry.coordinates] : x.geometry?.type === 'MultiLineString' ? x.geometry.coordinates : null;
    return lineas && lineas.every((l) => l.length >= 2);
  }), `${f.length} tramos`);
  const fuentes = m.fuentes || [];
  const ID_FUENTES = ['ANA', 'IGP', 'OSM'];
  comprobar('Quebradas: metadata.fuentes trae ANA, IGP y OpenStreetMap, cada una con nombre, capa, fecha de extracción, elaboración, atribución y licencia', ID_FUENTES.every((id) => {
    const x = fuentes.find((y) => y.id === id);
    return x && !!x.fuente && (!!x.capa || !!x.capas) && /^\d{4}-\d{2}-\d{2}T/.test(x.descargado || '') && !!x.elaboracion && !!x.atribucion && !!x.licencia;
  }) && fuentes.length === 3, fuentes.map((x) => x.id).join(', '));
  comprobar('Quebradas: la ANA se atribuye a la Autoridad Nacional del Agua, el IGP al Instituto Geofísico del Perú y OpenStreetMap lleva ODbL', /Autoridad Nacional del Agua/.test(fuentes.find((x) => x.id === 'ANA')?.fuente || '') && /Instituto Geofísico del Perú/.test(fuentes.find((x) => x.id === 'IGP')?.atribucion || '') && /ODbL/.test(fuentes.find((x) => x.id === 'OSM')?.licencia || ''));
  comprobar('Quebradas: cada tramo dice su fuente (ANA, IGP u OSM)', f.every((x) => ID_FUENTES.includes(x.properties.fuente)));
  const porFuente = Object.fromEntries(ID_FUENTES.map((id) => [id, f.filter((x) => x.properties.fuente === id).length]));
  comprobar('Quebradas: el conteo de tramos por fuente coincide con metadata.fuentes[].registros y la suma con metadata.registros', ID_FUENTES.every((id) => porFuente[id] === fuentes.find((y) => y.id === id)?.registros) && porFuente.ANA + porFuente.IGP + porFuente.OSM === m.registros, JSON.stringify(porFuente));
  comprobar('Quebradas: lo recibido de cada fuente cubre lo que se guardó más lo descartado como duplicado', fuentes.every((x) => x.recibidos >= x.registros + (x.duplicados || 0)), fuentes.map((x) => `${x.id} ${x.recibidos}/${x.registros}/${x.duplicados ?? 0}`).join(' · '));
  comprobar('Quebradas: los tramos de IGP vienen de las capas Quebrada o RiosArequipa y los de OSM tienen el id de su vía', f.filter((x) => x.properties.fuente === 'IGP').every((x) => ['Quebrada', 'RiosArequipa'].includes(x.properties.capa)) && f.filter((x) => x.properties.fuente === 'OSM').every((x) => /^way\/\d+$/.test(x.properties.capa)));
  comprobar('Quebradas: metadata.registros coincide con el número de features y los ids son únicos', m.registros === f.length && new Set(f.map((x) => x.properties.id)).size === f.length);
  const nombres = [...new Set(f.flatMap((x) => [x.properties.nombre, ...(x.properties.alias || []).map((a) => a.nombre)]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  comprobar('Quebradas: metadata.nombres lista exactamente los cursos del archivo (nombres y alias)', JSON.stringify(nombres) === JSON.stringify(m.nombres), `${nombres.length} nombres`);
  const puntos = f.flatMap((x) => (x.geometry.type === 'LineString' ? x.geometry.coordinates : x.geometry.coordinates.flat()));
  comprobar('Quebradas: coordenadas dentro del departamento de Arequipa y alrededores (lon -73 a -70, lat -17,5 a -15,5)', puntos.every(([x, y]) => x > -73 && x < -70 && y > -17.5 && y < -15.5), `${puntos.length} vértices`);
  console.log(`INFO  Quebradas: ${nombres.join(', ')}`);
  console.log(`INFO  Quebradas: Añashuayco ${nombres.some((x) => /añashuayco/i.test(x)) ? 'figura' : 'NO figura'}; San Lázaro ${nombres.some((x) => /san l[aá]zaro/i.test(x)) ? 'figura' : 'NO figura'}`);
}

// Peligro volcánico del Misti (IGP): congelado con scripts/descargar-peligro-volcanico.mjs
{
  const f = volcan.features;
  const m = volcan.metadata || {};
  const TIPOS = ['lahar', 'flujo_piroclastico', 'lava', 'avalancha', 'ceniza'];
  const NIVELES = ['bajo', 'moderado', 'alto'];
  const anillos = f.flatMap((x) => x.geometry.coordinates.flatMap((p) => p));
  comprobar('Volcán: FeatureCollection con solo MultiPolygon, tipo y nivel conocidos, capa de origen y anillos cerrados de al menos 4 puntos', volcan.type === 'FeatureCollection' && f.length > 0 && f.every((x) => x.geometry?.type === 'MultiPolygon' && TIPOS.includes(x.properties.tipo) && NIVELES.includes(x.properties.nivel) && !!x.properties.capa && Number.isInteger(x.properties.capaId)) && anillos.every((r) => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]), `${f.length} polígonos`);
  comprobar('Volcán: metadata con fuente (IGP), servicio https, fecha de extracción, licencia, referencia oficial (INGEMMET) y la aclaración «sin metadatos de fecha»', /Instituto Geofísico del Perú/.test(m.fuente || '') && /^https:/.test(m.servicio || '') && /^\d{4}-\d{2}-\d{2}T/.test(m.descargado || '') && !!m.licencia && /INGEMMET/.test(m.referencia || '') && /Sin metadatos de fecha/.test(m.fechaDelMapa || ''), m.descargado);
  const porTipo = Object.fromEntries(TIPOS.map((t) => [t, f.filter((x) => x.properties.tipo === t).length]));
  comprobar('Volcán: metadata.registros, porTipo y capas[].registros coinciden con los polígonos del archivo', m.registros === f.length && TIPOS.every((t) => (m.porTipo[t] || 0) === porTipo[t]) && m.capas.reduce((s, c) => s + c.registros, 0) === f.length && m.capas.every((c) => f.filter((x) => x.properties.capaId === c.id).length === c.registros), JSON.stringify(porTipo));
  comprobar('Volcán: lahares, flujos piroclásticos, lava y avalanchas traen los tres niveles (alto, moderado y bajo)', ['lahar', 'flujo_piroclastico', 'lava', 'avalancha'].every((t) => NIVELES.every((n) => f.some((x) => x.properties.tipo === t && x.properties.nivel === n))));
  const cerca = f.filter((x) => x.properties.tipo !== 'ceniza').flatMap((x) => x.geometry.coordinates.flatMap((p) => p[0]));
  comprobar('Volcán: los polígonos de lahares, flujos, lava y avalanchas quedan cerca del Misti (lon -71,8 a -71,2; lat -16,7 a -16,1)', cerca.every(([x, y]) => x > -71.8 && x < -71.2 && y > -16.7 && y < -16.1), `${cerca.length} vértices`);
  comprobar('Volcán: la ceniza dice su escenario y el espesor del depósito', f.filter((x) => x.properties.tipo === 'ceniza').every((x) => ['vulcaniana', 'subpliniana', 'pliniana'].includes(x.properties.escenario) && /cm|mm/.test(x.properties.deposito || '')));
  console.log(`INFO  Volcán: ${f.length} polígonos (${TIPOS.map((t) => `${t} ${porTipo[t]}`).join(', ')}); ${m.fechaDelMapa}`);
}

// Sismos reportados (IGP): congelados con scripts/descargar-sismos.mjs
{
  const f = sismos.features;
  const m = sismos.metadata || {};
  comprobar('Sismos: solo puntos, con fecha AAAA-MM-DD, magnitud numérica e id único', sismos.type === 'FeatureCollection' && f.every((x) => x.geometry?.type === 'Point' && /^\d{4}-\d{2}-\d{2}$/.test(x.properties.fecha) && typeof x.properties.magnitud === 'number') && new Set(f.map((x) => x.properties.id)).size === f.length, `${f.length} sismos`);
  comprobar('Sismos: metadata con fuente (IGP), capa, fecha de extracción, periodo y licencia', /Instituto Geofísico/.test(m.fuente || '') && /^https:\/\//.test(m.capa || '') && /^\d{4}-\d{2}-\d{2}T/.test(m.descargado || '') && /^\d{4}-\d{2}-\d{2}$/.test(m.fechaDesde || '') && /^\d{4}-\d{2}-\d{2}$/.test(m.fechaHasta || '') && !!m.licencia, `${m.fechaDesde} a ${m.fechaHasta}`);
  comprobar('Sismos: metadata.registros y magnitudMaxima coinciden con el archivo', m.registros === f.length && m.magnitudMaxima === Math.max(...f.map((x) => x.properties.magnitud)), `magnitud máxima ${m.magnitudMaxima}`);
  comprobar('Sismos: todas las fechas caen dentro del periodo declarado y el total de la capa no es menor que los guardados', f.every((x) => x.properties.fecha >= m.fechaDesde && x.properties.fecha <= m.fechaHasta) && m.totalCapa >= f.length, `capa: ${m.totalCapa}`);
  const [oeste, sur, este, norte] = m.caja;
  comprobar('Sismos: coordenadas dentro del recuadro declarado', f.every((x) => x.geometry.coordinates[0] >= oeste && x.geometry.coordinates[0] <= este && x.geometry.coordinates[1] >= sur && x.geometry.coordinates[1] <= norte));
  console.log(`INFO  Sismos: ventana de la capa ${m.fechaDesde} a ${m.fechaHasta} (no es el catálogo histórico); extraído ${m.descargado.slice(0, 10)}`);
}

// Comercio: mercados, supermercados y malls de OpenStreetMap (scripts/descargar-comercio.mjs); informativos, sin umbral
{
  const CalcC = createRequire(import.meta.url)('../public/js/calculos.js');
  const caja = [-71.75, -16.6, -71.35, -16.2];
  const enCaja = ([x, y]) => x >= caja[0] && x <= caja[2] && y >= caja[1] && y <= caja[3];
  const anillosDe = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).flat();
  const vistos = new Map();
  for (const nombre of ['mercados', 'supermercados', 'malls']) {
    const fc = json(`data/equipamiento/${nombre}.geojson`);
    const f = fc.features;
    const m = fc.metadata || {};
    comprobar(`Comercio/${nombre}: metadata con fuente ODbL, fecha de extracción, consulta única (out geom), licencia y la nota de que es informativo`, m.fuente === 'OpenStreetMap (ODbL)' && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha_extraccion) && typeof m.consulta === 'string' && m.consulta.includes('out geom tags') && (m.consulta.match(/\[out:json\]/g) || []).length === 1 && m.licencia === 'ODbL' && /informativ/i.test(m.informativo || ''));
    comprobar(`Comercio/${nombre}: metadata.registros y conteo_por_fuente coinciden con el número de features`, m.registros === f.length && f.length > 0 && m.conteo_por_fuente && m.conteo_por_fuente.OSM === f.length, `${f.length}`);
    comprobar(`Comercio/${nombre}: cada elemento dice su fuente (OSM), tiene id de OSM único, nombre (o null) y etiquetas, y esa etiqueta lo clasifica en ${nombre}`, new Set(f.map((x) => x.properties.osm)).size === f.length && f.every((x) => x.properties.fuente === 'OSM' && /^(node|way|relation)\/\d+$/.test(x.properties.osm) && 'nombre' in x.properties && x.properties.tags && CalcC.categoriasDe(x.properties.tags, x.properties.nombre).includes(nombre)));
    comprobar(`Comercio/${nombre}: solo puntos y polígonos con anillos cerrados, dentro de la caja de Arequipa`, f.every((x) => (x.geometry.type === 'Point' ? enCaja(x.geometry.coordinates) : /^(Multi)?Polygon$/.test(x.geometry.type) && anillosDe(x.geometry).every((a) => a.length >= 4 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1] && a.every(enCaja)))));
    comprobar(`Comercio/${nombre}: el mismo lugar no aparece dos veces (ninguno repite un id asociado de otro)`, new Set(f.flatMap((x) => [x.properties.osm, ...(x.properties.osm_asociados || [])])).size === f.reduce((t, x) => t + 1 + (x.properties.osm_asociados || []).length, 0));
    f.forEach((x) => vistos.set(x.properties.osm, (vistos.get(x.properties.osm) || 0) + 1));
    if (nombre === 'malls') {
      const c = m.curados || {};
      comprobar('Comercio/malls: la lista curada trae para cada mall su entidad y el enlace https de su fuente, y dice cuáles no están en OpenStreetMap', Array.isArray(c.lista) && c.lista.length > 0 && c.lista.every((x) => x.nombre && x.entidad && /^https:\/\//.test(x.url) && /^\d{4}-\d{2}-\d{2}$/.test(x.verificado_el)) && Array.isArray(c.sin_osm) && Array.isArray(c.verificados_en_osm));
      comprobar('Comercio/malls: todo mall verificado apunta a un elemento que existe en el archivo y cita su fuente', f.filter((x) => x.properties.verificado).every((x) => /^https:\/\//.test(x.properties.verificado.url) && x.properties.verificado.nombre) && c.verificados_en_osm.every((v) => f.some((x) => x.properties.osm === v.osm)));
      console.log(`INFO  Malls: ${f.length} (${f.filter((x) => x.geometry.type !== 'Point').length} con polígono; ${f.filter((x) => x.properties.verificado).length} verificados con su fuente; curados sin OSM: ${(c.sin_osm || []).map((x) => x.nombre).join(', ') || 'ninguno'})`);
    }
    if (nombre === 'mercados') {
      const cen = m.cenama || {};
      const cob = json('../docs/validacion/cenama-cobertura.json');
      comprobar('Comercio/mercados: metadata.cenama dice la fuente (PRODUCE / INEI), su licencia y que no trae coordenadas', /PRODUCE/.test(cen.entidad || '') && /ODC-By/.test(cen.licencia || '') && /sin nombre, dirección ni coordenadas/.test(cen.limites || '') && cen.registros_provincia_arequipa > 0);
      comprobar('Comercio/mercados: la cobertura frente al CENAMA suma los mismos mercados de OpenStreetMap que el archivo y los del censo de la provincia', cob.totales.osm === f.length && cob.totales.cenama === cen.registros_provincia_arequipa && cob.filas.reduce((t, x) => t + x.cenama, 0) === cob.totales.cenama, `OSM ${cob.totales.osm} frente a CENAMA ${cob.totales.cenama}`);
    }
  }
  comprobar('Comercio: ningún elemento de OpenStreetMap está en más de una de las tres categorías', [...vistos.values()].every((n) => n === 1));

  // Reparto por NECESIDAD (Calculos.agruparComercio): abastecimiento (mercados + supermercados), compras y ocio (malls con fuente) y comercio de barrio (el resto de shop=mall).
  const crudo = (nombre) => json(`data/equipamiento/${nombre}.geojson`).features;
  const [mer, sup, mal] = [crudo('mercados'), crudo('supermercados'), crudo('malls')];
  const g = CalcC.agruparComercio({ mercados: mer, supermercados: sup, malls: mal });
  const centro = (x) => (x.geometry.type === 'Point' ? { lat: x.geometry.coordinates[1], lon: x.geometry.coordinates[0] } : CalcC.centroDe(x.geometry));
  const dentro = g.abastecimiento.filter((x) => x.properties.dentro_de_mall);
  const excluidos = [['mercados', mer], ['supermercados', sup], ['malls', mal]].flatMap(([capa, lista]) => lista.filter((x) => CalcC.esComercioExcluido(capa, x.properties)));
  comprobar('Comercio/necesidades: cada elemento cae en exactamente una necesidad, salvo lo excluido a propósito (COMERCIO_EXCLUIDOS), y no se pierde ni se inventa ninguno', g.abastecimiento.length === mer.length + sup.length - excluidos.length && g.compras_ocio.length + g.comercio_barrio.length === mal.length, `abastecimiento ${g.abastecimiento.length}, compras y ocio ${g.compras_ocio.length}, comercio de barrio ${g.comercio_barrio.length}`);
  comprobar('Comercio/necesidades: la exclusión es estrecha (solo Santa Natura, tienda de productos naturales) y lo excluido no está en ningún grupo', excluidos.length === 1 && /santa natura/i.test(excluidos[0].properties.nombre) && ![...g.abastecimiento, ...g.compras_ocio, ...g.comercio_barrio].some((x) => x.properties.osm === excluidos[0].properties.osm));
  comprobar('Comercio/necesidades: compras y ocio son exactamente los malls con su fuente (verificado) y comercio de barrio, ninguno de ellos', g.compras_ocio.every((x) => x.properties.verificado) && !g.comercio_barrio.some((x) => x.properties.verificado) && g.compras_ocio.length === mal.filter((x) => x.properties.verificado).length);
  comprobar('Comercio/necesidades: la geometría y la fuente de cada elemento quedan intactas (no se recorta ni se mueve nada)', [...g.abastecimiento, ...g.compras_ocio, ...g.comercio_barrio].every((x) => x.properties.fuente === 'OSM' && [...mer, ...sup, ...mal].some((o) => o.properties.osm === x.properties.osm && JSON.stringify(o.geometry) === JSON.stringify(x.geometry))));
  comprobar('Comercio/necesidades: todo supermercado que dice estar dentro de un mall lo está de verdad (su punto cae en el polígono de ese mall) y ningún mall cuenta como abastecimiento', dentro.every((x) => { const m = mal.find((y) => y.properties.osm === x.properties.dentro_de_mall.osm); const c = centro(x); return m && m.geometry.type !== 'Point' && CalcC.distanciaAGeometriaM(c.lat, c.lon, m.geometry) === 0; }) && !g.abastecimiento.some((x) => x.properties.tipo === 'mall'));
  console.log(`INFO  Necesidades: abastecimiento ${g.abastecimiento.length} (${mer.length} mercados, ${sup.length - excluidos.length} supermercados tras excluir ${excluidos.map((x) => x.properties.nombre).join(', ') || 'nada'}, ${dentro.length} de ellos dentro de un mall: ${[...new Set(dentro.map((x) => x.properties.dentro_de_mall.nombre || 'mall sin nombre'))].join(', ')}); compras y ocio ${g.compras_ocio.length}; comercio de barrio ${g.comercio_barrio.length}`);
}

// Equipamiento: salud (RENIPRESS) y educación (ESCALE) con OpenStreetMap de respaldo; transporte y áreas verdes de OpenStreetMap
{
  const caja = [-71.75, -16.6, -71.35, -16.2];
  const enCaja = ([x, y]) => x >= caja[0] && x <= caja[2] && y >= caja[1] && y <= caja[3];
  for (const [nombre, fc] of Object.entries(equipamiento)) {
    const f = fc.features;
    const m = fc.metadata || {};
    const oficial = nombre === 'salud' || nombre === 'consultorios' || nombre === 'educacion';
    if (!oficial) comprobar(`Equipamiento/${nombre}: metadata con fuente ODbL, fecha de extracción y consulta`, m.fuente === 'OpenStreetMap (ODbL)' && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha_extraccion) && typeof m.consulta === 'string' && m.consulta.includes('[out:json]'), m.fecha_extraccion);
    comprobar(`Equipamiento/${nombre}: metadata.registros coincide con el número de features`, m.registros === f.length && f.length > 0, `${f.length}`);
    if (!oficial) comprobar(`Equipamiento/${nombre}: id de OSM único, con nombre y etiquetas`, new Set(f.map((x) => x.properties.osm)).size === f.length && f.every((x) => /^(node|way|relation)\/\d+$/.test(x.properties.osm) && 'nombre' in x.properties && x.properties.tags));
    if (nombre === 'areas_verdes') {
      const anillos = f.flatMap((x) => (x.geometry.type === 'Polygon' ? [x.geometry.coordinates] : x.geometry.coordinates).flat());
      comprobar('Equipamiento/areas_verdes: solo Polygon/MultiPolygon, con anillos cerrados dentro de la caja de Arequipa', f.every((x) => /^(Multi)?Polygon$/.test(x.geometry.type)) && anillos.every((a) => a.length >= 4 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1] && a.every(enCaja)), `${anillos.length} anillos`);
    } else {
      comprobar(`Equipamiento/${nombre}: solo puntos dentro de la caja de Arequipa`, f.every((x) => x.geometry.type === 'Point' && enCaja(x.geometry.coordinates)));
    }
  }
  const esOsm = (x) => x.properties.fuente === 'OSM';
  // Salud y consultorios son dos categorías: el consultorio (amenity=doctors, healthcare=doctor) no es un establecimiento de salud.
  const CalcOsm = createRequire(import.meta.url)('../public/js/calculos.js');
  const sinSalud = equipamiento.salud.features.filter((x) => esOsm(x) && !(['hospital', 'clinic'].includes(x.properties.tags.amenity) || (x.properties.tags.healthcare && x.properties.tags.healthcare !== 'doctor')));
  comprobar('Equipamiento/salud: todo elemento de OpenStreetMap tiene amenity=hospital|clinic o healthcare distinto de doctor', sinSalud.length === 0);
  comprobar('Equipamiento/salud: ningún elemento de OpenStreetMap es un consultorio (categoriaSalud = salud)', equipamiento.salud.features.filter(esOsm).every((x) => CalcOsm.categoriaSalud(x.properties.tags, x.properties.nombre) === 'salud'));
  comprobar('Equipamiento/consultorios: todo elemento de OpenStreetMap es amenity=doctors o healthcare=doctor (categoriaSalud = consultorio)', equipamiento.consultorios.features.filter(esOsm).every((x) => CalcOsm.categoriaSalud(x.properties.tags, x.properties.nombre) === 'consultorio'));
  comprobar('Equipamiento/salud y consultorios: ningún elemento de OpenStreetMap es dental (amenity=dentist, healthcare=dentist, healthcare:speciality=dentistry o nombre dental / odontológico)', [...equipamiento.salud.features, ...equipamiento.consultorios.features].filter(esOsm).every((x) => !CalcOsm.esDental(x.properties.tags, x.properties.nombre)));
  const OficialSalud = createRequire(import.meta.url)('./lib/equipamiento-oficial.js');
  comprobar('Equipamiento/salud y consultorios: ningún punto de RENIPRESS tiene un nombre solo dental (dental / odontológico / dentist, salvo que el nombre diga también medicina, médico, hospital, centro de salud o especialidades)', [...equipamiento.salud.features, ...equipamiento.consultorios.features].filter((x) => x.properties.fuente === 'RENIPRESS').every((x) => !OficialSalud.esNombreDental(x.properties.nombre)));
  const claseConsultorio = (x) => /CONSULTORIO/i.test((x.properties.clasificacion || x.properties.nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const ofiSalud = equipamiento.salud.features.filter((x) => x.properties.fuente === 'RENIPRESS');
  const ofiConsultorios = equipamiento.consultorios.features.filter((x) => x.properties.fuente === 'RENIPRESS');
  comprobar('Equipamiento/consultorios: todo punto de RENIPRESS dice CONSULTORIO en su clasificación (o en su nombre si no la trae) y ninguno de salud.geojson lo dice', ofiConsultorios.length > 0 && ofiConsultorios.every(claseConsultorio) && !ofiSalud.some(claseConsultorio), `${ofiConsultorios.length} consultorios, ${ofiSalud.length} establecimientos`);
  const codigosSalud = new Set(ofiSalud.map((x) => x.properties.codigo_renipress));
  comprobar('Equipamiento/consultorios: ningún código de RENIPRESS está a la vez en salud.geojson y en consultorios.geojson', !ofiConsultorios.some((x) => codigosSalud.has(x.properties.codigo_renipress)));
  comprobar('Equipamiento/consultorios: ningún elemento de OpenStreetMap está a la vez en salud.geojson y en consultorios.geojson', !equipamiento.consultorios.features.filter(esOsm).some((x) => equipamiento.salud.features.some((y) => esOsm(y) && y.properties.osm === x.properties.osm)));

  // Salud y educación: RENIPRESS y ESCALE como fuente primaria, OpenStreetMap solo de respaldo (scripts/descargar-equipamiento-oficial.mjs).
  const NIVELES_V = ['inicial', 'primaria', 'secundaria'];
  const REGLAS = {
    salud: { oficial: 'RENIPRESS', codigo: 'codigo_renipress', licencia: /ODC-By/ },
    consultorios: { oficial: 'RENIPRESS', codigo: 'codigo_renipress', licencia: /ODC-By/ },
    educacion: { oficial: 'ESCALE', codigo: 'codigo_local', licencia: /Acuerdo de uso de datos/ },
  };
  for (const [nombre, r] of Object.entries(REGLAS)) {
    const fc = equipamiento[nombre];
    const m = fc.metadata || {};
    const f = fc.features;
    const porFuente = { [r.oficial]: f.filter((x) => x.properties.fuente === r.oficial).length, OSM: f.filter(esOsm).length };
    const fuentes = Array.isArray(m.fuentes) ? m.fuentes : [];
    const prim = fuentes.find((x) => x.rol === 'primaria');
    const resp = fuentes.find((x) => x.rol === 'respaldo');
    comprobar(`Equipamiento/${nombre}: procedencia (fuente primaria ${r.oficial} con dirección, fecha y licencia; OpenStreetMap ODbL de respaldo)`, !!prim && prim.id === r.oficial && /^\d{4}-\d{2}-\d{2}$/.test(prim.fecha) && /^https:\/\//.test(prim.url || '') && r.licencia.test(prim.licencia || '') && !!resp && resp.licencia === 'ODbL' && /^\d{4}-\d{2}-\d{2}$/.test(resp.fecha) && m.fecha_extraccion === prim.fecha, prim && prim.fecha);
    comprobar(`Equipamiento/${nombre}: conteo_por_fuente coincide con las features, y la regla de deduplicación y de selección están escritas`, JSON.stringify(m.conteo_por_fuente) === JSON.stringify(porFuente) && porFuente[r.oficial] > 0 && m.deduplicacion?.radio_m === 200 && typeof m.deduplicacion.regla === 'string' && typeof m.regla_seleccion === 'string', JSON.stringify(porFuente));
    comprobar(`Equipamiento/${nombre}: toda feature dice su fuente (${r.oficial} u OSM) y tiene nombre`, f.every((x) => [r.oficial, 'OSM'].includes(x.properties.fuente) && 'nombre' in x.properties));
    const ofi = f.filter((x) => x.properties.fuente === r.oficial);
    comprobar(`Equipamiento/${nombre}: los puntos de ${r.oficial} traen su código oficial, sin repetir`, ofi.every((x) => typeof x.properties[r.codigo] === 'string' && x.properties[r.codigo] !== '') && new Set(ofi.map((x) => x.properties[r.codigo])).size === ofi.length);
    const osmIds = f.filter(esOsm).map((x) => x.properties.osm);
    comprobar(`Equipamiento/${nombre}: los de OpenStreetMap traen su id único y sus etiquetas`, new Set(osmIds).size === osmIds.length && f.filter(esOsm).every((x) => /^(node|way|relation)\/\d+$/.test(x.properties.osm) && x.properties.tags));
    // Ningún elemento de OSM debe tener un punto oficial de la misma categoría a 200 m o menos (es la regla de deduplicación).
    const hav = (la1, lo1, la2, lo2) => { const r = (d) => (d * Math.PI) / 180; const a = Math.sin(r(la2 - la1) / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a))); };
    const dentroDeRadio = (x, o) => hav(x.geometry.coordinates[1], x.geometry.coordinates[0], o.geometry.coordinates[1], o.geometry.coordinates[0]) <= 200;
    const repetidos = f.filter(esOsm).filter((x) => ofi.some((o) => (nombre !== 'educacion' || x.properties.niveles.some((n) => o.properties.niveles.includes(n))) && dentroDeRadio(x, o)));
    comprobar(`Equipamiento/${nombre}: ningún elemento de OpenStreetMap tiene un punto oficial de la misma categoría a 200 m o menos`, repetidos.length === 0, `${repetidos.length}`);
  }
  comprobar('Equipamiento/educacion: los niveles de cada local (ESCALE y respaldo) son inicial, primaria o secundaria, y no vacíos', equipamiento.educacion.features.every((x) => Array.isArray(x.properties.niveles) && x.properties.niveles.length > 0 && x.properties.niveles.every((n) => NIVELES_V.includes(n))));
  comprobar('Equipamiento/educacion: cada local de ESCALE lista sus instituciones con código modular, y su nivel está entre los del local', equipamiento.educacion.features.filter((x) => x.properties.fuente === 'ESCALE').every((x) => x.properties.instituciones.length > 0 && x.properties.instituciones.every((i) => /^\d{7}$/.test(i.codigo_modular) && x.properties.niveles.includes(i.nivel))));
}

// Precio de oferta por m² del distrito (Aptología, CC BY 4.0): congelado con scripts/descargar-precios.mjs
{
  const m = precios;
  const nombres = distritos.features.map((x) => x.properties.distrito);
  const filas = Object.entries(m.distritos || {});
  comprobar('Precios: metadata con fuente, URL https, licencia CC BY 4.0 y la atribución «Datos: Aptologia»', !!m.fuente && /^https:\/\//.test(m.url || '') && m.licencia === 'CC BY 4.0' && m.atribucion === 'Datos: Aptologia', m.licencia);
  comprobar('Precios: fecha de descarga y periodo (corte) con formato AAAA-MM-DD, y el corte no es posterior a la descarga', /^\d{4}-\d{2}-\d{2}$/.test(m.fecha_descarga || '') && /^\d{4}-\d{2}-\d{2}$/.test(m.periodo?.corte || '') && m.periodo.corte <= m.fecha_descarga, `corte ${m.periodo?.corte}, descarga ${m.fecha_descarga}`);
  comprobar('Precios: se rotula como precio de oferta (no de cierre), en soles, con unidades y muestra mínima', /oferta/.test(m.tipo || '') && /no de cierre/.test(m.tipo || '') && m.moneda === 'PEN' && !!m.unidades?.venta_m2 && m.muestra_minima >= 1);
  comprobar('Precios: hay al menos un distrito y cada uno está escrito como en distritos_aqp.geojson', filas.length > 0 && filas.every(([n]) => nombres.includes(n)), `${filas.length} distritos: ${filas.map(([n]) => n).join(', ')}`);
  comprobar('Precios: cada precio por m² es positivo y razonable (S/ 500 a S/ 30 000) y cumple la muestra mínima de avisos', filas.every(([, d]) => (d.venta_m2 === null || (d.venta_m2 >= 500 && d.venta_m2 <= 30000 && d.avisos_venta >= m.muestra_minima)) && (d.arriendo_mensual === null || d.avisos_arriendo >= m.muestra_minima)));
  comprobar('Precios: n_avisos.venta es la suma de los avisos de venta por distrito', m.n_avisos?.venta === filas.reduce((s, [, d]) => s + (d.avisos_venta || 0), 0), `${m.n_avisos?.venta}`);
  const P = createRequire(import.meta.url)('../public/js/precios.js');
  comprobar('Precios (módulo): cada distrito del archivo da INFORMATIVO y uno sin cifra da SIN DATO con su causa, sin inventar un precio', filas.every(([n]) => P.buscar(m, n).estado === 'INFORMATIVO') && (() => {
    const sin = nombres.find((n) => !(n in m.distritos));
    const r = P.buscar(m, sin);
    return r.estado === 'SIN DATO' && !!r.causa && r.precioM2 === undefined;
  })());
  console.log(`INFO  Precios: ${filas.length} de ${nombres.length} distritos con cifra; ${m.fuente}; corte ${m.periodo?.corte}; descargado ${m.fecha_descarga}`);
}

// Escenario de riesgo del CENEPRED ante El Niño 2026-2027 por distrito: congelado con scripts/descargar-riesgo-cenepred.mjs
{
  const m = riesgoCenepred;
  const R = createRequire(import.meta.url)('./lib/riesgo-cenepred.js');
  const C = createRequire(import.meta.url)('../public/js/cenepred.js');
  const filas = Object.entries(m.distritos || {});
  const porUbigeo = new Map(distritos.features.map((x) => [x.properties.ubigeo, x.properties.distrito]));
  comprobar('CENEPRED: metadata con fuente, URL del servicio y del visor de SIGRID, estudio con URL https, fecha de descarga (AAAA-MM-DD) y la nota de escala distrital', !!m.fuente && /^https:\/\/sigrid\.cenepred\.gob\.pe\//.test(m.url || '') && /^https:\/\/sigrid\.cenepred\.gob\.pe\/sigridv3\/?$/.test(m.url_visor || '') && /^https:\/\//.test(m.estudio?.url || '') && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha_descarga || '') && /distrital/i.test(m.nota || '') && /no es una evaluaci/i.test(m.nota || ''));
  comprobar('CENEPRED: están los 25 distritos de distritos_aqp.geojson, emparejados por ubigeo y con el mismo nombre, y no hay otros', filas.length === porUbigeo.size && filas.length === 25 && filas.every(([u, d]) => porUbigeo.get(u) === d.distrito), `${filas.length} distritos`);
  comprobar('CENEPRED: todos los niveles (inundación y movimientos en masa) están en el conjunto conocido: Bajo, Medio, Alto, Muy alto', filas.every(([, d]) => R.NIVELES.includes(d.inundacion?.nivel) && R.NIVELES.includes(d.movimientos_masa?.nivel)));
  comprobar('CENEPRED: viviendas, locales educativos y establecimientos de salud son enteros no negativos', filas.every(([, d]) => [d.inundacion, d.movimientos_masa].every((b) => ['viviendas', 'instituciones_educativas', 'establecimientos_salud'].every((k) => Number.isInteger(b[k]) && b[k] >= 0))));
  comprobar('CENEPRED: el resumen por nivel del archivo coincide con el conteo de los distritos', JSON.stringify(m.resumen_por_nivel) === JSON.stringify(R.resumenPorNivel(m.distritos)));
  comprobar('CENEPRED (módulo): cada distrito da INFORMATIVO por ubigeo y por nombre, y uno que no está en los datos (Vítor) da SIN DATO con su causa, sin inventar un nivel', filas.every(([u, d]) => C.buscar(m, u).estado === 'INFORMATIVO' && C.buscar(m, d.distrito).ubigeo === u) && (() => {
    const r = C.buscar(m, 'Vitor');
    return r.estado === 'SIN DATO' && !!r.causa && r.inundacion === undefined;
  })());
  const resumen = R.resumenPorNivel(m.distritos);
  const texto = (o) => R.NIVELES.map((n) => `${n} ${o[n]}`).join(', ');
  console.log(`INFO  CENEPRED: inundación ${texto(resumen.inundacion)}; movimientos en masa ${texto(resumen.movimientos_masa)}; descargado ${m.fecha_descarga}`);
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
for (const f of ['js/config.js', 'js/calculos.js', 'js/rutas.js', 'js/geo.js', 'js/zonificacion.js', 'js/peligros.js', 'js/volcan.js', 'js/cenepred.js', 'js/contexto.js', 'js/delitos.js', 'js/distritos.js', 'js/riesgos.js']) {
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

// B7. Quebradas y contexto: distancia a líneas frente a un método independiente (líneas densificadas y ley esférica de los cosenos).
{
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const cosenos = (la1, lo1, la2, lo2) => R * Math.acos(Math.min(1, Math.sin(rad(la1)) * Math.sin(rad(la2)) + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1))));
  // Cada línea se densifica a pasos de ~5 m: la distancia mínima a esos puntos tiene un error menor que ~3 m.
  const densas = [];
  for (const [indice, x] of quebradas.features.entries()) {
    const lineas = x.geometry.type === 'LineString' ? [x.geometry.coordinates] : x.geometry.coordinates;
    for (const l of lineas) {
      for (let i = 1; i < l.length; i++) {
        const [x0, y0] = l[i - 1];
        const [x1, y1] = l[i];
        const largo = cosenos(y0, x0, y1, x1);
        const n = Math.max(1, Math.ceil(largo / 5));
        for (let k = 0; k <= n; k++) densas.push([y0 + ((y1 - y0) * k) / n, x0 + ((x1 - x0) * k) / n, x.properties.nombre, indice]);
      }
    }
  }
  let peorError = 0;
  let nombresOk = true;
  const probados = 60;
  const lista = quebradas.features.map((x) => ({ nombre: x.properties.nombre, tipo: x.properties.tipo, fuente: x.properties.fuente, geometry: x.geometry }));
  for (let i = 0; i < probados; i++) {
    const la = -16.2 - azar() * 0.4;
    const lo = -71.75 + azar() * 0.4;
    // Distancia mínima de cada tramo, por separado: dos tramos casi iguales pueden empatar y el nombre no distingue.
    const minimas = new Map();
    for (const [pla, plo, nom, idx] of densas) {
      const d = cosenos(la, lo, pla, plo);
      if (d < (minimas.get(idx) ?? Infinity)) minimas.set(idx, d);
    }
    const mejor = Math.min(...minimas.values());
    const r = Calc.evaluarCauces({ lat: la, lon: lo }, lista, {});
    peorError = Math.max(peorError, Math.abs(r.distanciaM - mejor));
    // El cauce elegido debe ser uno de los que quedan a no más de 6 m del mejor (mismo nombre y misma fuente).
    const elegidoOk = [...minimas].some(([idx, d]) => d <= mejor + 6 && (lista[idx].nombre || '') === (r.nombre.startsWith('Sin nombre') ? '' : r.nombre) && lista[idx].fuente === r.fuenteId);
    if (!elegidoOk) nombresOk = false;
  }
  comprobar(`Quebradas: la distancia a la red coincide con un método independiente (${probados} puntos al azar; error máximo ${peorError.toFixed(1)} m)`, peorError < 6);
  comprobar('Quebradas: el cauce más cercano (nombre y fuente) es uno de los que el método independiente da como más cercanos', nombresOk);
  comprobar('Quebradas: sin umbral del usuario el estado es INFORMATIVO; con él, CUMPLE o NO CUMPLE (nunca un umbral por defecto)', (() => {
    const r0 = Calc.evaluarCauces({ lat: -16.399, lon: -71.537 }, quebradas.features.map((x) => ({ nombre: x.properties.nombre, geometry: x.geometry })), {});
    const c = Calc.evaluarCauces({ lat: -16.399, lon: -71.537 }, quebradas.features.map((x) => ({ nombre: x.properties.nombre, geometry: x.geometry })), { umbralUsuarioM: 1 });
    const n = Calc.evaluarCauces({ lat: -16.399, lon: -71.537 }, quebradas.features.map((x) => ({ nombre: x.properties.nombre, geometry: x.geometry })), { umbralUsuarioM: 50000 });
    return r0.estado === 'INFORMATIVO' && r0.umbralM === null && c.estado === 'CUMPLE' && n.estado === 'NO CUMPLE';
  })());
}

// B5b. Riesgo del distrito ante El Niño (CENEPRED): el módulo del navegador frente al distrito por número de vueltas y al archivo leído aquí.
{
  const Ctx = app('Contexto');
  let malos = 0;
  let conDato = 0;
  let sinDistrito = 0;
  for (let k = 0; k < 400; k++) {
    const lat = sur + azar() * (norte - sur);
    const lon = oeste + azar() * (este - oeste);
    let ubigeo = null;
    for (const f of distritos.features) {
      const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (polis.some((p) => dentro(lon, lat, p))) { ubigeo = f.properties.ubigeo; break; }
    }
    const r = await Ctx.cenepred(lat, lon);
    if (ubigeo === null) {
      sinDistrito++;
      if (r.estado !== 'SIN DATO' || !r.error || r.inundacion !== undefined) malos++;
      continue;
    }
    conDato++;
    const e = riesgoCenepred.distritos[ubigeo];
    if (r.estado !== 'INFORMATIVO' || r.ubigeo !== ubigeo || r.inundacion.nivel !== e.inundacion.nivel || r.movimientos_masa.nivel !== e.movimientos_masa.nivel || r.inundacion.viviendas !== e.inundacion.viviendas) malos++;
  }
  comprobar('CENEPRED (módulo): 400 puntos al azar dan el nivel del distrito que da el método independiente, y fuera de los distritos queda SIN DATO con su causa', malos === 0, `${malos} diferencias; ${conDato} dentro de un distrito, ${sinDistrito} fuera`);
  const sachaca = await Ctx.cenepred(-16.4436, -71.5744);
  comprobar('CENEPRED (módulo): un punto de Sachaca da INFORMATIVO, con la frase del distrito, la fuente y sin cumple ni puntaje', sachaca.estado === 'INFORMATIVO' && sachaca.distrito === 'SACHACA' && /^Según el CENEPRED, el distrito de Sachaca tiene riesgo muy alto ante inundaciones/.test(sachaca.frase) && /CENEPRED/.test(sachaca.fuente) && !/cumple|puntaje/i.test(JSON.stringify(sachaca)), sachaca.frase);
}
// B7. Concesiones de distribución eléctrica (MINEM, DGE; scripts/descargar-concesiones-electricas.mjs): el archivo y el módulo del navegador frente al
// número de vueltas. Es INFORMATIVO: dentro de una concesión no es tener una conexión.
{
  const CalcE = createRequire(import.meta.url)('../public/js/calculos.js');
  const fc = json('data/electricidad/concesiones_distribucion.geojson');
  const f = fc.features;
  const m = fc.metadata || {};
  const polis = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  const CAMPOS_E = ['objectid', 'nombre_zona', 'situacion', 'concesion', 'empresa', 'concesionaria', 'expediente', 'tipo_concesion', 'sistema_electrico'];
  comprobar('Electricidad: metadata con la fuente (MINEM, DGE), el enlace del servicio y de datosabiertos.gob.pe, la fecha de descarga, la licencia ODC-By, los expedientes y lo que NO dice',
    /MINEM/.test(m.fuente || '') && /^https:\/\/geoportal\.minem\.gob\.pe\/.*MapServer\/0$/.test(m.url_servicio || '') && /datosabiertos\.gob\.pe/.test(m.url_datos_abiertos || '') && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha_descarga || '') && /ODC-By/.test(m.licencia || '') && Array.isArray(m.expedientes) && m.expedientes.length > 0 && /NO dice que un predio esté conectado/.test(m.no_dice || '') && /sin umbral/i.test(m.informativo || ''));
  comprobar('Electricidad: metadata.registros y conteo_por_concesionaria coinciden con el número de features y cada expediente de la metadata está en algún feature', m.registros === f.length && f.length > 0 && Object.values(m.conteo_por_concesionaria || {}).reduce((t, n) => t + n, 0) === f.length && m.expedientes.every((e) => f.some((x) => x.properties.expediente === e)));
  comprobar('Electricidad: cada concesión trae todos sus campos (empresa, concesionaria, expediente, situación…), con OBJECTID único', f.every((x) => CAMPOS_E.every((c) => x.properties[c] !== undefined && x.properties[c] !== null && x.properties[c] !== '')) && new Set(f.map((x) => x.properties.objectid)).size === f.length);
  comprobar('Electricidad: solo polígonos con anillos cerrados de 4 o más puntos, en coordenadas WGS84 dentro de Arequipa y alrededores', f.every((x) => polis(x.geometry).length > 0 && polis(x.geometry).every((p) => p.every((a) => a.length >= 4 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1] && a.every(([lon, lat]) => lon > -73 && lon < -70 && lat > -17.5 && lat < -15.5)))));
  comprobar('Electricidad: hay una concesión de SEAL (Sociedad Eléctrica del Sur Oeste) con el expediente 15008293-00-00', f.some((x) => x.properties.concesionaria === 'SEAL' && x.properties.expediente === '15008293-00-00'));
  const enSeal = (lat, lon) => f.some((x) => x.properties.concesionaria === 'SEAL' && polis(x.geometry).some((p) => dentro(lon, lat, p)));
  const plaza = CalcE.evaluarConcesion({ lat: -16.3989, lon: -71.5369 }, f, {});
  comprobar('Electricidad: la Plaza de Armas de Arequipa está dentro de una concesión de SEAL (módulo del navegador y número de vueltas coinciden)', plaza.dentro === true && plaza.concesionarias.includes('SEAL') && enSeal(-16.3989, -71.5369));
  comprobar('Electricidad: un punto en Lima y otro en el mar quedan fuera, con una distancia grande al borde', [[-12.05, -77.04], [-17.5, -73.5]].every(([la, lo]) => { const r = CalcE.evaluarConcesion({ lat: la, lon: lo }, f, {}); return r.dentro === false && r.distanciaM > 100000; }));
  // Dentro / fuera frente al número de vueltas en puntos al azar de la caja de Arequipa metropolitana (los mismos criterios, otro método).
  let discrepan = 0;
  let dentroN = 0;
  const N_E = 400;
  for (let i = 0; i < N_E; i++) {
    const lon = -71.75 + azar() * 0.4;
    const lat = -16.6 + azar() * 0.4;
    const nav = CalcE.evaluarConcesion({ lat, lon }, f, {}).dentro;
    const ref = f.some((x) => polis(x.geometry).some((p) => dentro(lon, lat, p)));
    if (ref) dentroN++;
    if (nav !== ref) discrepan++;
  }
  comprobar(`Electricidad: dentro / fuera de una concesión en ${N_E} puntos al azar de la caja de Arequipa coincide con el número de vueltas`, discrepan === 0 && dentroN > 0 && dentroN < N_E, `${dentroN} dentro, ${discrepan} discrepancias`);
  console.log(`INFO  Electricidad: ${f.length} concesiones (${Object.entries(m.conteo_por_concesionaria).map(([k, v]) => `${k} ${v}`).join(', ')}); descargado el ${m.fecha_descarga}; dentro de una concesión: ${dentroN} de ${N_E} puntos al azar de la caja`);
}

// B7d. Concesiones mineras (INGEMMET, Catastro Minero; scripts/descargar-concesiones-mineras.mjs): el archivo y el módulo del navegador frente al número de vueltas.
// Es INFORMATIVO: una concesión es un derecho sobre los minerales, no minería en el predio. No se guarda el nombre del titular.
{
  const CalcM = createRequire(import.meta.url)('../public/js/calculos.js');
  const fc = json('data/mineria/concesiones_mineras.geojson');
  const f = fc.features;
  const m = fc.metadata || {};
  const polis = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  const CAMPOS_M = ['codigo', 'nombre', 'hectareas', 'estado', 'estado_detalle', 'sustancia', 'explotacion_o_exploracion', 'distritos', 'fecha_denuncio', 'actualizado'];
  comprobar('Minería: metadata con la fuente (INGEMMET), el enlace del servicio, la fecha de descarga, el aviso de que es referencial y lo que NO dice',
    /INGEMMET/.test(m.fuente || '') && /^https:\/\/geocatmin\.ingemmet\.gob\.pe\/.*MapServer\/0$/.test(m.url_servicio || '') && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha_descarga || '') && /referencial/.test(m.aviso_del_servicio || '') && /NO dice que haya minería/.test(m.no_dice || '') && /sin umbral/i.test(m.informativo || ''));
  comprobar('Minería: metadata.registros y conteo_por_estado coinciden con el número de features', m.registros === f.length && f.length > 0 && Object.values(m.conteo_por_estado || {}).reduce((t, n) => t + n, 0) === f.length);
  comprobar('Minería: cada concesión trae todos sus campos, con código único y estado conocido, y NINGUNA trae el nombre del titular', f.every((x) => CAMPOS_M.every((c) => c in x.properties) && ['TITULADO', 'EN TRÁMITE', 'EXTINGUIDO', 'OTRO'].includes(x.properties.estado) && !('TIT_CONCES' in x.properties) && !('titular' in x.properties)) && new Set(f.map((x) => x.properties.codigo)).size === f.length);
  comprobar('Minería: solo polígonos con anillos cerrados de 4 o más puntos, en coordenadas WGS84 cerca de Arequipa', f.every((x) => polis(x.geometry).length > 0 && polis(x.geometry).every((p) => p.every((a) => a.length >= 4 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1] && a.every(([lon, lat]) => lon > -73 && lon < -70 && lat > -17.5 && lat < -15.5)))));
  const plaza = CalcM.evaluarMinera({ lat: -16.3989, lon: -71.5369 }, f, {});
  comprobar('Minería: la Plaza de Armas de Arequipa no cae en una concesión minera y hay una a distancia finita (módulo del navegador y número de vueltas coinciden)', plaza.dentro === false && Number.isFinite(plaza.distanciaM) && !f.some((x) => x.properties.estado !== 'EXTINGUIDO' && polis(x.geometry).some((p) => dentro(-71.5369, -16.3989, p))));
  let discrepan = 0;
  let dentroN = 0;
  const N_M = 400;
  for (let i = 0; i < N_M; i++) {
    const lon = -71.75 + azar() * 0.4;
    const lat = -16.6 + azar() * 0.4;
    const nav = CalcM.evaluarMinera({ lat, lon }, f, {}).dentro;
    const ref = f.some((x) => x.properties.estado !== 'EXTINGUIDO' && polis(x.geometry).some((p) => dentro(lon, lat, p)));
    if (ref) dentroN++;
    if (nav !== ref) discrepan++;
  }
  comprobar(`Minería: dentro / fuera de una concesión (sin las extinguidas) en ${N_M} puntos al azar de la caja de Arequipa coincide con el número de vueltas`, discrepan === 0 && dentroN > 0 && dentroN < N_M, `${dentroN} dentro, ${discrepan} discrepancias`);
  console.log(`INFO  Minería: ${f.length} concesiones (${Object.entries(m.conteo_por_estado).map(([k, v]) => `${k} ${v}`).join(', ')}); descargado el ${m.fecha_descarga}; dentro de una concesión viva: ${dentroN} de ${N_M} puntos al azar de la caja`);
}

// B7c. Censo por manzana (INEI, REDATAM 2017; scripts/descargar-censo-servicios.mjs): los archivos y el módulo del navegador frente al número de vueltas.
// Es INFORMATIVO: son cifras de la manzana en 2017, no de un predio.
{
  const CalcM = createRequire(import.meta.url)('../public/js/calculos.js');
  const idx = json('data/censo/index.json');
  const polisM = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  comprobar('Censo: el índice trae el año (2017), la fuente INEI, los enlaces de REDATAM y del WFS, la fecha de descarga, el universo, los campos y lo que NO dice (el 2025)',
    idx.anio_censo === 2017 && /INEI/.test(idx.fuente || '') && /^https:\/\/censos2017\.inei\.gob\.pe\//.test(idx.url_redatam || '') && /geoespacial\.inei\.gob\.pe/.test(idx.url_poligonos || '') && /^\d{4}-\d{2}-\d{2}$/.test(idx.fecha_descarga || '') && /ocupadas con personas presentes/.test(idx.universo || '') && /2025/.test(idx.no_dice || '') && ['id', 'v', 'h', 'p', 'o', 'l', 'ad', 'af', 'sd', 'sf'].every((k) => idx.campos[k]));
  let manzanasN = 0;
  let conDatosN = 0;
  let incoherentesN = 0;
  let idsRepetidos = 0;
  let fueraDeCaja = 0;
  let anillosMalos = 0;
  let sumaPers = 0;
  let sumaViv = 0;
  const todas = new Map();
  const vistos = new Set();
  const tilesOk = idx.distritos.every((d) => {
    const crudo = leer(`data/censo/${d.archivo}`);
    const fc = JSON.parse(crudo);
    const [w, s, e, n] = d.caja;
    let pers = 0;
    let viv = 0;
    let con = 0;
    for (const f of fc.features) {
      const p = f.properties;
      if (vistos.has(p.id)) idsRepetidos++;
      vistos.add(p.id);
      const ps = polisM(f.geometry);
      if (!ps.length || !ps.every((q) => q.every((a) => a.length >= 4 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1]))) anillosMalos++;
      if (!ps.every((q) => q.every((a) => a.every(([x, y]) => x >= w && x <= e && y >= s && y <= n && x > -73 && x < -70 && y > -17.5 && y < -15.5)))) fueraDeCaja++;
      if (typeof p.o === 'number') {
        con++;
        pers += p.p;
        viv += p.v;
        if (!(p.l <= p.o && p.ad + p.af <= p.o && p.sd + p.sf <= p.o && p.o <= p.v && p.l >= 0 && p.ad >= 0 && p.af >= 0 && p.sd >= 0 && p.sf >= 0)) incoherentesN++;
      }
      todas.set(p.id, f);
    }
    manzanasN += fc.features.length;
    conDatosN += con;
    sumaPers += pers;
    sumaViv += viv;
    return fc.features.length === d.manzanas && con === d.con_datos && pers === d.personas && viv === d.viviendas && fc.metadata.ubigeo === d.ubigeo && fc.metadata.anio === 2017;
  });
  comprobar('Censo: cada pieza por distrito coincide con el índice (manzanas, con cifras, viviendas, personas, ubigeo y año)', tilesOk && manzanasN === idx.totales.manzanas && conDatosN === idx.totales.con_datos && sumaPers === idx.totales.personas && sumaViv === idx.totales.viviendas, `${manzanasN} manzanas, ${conDatosN} con cifras`);
  comprobar('Censo: las manzanas son polígonos con anillos cerrados dentro de la caja de su distrito, con idmanzana único', anillosMalos === 0 && fueraDeCaja === 0 && idsRepetidos === 0);
  comprobar('Censo: en toda manzana con cifras, con alumbrado ≤ ocupadas, agua de red ≤ ocupadas, desagüe de red ≤ ocupadas y ocupadas ≤ viviendas contadas (nada negativo)', incoherentesN === 0);
  comprobar('Censo: los distritos del índice son de la provincia de Arequipa y están en los límites del proyecto', idx.distritos.every((d) => /^0401\d\d$/.test(d.ubigeo)));
  // La manzana de un punto: el módulo del navegador frente al número de vueltas, en 300 puntos al azar de la caja del Cercado.
  const cercado = idx.distritos.find((d) => d.ubigeo === '040101');
  const feats = JSON.parse(leer(`data/censo/${cercado.archivo}`)).features;
  let discrepan = 0;
  let dentroN = 0;
  const N_C = 300;
  for (let i = 0; i < N_C; i++) {
    const lon = cercado.caja[0] + azar() * (cercado.caja[2] - cercado.caja[0]);
    const lat = cercado.caja[1] + azar() * (cercado.caja[3] - cercado.caja[1]);
    const ref = feats.find((f) => polisM(f.geometry).some((p) => dentro(lon, lat, p)));
    const nav = CalcM.evaluarManzana({ lat, lon }, feats, { anio: 2017, cercanaM: 0.0001, minViviendas: 5 }); // cercanaM casi 0: solo «dentro»
    const idNav = nav.modo === 'dentro' ? nav.manzana : null;
    if (ref) dentroN++;
    if ((ref ? ref.properties.id : null) !== idNav) discrepan++;
  }
  comprobar(`Censo: la manzana que contiene a ${N_C} puntos al azar del Cercado coincide con el número de vueltas`, discrepan === 0 && dentroN > 0, `${dentroN} dentro de alguna manzana, ${discrepan} discrepancias`);
  const plaza = CalcM.evaluarManzana({ lat: -16.3989, lon: -71.5369 }, feats, { anio: 2017, cercanaM: 30, minViviendas: 5 });
  comprobar('Censo: la Plaza de Armas de Arequipa cae en (o junto a) una manzana del Cercado', plaza.modo === 'dentro' || plaza.modo === 'cercana', `modo ${plaza.modo}, manzana ${plaza.manzana}`);
  const fuera = idx.distritos.reduce((t, d) => ({ viv: t.viv + d.fuera_de_manzana.viviendas, per: t.per + d.fuera_de_manzana.personas }), { viv: 0, per: 0 });
  console.log(`INFO  Censo 2017: ${idx.totales.distritos} distritos, ${idx.totales.manzanas} manzanas (${idx.totales.con_datos} con cifras), ${idx.totales.viviendas} viviendas y ${idx.totales.personas} personas en manzanas; fuera de manzana (sin polígono): ${fuera.viv} viviendas, ${fuera.per} personas; ${(idx.totales.bytes / 1048576).toFixed(1)} MB`);
}

// B7a. Peligro volcánico: el módulo del navegador frente a un recuento independiente (número de vueltas, sin índice de cajas).
{
  const Vol = app('Volcan');
  const Ctx = app('Contexto');
  const RANGO = { bajo: 1, moderado: 2, alto: 3 };
  // En un punto: el nivel más alto de cada fenómeno, calculado aquí con el método de las vueltas sobre el archivo crudo.
  // Se descartan primero los polígonos cuya caja (mínimo y máximo de sus vértices, calculados aquí) no contiene el punto.
  const cajas = volcan.features.map((x) => {
    const pts = x.geometry.coordinates.flatMap((p) => p[0]);
    return [Math.min(...pts.map((c) => c[0])), Math.min(...pts.map((c) => c[1])), Math.max(...pts.map((c) => c[0])), Math.max(...pts.map((c) => c[1]))];
  });
  const nivelesEn = (lat, lon) => {
    const mejor = {};
    volcan.features.forEach((x, i) => {
      const t = x.properties.tipo;
      const b = cajas[i];
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return;
      if (x.geometry.coordinates.some((p) => dentro(lon, lat, p)) && (!mejor[t] || RANGO[x.properties.nivel] > RANGO[mejor[t]])) mejor[t] = x.properties.nivel;
    });
    return mejor;
  };
  const zonas = Vol.indexar(volcan.features);
  let distintos = 0;
  let conZona = 0;
  const detalles = [];
  for (let k = 0; k < 400; k++) {
    const lat = sur + azar() * (norte - sur);
    const lon = oeste + azar() * (este - oeste);
    const esperado = nivelesEn(lat, lon);
    const obtenido = Object.fromEntries(Vol.resumirPunto(Vol.enZonas(lat, lon, zonas)).map((r) => [r.tipo, r.nivel]));
    if (Object.keys(esperado).some((t) => t !== 'ceniza')) conZona++;
    if (JSON.stringify(Object.entries(esperado).sort()) !== JSON.stringify(Object.entries(obtenido).sort())) { distintos++; if (detalles.length < 3) detalles.push(`${lat.toFixed(4)},${lon.toFixed(4)}`); }
  }
  comprobar('Volcán: 400 puntos al azar en Arequipa metropolitana dan el mismo nivel por fenómeno que el método independiente', distintos === 0, `${distintos} diferencias${detalles.length ? ` (${detalles.join('; ')})` : ''}; ${conZona} puntos en alguna zona de lahares, flujos, lava o avalanchas`);
  // Un punto conocido: la cima del Misti.
  const cima = Vol.resumirPunto(Vol.enZonas(-16.294, -71.409, zonas));
  comprobar('Volcán: la cima del Misti cae en peligro alto de flujos piroclásticos y de avalanchas', cima.find((r) => r.tipo === 'flujo_piroclastico')?.nivel === 'alto' && cima.find((r) => r.tipo === 'avalancha')?.nivel === 'alto');
  // El módulo Contexto.volcan devuelve lo mismo, informativo, con su fuente y sin cumple.
  const v = await Ctx.volcan(-16.4256, -71.4944);
  comprobar('Volcán (módulo): INFORMATIVO, con frase, fuente del IGP, referencia y fecha de los datos; nunca cumple ni puntaje', v.estado === 'INFORMATIVO' && /Instituto Geofísico/.test(v.fuente) && /INGEMMET/.test(v.referencia) && /Sin metadatos de fecha/.test(v.fechaDelMapa) && !/cumple|puntaje/i.test(JSON.stringify(v.frase) + JSON.stringify(v.lineas)), v.frase);
  // Por distrito: Paucarpata y Cayma con una muestra cada 150 m (independiente) frente a la de 250 m del módulo (tolerancia de 4 puntos).
  const mPorGrado = ((Math.PI / 180) * 6371008.8);
  const porcentajes = (polys) => {
    const bx = polys.flatMap((p) => p[0]);
    const x0 = Math.min(...bx.map((c) => c[0])); const x1 = Math.max(...bx.map((c) => c[0]));
    const y0 = Math.min(...bx.map((c) => c[1])); const y1 = Math.max(...bx.map((c) => c[1]));
    const dl = 150 / mPorGrado;
    const cuenta = { alto: 0, moderado: 0, bajo: 0, ninguno: 0 };
    let n = 0;
    for (let lat = y0 + dl / 2; lat < y1; lat += dl) {
      const dlo = 150 / (mPorGrado * Math.cos(rad(lat)));
      for (let lon = x0 + dlo / 2; lon < x1; lon += dlo) {
        if (!polys.some((p) => dentro(lon, lat, p))) continue;
        n++;
        cuenta[nivelesEn(lat, lon).lahar || 'ninguno']++;
      }
    }
    return Object.fromEntries(Object.entries(cuenta).map(([k, c]) => [k, (100 * c) / n]));
  };
  const resultados = [];
  let distritosOk = true;
  for (const nombre of ['PAUCARPATA', 'CAYMA']) {
    const polys = Dis.poligonos(nombre);
    const mio = Vol.porDistrito(zonas, polys, { pasoM: 250 }).porTipo.lahar;
    const otro = porcentajes(polys);
    const peor = Math.max(...Object.keys(otro).map((k) => Math.abs(mio[k] - otro[k])));
    if (peor > 4) distritosOk = false;
    resultados.push(`${nombre} alto ${mio.alto.toFixed(1)}/${otro.alto.toFixed(1)} moderado ${mio.moderado.toFixed(1)}/${otro.moderado.toFixed(1)} bajo ${mio.bajo.toFixed(1)}/${otro.bajo.toFixed(1)}`);
  }
  comprobar('Volcán: la parte de Paucarpata y de Cayma en cada nivel de lahares coincide (±4 puntos) con una muestra independiente cada 150 m', distritosOk, resultados.join(' · '));
}

// B7b. Contexto: el módulo del navegador da lo mismo que un conteo independiente y rotula lo que corresponde.
{
  const Ctx = app('Contexto');
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const cosenos = (la1, lo1, la2, lo2) => R * Math.acos(Math.min(1, Math.sin(rad(la1)) * Math.sin(rad(la2)) + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1))));
  const la = -16.399;
  const lo = -71.537;
  const radio = app('CONFIG.sismos.radioM');
  const esperado = sismos.features.filter((x) => cosenos(la, lo, x.geometry.coordinates[1], x.geometry.coordinates[0]) <= radio);
  const s = await Ctx.sismos(la, lo);
  comprobar('Sismos: el conteo en el radio coincide con un recuento independiente (ley esférica de los cosenos)', s.estado === 'INFORMATIVO' && s.total === esperado.length, `${s.total} sismos a ${radio / 1000} km`);
  comprobar('Sismos: la magnitud máxima y el periodo salen del archivo', s.magnitudMaxima === Math.max(...esperado.map((x) => x.properties.magnitud)) && s.desde === sismos.metadata.fechaDesde && s.hasta === sismos.metadata.fechaHasta);
  const p = await Ctx.peligros(la, lo);
  const enRadio = peligros.features.filter((x) => cosenos(la, lo, x.geometry.coordinates[1], x.geometry.coordinates[0]) <= p.radioM);
  comprobar('Peligros (contexto): el conteo en el radio coincide con un recuento independiente y siempre es INFORMATIVO', p.estado === 'INFORMATIVO' && p.total === enRadio.length, `${p.total} a ${p.radioM} m; el más cercano a ${Math.round(p.distanciaM)} m`);
  const q = await Ctx.quebradas(la, lo, null);
  comprobar('Quebradas (módulo): INFORMATIVO sin umbral, con nombre y distancia; según tu umbral solo si la persona lo fija', q.estado === 'INFORMATIVO' && q.nombre && q.distanciaM > 0 && q.segunUmbralUsuario === false && (await Ctx.quebradas(la, lo, 100)).segunUmbralUsuario === true);
  comprobar('Quebradas (módulo): nombra la fuente del cauce más cercano y las fuentes del archivo con sus tramos', ['ANA', 'IGP', 'OpenStreetMap'].includes(q.fuenteCorta) && q.fuentes.length === 3 && q.fuentes.every((x) => x.registros === quebradas.features.filter((y) => y.properties.fuente === x.id).length), `${q.nombre} (${q.fuenteCorta})`);
  // «Qué no cubre»: las quebradas ausentes se recalculan aquí con un método propio (texto en minúsculas sin tildes) y deben coincidir.
  {
    const sin = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const todosLosNombres = sin(quebradas.metadata.nombres.join(' | '));
    const sectores = peligros.features.map((x) => sin(x.properties.sector || ''));
    const cuentaDe = (clave) => sectores.filter((t) => new RegExp('(quebrada|qda\\.?|torrentera)\\s+' + clave).test(t)).length;
    const claves = (q.ausentes || []).map((a) => sin(a.nombre).replace(/[^a-z ]/g, ''));
    comprobar('Quebradas (módulo): ninguna quebrada «ausente» figura entre los nombres del archivo', claves.every((c) => !todosLosNombres.includes(c)), claves.join(', '));
    comprobar('Quebradas (módulo): los registros de cada quebrada ausente coinciden con un recuento independiente del campo sector de INGEMMET', (q.ausentes || []).every((a) => a.registros === 0 || cuentaDe(sin(a.nombre).replace(/[^a-z ]/g, '')) >= a.registros), (q.ausentes || []).map((a) => `${a.nombre} ${a.registros}`).join(', '));
  }
  const sinArchivo = vm.createContext({ console, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  for (const f of ['js/config.js', 'js/calculos.js', 'js/geo.js', 'js/peligros.js', 'js/contexto.js']) vm.runInContext(leer(f), sinArchivo, { filename: f });
  const vacio = await vm.runInContext('Contexto.evaluar(-16.399, -71.537, 200)', sinArchivo);
  comprobar('Contexto: si faltan los archivos congelados, las tres variables quedan SIN DATO con su causa (no se inventan datos)', ['quebradas', 'peligros', 'sismos'].every((k) => vacio[k].estado === 'SIN DATO' && !!vacio[k].error));
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

// ------------------------------------------------- C. Asistente de chat
console.log('\n== C. Asistente: búsqueda de zonas frente a un método independiente ==');
{
  vm.runInContext(leer('js/precios.js'), ctx, { filename: 'js/precios.js' }); // asistente.js lo usa para el precio por m² del distrito
  vm.runInContext(leer('js/asistente.js'), ctx, { filename: 'js/asistente.js' });
  const A = app('Asistente');
  const U = { ...CONFIG.umbrales, zona: CONFIG.asistente.umbralesZona };
  const zonasLista = await Zon.zonas();
  const datos = A.prepararDatos({
    salud: equipamiento.salud.features, educacion: equipamiento.educacion.features, transporte: equipamiento.transporte.features, areasVerdes: equipamiento.areas_verdes.features,
  }, zonasLista, U);
  const celdas = A.generarCeldas(zonasLista, { pasoM: CONFIG.asistente.pasoCeldaM });
  comprobar('Asistente: la cuadrícula tiene celdas solo en zonas construibles', celdas.length > 1000 && celdas.every((c) => reglas[c.zona]?.edificable === 'si'), `${celdas.length} celdas de ${CONFIG.asistente.pasoCeldaM} m`);

  // La zona de cada celda coincide con la que devuelve la búsqueda por punto de la ficha (otro camino de código).
  const muestra = Array.from({ length: 300 }, () => celdas[Math.floor(azar() * celdas.length)]);
  let difZona = 0;
  for (const c of muestra) if ((await Zon.lookup(c.lat, c.lon))?.codigo !== c.zona) difZona++;
  comprobar('Asistente: la zona de 300 celdas al azar coincide con Zonificacion.lookup', difZona === 0, `${difZona} diferencias`);

  // Distancias: fuerza bruta con la ley esférica de los cosenos (sin el atajo de latitud ni el haversine del código).
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const cosenos = (la1, lo1, la2, lo2) => R * Math.acos(Math.min(1, Math.sin(rad(la1)) * Math.sin(rad(la2)) + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1))));
  const brutoMin = (features, filtro) => (c) => Math.min(...features.filter(filtro).map((f) => cosenos(c.lat, c.lon, f.geometry.coordinates[1], f.geometry.coordinates[0])));
  const bruto = {
    salud: brutoMin(equipamiento.salud.features, () => true),
    transporte: brutoMin(equipamiento.transporte.features, () => true),
    // Definición escrita aquí, aparte de Calculos.nivelesEducativos: jardín, o colegio etiquetado con nivel 0 / school=kindergarten.
    inicial: brutoMin(equipamiento.educacion.features, (f) => {
      if (f.properties.fuente === 'ESCALE') return f.properties.niveles.includes('inicial');
      if (f.properties.niveles && !f.properties.niveles.includes('inicial')) return false; // respaldo de OSM: solo los niveles que ESCALE no cubre ahí
      const t = f.properties.tags;
      return t.amenity === 'kindergarten' || (t.amenity === 'school' && (/(^|[;,\s])0($|[;,\s])/.test(t['isced:level'] ?? '') || /kindergarten/.test(t.school ?? '')));
    }),
  };
  const req = (id) => ({ id, umbralM: null, prioridad: 1 });
  const dif = { salud: 0, transporte: 0, inicial: 0 };
  const lejos = { salud: 0, transporte: 0, inicial: 0 };
  const ejemplos = [];
  const pocas = muestra.slice(0, 120);
  for (const c of pocas) {
    const e = A.evaluarCelda(c, datos, [req('salud'), req('transporte'), req('inicial')], U);
    for (const id of ['salud', 'transporte', 'inicial']) {
      const b = bruto[id](c);
      const umbral = id === 'inicial' ? U.educacion.inicial : U[id];
      if (Math.abs(e[id].distanciaM - b) > 0.5 || e[id].cumple !== (b <= umbral)) {
        dif[id]++;
        if (ejemplos.length < 3) ejemplos.push(`${id}: código ${e[id].distanciaM?.toFixed(1)} m / cosenos ${b.toFixed(1)} m (cumple ${e[id].cumple}, umbral ${umbral})`);
      }
      if (b > 3000) lejos[id]++;
    }
  }
  comprobar('Asistente: distancia y veredicto de salud, transporte e inicial en 120 celdas coinciden con la fuerza bruta (ley de cosenos)', Object.values(dif).every((n) => n === 0), `diferencias: ${JSON.stringify(dif)}${ejemplos.length ? ` · ${ejemplos.join(' | ')}` : ''}`);

  // Búsqueda completa con los datos reales: tiempo, orden y coherencia de las áreas.
  await Dis.load();
  const criterios = [req('colegio'), { ...req('salud'), prioridad: 2 }, req('areaVerde')];
  const r = A.buscar({ criterios, zonas: zonasLista, datos, umbrales: U, distritoDe: (la, lo) => Dis.nombreDe(la, lo), pasoM: CONFIG.asistente.pasoCeldaM, minCeldas: CONFIG.asistente.minCeldasArea });
  // El tiempo se mide con el módulo cargado como CommonJS: dentro de `vm` el código corre varias veces más lento que en el
  // navegador y la cifra no diría nada de lo que vive la persona.
  const Rapido = createRequire(import.meta.url)('../public/js/asistente.js');
  const datosRapido = Rapido.prepararDatos({
    salud: equipamiento.salud.features, educacion: equipamiento.educacion.features, transporte: equipamiento.transporte.features, areasVerdes: equipamiento.areas_verdes.features,
  }, zonasLista, U);
  const parametros = { criterios, zonas: zonasLista, datos: datosRapido, umbrales: U, distritoDe: (la, lo) => Dis.nombreDe(la, lo), pasoM: CONFIG.asistente.pasoCeldaM, minCeldas: CONFIG.asistente.minCeldasArea };
  let t0 = Date.now();
  const rapida = Rapido.buscar(parametros);
  const msPrimera = Date.now() - t0;
  const celdasListas = Rapido.generarCeldas(zonasLista, { pasoM: CONFIG.asistente.pasoCeldaM });
  t0 = Date.now();
  Rapido.buscar({ ...parametros, celdas: celdasListas });
  const msReuso = Date.now() - t0;
  comprobar('Asistente: una búsqueda con 3 criterios sobre los datos reales tarda menos de 2 s', msPrimera < 2000, `${msPrimera} ms, ${rapida.totalCeldas} celdas`);
  comprobar('Asistente: con la cuadrícula ya calculada («agrega…», «quita…») tarda menos de 1 s', msReuso < 1000, `${msReuso} ms`);
  comprobar('Asistente: dentro y fuera de `vm` la búsqueda da las mismas áreas y porcentajes', JSON.stringify(rapida.areas.map((a) => [a.nombre, a.celdas, Math.round(a.pctCumpleTodo * 100)])) === JSON.stringify(r.areas.map((a) => [a.nombre, a.celdas, Math.round(a.pctCumpleTodo * 100)])));
  comprobar('Asistente: los porcentajes están entre 0 y 100 y las áreas vienen ordenadas por coincidencia', r.areas.length > 0 && r.areas.every((a, i) => a.pctCumpleTodo >= 0 && a.pctCumpleTodo <= 100 && a.puntajePct >= 0 && a.puntajePct <= 100 && (i === 0 || r.areas[i - 1].puntajePct >= a.puntajePct)), `${r.areas.length} distritos`);
  comprobar('Asistente: la mejor celda de cada área cae realmente en ese distrito', r.areas.every((a) => Dis.nombreDe(a.mejor.lat, a.mejor.lon) === a.nombre));
  comprobar('Asistente: la suma de celdas por distrito no supera el total', r.areas.reduce((s, a) => s + a.celdas, 0) <= r.totalCeldas);
  // Distritos y entidades: conteo por distrito, sectores dentro de un distrito y lenguaje de la respuesta.
  const Ent = createRequire(import.meta.url)('../public/js/entidades.js');
  const nombresDistrito = Dis.lista().map((d) => d.nombre);
  const conteos = nombresDistrito.map((n) => [n, Ent.contar(datosRapido, Dis.poligonos(n))]);
  const sumaColegios = conteos.reduce((s, [, c]) => s + c.colegios.total, 0);
  comprobar('Distritos: la lista trae los 25 distritos del archivo, cada uno con polígono', nombresDistrito.length === 25 && nombresDistrito.every((n) => Dis.poligonos(n).length > 0), `${nombresDistrito.length} distritos`);
  comprobar('Distritos: los colegios por distrito no superan el total de colegios con nivel (ninguno se cuenta en dos distritos)', sumaColegios <= datosRapido.colegiosLista.length, `${sumaColegios} de ${datosRapido.colegiosLista.length}`);
  const pau = Object.fromEntries(conteos).PAUCARPATA;
  comprobar('Distritos: Paucarpata tiene colegios, salud, paraderos y parques en los datos', pau.colegios.total > 0 && pau.salud.total > 0 && pau.paraderos.total > 0 && pau.parques.total > 0, `${pau.colegios.total} colegios, ${pau.salud.total} salud, ${pau.paraderos.total} paraderos, ${pau.parques.total} parques`);
  const enPau = Rapido.buscar({ ...parametros, criterios: [req('inicial'), req('areaVerde')], distrito: 'PAUCARPATA', celdas: celdasListas });
  const fPau = Rapido.formatearBusqueda(enPau, { datos: datosRapido, distrito: 'Paucarpata' });
  comprobar('Asistente: una búsqueda dentro de Paucarpata solo devuelve celdas de Paucarpata y sectores con su contorno', enPau.cumplen.length > 0 && enPau.cumplen.every((c) => c.distrito === 'PAUCARPATA') && fPau.sectores.length > 0 && fPau.sectores.every((s) => s.contorno.length > 0), `${fPau.sectores.length} sectores`);
  comprobar('Asistente: el centro de cada sector cae dentro de Paucarpata', fPau.sectores.every((s) => Dis.contiene('PAUCARPATA', s.centro.lat, s.centro.lon)));
  comprobar('Asistente: el texto de una búsqueda no habla de suelo, coincidencia ni celdas', !/suelo|coincidencia|ponderad|celda|cuadr[ií]cula/i.test(fPau.texto), fPau.texto.split('\n')[0]);
  const frase = Rapido.interpretar('quiero vivir en pauccarpata cuantos colegios hay ahi', {});
  comprobar('Asistente: «quiero vivir en pauccarpata cuantos colegios hay ahi» cuenta colegios en Paucarpata', frase.tipo === 'contar' && frase.distrito === 'PAUCARPATA');
  const cubre = (id) => `${id} ${Math.round((100 * celdas.filter((c) => A.evaluarCelda(c, datos, [req(id)], U)[id].cumple).length) / celdas.length)} %`;
  console.log(`INFO  Parte de las celdas que cumple cada criterio con su umbral: ${['colegio', 'inicial', 'primaria', 'secundaria', 'salud', 'transporte', 'areaVerde', 'campina'].map(cubre).join(' · ')}`);
}

// ------------------------------------------------- D. Rutas de transporte (SmartBus)
console.log('\n== D. Rutas de SmartBus: integridad y cálculos frente a métodos independientes ==');
{
  const rutasFc = json('data/rutas_smartbus.geojson');
  const meta = rutasFc.metadata || {};
  const feats = rutasFc.features;
  const lineasF = feats.filter((f) => f.properties?.tipo === 'ruta');
  const paradasF = feats.filter((f) => f.properties?.tipo === 'parada');
  const CAJA = { oeste: -71.8, sur: -16.7, este: -71.2, norte: -16.1 }; // la misma de scripts/descargar-rutas-smartbus.mjs
  const enCaja = ([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= CAJA.oeste && x <= CAJA.este && y >= CAJA.sur && y <= CAJA.norte;
  const partesDe = (f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates);

  // D1. Integridad
  comprobar('Rutas: es una FeatureCollection solo de rutas (LineString o MultiLineString) y paradas (Point)', rutasFc.type === 'FeatureCollection' && feats.length === lineasF.length + paradasF.length && lineasF.every((f) => /^(Multi)?LineString$/.test(f.geometry?.type)) && paradasF.every((f) => f.geometry?.type === 'Point'), `${lineasF.length} rutas, ${paradasF.length} paradas`);
  comprobar('Rutas: metadatos con fuente, permiso (verbal, confirmación escrita pendiente), atribución y fecha de descarga', meta.fuente === 'SmartBus (smartbus.app)' && /verbal/.test(meta.permiso) && /confirmaci[oó]n escrita pendiente/.test(meta.permiso) && meta.atribucion === 'Rutas: SmartBus (smartbus.app)' && /^\d{4}-\d{2}-\d{2}$/.test(meta.fecha_descarga), `${meta.fecha_descarga}`);
  const lineasUnicas = new Set(lineasF.map((f) => f.properties.linea));
  const vertices = lineasF.reduce((n, f) => n + partesDe(f).reduce((m, p) => m + p.length, 0), 0);
  const ramales = new Set(lineasF.map((f) => `${f.properties.linea}|${f.properties.ramal}`));
  comprobar('Rutas: los conteos de los metadatos cuadran con el contenido', meta.conteos?.rutas === lineasF.length && meta.conteos?.paradas === paradasF.length && meta.conteos?.lineas === lineasUnicas.size && meta.conteos?.ramales === ramales.size && meta.conteos?.vertices === vertices, JSON.stringify(meta.conteos));
  comprobar('Rutas: cada ruta tiene línea, empresa, ramal, nombre, sentido, id, fuente y enlace https a smartbus.app', lineasF.every((f) => ['linea', 'empresa', 'ramal', 'nombre', 'sentido', 'id_ruta'].every((k) => typeof f.properties[k] === 'string' && f.properties[k]) && f.properties.fuente === 'SmartBus (smartbus.app)' && /^https:\/\/smartbus\.app\/pe\/arequipa\//.test(f.properties.url)));
  comprobar('Rutas: ids de ruta únicos', new Set(lineasF.map((f) => f.properties.id_ruta)).size === lineasF.length);
  comprobar('Rutas: todos los vértices y paradas son números dentro de Arequipa', lineasF.every((f) => partesDe(f).every((p) => p.length >= 2 && p.every(enCaja))) && paradasF.every((f) => enCaja(f.geometry.coordinates)));
  const deAB = (a, b) => { const x = (rad(b[0] - a[0])) * Math.cos(rad((a[1] + b[1]) / 2)); const y = rad(b[1] - a[1]); return R * Math.hypot(x, y); };
  const saltos = lineasF.flatMap((f) => partesDe(f).flatMap((p) => p.slice(1).map((c, i) => deAB(p[i], c)))).filter((d) => d > meta.salto_maximo_m + 1);
  comprobar(`Rutas: ningún segmento mide más de ${meta.salto_maximo_m} m (los saltos entre tramos se partieron en el archivo)`, saltos.length === 0, `${saltos.length} segmentos`);
  const paradasPorRuta = new Map();
  paradasF.forEach((f) => { if (!paradasPorRuta.has(f.properties.id_ruta)) paradasPorRuta.set(f.properties.id_ruta, []); paradasPorRuta.get(f.properties.id_ruta).push(f.properties.orden); });
  const ids = new Set(lineasF.map((f) => f.properties.id_ruta));
  comprobar('Rutas: toda parada pertenece a una ruta existente, el campo «paradas» de la ruta coincide con las que tiene y el orden es 1…n sin saltos', paradasF.every((f) => ids.has(f.properties.id_ruta) && Number.isInteger(f.properties.orden) && f.properties.nombre)
    && lineasF.every((f) => { const o = (paradasPorRuta.get(f.properties.id_ruta) || []).sort((a, b) => a - b); return o.length === f.properties.paradas && o.every((v, i) => v === i + 1); }));

  // Las paradas son vértices del recorrido o están sobre él: medida con el mismo módulo del navegador.
  const RutasMod = app('Rutas');
  const indice = RutasMod.indexar(rutasFc);
  const rutaPorId = new Map(indice.rutas.map((r) => [r.props.id_ruta, r]));
  const distParada = indice.paradas.map((s) => Math.min(...rutaPorId.get(s.props.id_ruta).partes.map((p) => Calc.distanciaALineaM(s.lat, s.lon, p))));
  const lejosDeSuRuta = distParada.filter((d) => d > 50).length;
  comprobar('Rutas: al menos el 99,9 % de las paradas queda a 50 m o menos del trazado de su propia ruta', lejosDeSuRuta <= Math.floor(indice.paradas.length * 0.001), `${lejosDeSuRuta} de ${indice.paradas.length} a más de 50 m`);

  // D2. Líneas cerca de un punto frente a la distancia sobre la esfera punto-segmento (cross-track), por fuerza bruta.
  const aRad = (c) => [rad(c[1]), rad(c[0])]; // [lat, lon] en radianes
  const angular = (p, q) => { const dLa = q[0] - p[0]; const dLo = q[1] - p[1]; const h = Math.sin(dLa / 2) ** 2 + Math.cos(p[0]) * Math.cos(q[0]) * Math.sin(dLo / 2) ** 2; return 2 * Math.asin(Math.min(1, Math.sqrt(h))); };
  const rumbo = (p, q) => Math.atan2(Math.sin(q[1] - p[1]) * Math.cos(q[0]), Math.cos(p[0]) * Math.sin(q[0]) - Math.sin(p[0]) * Math.cos(q[0]) * Math.cos(q[1] - p[1]));
  function distSegEsfera(p, a, b) {
    const dA = angular(a, p);
    const dB = angular(b, p);
    const dAB = angular(a, b);
    if (dAB < 1e-12) return R * dA;
    const xt = Math.asin(Math.sin(dA) * Math.sin(rumbo(a, p) - rumbo(a, b)));
    const at = Math.acos(Math.min(1, Math.max(-1, Math.cos(dA) / Math.cos(xt))));
    const aviene = Math.cos(rumbo(a, p) - rumbo(a, b)) >= 0;
    return R * (aviene && at <= dAB ? Math.abs(xt) : Math.min(dA, dB));
  }
  const prec = lineasF.map((f) => ({ linea: f.properties.linea, partes: partesDe(f).map((p) => p.map(aRad)) }));
  const puntosPrueba = [];
  for (let k = 0; k < 80; k++) puntosPrueba.push([sur + azar() * (norte - sur), oeste + azar() * (este - oeste)]);
  for (let k = 0; k < 120; k++) { // la mitad cerca de algún vértice real, para que haya líneas que sí pasan
    const f = lineasF[Math.floor(azar() * lineasF.length)];
    const p = partesDe(f); const pp = p[Math.floor(azar() * p.length)]; const v = pp[Math.floor(azar() * pp.length)];
    puntosPrueba.push([v[1] + (azar() - 0.5) * 0.008, v[0] + (azar() - 0.5) * 0.008]);
  }
  let conLineas = 0; let diferencias = 0; let desvio = 0; const muestras = [];
  const D = CONFIG.umbrales.transporte;
  for (const [la, lo] of puntosPrueba) {
    const obtenido = RutasMod.cerca(indice, la, lo, D);
    const p = aRad([lo, la]);
    const minPorLinea = new Map();
    for (const r of prec) {
      let m = Infinity;
      for (const parte of r.partes) for (let i = 1; i < parte.length; i++) m = Math.min(m, distSegEsfera(p, parte[i - 1], parte[i]));
      minPorLinea.set(r.linea, Math.min(minPorLinea.get(r.linea) ?? Infinity, m));
    }
    const esperadas = [...minPorLinea].filter(([, d]) => d <= D);
    if (obtenido.lineas.length) conLineas++;
    const dudosas = new Set([...minPorLinea].filter(([, d]) => Math.abs(d - D) < 2).map(([l]) => l)); // en el borde de 400 m las dos fórmulas pueden diferir por metros
    const a = new Set(obtenido.lineas.map((l) => l.linea).filter((l) => !dudosas.has(l)));
    const b = new Set(esperadas.map(([l]) => l).filter((l) => !dudosas.has(l)));
    if (a.size !== b.size || [...a].some((l) => !b.has(l))) { diferencias++; if (muestras.length < 3) muestras.push(`${la.toFixed(5)},${lo.toFixed(5)}: ${[...a]} vs ${[...b]}`); }
    obtenido.lineas.forEach((l) => { desvio = Math.max(desvio, Math.abs(l.distanciaM - minPorLinea.get(l.linea))); });
  }
  comprobar(`Rutas: líneas a ${D} m o menos de ${puntosPrueba.length} puntos coinciden con la distancia punto-segmento sobre la esfera (fuerza bruta)`, diferencias === 0, `${conLineas} puntos con alguna línea; ${muestras.join(' | ')}`);
  comprobar('Rutas: la distancia a cada línea difiere menos de 2,5 m de la calculada sobre la esfera', desvio < 2.5, `máxima diferencia ${desvio.toFixed(2)} m`);

  // D3. Líneas que cruzan un distrito frente a un barrido más fino (cada 20 m) con punto en polígono por número de vueltas.
  const nombresProbados = ['PAUCARPATA', 'CAYMA', 'SOCABAYA', 'YURA', 'MIRAFLORES', 'CHARACATO'];
  const fallosDistrito = [];
  const resumenDistrito = [];
  for (const nombre of nombresProbados) {
    const fs = distritos.features.filter((f) => f.properties.distrito === nombre);
    const polis = fs.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
    const geo = { type: 'MultiPolygon', coordinates: polis };
    const obtenido = new Set(RutasMod.cruzan(indice, geo).lineas.map((l) => l.linea));
    const cuenta = new Map();
    for (const f of lineasF) for (const parte of partesDe(f)) {
      for (let i = 0; i < parte.length; i++) {
        const pasos = i + 1 < parte.length ? Math.max(1, Math.ceil(deAB(parte[i], parte[i + 1]) / 20)) : 1;
        for (let s = 0; s < pasos; s++) {
          const t = s / pasos;
          const x = i + 1 < parte.length ? parte[i][0] + (parte[i + 1][0] - parte[i][0]) * t : parte[i][0];
          const y = i + 1 < parte.length ? parte[i][1] + (parte[i + 1][1] - parte[i][1]) * t : parte[i][1];
          if (polis.some((p) => dentro(x, y, p))) cuenta.set(f.properties.linea, (cuenta.get(f.properties.linea) ?? 0) + 1);
        }
      }
    }
    const esperado = new Set([...cuenta].filter(([, n]) => n >= 5).map(([l]) => l)); // con menos de 5 puntos (100 m) el cruce es un roce que el método del código puede no contar
    const roce = new Set([...cuenta].filter(([, n]) => n < 5).map(([l]) => l));
    const faltan = [...esperado].filter((l) => !obtenido.has(l));
    const sobran = [...obtenido].filter((l) => !cuenta.has(l));
    if (faltan.length || sobran.length) fallosDistrito.push(`${nombre}: faltan ${faltan} sobran ${sobran}`);
    resumenDistrito.push(`${nombre} ${obtenido.size} líneas${roce.size ? ` (${roce.size} roces)` : ''}`);
  }
  comprobar(`Rutas: las líneas que cruzan ${nombresProbados.length} distritos coinciden con un barrido cada 20 m y número de vueltas`, fallosDistrito.length === 0, fallosDistrito.join(' | ') || resumenDistrito.join(', '));
  const plazaRutas = RutasMod.cerca(indice, CONFIG.center[0], CONFIG.center[1], D);
  console.log(`INFO  Plaza de Armas: ${RutasMod.resumen(plazaRutas, 20)}`);
  comprobar('Rutas: lejos de toda ruta (Pampa de Majes, 120 km al oeste) no se inventa ninguna línea', RutasMod.cerca(indice, -16.35, -72.65, D).lineas.length === 0);
}

// Z. Rutas de bus de OpenStreetMap (scripts/descargar-rutas-osm.mjs) y el viaje en combi (public/js/viaje.js); va al final porque guarda en memoria los trazados densificados y eso ralentiza las pruebas de tiempo: el archivo, su acuerdo con SmartBus y un viaje conocido.
{
  const CalcR = createRequire(import.meta.url)('../public/js/calculos.js');
  globalThis.Calculos = globalThis.Calculos || CalcR;
  const V = createRequire(import.meta.url)('../public/js/viaje.js');
  const RutasM = createRequire(import.meta.url)('../public/js/rutas.js');
  const fcO = json('data/rutas_osm.geojson');
  const mO = fcO.metadata || {};
  const rO = fcO.features;
  comprobar('Rutas OSM: metadata con la fuente, la consulta, la fecha, la base de OSM, la licencia ODbL, la atribución y los conteos', /OpenStreetMap/.test(mO.fuente || '') && typeof mO.consulta === 'string' && /relation\["type"="route"\]/.test(mO.consulta) && /^\d{4}-\d{2}-\d{2}$/.test(mO.fecha_extraccion || '') && mO.licencia === 'ODbL' && /OpenStreetMap/.test(mO.atribucion || '') && mO.conteos && mO.conteos.rutas === rO.length && rO.length > 0, `${rO.length} rutas`);
  comprobar('Rutas OSM: cada ruta es un sentido de un ramal con id de OSM único, línea, ramal, de y hasta, y un trazado (LineString o MultiLineString) dentro de Arequipa', new Set(rO.map((f) => f.properties.osm)).size === rO.length && rO.every((f) => /^relation\/\d+$/.test(f.properties.osm) && f.properties.linea && f.properties.ramal && f.properties.desde && f.properties.hasta && /^(Multi)?LineString$/.test(f.geometry.type) && (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates).every((p) => p.length >= 2 && p.every(([x, y]) => x > -72 && x < -71 && y > -17 && y < -16))));
  const saltoMax = Math.max(0, ...rO.flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates).flatMap((p) => p.slice(1).map((c, i) => CalcR.haversine(p[i][1], p[i][0], c[1], c[0])))));
  comprobar('Rutas OSM: ninguna relación tuvo un salto entre vías de más de 300 m (se habría partido en partes) y ningún tramo recto del trazado pasa de 1 km', mO.conteos.con_saltos === 0 && saltoMax <= 1000, `mayor tramo recto entre vértices ${Math.round(saltoMax)} m (dentro de una misma vía de OSM)`);
  comprobar('Rutas OSM: duración e intervalo, cuando están, son minutos enteros positivos', rO.every((f) => [f.properties.duracion_min, f.properties.intervalo_min].every((x) => x === null || (Number.isInteger(x) && x > 0))));
  const fcS = json('data/rutas_smartbus.geojson');
  const osmR = V.desdeOsm(fcO);
  const sbR = V.desdeSmartbus(RutasM.indexar(fcS));
  const todas = [...osmR, ...sbR].map((ruta) => ({ ruta, caminarTotalM: 0, viajeM: 0 }));
  const unidas = V.unir(todas);
  const enAmbas = unidas.filter((u) => u.fuentes.length === 2).length;
  comprobar('Rutas OSM y SmartBus: describen las mismas rutas (la unión por línea + ramal + de + hasta deja casi todas en las dos fuentes)', enAmbas / osmR.length >= 0.9, `${enAmbas} de ${osmR.length} rutas de OSM están también en SmartBus`);
  const lineasO = new Set(rO.map((f) => f.properties.linea));
  comprobar('Rutas OSM y SmartBus: las mismas líneas', [...lineasO].every((l) => fcS.metadata.lineas.includes(l)) && fcS.metadata.lineas.every((l) => lineasO.has(l)));
  // Un viaje conocido: desde Paucarpata (cerca de la C6) hasta el Parque Industrial de la configuración hay rutas directas y todas ponen el origen antes que el destino.
  const PI = { lat: -16.4179, lon: -71.5497 };
  const rutasT = [...osmR, ...sbR];
  const dir = V.rutasDirectas({ lat: -16.4240, lon: -71.5000 }, PI, rutasT, { caminarM: 400 });
  comprobar('Viaje: de Paucarpata al Parque Industrial hay rutas directas de las dos fuentes, a ≤ 400 m de las dos puntas y con viaje mayor que cero', dir.directas.length > 0 && dir.directas.every((d) => d.caminarOrigenM <= 400 && d.caminarDestinoM <= 400 && d.viajeM > 0) && new Set(dir.directas.map((d) => d.ruta.fuente)).size === 2, `${dir.directas.length} directas, ${V.unir(dir.directas).length} distintas`);
  const inv = V.rutasDirectas(PI, { lat: -16.4240, lon: -71.5000 }, rutasT, { caminarM: 400 });
  comprobar('Viaje: el sentido importa: las rutas directas de ida no son las mismas que las del regreso', V.unir(dir.directas).map((d) => d.ruta.ramal + d.ruta.hasta).sort().join() !== V.unir(inv.directas).map((d) => d.ruta.ramal + d.ruta.hasta).sort().join() || dir.directas.length !== inv.directas.length);
  console.log(`INFO  Rutas OSM: ${rO.length} rutas, ${mO.conteos.vertices} vértices, líneas ${JSON.stringify(mO.conteos.lineas)}; con duración ${mO.conteos.con_duracion}, con intervalo ${mO.conteos.con_intervalo}`);
}

console.log(`\n${pruebas - fallos} de ${pruebas} comprobaciones correctas.`);
if (fallos) {
  console.error(`${fallos} FALLARON.`);
  process.exit(1);
}
