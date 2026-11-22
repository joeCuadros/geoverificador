/**
 * criterios.ts — Los criterios que una persona puede pedir, cómo se mide cada uno y cómo se ordenan los resultados (tareas 6.4 y 6.7).
 *
 * Orden transparente (ADR 0001): más criterios cumplidos primero; a igualdad, menos «sin dato»; a igualdad, el aviso visto más recientemente.
 * No hay pesos ni puntaje. Un criterio sin dato no cuenta como cumplido y se muestra como «sin dato».
 *
 * Los umbrales de salud, colegio y paradero son los de la ficha (CONFIG.umbrales). Para universidad, mall, mercado, trabajo y servicios el proyecto
 * no tiene una norma que citar: son CONVENCIONES del agente, se dicen en la respuesta y la persona puede cambiarlas («a menos de 800 m»).
 */
import CONFIG from '@geoverificador/dominio/nucleo/config';
import type { Criterio } from '@geoverificador/datos/avisos';

export type IdCriterio =
  | 'colegio' | 'universidad' | 'mall' | 'salud' | 'paradero' | 'mercado'
  | 'agua' | 'luz' | 'desague' | 'concesion_electrica'
  | 'lejos_de_cauce' | 'sin_peligro_volcanico_alto' | 'zona_comercio' | 'trabajo' | 'lugar';

export interface CriterioPedido {
  id: IdCriterio;
  /** Distancia máxima en metros (criterios de cercanía) o mínima (lejos_de_cauce). */
  metros?: number;
  /** Porcentaje mínimo de la manzana (agua, luz, desagüe). */
  minPct?: number;
  /** Minutos máximos de viaje (trabajo). */
  maxMin?: number;
}

interface DefCriterio {
  etiqueta: string;
  clase: 'cerca' | 'servicio' | 'condicion' | 'viaje';
  /** Umbral por omisión y si es una convención del agente (true) o el umbral de la ficha (false). */
  omision: number;
  convencion: boolean;
  /** El límite del dato, en una frase que el agente puede citar (fase 4). */
  limite: string;
}

export const CRITERIOS: Record<IdCriterio, DefCriterio> = {
  colegio: { etiqueta: 'Colegio', clase: 'cerca', omision: CONFIG.umbrales.educacion.primaria, convencion: false, limite: 'Distancia en línea recta al colegio más cercano; no dice si hay vacantes.' },
  salud: { etiqueta: 'Salud', clase: 'cerca', omision: CONFIG.umbrales.salud, convencion: false, limite: 'Distancia en línea recta al establecimiento de salud más cercano.' },
  paradero: { etiqueta: 'Paradero', clase: 'cerca', omision: CONFIG.umbrales.transporte, convencion: false, limite: 'Distancia en línea recta al paradero mapeado más cercano; los paraderos de OpenStreetMap son parciales.' },
  universidad: { etiqueta: 'Universidad', clase: 'cerca', omision: 1500, convencion: true, limite: 'Las sedes de universidad salen de OpenStreetMap: puede faltar alguna.' },
  mall: { etiqueta: 'Centro comercial', clase: 'cerca', omision: 1500, convencion: true, limite: 'Solo hay 4 centros comerciales en los datos; las otras 47 son galerías y no cuentan como mall.' },
  mercado: { etiqueta: 'Mercado o supermercado', clase: 'cerca', omision: 800, convencion: true, limite: 'Mercados y supermercados de OpenStreetMap.' },
  lugar: { etiqueta: 'Lugar pedido', clase: 'cerca', omision: 1500, convencion: true, limite: 'Distancia en línea recta al lugar que nombraste.' },
  agua: { etiqueta: 'Agua por red pública', clase: 'servicio', omision: 80, convencion: true, limite: 'Cobertura de la manzana en el censo de 2017: no garantiza el servicio en el predio ni hoy.' },
  luz: { etiqueta: 'Luz eléctrica', clase: 'servicio', omision: 80, convencion: true, limite: 'Cobertura de la manzana en el censo de 2017: no garantiza el servicio en el predio ni hoy.' },
  desague: { etiqueta: 'Desagüe por red pública', clase: 'servicio', omision: 80, convencion: true, limite: 'Cobertura de la manzana en el censo de 2017: no garantiza el servicio en el predio ni hoy.' },
  concesion_electrica: { etiqueta: 'Dentro de concesión eléctrica', clase: 'condicion', omision: 0, convencion: false, limite: 'Estar dentro de un área de concesión no es tener una conexión.' },
  lejos_de_cauce: { etiqueta: 'Lejos de quebradas y ríos', clase: 'condicion', omision: 100, convencion: true, limite: 'Distancia a la línea del cauce en el mapa, no a su faja marginal; solo se miran cauces a 500 m o menos.' },
  sin_peligro_volcanico_alto: { etiqueta: 'Fuera de peligro volcánico alto', clase: 'condicion', omision: 0, convencion: false, limite: 'Mapa de peligro volcánico del IGP, sin fecha de elaboración.' },
  zona_comercio: { etiqueta: 'Zonificación que permite comercio', clase: 'condicion', omision: 0, convencion: false, limite: 'Plano del PDM 2016-2025, de vigencia cumplida: confirme con un Certificado de Zonificación y Vías.' },
  trabajo: { etiqueta: 'Llegar al trabajo', clase: 'viaje', omision: 30, convencion: true, limite: 'Tiempo aproximado en combi o bus con las rutas de OpenStreetMap, sin contar la espera; cubre el 72 % de la ciudad.' },
};

