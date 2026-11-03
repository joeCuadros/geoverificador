/**
 * descargar-peligro-volcanico.mjs — Congela las zonas de peligro volcánico del Misti que cubren Arequipa.
 *
 * Fuente: Instituto Geofísico del Perú (IGP, CENVUL), servicio monitoreocenvul/Vulcanologia (ArcGIS REST, CORS abierto). Las
 * capas NO traen descripción, fecha ni licencia: el servicio solo da el nombre de la capa y, en algunas, atributos de la zona
 * (`zona`, `afectacion`, `deposito`, `ocurrencia`). Se registra tal cual y se dice qué falta:
 *   - Lahares:                 capas 29, 30 y 31 (LaharAltoMisti, LaharMediaMisti, LaharBajaMisti) y, solo con volcan = Misti,
 *                              capas 18, 19 y 20 (Lahares Alta, Media y Baja: probabilidad y volumen del escenario).
 *   - Flujos piroclásticos:    capas 15, 16 y 17.
 *   - Lava:                    capas 21, 22 y 23.
 *   - Avalanchas de escombros: capas 9, 10 y 11.
 *   - Ceniza:                  capas 12, 13 y 14 (escenarios vulcaniano, subpliniano y pliniano, cada uno con zonas alta,
 *                              moderada y baja y el espesor del depósito). El servicio no dice de qué volcán son; se incluyen
 *                              porque cubren Arequipa y el escenario es el del Misti (ver docs/METODOLOGIA.md).
 * No se guardan las capas 24 a 27 (son las mismas zonas unidas) ni las de otros volcanes.
 *
 * Referencia oficial del mapa de peligros: INGEMMET, Boletín Serie C n.° 100 «Geología y nuevos mapas de peligros del volcán
 * Misti» (Cueva y Mariño, 2025), que reemplaza al Boletín n.° 60 (2016) y al mapa de 2007. NO se pudo confirmar de qué edición
 * salen las capas del IGP: por eso la metadata dice «sin metadatos de fecha».
 *
 * Uso:   node scripts/descargar-peligro-volcanico.mjs
 * Sale:  public/data/peligro_volcanico_misti.geojson
 *
 * Decisiones:
 *  - Cada polígono se simplifica (Douglas-Peucker) a unos 11 m (22 m en lahares 29 a 31, que vienen de un ráster y pesan
 *    millones de vértices; 55 m en ceniza, que son zonas regionales). Es mucho menos que la escala del mapa de peligros.
 *  - Se descartan los polígonos de menos de ~600 m² (restos de la conversión de ráster).
 *  - Solicitudes sencillas con un User-Agent propio, una por capa y con pausa. Si una capa falla, no se escribe nada.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { simplificarAnillo, redondear } = require('./lib/geometria.js');

// ------------------------------------------------------------------ CONFIGURACIÓN
const SERVICIO = process.env.VOLCAN_URL || 'https://ide.igp.gob.pe/arcgis/rest/services/monitoreocenvul/Vulcanologia/MapServer';
const USER_AGENT = 'geoverificador-datos/1.0 (proyecto academico de verificacion de predios en Arequipa; descarga unica de datos publicos)';
// Caja de Arequipa metropolitana (oeste, sur, este, norte): se guardan los polígonos que la tocan.
const CAJA = [-71.75, -16.6, -71.35, -16.2];
const DECIMALES = 5;
const AREA_MINIMA_GRADOS2 = 5e-8; // ~600 m²
const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'peligro_volcanico_misti.geojson');

const NIVEL_DE = { 'peligro alto': 'alto', 'peligro moderado': 'moderado', 'peligro bajo': 'bajo', 'probabilidad alta': 'alto', 'probabilidad media': 'moderado', 'probabilidad baja': 'bajo' };

// id de capa → { tipo, nivel, tolerancia, where? }. `nivel: null` = se lee del campo `zona` de cada polígono.
const CAPAS = [
  { id: 29, tipo: 'lahar', nivel: 'alto', tol: 0.0002 },
  { id: 30, tipo: 'lahar', nivel: 'moderado', tol: 0.0002 },
  { id: 31, tipo: 'lahar', nivel: 'bajo', tol: 0.0002 },
  { id: 18, tipo: 'lahar', nivel: 'alto', tol: 0.0001, where: "volcan='Misti'", escenario: true },
  { id: 19, tipo: 'lahar', nivel: 'moderado', tol: 0.0001, where: "volcan='Misti'", escenario: true },
  { id: 20, tipo: 'lahar', nivel: 'bajo', tol: 0.0001, where: "volcan='Misti'", escenario: true },
  { id: 15, tipo: 'flujo_piroclastico', nivel: 'alto', tol: 0.0001 },
  { id: 16, tipo: 'flujo_piroclastico', nivel: 'moderado', tol: 0.0001 },
  { id: 17, tipo: 'flujo_piroclastico', nivel: 'bajo', tol: 0.0001 },
  { id: 21, tipo: 'lava', nivel: 'alto', tol: 0.0001 },
  { id: 22, tipo: 'lava', nivel: 'moderado', tol: 0.0001 },
  { id: 23, tipo: 'lava', nivel: 'bajo', tol: 0.0001 },
  { id: 9, tipo: 'avalancha', nivel: 'alto', tol: 0.0001 },
  { id: 10, tipo: 'avalancha', nivel: 'moderado', tol: 0.0001 },
  { id: 11, tipo: 'avalancha', nivel: 'bajo', tol: 0.0001 },
  { id: 12, tipo: 'ceniza', nivel: null, tol: 0.0005 },
  { id: 13, tipo: 'ceniza', nivel: null, tol: 0.0005 },
  { id: 14, tipo: 'ceniza', nivel: null, tol: 0.0005 },
];

// ------------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, params) {
  const destino = `${url}?${new URLSearchParams({ f: 'json', ...params })}`;
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(destino, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`el servicio respondió ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (err) {
      if (intento >= 3) throw new Error(`Falló la consulta tras 3 intentos (${err.message}).\nURL: ${destino}`);
      await esperar(3000 * intento);
    }
  }
}

/** Área (grados², con signo) de un anillo; solo sirve para descartar restos diminutos. */
function areaAnillo(r) {
  let s = 0;
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(s / 2);
}

