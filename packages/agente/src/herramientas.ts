/**
 * herramientas.ts — Las herramientas del agente (tarea 6.1): funciones tipadas, con esquema de entrada y de salida, que consultan la base y el
 * núcleo de dominio. El modelo de lenguaje no calcula nada: todo número de una respuesta sale de la salida de una de estas funciones.
 *
 *   geocodificar_lugar · buscar_avisos · entorno_de_aviso · tiempo_de_viaje · buscar_zonas · explicar_fuente
 */
import { z } from 'zod';
import Asistente from '@geoverificador/dominio/nucleo/asistente';
import Calculos from '@geoverificador/dominio/nucleo/calculos';
import CONFIG from '@geoverificador/dominio/nucleo/config';
import Viaje from '@geoverificador/dominio/nucleo/viaje';
import { topeEnSoles } from '@geoverificador/dominio/avisos';
import { avisoPorId, buscarAvisos, tipoCambioVigente, type AvisoHallado, type FiltrosAvisos } from '@geoverificador/datos/avisos';
import type { Base } from '@geoverificador/datos/cliente';
import { fuente as leerFuente, fuentes as leerFuentes } from '@geoverificador/datos/consultas';
import { geocodificarLocal, geocodificarNominatim, PRECISION_UTIL_M, type OpcionesNominatim } from '@geoverificador/datos/geocodificar';
import { CRITERIOS, LIMITES, cumplidos, evaluar, ordenar, sinDato, type CriterioEvaluado, type IdCriterio, type ViajeMedido } from './criterios.ts';

export interface Contexto {
  base: Base;
  /** Día de hoy (AAAA-MM-DD): fija el tipo de cambio que se usa. */
  hoy: string;
  /** Qué avisos se pueden mostrar (ADR 0002): 'ninguna' | 'permitidas' | 'todas'. */
  publicar: FiltrosAvisos['publicar'];
  /** Geocodificador externo, opcional. Sin él solo se usan los datos locales. */
  nominatim?: OpcionesNominatim | null;
}

const punto = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const idCriterio = z.enum(Object.keys(CRITERIOS) as [IdCriterio, ...IdCriterio[]]);
const criterioPedido = z.object({
  id: idCriterio,
  metros: z.number().positive().max(50_000).optional().describe('Distancia máxima en metros (o mínima en lejos_de_cauce). Omitir para usar la de referencia.'),
  minPct: z.number().min(0).max(100).optional().describe('Porcentaje mínimo de la manzana (agua, luz, desague).'),
  maxMin: z.number().positive().max(240).optional().describe('Minutos máximos de viaje (trabajo).'),
});
const criterioEvaluado = z.object({
  id: idCriterio, etiqueta: z.string(), cumple: z.boolean().nullable(), valor: z.string(), pedido: z.string(), referencia: z.string().nullable(), fuente: z.string().nullable(), fecha: z.string().nullable(), nota: z.string(), convencion: z.boolean(),
});

