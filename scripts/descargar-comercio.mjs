/**
 * descargar-comercio.mjs — Arma los mercados de abastos, los supermercados y los malls (centros comerciales) de Arequipa y los escribe en
 * los archivos que lee la aplicación (categorías INFORMATIVAS: sin umbral, no entran en el puntaje ni en la búsqueda de zonas):
 *   public/data/equipamiento/mercados.geojson       OpenStreetMap amenity=marketplace (puntos y polígonos)
 *   public/data/equipamiento/supermercados.geojson  OpenStreetMap shop=supermarket, aparte de los mercados
 *   public/data/equipamiento/malls.geojson          OpenStreetMap shop=mall y landuse=retail con nombre de mall; polígonos donde OSM tiene el edificio
 *
 * Uso:   node scripts/descargar-comercio.mjs      (o: pnpm datos:comercio)
 * Opciones:
 *   --refrescar        vuelve a consultar Overpass y a descargar el CENAMA aunque estén en la caché
 *   --radio=150        radio (m) con el que se juntan los elementos que son el mismo lugar (por omisión 150)
 *   --cenama=ruta.csv  usa ese CSV del CENAMA en vez de descargarlo
 *
 * Qué hace:
 *  - UNA sola consulta a Overpass para toda la caja (la de CONFIG.viewbox), con tiempo máximo y reintentos de espera creciente, identificándose
 *    con un User-Agent. La respuesta queda en .cache-comercio/ (no se sube al repositorio): se reutiliza mientras la consulta no cambie.
 *  - Las etiquetas de cada categoría están en Calculos.FILTROS (única definición). Solo se conserva lo que cae dentro de los distritos
 *    (public/data/distritos_aqp.geojson). Un lugar mapeado dos veces (nodo y edificio, o edificio y terreno) cuenta una (scripts/lib/comercio.js).
 *  - Los malls se contrastan con una lista curada y verificada (cada uno con el enlace de su fuente). Un mall de la lista que OSM no tiene se
 *    informa en `metadata.curados.sin_osm`; no se le inventa una ubicación.
 *  - CENAMA 2016 (INEI; PRODUCE en datosabiertos.gob.pe) es una tabla anonimizada, sin nombre ni coordenadas: no se puede ubicar un mercado con ella.
 *    Se usa solo para medir la cobertura (mercados de OSM frente a mercados del censo, por distrito); queda en docs/validacion/cenama-cobertura.json.
 *  - Cada elemento lleva `fuente` (OSM), `osm` (tipo/id), `nombre` y las etiquetas de OSM. `metadata` lleva la consulta, la fecha, la base de
 *    OSM, la licencia, los conteos y la regla.
 *  - Si algo falla (red, formato, categoría vacía) NO se escribe nada y se sale con código 1. Nunca se inventan ni se rellenan datos.
 *  - Los datos de OSM son © colaboradores de OpenStreetMap, licencia ODbL.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Calculos = require('../public/js/calculos.js');
const C = require('./lib/comercio.js');

// ------------------------------------------------------------------ CONFIGURACIÓN
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATOS = join(RAIZ, 'public', 'data');
const SALIDA = join(DATOS, 'equipamiento');
const CACHE = join(RAIZ, '.cache-comercio');
const VALIDACION = join(RAIZ, 'docs', 'validacion');
// Misma caja que CONFIG.viewbox (sur, oeste, norte, este).
const BBOX = [-16.6, -71.75, -16.2, -71.35];
const SERVIDORES = [
  { etiqueta: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter', intentos: 2 },
  { etiqueta: 'overpass.openstreetmap.fr (respaldo)', url: 'https://overpass.openstreetmap.fr/api/interpreter', intentos: 2 },
  { etiqueta: 'overpass.kumi.systems (respaldo)', url: 'https://overpass.kumi.systems/api/interpreter', intentos: 1 },
];
const ESPERA_BASE_MS = 8000;
const TIMEOUT_CLIENTE_MS = 300000;
const USER_AGENT = 'geoverificador-datos/1.0 (descarga de datos abiertos; proyecto académico)';
const FUENTE_OSM = 'OpenStreetMap (ODbL)';

const CENAMA = {
  pagina: 'https://www.datosabiertos.gob.pe/dataset/censo-nacional-de-mercado-de-abastos-cenama-2016-ministerio-de-la-producci%C3%B3n-produce',
  csv: 'https://www.datosabiertos.gob.pe/sites/default/files/dat_cenamav3.csv',
  entidad: 'Ministerio de la Producción (PRODUCE); levantado por el INEI entre el 2016-11-24 y el 2017-01-16',
  licencia: 'Open Data Commons Attribution License (ODC-By)',
  libro: 'https://www.inei.gob.pe/media/MenuRecursivo/publicaciones_digitales/Est/Lib1448/libro.pdf',
  limites:
    'Tabla anonimizada (id_anonimo_cenama): sin nombre, dirección ni coordenadas; solo departamento, provincia, distrito, tipo de mercado, puestos y servicios. ' +
    'No permite ubicar un mercado: sirve para medir cuántos mercados había en cada distrito en 2016 y compararlo con OpenStreetMap.',
};

/**
 * Malls curados: nombre, patrón para reconocerlos en OSM (expresión regular sin tildes), entidad que lo confirma y el enlace de esa fuente.
 * Cada uno se verificó contra el sitio oficial del mall o de su operador (ver docs/METODOLOGIA.md); esto NO da coordenadas: la ubicación
 * es la de OpenStreetMap y, si OSM no lo tiene, el mall se informa como ausente.
 */