/** Los polígonos de ArcGIS (`rings`) como MultiPolygon: un anillo exterior (sentido horario en ArcGIS) por polígono y sus huecos. */
function aMultiPoligono(rings, tol) {
  const polis = [];
  let conservado = false; // el último exterior se guardó: solo entonces sus huecos le pertenecen
  for (const anillo of rings || []) {
    const s = simplificarAnillo(anillo.map(([x, y]) => [x, y]), tol);
    if (!s) continue;
    // En ArcGIS el anillo exterior es horario (área con signo negativa) y los huecos, antihorarios.
    let suma = 0;
    for (let i = 0; i + 1 < s.length; i++) suma += s[i][0] * s[i + 1][1] - s[i + 1][0] * s[i][1];
    const exterior = suma < 0;
    const redondeado = s.map(([x, y]) => [redondear(x, DECIMALES), redondear(y, DECIMALES)]);
    if (exterior) {
      conservado = areaAnillo(redondeado) >= AREA_MINIMA_GRADOS2;
      if (conservado) polis.push([redondeado]);
    } else if (conservado && areaAnillo(redondeado) >= AREA_MINIMA_GRADOS2 / 4) polis[polis.length - 1].push(redondeado);
  }
  return polis;
}

function detalleDe(capa, a) {
  const alcance = a.afectacion || a['afectación'];
  if (capa.tipo === 'ceniza') {
    const esc = String(a.erupcion_t || '').toLowerCase();
    return `Escenario ${esc}: depósito de ceniza ${a.deposito || 'sin dato'}${alcance ? `, alcance ${alcance}` : ''}`;
  }
  if (capa.escenario) return `${a.ocurrencia || 'Escenario'}, volumen ${a.volumen || 'sin dato'}`;
  return alcance ? `Alcance ${alcance}` : null;
}