export const ESQUEMAS = {
  geocodificar_lugar: {
    descripcion: 'Convierte el nombre de un lugar de Arequipa o una dirección en un punto. Úsala antes de medir «cerca de» o un viaje. Si devuelve varios candidatos distintos o ninguno, pregunta a la persona.',
    entrada: z.object({ texto: z.string().min(2).max(200).describe('Nombre o dirección tal como lo dijo la persona, p. ej. «Parque Industrial» o «UNSA».') }),
    salida: z.object({
      candidatos: z.array(z.object({ nombre: z.string(), lat: z.number(), lon: z.number(), precisionM: z.number(), origen: z.string(), categoria: z.string().nullable(), distrito: z.string().nullable(), sirveParaMedir: z.boolean() })),
      nota: z.string().nullable(),
    }),
  },
  buscar_avisos: {
    descripcion: 'Busca avisos vigentes de venta que cumplan el tipo, el precio y el distrito, mide cada criterio pedido en cada aviso y los devuelve ordenados por cuántos criterios cumplen. No inventa avisos: si no hay, devuelve una lista vacía con el motivo.',
    entrada: z.object({
      tipo: z.enum(['departamento', 'casa', 'terreno', 'local', 'oficina']).nullable().optional(),
      precioMax: z.number().positive().nullable().optional(),
      moneda: z.enum(['PEN', 'USD']).nullable().optional().describe('Moneda del precio máximo. Obligatoria si hay precioMax.'),
      distrito: z.string().max(60).nullable().optional(),
      dormitoriosMin: z.number().int().min(0).max(20).nullable().optional(),
      areaMinM2: z.number().positive().nullable().optional(),
      criterios: z.array(criterioPedido).max(12).default([]),
      trabajo: punto.extend({ nombre: z.string().max(120) }).nullable().optional().describe('Punto del trabajo o destino del viaje (de geocodificar_lugar). Necesario para el criterio «trabajo».'),
      sinTrasbordo: z.boolean().optional().describe('Solo cuentan rutas directas al trabajo.'),
      lugar: punto.extend({ nombre: z.string().max(120) }).nullable().optional().describe('Otro lugar del que se quiere estar cerca. Necesario para el criterio «lugar».'),
      limite: z.number().int().min(1).max(20).default(8),
    }),
    salida: z.object({
      avisos: z.array(
        z.object({
          id: z.number(), titulo: z.string().nullable(), url: z.string(), fuente: z.string(), tipo: z.string().nullable(), tipoInferido: z.boolean(), esProyecto: z.boolean(),
          precio: z.number().nullable(), moneda: z.string().nullable(), precioPen: z.number().nullable(), tipoCambio: z.number().nullable(), tipoCambioFecha: z.string().nullable(),
          areaM2: z.number().nullable(), dormitorios: z.number().nullable(), distrito: z.string().nullable(), zona: z.string().nullable(), lat: z.number().nullable(), lon: z.number().nullable(),
          vistoPorUltimaVez: z.string(), tambienEn: z.array(z.string()), criterios: z.array(criterioEvaluado), cumplidos: z.number(), sinDato: z.number(), pedidos: z.number(),
        }),
      ),
      totalHallados: z.number().describe('Avisos que cumplen tipo, precio y distrito, antes de ordenar y recortar.'),
      precioMaxPen: z.number().nullable(),
      tipoCambio: z.object({ fecha: z.string(), venta: z.number(), fuente: z.string() }).nullable(),
      motivoVacio: z.string().nullable(),
      notas: z.array(z.string()),
      limites: z.array(z.string()),
    }),
  },
  entorno_de_aviso: {
    descripcion: 'Devuelve la ficha de entorno de un aviso: distancia a colegio, universidad, mall, salud, paradero y mercado; servicios de la manzana; zonificación y peligros. Cada valor con su fuente y su fecha.',
    entrada: z.object({ id: z.number().int().positive() }),
    salida: z.object({
      aviso: z.object({ id: z.number(), titulo: z.string().nullable(), url: z.string(), fuente: z.string(), distrito: z.string().nullable(), vistoPorUltimaVez: z.string() }).nullable(),
      criterios: z.record(z.string(), z.object({ valor: z.union([z.number(), z.string(), z.boolean()]).nullable(), unidad: z.string(), referencia: z.string().nullable(), fuente: z.string().nullable(), fecha: z.string().nullable(), nota: z.string().nullable() })).nullable(),
      motivoVacio: z.string().nullable(),
    }),
  },
  tiempo_de_viaje: {
    descripcion: 'Dice qué combi o bus lleva de un punto a otro (directo o con un trasbordo) y el tiempo aproximado sin contar la espera. Si no hay ruta en los datos, lo dice.',
    entrada: z.object({ origen: punto, destino: punto, sinTrasbordo: z.boolean().optional() }),
    salida: z.object({
      distanciaM: z.number(),
      hayRuta: z.boolean(),
      mejor: z.object({ minutos: z.number().nullable(), trasbordos: z.number(), lineas: z.array(z.string()), caminarM: z.number(), esperaMediaMin: z.number().nullable() }).nullable(),
      directas: z.number(),
      conTrasbordo: z.number(),
      nota: z.string(),
    }),
  },
  buscar_zonas: {
    descripcion: 'Busca sectores de la ciudad (no avisos) donde se cumplen a la vez los criterios de entorno: salud, inicial, primaria, secundaria, colegio, transporte, areaVerde, lejosQuebrada. Úsala cuando la persona pregunta dónde vivir, no por un inmueble.',
    entrada: z.object({ criterios: z.array(z.enum(['salud', 'inicial', 'primaria', 'secundaria', 'colegio', 'transporte', 'areaVerde', 'lejosQuebrada'])).min(1).max(6), distrito: z.string().max(60).nullable().optional() }),
    salida: z.object({
      sectores: z.array(z.object({ nombre: z.string().nullable(), distrito: z.string().nullable(), hectareas: z.number(), lat: z.number(), lon: z.number() })),
      texto: z.string(),
      fecha: z.string().nullable(),
    }),
  },
  explicar_fuente: {
    descripcion: 'Dice de qué fuente sale un dato, con su licencia, su fecha y su límite. Úsala cuando preguntan «¿de dónde sale?» o «¿de qué fecha es?».',
    entrada: z.object({ tema: z.string().min(2).max(60).describe('Un criterio (colegio, universidad, mall, salud, paradero, mercado, agua, luz, zona_comercio, trabajo…) o «avisos».') }),
    salida: z.object({ fuentes: z.array(z.object({ id: z.string(), nombre: z.string(), licencia: z.string().nullable(), licenciaVerificada: z.boolean(), fecha: z.string().nullable(), url: z.string().nullable(), limite: z.string().nullable() })) }),
  },
} as const;

