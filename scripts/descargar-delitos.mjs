/**
 * descargar-delitos.mjs — Descarga las denuncias de robo y hurto en Arequipa como GeoJSON.
 *
 * Fuente: capa SIDPOL_DELITOS_TOTAL del Mapa del Delito Georreferenciado
 * (Observatorio Nacional de Seguridad Ciudadana, Ministerio del Interior), datos del SIDPOL de la PNP.
 *
 * Uso:   node scripts/descargar-delitos.mjs
 * Sale:  public/data/delitos_aqp.geojson
 *
 * Decisiones (cámbialas en la sección CONFIGURACIÓN si el equipo decide otra cosa):
 *  - Solo provincia de Arequipa.
 *  - Solo ESTADO_COORD = 'INVERTIDA': denuncias con coordenada real, que la fuente corrigió invirtiendo
 *    latitud y longitud y validó contra el distrito. Las marcadas 'CERO_AMBAS' no tenían coordenada y la
 *    fuente las ubicó en el centro de su sector policial, así que no sirven para medir cercanía.
 *    Las 'UBIGEO_NO_COINCIDE' tienen coordenada, pero en un distrito distinto al denunciado.
 *  - Solo robo y hurto: los delitos que mejor reflejan la inseguridad en la calle.
 *  - metadata.cobertura guarda, mes a mes, cuántas denuncias de robo y hurto traen coordenada real frente al total:
 *    la proporción cambió mucho en el tiempo y el indicador debe usar un periodo homogéneo.
 *  - Sin dirección, cuadra ni hora exacta: el indicador no los necesita y se evita publicar
 *    datos que permitan ubicar a personas.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ CONFIGURACIÓN
const CAPA =
  process.env.DELITOS_URL ||
  'https://services6.arcgis.com/lMIZrqiJkpM748BR/arcgis/rest/services/SIDPOL_DELITOS_TOTAL/FeatureServer/1';

const WHERE = [
  "provincia_hecho = 'AREQUIPA'",
  "ESTADO_COORD = 'INVERTIDA'",
  "subtipo_hecho IN ('ROBO', 'HURTO')",
].join(' AND ');

const CAMPOS = ['OBJECTID', 'fecha_hora_hecho', 'turno_hecho', 'distrito_hecho', 'subtipo_hecho', 'modalidad_hecho'];
const PAGINA = 2000; // máximo que entrega el servicio por solicitud
const DECIMALES = 5; // ~1 m de precisión
const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'delitos_aqp.geojson');

// ------------------------------------------------------------------------ SOLICITUDES
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultar(params) {
  const url = `${CAPA}/query?${new URLSearchParams({ f: 'json', ...params })}`;
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`el servicio respondió ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (err) {
      if (intento >= 3) throw new Error(`Falló la consulta tras 3 intentos (${err.message}).\nURL: ${url}`);
      await esperar(2000 * intento);
    }
  }
}

// Cobertura mensual: de todas las denuncias de robo y hurto de la provincia, cuántas traen coordenada real
// (ESTADO_COORD = 'INVERTIDA'). El navegador la usa para elegir un periodo con cobertura homogénea.
async function coberturaMensual(anios) {
  const base = "provincia_hecho = 'AREQUIPA' AND subtipo_hecho IN ('ROBO', 'HURTO')";
  const cobertura = {};
  for (const anio of anios) {
    const data = await consultar({
      where: `${base} AND fecha_hora_hecho >= timestamp '${anio}-01-01 00:00:00' AND fecha_hora_hecho < timestamp '${anio + 1}-01-01 00:00:00'`,
      groupByFieldsForStatistics: 'mes_hecho,ESTADO_COORD',
      outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]),
    });
    for (const { attributes: a } of data.features || []) {
      const mes = `${anio}-${String(a.mes_hecho).padStart(2, '0')}`;
      cobertura[mes] = cobertura[mes] || { total: 0, conUbicacion: 0 };
      cobertura[mes].total += a.n;
      if (a.ESTADO_COORD === 'INVERTIDA') cobertura[mes].conUbicacion += a.n;
    }
    await esperar(300);
  }
  return Object.fromEntries(Object.entries(cobertura).sort(([x], [y]) => x.localeCompare(y)));
}

const redondear = (n) => Math.round(n * 10 ** DECIMALES) / 10 ** DECIMALES;
const fechaISO = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString().slice(0, 10) : null);

// ------------------------------------------------------------------------- PRINCIPAL
async function main() {
  console.log(`Capa: ${CAPA}\nFiltro: ${WHERE}\n`);
  const { count: total } = await consultar({ where: WHERE, returnCountOnly: 'true' });
  if (!Number.isInteger(total)) throw new Error('El servicio no devolvió el número de registros.');
  console.log(`Registros que cumplen el filtro: ${total}`);

  const vistos = new Set();
  const features = [];
  for (let offset = 0; offset < total; offset += PAGINA) {
    const pagina = await consultar({
      where: WHERE,
      outFields: CAMPOS.join(','),
      returnGeometry: 'true',
      outSR: '4326',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(PAGINA),
      f: 'geojson',
    });
    for (const f of pagina.features || []) {
      const p = f.properties || {};
      const id = p.OBJECTID ?? f.id;
      if (vistos.has(id) || !f.geometry || f.geometry.type !== 'Point') continue;
      vistos.add(id);
      const [lon, lat] = f.geometry.coordinates;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [redondear(lon), redondear(lat)] },
        properties: {
          id,
          fecha: fechaISO(p.fecha_hora_hecho),
          turno: p.turno_hecho ?? null,
          distrito: p.distrito_hecho ?? null,
          subtipo: p.subtipo_hecho ?? null,
          modalidad: p.modalidad_hecho ?? null,
        },
      });
    }
    process.stdout.write(`\rDescargados: ${features.length} de ${total}`);
    await esperar(300); // no saturar el servicio público
  }
  console.log('');

  if (features.length < total) {
    console.warn(`Aviso: se esperaban ${total} y llegaron ${features.length}. Vuelve a correr el script más tarde.`);
  }

  const fechas = features.map((f) => f.properties.fecha).filter(Boolean).sort();
  const anios = [...new Set(fechas.map((f) => Number(f.slice(0, 4))))];
  const cobertura = await coberturaMensual(anios);
  const salida = {
    type: 'FeatureCollection',
    metadata: {
      fuente: 'Mapa del Delito Georreferenciado (MININTER), datos del SIDPOL de la PNP',
      capa: CAPA,
      filtro: WHERE,
      descargado: new Date().toISOString(),
      registros: features.length,
      desde: fechas[0] || null,
      hasta: fechas[fechas.length - 1] || null,
      cobertura,
    },
    features,
  };
  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(SALIDA, JSON.stringify(salida));

  const porSubtipo = {};
  const porAnio = {};
  features.forEach(({ properties: p }) => {
    porSubtipo[p.subtipo] = (porSubtipo[p.subtipo] || 0) + 1;
    const anio = p.fecha ? p.fecha.slice(0, 4) : 'sin fecha';
    porAnio[anio] = (porAnio[anio] || 0) + 1;
  });
  console.log(`\nGuardado en ${SALIDA}`);
  console.log(`Periodo: ${salida.metadata.desde} a ${salida.metadata.hasta}`);
  console.log('Por tipo:', porSubtipo);
  console.log('Por año:', porAnio);
  console.log('Cobertura mensual (con ubicación / total):');
  Object.entries(cobertura).forEach(([mes, c]) => console.log(`  ${mes}: ${c.conUbicacion} / ${c.total} (${Math.round((100 * c.conUbicacion) / c.total)} %)`));
}

main().catch((err) => {
  console.error(`\nNo se pudo completar la descarga: ${err.message}`);
  process.exit(1);
});