/** Códigos del plano que son zonas de comercio (las claves de reglas_zonas.json que empiezan con «C»). */
export const ZONAS_DE_COMERCIO = ['CE', 'CS', 'CZ', 'CIn', 'CM', 'CV', 'CM-1', 'CM-2'];

export interface ViajeMedido {
  /** Minutos sin contar la espera, o null si las rutas no traen duración. */
  minutos: number | null;
  trasbordos: number | null;
  linea: string | null;
  /** Distancia en línea recta al destino. */
  distanciaM: number;
  hayRuta: boolean;
}

export interface CriterioEvaluado {
  id: IdCriterio;
  etiqueta: string;
  /** true cumple · false no cumple · null sin dato */
  cumple: boolean | null;
  /** El valor medido, listo para mostrar: «650 m», «92 %», «RDM-1», «25 min con C10». */
  valor: string;
  /** Lo que se pidió: «a 1,5 km o menos». */
  pedido: string;
  referencia: string | null;
  fuente: string | null;
  fecha: string | null;
  nota: string;
  convencion: boolean;
}

const dist = (m: number): string => (m < 1000 ? `${Math.round(m)} m` : `${(Math.round(m / 100) / 10).toFixed(1).replace('.', ',')} km`);
/** Distancia a pie en línea recta a partir de la cual «cerca del trabajo» se cumple sin mirar el transporte. */
export const TRABAJO_A_PIE_M = 1500;