export type NombreHerramienta = keyof typeof ESQUEMAS;
export type Entrada<N extends NombreHerramienta> = z.input<(typeof ESQUEMAS)[N]['entrada']>;
export type Salida<N extends NombreHerramienta> = z.infer<(typeof ESQUEMAS)[N]['salida']>;

export class ErrorDeHerramienta extends Error {}

// ------------------------------------------------------------------ Viaje

let rutasEnMemoria: Promise<{ rutas: any[]; fecha: string | null }> | null = null;
/** Las rutas de bus de la base, listas para el núcleo (Viaje.desdeOsm). Se leen una vez por proceso. */
function rutas(base: Base): Promise<{ rutas: any[]; fecha: string | null }> {
  rutasEnMemoria ??= (async () => {
    const filas = await base.consulta(`SELECT props, ST_AsGeoJSON(geom, 15)::jsonb AS geometry FROM ruta ORDER BY orden`);
    const meta = (await base.consulta(`SELECT metadatos FROM archivo_dato WHERE ruta = 'rutas_osm.geojson'`))[0]?.metadatos ?? {};
    return { rutas: Viaje.desdeOsm({ type: 'FeatureCollection', features: filas.map((f) => ({ type: 'Feature', properties: f.props, geometry: f.geometry })) }), fecha: meta.fecha_extraccion ?? null };
  })().catch((e) => {
    rutasEnMemoria = null;
    throw e;
  });
  return rutasEnMemoria;
}

/** Para las pruebas: olvida lo leído de la base. */
export function olvidarMemoria(): void {
  rutasEnMemoria = null;
  zonasEnMemoria = null;
}