const VERIFICADO_EL = '2026-11-10';
const CURADOS = [
  {
    id: 'mall-aventura', nombre: 'Mall Aventura Arequipa', patron: 'aventura', entidad: 'Mall Aventura (sitio oficial)', tipo_fuente: 'sitio oficial',
    url: 'https://mallaventura.pe/arequipa/', direccion: 'Av. Porongoche N° 500, Paucarpata', verificado_el: VERIFICADO_EL,
  },
  {
    id: 'real-plaza', nombre: 'Real Plaza Arequipa', patron: 'real plaza', entidad: 'Real Plaza (sitio oficial)', tipo_fuente: 'sitio oficial',
    url: 'https://www.realplaza.com/arequipa', direccion: 'Av. Ejército N° 1009, Cayma', verificado_el: VERIFICADO_EL,
  },
  {
    id: 'mallplaza', nombre: 'Mallplaza Arequipa', patron: 'mall ?plaza', entidad: 'Mallplaza (sitio oficial)', tipo_fuente: 'sitio oficial',
    url: 'https://www.mallplaza.com/pe/arequipa', direccion: 'Av. Ejército 793, Cayma', verificado_el: VERIFICADO_EL,
  },
  {
    id: 'outlet-arauco', nombre: 'OutletArauco Arequipa (antes Parque Lambramani)', patron: 'lambramani|outlet ?arauco', entidad: 'Parque Arauco, OutletArauco (sitio oficial; parquelambramani.com redirige a él)', tipo_fuente: 'sitio oficial',
    url: 'https://arequipa.outletarauco.pe/', direccion: 'Av. Los Incas, Arequipa', verificado_el: VERIFICADO_EL,
  },
  {
    id: 'arequipa-center', nombre: 'Arequipa Center', patron: 'arequipa center', entidad: 'Cencosud (según Peru Retail, 2018-10-16; no se encontró un sitio oficial)', tipo_fuente: 'prensa especializada',
    url: 'https://www.peru-retail.com/centros-comerciales-arequipa/', direccion: 'Av. Aviación 602, Cerro Colorado', verificado_el: VERIFICADO_EL,
  },
];