/** Evalúa un criterio pedido contra los criterios medidos de un aviso (aviso_entorno) y, si aplica, el viaje y el lugar pedido. */
export function evaluar(pedido: CriterioPedido, medidos: Record<string, Criterio> | null, extra: { viaje?: ViajeMedido | null; lugar?: { nombre: string; distanciaM: number | null } | null } = {}): CriterioEvaluado {
  const def = CRITERIOS[pedido.id];
  const base = { id: pedido.id, etiqueta: def.etiqueta, nota: def.limite, convencion: def.convencion && pedido.metros === undefined && pedido.minPct === undefined && pedido.maxMin === undefined };
  const sinDato = (pedidoTxt: string, motivo: string): CriterioEvaluado => ({ ...base, cumple: null, valor: `sin dato (${motivo})`, pedido: pedidoTxt, referencia: null, fuente: null, fecha: null });
  const m = medidos?.[pedido.id === 'lejos_de_cauce' ? 'cauce' : pedido.id === 'sin_peligro_volcanico_alto' ? 'peligro_volcanico' : pedido.id === 'zona_comercio' ? 'zona' : pedido.id] ?? null;
  const de = (c: Criterio | null) => ({ referencia: c?.referencia ?? null, fuente: c?.fuente ?? null, fecha: c?.fecha ?? null });

  if (pedido.id === 'trabajo') {
    const max = pedido.maxMin ?? def.omision;
    const texto = `${max} min o menos en combi o bus, o a ${dist(TRABAJO_A_PIE_M)} o menos`;
    const v = extra.viaje;
    if (!v) return sinDato(texto, 'el aviso no tiene coordenadas o falta el lugar de trabajo');
    const comun = { ...base, pedido: texto, referencia: v.linea, fuente: 'OpenStreetMap (rutas de bus)', fecha: null };
    if (v.distanciaM <= TRABAJO_A_PIE_M) return { ...comun, cumple: true, valor: `a ${dist(v.distanciaM)} en línea recta`, referencia: null };
    if (!v.hayRuta) return { ...comun, cumple: false, valor: `a ${dist(v.distanciaM)} y sin ruta directa ni con un trasbordo en los datos` };
    if (v.minutos === null) return { ...comun, cumple: null, valor: `hay ruta${v.linea ? ` (${v.linea})` : ''}, pero no trae duración` };
    return { ...comun, cumple: v.minutos <= max, valor: `${Math.round(v.minutos)} min${v.linea ? ` con ${v.linea}` : ''}${v.trasbordos ? ' y un trasbordo' : ''}` };
  }
  if (pedido.id === 'lugar') {
    const max = pedido.metros ?? def.omision;
    const l = extra.lugar;
    if (!l || l.distanciaM === null) return sinDato(`a ${dist(max)} o menos`, 'el aviso no tiene coordenadas');
    return { ...base, etiqueta: l.nombre, cumple: l.distanciaM <= max, valor: dist(l.distanciaM), pedido: `a ${dist(max)} o menos`, referencia: l.nombre, fuente: null, fecha: null };
  }
  if (def.clase === 'cerca') {
    const max = pedido.metros ?? def.omision;
    if (!m || typeof m.valor !== 'number') return sinDato(`a ${dist(max)} o menos`, medidos ? 'no hay ninguno en los datos' : 'el aviso no tiene coordenadas');
    return { ...base, cumple: m.valor <= max, valor: dist(m.valor), pedido: `a ${dist(max)} o menos`, ...de(m) };
  }
  if (def.clase === 'servicio') {
    const min = pedido.minPct ?? def.omision;
    if (!m || typeof m.valor !== 'number') return sinDato(`${min} % o más de la manzana`, medidos ? 'la manzana no tiene cifras del censo' : 'el aviso no tiene coordenadas');
    return { ...base, cumple: m.valor >= min, valor: `${m.valor} % de la manzana`, pedido: `${min} % o más de la manzana`, ...de(m) };
  }
  if (pedido.id === 'lejos_de_cauce') {
    const min = pedido.metros ?? def.omision;
    if (!medidos) return sinDato(`a más de ${dist(min)}`, 'el aviso no tiene coordenadas');
    if (!m || typeof m.valor !== 'number') return { ...base, cumple: true, valor: 'ningún cauce a 500 m', pedido: `a más de ${dist(min)}`, ...de(m) };
    return { ...base, cumple: m.valor > min, valor: `cauce a ${dist(m.valor)}`, pedido: `a más de ${dist(min)}`, ...de(m) };
  }
  if (pedido.id === 'sin_peligro_volcanico_alto') {
    if (!m || typeof m.valor !== 'string') return sinDato('fuera de zona de peligro alto', 'el aviso no tiene coordenadas');
    return { ...base, cumple: m.valor !== 'alto', valor: m.valor === 'fuera' ? 'fuera de las zonas del mapa' : `peligro ${m.valor}`, pedido: 'fuera de zona de peligro alto', ...de(m) };
  }
  if (pedido.id === 'zona_comercio') {
    if (!medidos) return sinDato('zona de comercio', 'el aviso no tiene coordenadas');
    if (!m || typeof m.valor !== 'string') return { ...base, cumple: null, valor: 'sin dato (fuera del plano de zonificación)', pedido: 'zona de comercio', ...de(m) };
    return { ...base, cumple: ZONAS_DE_COMERCIO.includes(m.valor) || /^C/.test(m.valor), valor: `zona ${m.valor}`, pedido: 'zona de comercio', ...de(m) };
  }
  // concesion_electrica
  if (!m || typeof m.valor !== 'boolean') return sinDato('dentro de un área de concesión', 'el aviso no tiene coordenadas');
  return { ...base, cumple: m.valor, valor: m.valor ? 'dentro' : 'fuera', pedido: 'dentro de un área de concesión', ...de(m) };
}

export interface Ordenable {
  criterios: CriterioEvaluado[];
  ultimaVezVisto: string;
}

export const cumplidos = (x: Ordenable): number => x.criterios.filter((c) => c.cumple === true).length;
export const sinDato = (x: Ordenable): number => x.criterios.filter((c) => c.cumple === null).length;

/** Orden transparente (ADR 0001). No modifica la lista que recibe. */
export function ordenar<T extends Ordenable>(avisos: T[]): T[] {
  return [...avisos].sort((a, b) => cumplidos(b) - cumplidos(a) || sinDato(a) - sinDato(b) || (a.ultimaVezVisto < b.ultimaVezVisto ? 1 : a.ultimaVezVisto > b.ultimaVezVisto ? -1 : 0));
}

/** Límites escritos en el producto (tarea 6.7). Van al pie de toda respuesta con avisos. */
export const LIMITES = [
  'GeoVerificador informa: no es asesoría legal ni financiera.',
  'Agua, luz y desagüe son la cobertura de la manzana en el censo de 2017, no una garantía del servicio en el predio.',
  'Cada aviso lleva la fecha en que se vio por última vez y el enlace al original: confirma precio y disponibilidad ahí.',
  'Las distancias son en línea recta.',
];