async function medirViaje(base: Base, origen: { lat: number; lon: number }, destino: { lat: number; lon: number }, sinTrasbordo = false): Promise<Salida<'tiempo_de_viaje'>> {
  const { rutas: lista } = await rutas(base);
  const tiempo = CONFIG.viaje.tiempo;
  const distanciaM = Calculos.haversine(origen.lat, origen.lon, destino.lat, destino.lon);
  const d = Viaje.rutasDirectas(origen, destino, lista, { caminarM: CONFIG.viaje.caminarM });
  const directas = Viaje.unir(d.directas);
  const opciones: Salida<'tiempo_de_viaje'>['mejor'][] = directas.map((x: any) => {
    const t = Viaje.estimarTiempo(x, tiempo);
    return { minutos: t.totalSinEsperaMin, trasbordos: 0, lineas: [Viaje.codigoLinea(x.ruta) ?? x.ruta?.linea ?? 'sin código'].filter(Boolean), caminarM: Math.round(x.caminarTotalM), esperaMediaMin: t.esperaMediaMin };
  });
  let conTrasbordo = 0;
  if (!sinTrasbordo && directas.length === 0) {
    const t = Viaje.rutasConTrasbordo(origen, destino, lista, { caminarM: CONFIG.viaje.caminarM, trasbordoM: CONFIG.viaje.trasbordoM, max: 1 });
    conTrasbordo = t.trasbordos.length;
    for (const x of t.trasbordos.slice(0, 5) as any[]) {
      const e = Viaje.estimarTiempoTrasbordo(x, tiempo);
      opciones.push({ minutos: e.totalSinEsperaMin, trasbordos: 1, lineas: [x.rutaA, x.rutaB].map((r: any) => Viaje.codigoLinea(r) ?? r?.linea ?? 'sin código'), caminarM: Math.round(x.caminarTotalM), esperaMediaMin: e.esperaMediaMin });
    }
  }
  const conTiempo = opciones.filter((o) => o && o.minutos !== null).sort((a, b) => a!.minutos! - b!.minutos!);
  const mejor = conTiempo[0] ?? opciones[0] ?? null;
  return {
    distanciaM: Math.round(distanciaM),
    hayRuta: opciones.length > 0,
    mejor: mejor ? { ...mejor, minutos: mejor.minutos === null ? null : Math.round(mejor.minutos) } : null,
    directas: directas.length,
    conTrasbordo,
    nota: 'Tiempo aproximado: caminata en línea recta a 1,07 m/s más la duración que OpenStreetMap etiqueta para la ruta, prorrateada por la distancia. No incluye la espera. Las rutas cubren el 72 % de la ciudad.',
  };
}

// ------------------------------------------------------------------ Zonas

let zonasEnMemoria: Promise<any> | null = null;
function datosDeZonas(base: Base): Promise<any> {
  zonasEnMemoria ??= (async () => {
    const leer = async (ruta: string, tabla: 'lugar' | 'zona' | 'peligro') => {
      const geo = tabla === 'lugar' ? 'COALESCE(forma, punto)' : 'geom';
      const filas = await base.consulta(`SELECT props, ST_AsGeoJSON(${geo}, 15)::jsonb AS geometry FROM ${tabla} WHERE archivo = $1 ORDER BY orden`, [ruta]);
      return filas.map((f) => ({ type: 'Feature', properties: f.props, geometry: f.geometry }));
    };
    const [zonasFc, reglas, salud, educacion, transporte, areasVerdes, cauces, distritos, meta] = await Promise.all([
      leer('zonas_aqp.geojson', 'zona'),
      base.consulta(`SELECT contenido FROM documento WHERE archivo = 'reglas_zonas.json'`),
      leer('equipamiento/salud.geojson', 'lugar'),
      leer('equipamiento/educacion.geojson', 'lugar'),
      leer('equipamiento/transporte.geojson', 'lugar'),
      leer('equipamiento/areas_verdes.geojson', 'lugar'),
      leer('quebradas_aqp.geojson', 'peligro'),
      base.consulta(`SELECT nombre, ST_AsGeoJSON(geom, 15)::jsonb AS geometry FROM distrito ORDER BY orden`),
      base.consulta(`SELECT metadatos FROM archivo_dato WHERE ruta = 'equipamiento/salud.geojson'`),
    ]);
    const poligonos = (g: any) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
    const caja = (polys: any[]) => {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const anillos of polys) for (const [x, y] of anillos[0] ?? []) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
      return b;
    };
    const tabla = reglas[0]?.contenido ?? {};
    const zonas = zonasFc.map((f: any) => { const polys = poligonos(f.geometry); return { feature: f, codigo: f.properties.codigo, color: f.properties.color, bbox: caja(polys), polys, regla: tabla[f.properties.codigo] ?? null }; });
    const umbrales = { ...CONFIG.umbrales, ...CONFIG.asistente.umbralesZona };
    const listaCauces = cauces.filter((f: any) => /LineString/.test(f.geometry.type)).map((f: any) => ({ nombre: f.properties.nombre, tipo: f.properties.tipo, geometry: f.geometry }));
    const datos = Asistente.prepararDatos({ salud, consultorios: [], mercados: [], supermercados: [], malls: [], finanzas: [], comida_fuera: [], recreacion: [], educacion, transporte, areasVerdes, cauces: listaCauces }, zonas, umbrales);
    const dist = distritos.map((d) => ({ nombre: d.nombre, polys: poligonos(d.geometry) }));
    const distritoDe = (lat: number, lon: number) => dist.find((d) => d.polys.some((a: any) => Calculos.puntoEnPoligono(lat, lon, a)))?.nombre ?? null;
    return { zonas, datos, umbrales, distritoDe, fecha: meta[0]?.metadatos?.fecha_extraccion ?? null };
  })().catch((e) => {
    zonasEnMemoria = null;
    throw e;
  });
  return zonasEnMemoria;
}