// ------------------------------------------------------------------------- PRINCIPAL
async function main() {
  const [oeste, sur, este, norte] = CAJA;
  const features = [];
  const resumenCapas = [];
  for (const capa of CAPAS) {
    const url = `${SERVICIO}/${capa.id}`;
    const info = await pedir(url, {});
    await esperar(1000);
    const data = await pedir(`${url}/query`, {
      where: capa.where || '1=1',
      geometry: `${oeste},${sur},${este},${norte}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      maxAllowableOffset: '0.00005',
    });
    if (data.exceededTransferLimit) throw new Error(`La capa ${capa.id} (${info.name}) excede el límite de la consulta.`);
    let incluidos = 0;
    for (const f of data.features || []) {
      const a = f.attributes || {};
      const zona = String(a.zona || a.ocurrencia || '').trim().toLowerCase();
      const nivel = capa.nivel || NIVEL_DE[zona];
      if (!nivel) throw new Error(`La capa ${capa.id} (${info.name}) trae un polígono sin nivel reconocible («${zona}»).`);
      const poligonos = aMultiPoligono(f.geometry && f.geometry.rings, capa.tol);
      if (poligonos.length === 0) continue;
      incluidos++;
      features.push({
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: poligonos },
        properties: {
          tipo: capa.tipo,
          nivel,
          etiqueta: a.zona || a.ocurrencia || info.name,
          escenario: capa.tipo === 'ceniza' ? String(a.erupcion_t || '').toLowerCase() : capa.escenario ? 'escenario por volumen' : null,
          detalle: detalleDe(capa, a),
          deposito: capa.tipo === 'ceniza' ? a.deposito || null : null,
          capa: info.name,
          capaId: capa.id,
        },
      });
    }
    resumenCapas.push({ id: capa.id, nombre: info.name, tipo: capa.tipo, recibidos: (data.features || []).length, registros: incluidos });
    console.log(`Capa ${capa.id} ${info.name}: ${(data.features || []).length} recibidos, ${incluidos} guardados`);
    await esperar(1000);
  }
  if (features.length === 0) throw new Error('No quedó ningún polígono: no se guarda un archivo vacío.');

  const porTipo = {};
  for (const f of features) porTipo[f.properties.tipo] = (porTipo[f.properties.tipo] || 0) + 1;
  const salida = {
    type: 'FeatureCollection',
    metadata: {
      fuente: 'Zonas de peligro volcánico (servicio monitoreocenvul/Vulcanologia), Instituto Geofísico del Perú (IGP, CENVUL)',
      servicio: SERVICIO,
      descargado: new Date().toISOString(),
      caja: CAJA,
      registros: features.length,
      porTipo,
      capas: resumenCapas,
      licencia: 'No declarada en el servicio; se atribuye al IGP',
      fechaDelMapa: 'Sin metadatos de fecha: el servicio no dice cuándo se elaboró ni de qué edición del mapa de INGEMMET sale',
      referencia: 'INGEMMET, Boletín Serie C n.° 100 «Geología y nuevos mapas de peligros del volcán Misti» (Cueva y Mariño, 2025; https://hdl.handle.net/20.500.12544/5309), que reemplaza al Boletín n.° 60 (2016) y al mapa de 2007. No se pudo confirmar cuál edición reproducen las capas del IGP.',
      simplificacion: 'Polígonos simplificados a unos 11 m (22 m en los lahares de las capas 29 a 31 y 55 m en ceniza) y sin restos de menos de ~600 m²',
      avisos: [
        'Es un mapa de escala regional: la frontera entre zonas no es exacta a nivel de predio.',
        'Los lahares se muestran con dos modelos del IGP (capas 29 a 31 y escenarios por volumen de las capas 18 a 20); donde difieren, la ficha da el nivel más alto.',
        'Las capas de ceniza no dicen de qué volcán son; cubren varios escenarios eruptivos y toda la ciudad queda dentro de ellos.',
        'Que un punto no esté en una zona no significa que no haya peligro.',
      ],
    },
    features,
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida));
  console.log(`\nGuardado en ${SALIDA}: ${features.length} polígonos (${Object.entries(porTipo).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}

main().catch((err) => {
  console.error(`\nNo se pudo completar la descarga: ${err.message}`);
  console.error('Se conserva el archivo congelado anterior (public/data/peligro_volcanico_misti.geojson), si existe; no se escribió nada.');
  process.exit(1);
});