const REGLAS = {
  mercados:
    'Elementos de OpenStreetMap con amenity=marketplace (puntos y polígonos) dentro de los polígonos de los distritos (public/data/distritos_aqp.geojson). ' +
    'OSM etiqueta así tanto los mercados de abastos como ferias y mercadillos: no distingue minorista de mayorista. Un mismo mercado mapeado dos veces se cuenta una.',
  supermercados:
    'Elementos de OpenStreetMap con shop=supermarket (puntos y polígonos) dentro de los distritos, como categoría aparte de los mercados. Un mismo local mapeado dos veces se cuenta una.',
  malls:
    'Elementos de OpenStreetMap con shop=mall y los de landuse=retail cuyo nombre diga mall, centro comercial, shopping o el de un mall conocido de Arequipa (Calculos.FILTROS.malls), ' +
    'dentro de los distritos. Se conserva el polígono cuando OSM lo tiene y la distancia se mide al borde, no al centro. El edificio shop=mall manda sobre el terreno landuse=retail del mismo nombre.',
};

// ------------------------------------------------------------------ ARGUMENTOS
function argumentos(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

// ------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultarOverpass(url, consulta) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': USER_AGENT },
    body: `data=${encodeURIComponent(consulta)}`,
    signal: AbortSignal.timeout(TIMEOUT_CLIENTE_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(`Overpass reportó: ${data.remark}`);
  if (!Array.isArray(data.elements)) throw new Error('la respuesta no trae `elements`');
  return data;
}

async function obtenerOverpass(consulta, refrescar) {
  const hash = createHash('sha1').update(consulta).digest('hex');
  const ruta = join(CACHE, 'overpass-comercio.json');
  if (existsSync(ruta) && !refrescar) {
    const guardado = JSON.parse(readFileSync(ruta, 'utf8'));
    if (guardado.hash === hash) {
      console.log(`Overpass: respuesta en la caché (${guardado.fecha_consulta}); usa --refrescar para volver a consultar.`);
      return guardado;
    }
    console.log('Overpass: la consulta cambió; se vuelve a consultar.');
  }
  const fallos = [];
  for (const s of SERVIDORES) {
    for (let i = 1; i <= s.intentos; i++) {
      try {
        console.log(`Consultando ${s.etiqueta} (intento ${i}/${s.intentos})…`);
        const data = await consultarOverpass(s.url, consulta);
        const guardado = { hash, fecha_consulta: new Date().toISOString().slice(0, 10), servidor: s.url, osm_base: data.osm3s?.timestamp_osm_base ?? null, elements: data.elements };
        await mkdir(CACHE, { recursive: true });
        await writeFile(ruta, JSON.stringify(guardado));
        return guardado;
      } catch (err) {
        const causa = err?.cause?.code || err.message;
        fallos.push(`${s.etiqueta} intento ${i}: ${causa}`);
        console.warn(`  falló: ${causa}`);
        if (i < s.intentos) await esperar(ESPERA_BASE_MS * i);
      }
    }
  }
  throw new Error(`Overpass no respondió tras todos los intentos:\n  ${fallos.join('\n  ')}`);
}

async function obtenerCenama(a) {
  if (a.cenama && a.cenama !== true) return { texto: readFileSync(a.cenama, 'utf8'), origen: a.cenama };
  const ruta = join(CACHE, 'dat_cenamav3.csv');
  if (!existsSync(ruta) || a.refrescar) {
    console.log(`CENAMA: descargando ${CENAMA.csv}`);
    const res = await fetch(CENAMA.csv, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`CENAMA: HTTP ${res.status} en ${CENAMA.csv}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(ruta, Buffer.from(await res.arrayBuffer()));
  } else console.log('CENAMA: archivo en la caché.');
  return { texto: readFileSync(ruta, 'utf8'), origen: CENAMA.csv };
}

// ------------------------------------------------------------------ DISTRITOS
function cargarDistritos() {
  const fc = JSON.parse(readFileSync(join(DATOS, 'distritos_aqp.geojson'), 'utf8'));
  const zonas = fc.features.map((f) => {
    const polis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const pts = polis.flatMap((p) => p[0]);
    return {
      nombre: f.properties.distrito,
      polis,
      caja: [Math.min(...pts.map((c) => c[0])), Math.min(...pts.map((c) => c[1])), Math.max(...pts.map((c) => c[0])), Math.max(...pts.map((c) => c[1]))],
    };
  });
  const zonaDe = (lat, lon) => zonas.find((z) => lon >= z.caja[0] && lon <= z.caja[2] && lat >= z.caja[1] && lat <= z.caja[3] && z.polis.some((anillos) => Calculos.puntoEnPoligono(lat, lon, anillos)));
  return { dentro: (lat, lon) => Boolean(zonaDe(lat, lon)), distritoDe: (lat, lon) => (zonaDe(lat, lon) ? zonaDe(lat, lon).nombre : null), nombres: zonas.map((z) => z.nombre) };
}

// ------------------------------------------------------------------ SALIDA
const normaliza = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

async function guardar(nombre, features, metadata) {
  const cabecera = JSON.stringify({ type: 'FeatureCollection', metadata }).slice(0, -1);
  const cuerpo = `${cabecera},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  await writeFile(join(SALIDA, `${nombre}.geojson`), cuerpo);
  console.log(`  ${nombre}.geojson: ${features.length} elementos, ${(Buffer.byteLength(cuerpo) / 1024).toFixed(0)} kB`);
}

const comoSalida = (f, extra = {}) => {
  const { categoria: _c, ...props } = f.properties;
  return { type: 'Feature', properties: { fuente: 'OSM', ...props, ...extra }, geometry: f.geometry };
};

// ------------------------------------------------------------------ PRINCIPAL
async function main() {
  const a = argumentos(process.argv.slice(2));
  const radioM = a.radio ? Number(a.radio) : 150;
  if (!(radioM > 0)) throw new Error('--radio debe ser un número de metros mayor que 0.');
  mkdirSync(CACHE, { recursive: true });

  const consulta = C.construirConsulta(BBOX);
  const osm = await obtenerOverpass(consulta, a.refrescar);
  const distritos = cargarDistritos();

  const conv = C.convertirElementos(osm.elements);
  console.log(`\nOSM: ${osm.elements.length} elementos; ${conv.features.length} clasificados; ${conv.sinGeometria} sin geometría utilizable (vías o relaciones sin cerrar); ${conv.sinCategoria} sin categoría (p. ej. landuse=retail sin nombre de mall).`);
  const dentro = C.enDistritos(conv.features, distritos.dentro);
  console.log(`  dentro de los distritos: ${dentro.length} (fuera de ellos: ${conv.features.length - dentro.length}).`);

  const preferirMall = (f) => (f.properties.tags.shop === 'mall' ? 2 : 1); // el edificio manda sobre el terreno comercial
  const por = {};
  for (const cat of C.CATEGORIAS) {
    const propios = dentro.filter((f) => f.properties.categoria === cat);
    const d = C.deduplicar(propios, { radioM, preferir: cat === 'malls' ? preferirMall : () => 0 });
    por[cat] = { crudos: propios.length, ...d };
  }
  const ver = C.verificarCurados(por.malls.features, CURADOS);
  por.malls.features = ver.features;

  const vacias = C.CATEGORIAS.filter((c) => por[c].features.length === 0);
  if (vacias.length) throw new Error(`Sin resultados para: ${vacias.join(', ')}. No se escribió nada.`);

  // Cobertura frente al CENAMA 2016 (solo mercados).
  const cen = await obtenerCenama(a);
  const censo = C.leerCenama(cen.texto);
  const cob = C.cobertura(censo.registros, por.mercados.features, distritos.distritoDe);
  const sinDistritoCenama = cob.filas.filter((f) => f.cenama > 0 && !distritos.nombres.map(normaliza).includes(normaliza(f.distrito))).map((f) => f.distrito);

  const base = {
    fuente: FUENTE_OSM,
    fecha_extraccion: osm.fecha_consulta,
    osm_base: osm.osm_base,
    servidor: osm.servidor,
    consulta,
    caja: { sur: BBOX[0], oeste: BBOX[1], norte: BBOX[2], este: BBOX[3] },
    licencia: 'ODbL',
    url_licencia: 'https://www.openstreetmap.org/copyright',
    atribucion: '© colaboradores de OpenStreetMap',
    informativo: 'Sin umbral: variable informativa, no entra en el puntaje ni en la búsqueda de zonas del asistente.',
    generado: new Date().toISOString().slice(0, 10),
    sin_geometria_utilizable: conv.sinGeometria,
  };
  await mkdir(SALIDA, { recursive: true });
  console.log('\nEscribiendo:');
  for (const cat of C.CATEGORIAS) {
    const feats = por[cat].features.map((f) => comoSalida(f));
    const meta = {
      ...base,
      categoria: cat,
      regla: REGLAS[cat],
      registros: feats.length,
      conteo_por_fuente: { OSM: feats.length },
      conteo_por_geometria: { punto: feats.filter((f) => f.geometry.type === 'Point').length, poligono: feats.filter((f) => f.geometry.type !== 'Point').length },
      deduplicacion: { radio_m: radioM, elementos_antes: por[cat].crudos, descartados: por[cat].descartados },
    };
    if (cat === 'malls') {
      meta.curados = {
        lista: CURADOS.map((c) => ({ id: c.id, nombre: c.nombre, entidad: c.entidad, tipo_fuente: c.tipo_fuente, url: c.url, direccion: c.direccion, verificado_el: c.verificado_el })),
        verificados_en_osm: feats.filter((f) => f.properties.verificado).map((f) => ({ osm: f.properties.osm, nombre: f.properties.nombre, id: f.properties.verificado.id })),
        sin_osm: ver.sinOsm.map((c) => ({ id: c.id, nombre: c.nombre, url: c.url })),
        nota: 'La lista curada confirma que el mall existe (con el enlace de su fuente); la ubicación y la forma son siempre las de OpenStreetMap. Un mall sin elemento en OSM no se dibuja ni se mide.',
      };
    }
    if (cat === 'mercados') {
      meta.cenama = {
        id: 'CENAMA 2016',
        nombre: 'Censo Nacional de Mercados de Abastos 2016',
        entidad: CENAMA.entidad,
        pagina: CENAMA.pagina,
        url: CENAMA.csv,
        licencia: CENAMA.licencia,
        limites: CENAMA.limites,
        registros_pais: censo.totalPais,
        registros_provincia_arequipa: censo.registros.length,
        por_tipo: censo.porTipo,
        cobertura: 'docs/validacion/cenama-cobertura.json',
      };
    }
    await guardar(cat === 'malls' ? 'malls' : cat, feats, meta);
  }

  await mkdir(VALIDACION, { recursive: true });
  await writeFile(
    join(VALIDACION, 'cenama-cobertura.json'),
    `${JSON.stringify({
      generado: base.generado,
      fuentes: { cenama: { ...CENAMA, origen: cen.origen, registros_provincia_arequipa: censo.registros.length, por_tipo: censo.porTipo }, osm: { fecha: osm.fecha_consulta, osm_base: osm.osm_base, etiqueta: 'amenity=marketplace', radio_dedup_m: radioM } },
      advertencia: 'El CENAMA no trae coordenadas: solo se comparan CONTEOS por distrito. Un conteo parecido no demuestra que sean los mismos mercados, ni uno distinto que falte alguno.',
      distritos_del_censo_fuera_de_los_25_distritos_del_proyecto: sinDistritoCenama,
      filas: cob.filas,
      totales: cob.totales,
    }, null, 2)}\n`,
  );

  console.log(`\nMercados: ${por.mercados.features.length} de OSM (de ${por.mercados.crudos}; ${por.mercados.descartados} repetidos). CENAMA 2016: ${censo.registros.length} en la provincia.`);
  console.log(`Supermercados: ${por.supermercados.features.length} de OSM (de ${por.supermercados.crudos}; ${por.supermercados.descartados} repetidos).`);
  console.log(`Malls: ${por.malls.features.length} de OSM (de ${por.malls.crudos}; ${por.malls.descartados} repetidos); curados sin OSM: ${ver.sinOsm.map((c) => c.nombre).join(', ') || 'ninguno'}.`);
  console.log('\nCobertura por distrito (CENAMA 2016 / OSM):');
  cob.filas.forEach((f) => console.log(`  ${f.distrito}: ${f.cenama} / ${f.osm}`));
  console.log(`  Total: ${cob.totales.cenama} / ${cob.totales.osm}`);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