// ------------------------------------------------------------------ Implementación

const TEMAS: Record<string, string[]> = {
  colegio: ['escale'], universidad: ['sunedu_osm'], mall: ['osm'], mercado: ['osm'], paradero: ['osm'], salud: ['renipress'], agua: ['inei_censo_2017'], luz: ['inei_censo_2017', 'minem_dge'], desague: ['inei_censo_2017'],
  concesion_electrica: ['minem_dge'], lejos_de_cauce: ['cauces'], sin_peligro_volcanico_alto: ['igp_volcan'], zona_comercio: ['pdm_2016_2025'], trabajo: ['osm'], lugar: ['osm'], avisos: ['nexo', 'urbania', 'adondevivir'], precio: ['aptologia'],
};

const tarjeta = (a: AvisoHallado, criterios: CriterioEvaluado[]) => ({
  id: a.id, titulo: a.titulo, url: a.url, fuente: a.fuenteNombre, tipo: a.tipo, tipoInferido: a.tipoInferido, esProyecto: a.esProyecto, precio: a.precio, moneda: a.moneda, precioPen: a.precioPen, tipoCambio: a.tipoCambio,
  tipoCambioFecha: a.tipoCambioFecha, areaM2: a.areaM2, dormitorios: a.dormitorios, distrito: a.distrito, zona: a.zona, lat: a.lat, lon: a.lon, vistoPorUltimaVez: a.ultimaVezVisto.slice(0, 10), tambienEn: a.tambienEn,
  criterios, cumplidos: criterios.filter((c) => c.cumple === true).length, sinDato: criterios.filter((c) => c.cumple === null).length, pedidos: criterios.length,
});

const IMPLEMENTACION: { [N in NombreHerramienta]: (entrada: z.infer<(typeof ESQUEMAS)[N]['entrada']>, ctx: Contexto) => Promise<Salida<N>> } = {
  async geocodificar_lugar({ texto }, ctx) {
    const locales = await geocodificarLocal(ctx.base, texto);
    let candidatos = locales;
    if (!candidatos.some((c) => c.precisionM <= PRECISION_UTIL_M) && ctx.nominatim) {
      const externo = await geocodificarNominatim(texto, ctx.nominatim).catch(() => null);
      if (externo) candidatos = [externo, ...locales];
    }
    return {
      candidatos: candidatos.map((c) => ({ nombre: c.nombre, lat: c.lat, lon: c.lon, precisionM: c.precisionM, origen: c.origen, categoria: c.categoria, distrito: c.distrito, sirveParaMedir: c.precisionM <= PRECISION_UTIL_M })),
      nota: candidatos.length === 0 ? 'No encontré ese lugar en los datos. Pide a la persona un lugar conocido cercano o una dirección.' : candidatos.every((c) => c.precisionM > PRECISION_UTIL_M) ? 'Solo encontré un distrito: es demasiado amplio para medir cercanía. Pide un lugar más preciso.' : null,
    };
  },

  async buscar_avisos(e, ctx) {
    const notas: string[] = [];
    const tc = await tipoCambioVigente(ctx.base, ctx.hoy);
    let precioMaxPen: number | null = null;
    if (e.precioMax != null) {
      if (!e.moneda) throw new ErrorDeHerramienta('Falta la moneda del precio máximo: pregunta si es en soles o en dólares.');
      precioMaxPen = topeEnSoles(e.precioMax, e.moneda, ctx.hoy, tc);
      if (precioMaxPen === null) throw new ErrorDeHerramienta('No hay un tipo de cambio reciente para convertir el precio en dólares a soles.');
      if (e.moneda === 'USD' && tc) notas.push(`El tope en dólares se llevó a soles con el tipo de cambio de venta del ${tc.fecha} (${tc.venta}).`);
    }
    if (e.criterios.some((c) => c.id === 'trabajo') && !e.trabajo) throw new ErrorDeHerramienta('El criterio «trabajo» necesita el punto del trabajo: usa geocodificar_lugar o pregunta dónde queda.');
    if (e.criterios.some((c) => c.id === 'lugar') && !e.lugar) throw new ErrorDeHerramienta('El criterio «lugar» necesita el punto del lugar: usa geocodificar_lugar.');

    const hallados = await buscarAvisos(ctx.base, { tipo: e.tipo ?? null, precioMaxPen, distrito: e.distrito ?? null, dormitoriosMin: e.dormitoriosMin ?? null, areaMinM2: e.areaMinM2 ?? null, limite: 200, publicar: ctx.publicar });
    const evaluados = [];
    for (const a of hallados.avisos) {
      const conPunto = a.lat !== null && a.lon !== null;
      let viaje: ViajeMedido | null = null;
      if (e.trabajo && conPunto && e.criterios.some((c) => c.id === 'trabajo')) {
        const v = await medirViaje(ctx.base, { lat: a.lat!, lon: a.lon! }, e.trabajo, e.sinTrasbordo ?? false);
        viaje = { minutos: v.mejor?.minutos ?? null, trasbordos: v.mejor?.trasbordos ?? null, linea: v.mejor?.lineas.join(' y ') ?? null, distanciaM: v.distanciaM, hayRuta: v.hayRuta };
      }
      const lugar = e.lugar ? { nombre: e.lugar.nombre, distanciaM: conPunto ? Calculos.haversine(a.lat!, a.lon!, e.lugar.lat, e.lugar.lon) : null } : null;
      const criterios = e.criterios.map((c) => evaluar(c, a.criterios, { viaje, lugar }));
      evaluados.push({ a, criterios, ultimaVezVisto: a.ultimaVezVisto });
    }
    const orden = ordenar(evaluados);
    for (const c of e.criterios) {
      const def = CRITERIOS[c.id];
      if (def.convencion && c.metros === undefined && c.minPct === undefined && c.maxMin === undefined) {
        notas.push(`«${def.etiqueta}»: usé ${def.clase === 'servicio' ? `${def.omision} % o más de la manzana` : def.clase === 'viaje' ? `${def.omision} minutos` : `${def.omision} m`} como referencia; es una convención del agente, puedes pedir otra.`);
      }
    }
    if (hallados.avisos.some((a) => a.lat === null)) notas.push('Algunos avisos no traen coordenadas: sus criterios de cercanía figuran como «sin dato».');
    if (e.sinTrasbordo) notas.push('Solo conté rutas directas, sin trasbordo.');
    return {
      avisos: orden.slice(0, e.limite).map((x) => tarjeta(x.a, x.criterios)),
      totalHallados: hallados.total,
      precioMaxPen,
      tipoCambio: e.moneda === 'USD' ? tc : null,
      motivoVacio: hallados.motivoVacio,
      notas,
      limites: LIMITES,
    };
  },

  async entorno_de_aviso({ id }, ctx) {
    const a = await avisoPorId(ctx.base, id, ctx.publicar);
    if (!a) return { aviso: null, criterios: null, motivoVacio: ctx.publicar === 'ninguna' ? 'La publicación de avisos no está activada.' : 'No hay un aviso con ese número.' };
    return { aviso: { id: a.id, titulo: a.titulo, url: a.url, fuente: a.fuenteNombre, distrito: a.distrito, vistoPorUltimaVez: a.ultimaVezVisto.slice(0, 10) }, criterios: a.criterios, motivoVacio: a.criterios ? null : 'El aviso no tiene coordenadas: no se pudo medir su entorno.' };
  },

  async tiempo_de_viaje({ origen, destino, sinTrasbordo }, ctx) {
    return medirViaje(ctx.base, origen, destino, sinTrasbordo ?? false);
  },

  async buscar_zonas({ criterios, distrito }, ctx) {
    const d = await datosDeZonas(ctx.base);
    const lista = criterios.map((id) => ({ id, umbralM: null, prioridad: 1 }));
    const celdas = Asistente.generarCeldas(d.zonas, { pasoM: CONFIG.asistente.pasoCeldaM, incluirCondicional: false });
    const resultado = Asistente.buscar({
      criterios: lista, zonas: d.zonas, datos: d.datos, umbrales: d.umbrales, distritoDe: d.distritoDe, distrito: distrito ?? null, pasoM: CONFIG.asistente.pasoCeldaM, minCeldas: CONFIG.asistente.minCeldasArea,
      maxPuntos: CONFIG.asistente.maxPuntos, separacionM: CONFIG.asistente.separacionPuntosM, centro: null, radioM: null, incluirCondicional: false, radioGlobalM: null, celdas,
    });
    const f = Asistente.formatearBusqueda(resultado, { aproximados: lista.map((c) => c.id).filter((id) => (Asistente.CRITERIOS as any)[id]?.aproximado), radioGlobalM: null, datos: d.datos, distrito: distrito ?? null });
    return {
      sectores: (f.filas ?? []).map((s: any) => ({ nombre: s.nombre ?? s.titulo ?? null, distrito: s.distrito ?? null, hectareas: Math.round(s.hectareas ?? 0), lat: s.centro?.lat ?? s.lat, lon: s.centro?.lon ?? s.lon })).filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lon)),
      texto: f.texto,
      fecha: d.fecha,
    };
  },

  async explicar_fuente({ tema }, ctx) {
    const clave = tema.trim().toLowerCase();
    const ids = TEMAS[clave] ?? ((await leerFuente(ctx.base, clave)) ? [clave] : []);
    const todas = ids.length ? (await Promise.all(ids.map((id) => leerFuente(ctx.base, id)))).filter(Boolean) : (await leerFuentes(ctx.base)).filter((f) => f.nombre.toLowerCase().includes(clave));
    return { fuentes: todas.map((f: any) => ({ id: f.id, nombre: f.nombre, licencia: f.licencia, licenciaVerificada: f.licencia_verificada, fecha: f.fecha, url: f.url, limite: f.limite })) };
  },
};

/** Ejecuta una herramienta validando su entrada y su salida. Lanza ErrorDeHerramienta con un mensaje que el modelo puede leer y corregir. */
export async function ejecutar<N extends NombreHerramienta>(nombre: N, entrada: unknown, ctx: Contexto): Promise<Salida<N>> {
  const def = ESQUEMAS[nombre];
  if (!def) throw new ErrorDeHerramienta(`No existe la herramienta «${String(nombre)}».`);
  const leida = def.entrada.safeParse(entrada);
  if (!leida.success) throw new ErrorDeHerramienta(`Entrada no válida para ${nombre}: ${leida.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
  const salida = await (IMPLEMENTACION[nombre] as any)(leida.data, ctx);
  return def.salida.parse(salida) as Salida<N>;
}

/** Declaraciones de las herramientas para un modelo: nombre, descripción y esquema JSON de la entrada. */
export function declaraciones(): { nombre: NombreHerramienta; descripcion: string; parametros: Record<string, unknown> }[] {
  return (Object.keys(ESQUEMAS) as NombreHerramienta[]).map((nombre) => ({ nombre, descripcion: ESQUEMAS[nombre].descripcion, parametros: z.toJSONSchema(ESQUEMAS[nombre].entrada, { io: 'input' }) as Record<string, unknown> }));
}

export { cumplidos, sinDato };
