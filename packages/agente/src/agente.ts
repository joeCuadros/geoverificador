/**
 * agente.ts — El ciclo del agente (tareas 6.2, 6.3 y 6.5).
 *
 *   mensaje → entender (erratas, respuesta a la pregunta pendiente, seguimiento) → ¿falta algo? una sola pregunta → ubicar lugares → buscar_avisos → redactar → verificar → respuesta
 *
 * Cada turno avanza: o se pregunta una sola cosa con opciones para tocar, o se busca, o se dice qué se entendió, qué falta y qué se puede hacer. Lo ya entendido
 * no se pierde entre turnos y una respuesta nunca se repite igual.
 *
 * El modelo de lenguaje es opcional y reemplazable: la interfaz `Proveedor` solo le deja reescribir la frase que abre la respuesta a partir de lo que devolvieron
 * las herramientas. Todo texto suyo pasa por `verificarRespuesta`; si cita una cifra o un enlace que las herramientas no dieron, se descarta y se usa la
 * redacción determinista. Sin proveedor (modo «reglas») la respuesta siempre es la determinista.
 */
import { z } from 'zod';
import { enArequipa } from '@geoverificador/dominio/avisos';
import { CONSULTA_VACIA, PREGUNTA, loQueFalta, nombreBonito, type Consulta, type Faltante } from './consulta.ts';
import { CRITERIOS, LIMITES, type CriterioEvaluado, type IdCriterio } from './criterios.ts';
import { ESQUEMA_AJUSTE, aplicarAjuste, entender, type Ajuste, type Aclaracion, type Entendimiento } from './dialogo.ts';
import { ejecutar, type Contexto, type Salida } from './herramientas.ts';
import { resolverLugar } from './lugares.ts';
import { alivios, ayudaSinEntender, ejemplos, entendidoDe, explicarVacio, repreguntar, resumenDe, siguientesPasos, sugerenciasDePregunta, type Chip, type Cobertura, type Sugerencia } from './presentacion.ts';
import { cuerpoDeAvisos, precioTexto, redactarAvisos, soles, titularDeAvisos } from './redactar.ts';
import { verificarRespuesta } from './verificar.ts';
import type { Cambio } from './difuso.ts';

export type { Ajuste, Aclaracion, Chip, Cobertura, Sugerencia };

interface LugarMedible {
  lat: number;
  lon: number;
  nombre: string;
}

/** Lo que recuerda el ciclo entre turnos de una misma conversación. El cliente lo devuelve tal cual: se valida en cada turno. */
export interface EstadoConversacion {
  consulta: Consulta | null;
  pendiente: Faltante | null;
  /** Opciones de un lugar dudoso entre las que la persona debe elegir. */
  aclaracion?: Aclaracion | null;
  /** Turnos seguidos sin avanzar (no se entendió, saludo repetido): cambia la ayuda para no repetirla. */
  sinAvanzar?: number;
  /** Ids de los avisos de la última búsqueda, en el orden mostrado: «compara el 1 y el 2» se refiere a ellos. */
  ultimosAvisos?: number[];
}
export const ESTADO_INICIAL: EstadoConversacion = { consulta: null, pendiente: null };

export interface Proveedor {
  nombre: string;
  /** Reescribe la frase que abre la respuesta a partir de lo que dijeron las herramientas. No debe agregar cifras ni enlaces. */
  redactar(entrada: { mensaje: string; consulta: Consulta; salidas: unknown[]; borrador: string }): Promise<string>;
}

/** Datos del turno que no son el mensaje: un ajuste tocado en la interfaz y el punto elegido en el mapa. */
export interface ExtraTurno {
  ajuste?: unknown;
  punto?: { lat: number; lon: number; etiqueta?: string | null } | null;
}

export interface TarjetaDeAviso {
  posicion: number;
  id: number;
  titulo: string;
  url: string;
  fuente: string;
  tipo: string | null;
  tipoInferido: boolean;
  esProyecto: boolean;
  precioTexto: string;
  distrito: string | null;
  zona: string | null;
  areaM2: number | null;
  dormitorios: number | null;
  vistoPorUltimaVez: string;
  tambienEn: string[];
  cumplidos: number;
  sinDato: number;
  pedidos: number;
  criterios: { id: IdCriterio; etiqueta: string; estado: 'cumple' | 'no_cumple' | 'sin_dato'; valor: string; pedido: string; fuente: string | null; fecha: string | null; nota: string; referencia: string | null }[];
}

export interface ResultadosDeAvisos {
  total: number;
  mostrados: number;
  orden: string;
  tarjetas: TarjetaDeAviso[];
  notas: string[];
  limites: string[];
}

export interface Comparacion {
  columnas: { posicion: number; id: number; titulo: string; url: string }[];
  filas: { etiqueta: string; valores: string[] }[];
  /** De dónde sale cada criterio medido (una vez por criterio, para que las celdas queden cortas). */
  fuentes: { etiqueta: string; fuente: string }[];
  nota: string;
}

export interface Respuesta {
  /** El texto completo (con avisos, criterios, fuentes y enlaces): para quien consume la API sin interfaz. */
  texto: string;
  /** La frase corta que abre la respuesta. Con tarjetas, ficha o comparación, la interfaz muestra esta y dibuja lo demás. */
  titular: string;
  /** 'pregunta': se pidió un dato; 'resultado': hay avisos o sectores; 'vacio': sin resultados; 'info': saludo/fuente/ayuda/ficha. */
  tipo: 'pregunta' | 'resultado' | 'vacio' | 'info';
  estado: EstadoConversacion;
  consulta: Consulta | null;
  herramientas: { nombre: string; entrada: unknown; salida: unknown }[];
  avisos: Salida<'buscar_avisos'>['avisos'];
  /** true si el texto de un proveedor se descartó por citar algo que las herramientas no dieron. */
  descartadoPorVerificacion: boolean;
  fallo?: string;
  /** 'modelo' solo si el titular lo escribió un modelo de lenguaje y pasó la verificación. */
  modo: 'reglas' | 'modelo';
  /** Lo que se entendió de la búsqueda, para verlo y corregirlo. */
  entendido: Chip[];
  correcciones: Cambio[];
  sugerencias: Sugerencia[];
  resultados: ResultadosDeAvisos | null;
  ficha: Salida<'ficha_de_punto'> | null;
  comparacion: Comparacion | null;
  cobertura: Cobertura | null;
}

const AYUDA = 'Puedo buscar avisos de venta en Arequipa y medir qué tan cerca están de lo que te importa (colegio, universidad, mall, salud, paradero, trabajo), si tienen agua y luz, y si la zona es de comercio. Dime, por ejemplo: «un departamento en Cayma, cerca de un colegio, con agua y luz, hasta 400 mil soles».';
const ORDEN = 'Orden: primero los que cumplen más criterios y, a igualdad, los que tienen menos «sin dato»; luego el visto más reciente. Es un orden de lectura, no una calificación ni una recomendación.';
const ORDEN_SIN_CRITERIOS = 'Orden: del aviso visto más recientemente al más antiguo, porque no pediste medir nada. Es un orden de lectura, no una calificación ni una recomendación.';
const MAXIMO = 5;

// ------------------------------------------------------------------ Estado que viene del cliente

const idCriterio = z.enum(Object.keys(CRITERIOS) as [IdCriterio, ...IdCriterio[]]);
const consultaZ = z.object({
  intencion: z.enum(['buscar_avisos', 'buscar_zonas', 'comparar', 'verificar_punto', 'fuente', 'saludo', 'otra']),
  tipo: z.enum(['departamento', 'casa', 'terreno', 'local', 'oficina']).nullable(),
  precioMax: z.number().positive().max(1e9).nullable(),
  moneda: z.enum(['PEN', 'USD']).nullable(),
  distrito: z.string().max(60).nullable(),
  dormitoriosMin: z.number().int().min(0).max(20).nullable(),
  areaMinM2: z.number().positive().max(1e7).nullable(),
  criterios: z.array(z.object({ id: idCriterio, metros: z.number().positive().max(50_000).optional(), minPct: z.number().min(0).max(100).optional(), maxMin: z.number().positive().max(240).optional() })).max(12),
  trabajoLugar: z.string().max(120).nullable(),
  sinTrasbordo: z.boolean(),
  lugarCerca: z.string().max(120).nullable(),
  noDisponible: z.array(z.string().max(200)).max(10),
  tema: z.string().max(60).nullable(),
  avisos: z.array(z.number().int()).max(10),
  tipoCualquiera: z.boolean().default(false),
  posiciones: z.array(z.number().int().min(1).max(9)).max(3).default([]),
});
const estadoZ = z.object({
  consulta: consultaZ.nullable().optional(),
  pendiente: z.enum(['tipo', 'trabajo', 'moneda', 'precio', 'distrito', 'lugar', 'aclarar']).nullable().optional(),
  aclaracion: z.object({ campo: z.enum(['trabajoLugar', 'lugarCerca']), opciones: z.array(z.string().max(160)).max(5) }).nullable().optional(),
  sinAvanzar: z.number().int().min(0).max(100).optional(),
  ultimosAvisos: z.array(z.number().int()).max(10).optional(),
});

/** El estado que manda el cliente puede venir manipulado: se acepta solo si tiene la forma esperada; si no, se empieza de cero. */
export function sanearEstado(crudo: unknown): EstadoConversacion {
  const r = estadoZ.safeParse(crudo);
  if (!r.success) return { ...ESTADO_INICIAL };
  const e = r.data;
  return { consulta: e.consulta ?? null, pendiente: e.pendiente ?? null, aclaracion: e.aclaracion ?? null, sinAvanzar: e.sinAvanzar ?? 0, ultimosAvisos: e.ultimosAvisos ?? [] };
}

// ------------------------------------------------------------------ Frases

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

export function textoDeCobertura(c: Cobertura): string {
  if (!c.publicacionActiva) return 'La publicación de avisos de terceros no está activada, así que por ahora no puedo mostrar avisos; sí puedo buscar zonas y decirte qué hay en un punto del mapa.';
  if (c.vigentes === 0) return 'Todavía no hay avisos vigentes cargados.';
  return `Tengo ${c.vigentes} ${plural(c.vigentes, 'aviso vigente', 'avisos vigentes')} en ${c.distritos.length} ${plural(c.distritos.length, 'distrito', 'distritos')}${c.ultimaVez ? `; el más reciente se vio el ${c.ultimaVez}` : ''}.`;
}

const NOMBRE_DE_CAMPO: Record<string, string> = { tipo: 'el tipo', precio: 'el tope de precio', distrito: 'el distrito', trabajo: 'el trabajo', lugar: 'el lugar', dormitorios: 'los dormitorios', area: 'el área mínima' };

/** «Quité el criterio «Colegio» y el tope de precio.» */
function fraseDeCambios(cambios: string[], c: Consulta): string | null {
  const quitados: string[] = [];
  let ajustado: string | null = null;
  for (const x of cambios) {
    if (x === 'precio' && c.precioMax !== null) ajustado = `Ajusté el tope de precio a ${c.moneda === 'USD' ? `US$ ${Math.round(c.precioMax).toLocaleString('es-PE').replace(/,/g, ' ')}` : soles(c.precioMax)}.`;
    else if (x in NOMBRE_DE_CAMPO) quitados.push(NOMBRE_DE_CAMPO[x]);
    else if (x in CRITERIOS) quitados.push(`el criterio «${CRITERIOS[x as IdCriterio].etiqueta}»`);
  }
  const quite = quitados.length ? `Quité ${quitados.length > 1 ? `${quitados.slice(0, -1).join(', ')} y ${quitados.at(-1)}` : quitados[0]}.` : null;
  return [quite, ajustado].filter(Boolean).join(' ') || null;
}

function fraseDeAjuste(a: Ajuste, c: Consulta): string | null {
  switch (a.accion) {
    case 'quitar':
      return fraseDeCambios([a.campo], c);
    case 'quitar_criterio':
      return fraseDeCambios([a.id], c);
    case 'sin_filtros':
      return 'Quité los filtros de tipo, distrito, precio y tamaño.';
    case 'poner_tipo':
      return a.valor === 'cualquiera' ? 'Busco de cualquier tipo.' : `Busco ${a.valor === 'oficina' ? 'oficinas' : a.valor === 'casa' ? 'casas' : a.valor === 'terreno' ? 'terrenos' : a.valor === 'local' ? 'locales' : 'departamentos'}.`;
    case 'poner_distrito':
      return `Cambié el distrito a ${nombreBonito(c.distrito ?? a.valor)}.`;
    case 'poner_precio':
      return `Puse el tope de precio en ${a.moneda === 'USD' ? `US$ ${Math.round(a.valor).toLocaleString('es-PE').replace(/,/g, ' ')}` : soles(a.valor)}.`;
    case 'poner_criterio':
      return `Sumé el criterio «${CRITERIOS[a.id].etiqueta}».`;
    default:
      return null;
  }
}

const tarjeta = (a: Salida<'buscar_avisos'>['avisos'][number], i: number): TarjetaDeAviso => ({
  posicion: i + 1, id: a.id, titulo: a.titulo?.trim() || 'Aviso sin título', url: a.url, fuente: a.fuente, tipo: a.tipo, tipoInferido: a.tipoInferido, esProyecto: a.esProyecto, precioTexto: precioTexto(a), distrito: a.distrito, zona: a.zona,
  areaM2: a.areaM2, dormitorios: a.dormitorios, vistoPorUltimaVez: a.vistoPorUltimaVez, tambienEn: a.tambienEn, cumplidos: a.cumplidos, sinDato: a.sinDato, pedidos: a.pedidos,
  criterios: a.criterios.map((c: CriterioEvaluado) => ({ id: c.id, etiqueta: c.etiqueta, estado: c.cumple === true ? 'cumple' : c.cumple === false ? 'no_cumple' : 'sin_dato', valor: c.valor, pedido: c.pedido, fuente: c.fuente, fecha: c.fecha, nota: c.nota, referencia: c.referencia })),
});

const lineaDeCriterio = (c: TarjetaDeAviso['criterios'][number]) => `${c.estado === 'cumple' ? '✔' : c.estado === 'no_cumple' ? '✘' : '?'} ${c.valor}${c.fecha ? ` (datos del ${c.fecha})` : ''}`;

function comparar(t: TarjetaDeAviso[]): Comparacion {
  const filas: Comparacion['filas'] = [
    { etiqueta: 'Precio', valores: t.map((x) => x.precioTexto) },
    { etiqueta: 'Distrito', valores: t.map((x) => (x.distrito ? nombreBonito(x.distrito) : 'sin dato')) },
    { etiqueta: 'Área', valores: t.map((x) => (x.areaM2 !== null ? `${x.areaM2} m²` : 'sin dato')) },
    { etiqueta: 'Dormitorios', valores: t.map((x) => (x.dormitorios !== null ? String(x.dormitorios) : 'sin dato')) },
  ];
  const ids = [...new Set(t.flatMap((x) => x.criterios.map((c) => c.id)))];
  for (const id of ids) {
    const una = t.flatMap((x) => x.criterios).find((c) => c.id === id)!;
    filas.push({ etiqueta: una.etiqueta, valores: t.map((x) => { const c = x.criterios.find((y) => y.id === id); return c ? lineaDeCriterio(c) : 'sin dato'; }) });
  }
  filas.push({ etiqueta: 'Visto por última vez', valores: t.map((x) => x.vistoPorUltimaVez) });
  const fuentes = ids.flatMap((id) => {
    const f = t.flatMap((x) => x.criterios).find((c) => c.id === id && c.fuente);
    return f?.fuente ? [{ etiqueta: f.etiqueta, fuente: f.fuente }] : [];
  });
  return { columnas: t.map((x) => ({ posicion: x.posicion, id: x.id, titulo: x.titulo, url: x.url })), filas, fuentes, nota: 'No hay puntaje ni una opción ganadora: cada fila muestra solo lo medido, con su fuente y su fecha. Decide tú con lo que más te importa.' };
}

// ------------------------------------------------------------------ El ciclo

export async function responder(mensaje: string, estadoCrudo: unknown, ctx: Contexto, proveedor: Proveedor | null = null, extra: ExtraTurno = {}): Promise<Respuesta> {
  const estado = sanearEstado(estadoCrudo);
  const herramientas: Respuesta['herramientas'] = [];
  const usar = async <N extends Parameters<typeof ejecutar>[0]>(nombre: N, entrada: unknown): Promise<Salida<N>> => {
    const salida = await ejecutar(nombre, entrada, ctx);
    herramientas.push({ nombre, entrada, salida });
    return salida;
  };
  let cobertura: Cobertura | null = null;
  const verCobertura = async (): Promise<Cobertura | null> => {
    if (!cobertura) cobertura = await usar('cobertura_avisos', {}).catch(() => null);
    return cobertura;
  };
  const punto = extra.punto && Number.isFinite(extra.punto.lat) && Number.isFinite(extra.punto.lon) ? extra.punto : null;
  const sinAvanzar = estado.sinAvanzar ?? 0;
  const avanza = (e: Partial<EstadoConversacion> = {}): EstadoConversacion => ({ consulta: estado.consulta, pendiente: null, aclaracion: null, sinAvanzar: 0, ultimosAvisos: estado.ultimosAvisos, ...e });
  const sinAvance = (e: Partial<EstadoConversacion> = {}): EstadoConversacion => ({ consulta: estado.consulta, pendiente: estado.pendiente, aclaracion: estado.aclaracion, sinAvanzar: sinAvanzar + 1, ultimosAvisos: estado.ultimosAvisos, ...e });
  const base = (p: Partial<Respuesta> & Pick<Respuesta, 'titular' | 'tipo'>): Respuesta => ({
    texto: p.titular, estado, consulta: null, herramientas, avisos: [], descartadoPorVerificacion: false, modo: 'reglas', entendido: [], correcciones: [], sugerencias: [], resultados: null, ficha: null, comparacion: null, cobertura, ...p,
  });
  const chips = async (c: Consulta | null, corregidos?: Parameters<typeof entendidoDe>[1]['corregidos']): Promise<Chip[]> => (c ? entendidoDe(c, { distritosConAvisos: c.distrito ? ((await verCobertura())?.distritos.map((d) => d.nombre) ?? []) : [], corregidos }) : []);

  type Ubicados = { ok: true; trabajo: LugarMedible | null; lugar: LugarMedible | null } | { ok: false; falta: Faltante; antes: string[]; aclaracion: Aclaracion | null };
  /** Ubica con el geocodificador el trabajo y el lugar con nombre; corrige erratas claras y deja en `c` el nombre tal como lo conoce la base. */
  const ubicar = async (c: Consulta, correcciones: Cambio[], corregidos: { trabajo: boolean; lugar: boolean }): Promise<Ubicados> => {
    let trabajo: LugarMedible | null = null;
    let lugar: LugarMedible | null = null;
    if (c.criterios.some((x) => x.id === 'trabajo') && c.trabajoLugar) {
      const r = await resolverLugar(ctx.base, c.trabajoLugar, (texto) => usar('geocodificar_lugar', { texto }));
      if (r.estado === 'dudoso') return { ok: false, falta: 'aclarar', antes: [], aclaracion: { campo: 'trabajoLugar', opciones: r.opciones } };
      if (r.estado === 'no_hallado') {
        const nota = r.nota ?? `No ubiqué «${c.trabajoLugar}».`;
        c.trabajoLugar = null;
        return { ok: false, falta: 'trabajo', antes: [nota], aclaracion: null };
      }
      trabajo = { lat: r.lat, lon: r.lon, nombre: r.nombre };
      if (r.corregidoDe) correcciones.push({ dicho: r.corregidoDe, entendido: r.nombre });
      corregidos.trabajo = Boolean(r.corregidoDe);
      c.trabajoLugar = r.nombre;
    }
    if (c.criterios.some((x) => x.id === 'lugar') && c.lugarCerca) {
      const r = await resolverLugar(ctx.base, c.lugarCerca, (texto) => usar('geocodificar_lugar', { texto }));
      if (r.estado === 'dudoso') return { ok: false, falta: 'aclarar', antes: [], aclaracion: { campo: 'lugarCerca', opciones: r.opciones } };
      if (r.estado === 'no_hallado') {
        const nota = r.nota ?? `No ubiqué «${c.lugarCerca}».`;
        c.lugarCerca = null;
        c.criterios = c.criterios.filter((x) => x.id !== 'lugar');
        return { ok: false, falta: 'lugar', antes: [nota], aclaracion: null };
      }
      lugar = { lat: r.lat, lon: r.lon, nombre: r.nombre };
      if (r.corregidoDe) correcciones.push({ dicho: r.corregidoDe, entendido: r.nombre });
      corregidos.lugar = Boolean(r.corregidoDe);
      c.lugarCerca = r.nombre;
    }
    return { ok: true, trabajo, lugar };
  };

  const distritos = (await ctx.base.consulta('SELECT nombre FROM distrito ORDER BY orden')).map((f) => String(f.nombre));
  const ajuste = extra.ajuste === undefined ? null : ESQUEMA_AJUSTE.safeParse(extra.ajuste);

  try {
    // ---------------------------------------------------------- Qué se entendió
    let e: Entendimiento;
    let frasePrevia: string | null = null;
    if (ajuste?.success) {
      const a = ajuste.data;
      if (a.accion === 'nueva') {
        const c = { ...CONSULTA_VACIA, criterios: [], noDisponible: [], avisos: [], posiciones: [] };
        e = { consulta: c, acto: 'reinicio', correcciones: [], dudas: [], respondio: null, cambios: [], noSirvio: false, sinPreferencia: false, necesita: null };
      } else if (a.accion === 'punto') {
        e = { consulta: estado.consulta ?? CONSULTA_VACIA, acto: 'punto', correcciones: [], dudas: [], respondio: null, cambios: [], noSirvio: false, sinPreferencia: false, necesita: null };
      } else if (a.accion === 'preguntar') {
        const previa = estado.consulta && estado.consulta.intencion === 'buscar_avisos' ? estado.consulta : { ...CONSULTA_VACIA, intencion: 'buscar_avisos' as const, criterios: [], noDisponible: [], avisos: [], posiciones: [] };
        e = { consulta: previa, acto: 'seguimiento', correcciones: [], dudas: [], respondio: null, cambios: [], noSirvio: false, sinPreferencia: false, necesita: a.campo };
      } else {
        const c = aplicarAjuste(estado.consulta, a, distritos);
        if (!c) e = entender(mensaje, { distritos, previa: estado.consulta, pendiente: estado.pendiente, aclaracion: estado.aclaracion });
        else {
          frasePrevia = fraseDeAjuste(a, c);
          e = { consulta: c, acto: 'seguimiento', correcciones: [], dudas: [], respondio: null, cambios: [], noSirvio: false, sinPreferencia: false, necesita: null };
        }
      }
    } else {
      e = entender(mensaje, { distritos, previa: estado.consulta, pendiente: estado.pendiente, aclaracion: estado.aclaracion });
    }
    const correcciones: Cambio[] = [...e.correcciones];
    const lineasDeCorreccion = () => correcciones.map((x) => `Entendí «${x.dicho}» como «${x.entendido}».`);

    // ---------------------------------------------------------- Intenciones que no son una búsqueda de avisos
    if (e.acto === 'reinicio') {
      const cob = await verCobertura();
      const titular = 'Listo, empecemos de nuevo. Cuéntame qué vivienda buscas en Arequipa: tipo, distrito, precio máximo y qué quieres tener cerca.';
      return base({ titular, tipo: 'info', consulta: e.consulta, estado: { consulta: null, pendiente: null, aclaracion: null, sinAvanzar: 0, ultimosAvisos: [] }, sugerencias: ejemplos(cob, Boolean(punto)) });
    }

    if (e.acto === 'saludo') {
      const cob = await verCobertura();
      const hay = estado.consulta && estado.consulta.intencion === 'buscar_avisos' && (estado.consulta.tipo || estado.consulta.tipoCualquiera || estado.consulta.criterios.length);
      if (sinAvanzar === 0 && !hay) {
        const titular = `Hola. ${cob ? textoDeCobertura(cob) : ''}`.trim();
        return base({ titular, texto: `${titular}\n\n${AYUDA}`, tipo: 'info', estado: sinAvance(), sugerencias: ejemplos(cob, Boolean(punto)) });
      }
      const lo = hay ? `Estoy con tu búsqueda: ${resumenDe(estado.consulta!)}.` : 'Todavía no tengo datos de tu búsqueda.';
      const titular = `Aquí sigo. ${lo} ¿Qué quieres hacer ahora?`;
      return base({ titular, tipo: 'info', estado: sinAvance(), entendido: await chips(estado.consulta), sugerencias: hay ? siguientesPasos(estado.consulta!, { cobertura: cob, mostrados: estado.ultimosAvisos?.length ?? 0, hayPunto: Boolean(punto) }) : ejemplos(cob, Boolean(punto)) });
    }

    if (e.acto === 'fuente') {
      const c = e.consulta;
      const r = await usar('explicar_fuente', { tema: c.tema ?? 'avisos' });
      const texto = r.fuentes.length ? r.fuentes.map((f) => `• ${f.nombre}${f.fecha ? ` — datos del ${f.fecha}` : ''}${f.licencia ? ` — licencia: ${f.licencia}${f.licenciaVerificada ? '' : ' (sin verificar)'}` : ''}${f.limite ? ` — límite: ${f.limite}` : ''}${f.url ? `\n  ${f.url}` : ''}`).join('\n') : 'No tengo registrada una fuente para ese tema.';
      return base({ titular: texto, tipo: 'info', consulta: c, estado: avanza(), entendido: await chips(estado.consulta), sugerencias: estado.consulta ? siguientesPasos(estado.consulta, { cobertura: await verCobertura(), mostrados: estado.ultimosAvisos?.length ?? 0, hayPunto: Boolean(punto) }) : ejemplos(await verCobertura(), Boolean(punto)) });
    }

    if (e.acto === 'punto') {
      const cob = await verCobertura();
      if (!punto) {
        const titular = 'Para decirte qué hay en un punto, primero elígelo en el mapa: toca un lugar o busca una dirección en el buscador del mapa, y vuelve a preguntarme.';
        return base({ titular, tipo: 'info', consulta: e.consulta, estado: avanza(), entendido: await chips(estado.consulta), sugerencias: ejemplos(cob, false) });
      }
      if (!enArequipa(punto.lat, punto.lon)) {
        return base({ titular: 'Ese punto está fuera de Arequipa: los datos de GeoVerificador solo cubren Arequipa metropolitana. Elige otro punto en el mapa.', tipo: 'info', consulta: e.consulta, estado: avanza(), sugerencias: ejemplos(cob, false) });
      }
      const f = await usar('ficha_de_punto', { lat: punto.lat, lon: punto.lon });
      const lineas = f.filas.map((x) => {
        const m = x.estado === 'cumple' ? '✔' : x.estado === 'no_cumple' ? '✘' : x.estado === 'sin_dato' ? '?' : '•';
        const detalle = x.valor ?? (x.nombre ? `${x.nombre}${x.distanciaM !== null ? `, a ${x.distanciaM < 1000 ? `${Math.round(x.distanciaM)} m` : `${(x.distanciaM / 1000).toFixed(2).replace('.', ',')} km`}` : ''}` : 'sin dato');
        return `${m} ${x.etiqueta}: ${detalle}${x.fuente ? ` · fuente: ${x.fuente}` : ''}${x.fecha ? ` (${x.fecha})` : ''}`;
      });
      const zona = f.zona ? `zona ${f.zona.codigo}${f.zona.nombre ? ` (${f.zona.nombre})` : ''}${f.zona.fuente ? ` · fuente: ${f.zona.fuente}${f.zona.fecha ? ` (${f.zona.fecha})` : ''}` : ''}` : 'sin zona en el plano de zonificación';
      const titular = `En el punto elegido${punto.etiqueta ? ` («${punto.etiqueta}»)` : ''}: ${f.distrito ? `distrito de ${nombreBonito(f.distrito)}` : 'distrito sin dato'}, ${zona}. Esto es lo más cercano de cada cosa:`;
      const texto = [titular, ...lineas, ...(f.peligros.length ? ['Peligros de contexto (no son una evaluación del predio):', ...f.peligros.map((x) => `• ${x.texto}${x.fuente ? ` · fuente: ${x.fuente}` : ''}${x.fecha ? ` (${x.fecha})` : ''}`)] : []), '', ...f.limites].join('\n');
      return base({ titular, texto, tipo: 'info', consulta: e.consulta, estado: avanza(), ficha: f, entendido: await chips(estado.consulta), sugerencias: estado.consulta?.tipo || estado.consulta?.tipoCualquiera ? siguientesPasos(estado.consulta, { cobertura: cob, mostrados: estado.ultimosAvisos?.length ?? 0, hayPunto: false }).filter((s) => s.rol !== 'punto') : ejemplos(cob, false).filter((s) => s.rol !== 'punto') });
    }

    if (e.acto === 'comparar') {
      const cob = await verCobertura();
      const previa = estado.consulta && estado.consulta.intencion === 'buscar_avisos' ? estado.consulta : null;
      const ids = estado.ultimosAvisos ?? [];
      const sinLista = (titular: string) => base({ titular, tipo: 'info', consulta: e.consulta, estado: avanza(), entendido: previa ? [] : [], sugerencias: ejemplos(cob, Boolean(punto)) });
      if (!previa || ids.length < 2) return sinLista('Para comparar necesito una lista: primero hago una búsqueda y te muestro avisos; después puedo ponerlos lado a lado, sin puntaje ni ganador.');
      const c = { ...previa, criterios: previa.criterios.map((x) => ({ ...x })) };
      const u = await ubicar(c, [], { trabajo: false, lugar: false });
      if (!u.ok) return sinLista('Para comparar tengo que repetir la búsqueda y no pude ubicar uno de los lugares que pediste. Corrígelo y vuelvo a intentar.');
      const criterios = c.criterios.filter((x) => (x.id === 'trabajo' ? u.trabajo : x.id === 'lugar' ? u.lugar : true));
      const r = await usar('buscar_avisos', { tipo: c.tipo, precioMax: c.precioMax, moneda: c.moneda, distrito: c.distrito, dormitoriosMin: c.dormitoriosMin, areaMinM2: c.areaMinM2, criterios, trabajo: u.trabajo, lugar: u.lugar, sinTrasbordo: c.sinTrasbordo });
      const disponibles = r.avisos.slice(0, MAXIMO);
      let posiciones = [...new Set(e.consulta.posiciones)].filter((p) => p >= 1 && p <= disponibles.length);
      if (posiciones.length < 2) posiciones = disponibles.slice(0, 2).map((_, i) => i + 1);
      if (posiciones.length < 2) return sinLista('La última búsqueda ya no tiene dos avisos para comparar. Repite la búsqueda y vuelvo a intentar.');
      const comparacion = comparar(posiciones.map((p) => tarjeta(disponibles[p - 1], p - 1)));
      const titular = `Comparo los avisos ${posiciones.join(' y ')} de tu última búsqueda, lado a lado.`;
      const texto = [titular, comparacion.nota, '', ...comparacion.filas.map((f) => `${f.etiqueta}: ${f.valores.map((v, i) => `[${comparacion.columnas[i].posicion}] ${v}`).join(' | ')}`), '', ...comparacion.columnas.map((x) => `[${x.posicion}] ${x.url}`), '', ...comparacion.fuentes.map((f) => `Fuente de «${f.etiqueta}»: ${f.fuente}`), '', ...r.limites].join('\n');
      return base({ titular, texto, tipo: 'info', consulta: c, estado: avanza({ consulta: c }), comparacion, entendido: await chips(c), sugerencias: siguientesPasos(c, { cobertura: cob, mostrados: disponibles.length, hayPunto: Boolean(punto) }).filter((s) => !/Compara/.test(s.texto)) });
    }

    if (e.acto === 'zonas') {
      const c = e.consulta;
      const ZONA: Record<string, 'salud' | 'colegio' | 'transporte' | 'lejosQuebrada'> = { salud: 'salud', colegio: 'colegio', paradero: 'transporte', lejos_de_cauce: 'lejosQuebrada' };
      const ids = [...new Set(c.criterios.map((x) => ZONA[x.id]).filter(Boolean))];
      const cob = await verCobertura();
      if (ids.length === 0) {
        return base({ titular: '¿Qué quieres tener cerca en la zona: salud, colegio, transporte, áreas verdes o lejos de quebradas?', tipo: 'pregunta', consulta: c, estado: avanza(), sugerencias: [
          { texto: 'Salud y colegio', mensaje: 'zonas con salud y colegio', rol: 'respuesta' },
          { texto: 'Transporte y colegio', mensaje: 'zonas con paradero y colegio', rol: 'respuesta' },
          { texto: 'Lejos de quebradas', mensaje: 'zonas lejos de quebradas', rol: 'respuesta' },
        ] });
      }
      const r = await usar('buscar_zonas', { criterios: ids, distrito: c.distrito });
      const titular = r.sectores.length ? r.texto : 'No encontré sectores que cumplan todo a la vez.';
      return base({ titular, tipo: r.sectores.length ? 'resultado' : 'vacio', consulta: c, estado: avanza(), correcciones, entendido: await chips(estado.consulta), sugerencias: estado.consulta ? siguientesPasos(estado.consulta, { cobertura: cob, mostrados: estado.ultimosAvisos?.length ?? 0, hayPunto: Boolean(punto) }) : ejemplos(cob, Boolean(punto)) });
    }

    if (e.acto === 'ninguno' || e.acto === 'sin_preferencia') {
      const cob = await verCobertura();
      const previa = estado.consulta && estado.consulta.intencion === 'buscar_avisos' ? estado.consulta : null;
      if (e.acto === 'sin_preferencia' && previa) {
        const titular = `Entendido: no tienes preferencia en eso. Sigo con lo que ya tengo: ${resumenDe(previa) || 'sin filtros'}. ¿Qué quieres ajustar?`;
        return base({ titular, tipo: 'info', consulta: previa, estado: sinAvance(), entendido: await chips(previa), sugerencias: siguientesPasos(previa, { cobertura: cob, mostrados: estado.ultimosAvisos?.length ?? 0, hayPunto: Boolean(punto) }) });
      }
      const ayuda = ayudaSinEntender(sinAvanzar, mensaje, previa);
      const duda = e.dudas[0] ? ` Tal vez «${e.dudas[0].dicho}» sea ${e.dudas[0].opciones.map((x) => `«${x}»`).join(' o ')}.` : '';
      return base({ titular: ayuda.titular + duda, tipo: 'info', consulta: e.consulta, estado: sinAvance(), entendido: await chips(previa), sugerencias: [...ayuda.sugerencias, ...(punto ? [{ texto: '¿Qué hay en el punto que elegí?', ajuste: { accion: 'punto' } as Ajuste, rol: 'punto' as const }] : [])] });
    }

    // ---------------------------------------------------------- Una búsqueda de avisos (o su pregunta pendiente)
    const c: Consulta = { ...e.consulta, criterios: e.consulta.criterios.map((x) => ({ ...x })) };
    const corregidos = {
      tipo: Boolean(c.tipo) && correcciones.some((x) => /^(departamento|apartamento|terreno|oficina|casa)/i.test(x.entendido)),
      distrito: Boolean(c.distrito) && correcciones.some((x) => x.entendido === nombreBonito(c.distrito!)),
      trabajo: false,
      lugar: false,
    };
    const pregunta = async (f: Faltante, antes: string[] = [], aclaracion: Aclaracion | null = null): Promise<Respuesta> => {
      const cob = f === 'distrito' ? await verCobertura() : null;
      const reiterar = e.noSirvio && estado.pendiente === f;
      const cuerpo = reiterar ? repreguntar(f, sinAvanzar, mensaje) : f === 'aclarar' && aclaracion ? `No estoy seguro de qué lugar es «${c[aclaracion.campo] ?? ''}». ¿Quisiste decir ${aclaracion.opciones.map((x) => `«${x}»`).join(' o ')}?` : PREGUNTA[f];
      const titular = [...lineasDeCorreccion(), ...antes, cuerpo].join('\n');
      return base({
        titular, tipo: 'pregunta', consulta: c, correcciones, entendido: await chips(c, corregidos), sugerencias: sugerenciasDePregunta(f, { cobertura: cob, aclaracion }),
        estado: reiterar ? sinAvance({ consulta: c, pendiente: f, aclaracion }) : avanza({ consulta: c, pendiente: f, aclaracion }),
      });
    };

    const falta = e.necesita ?? loQueFalta(c);
    if (falta) {
      const previoMensaje = e.necesita === 'precio' && !e.noSirvio ? ['Para ajustar el precio necesito un tope de referencia.'] : [];
      return await pregunta(falta, previoMensaje);
    }

    const u = await ubicar(c, correcciones, corregidos);
    if (!u.ok) return await pregunta(u.falta, u.antes, u.aclaracion);
    const { trabajo, lugar } = u;
    const criterios = c.criterios.filter((x) => (x.id === 'trabajo' ? trabajo : x.id === 'lugar' ? lugar : true));
    const filtros = { tipo: c.tipo, precioMax: c.precioMax, moneda: c.moneda, distrito: c.distrito, dormitoriosMin: c.dormitoriosMin, areaMinM2: c.areaMinM2 };
    const r = await usar('buscar_avisos', { ...filtros, criterios, trabajo, lugar, sinTrasbordo: c.sinTrasbordo });

    const aparte: string[] = [];
    if (trabajo) aparte.push(`Tomé como trabajo «${trabajo.nombre}».`);
    if (lugar) aparte.push(`Tomé como lugar «${lugar.nombre}».`);
    if (c.noDisponible.length) aparte.push(`No tengo datos de: ${c.noDisponible.join(', ')}; no lo usé para filtrar.`);
    for (const d of e.dudas) aparte.push(`No usé «${d.dicho}» porque no sé si quisiste decir ${d.opciones.map((x) => `«${x}»`).join(' o ')}.`);

    const previos = [...lineasDeCorreccion(), ...(frasePrevia ? [frasePrevia] : e.cambios.length ? [fraseDeCambios(e.cambios, c)].filter((x): x is string => Boolean(x)) : [])];
    const cob = await verCobertura();
    const entendido = await chips(c, corregidos);
    const nuevoEstado = (ids: number[]): EstadoConversacion => ({ consulta: c, pendiente: null, aclaracion: null, sinAvanzar: 0, ultimosAvisos: ids });

    if (r.avisos.length === 0) {
      let explicacion = r.motivoVacio ?? 'No encontré avisos que cumplan lo que pides.';
      let sugerencias: Sugerencia[] = [{ texto: 'Nueva búsqueda', ajuste: { accion: 'nueva' }, rol: 'alivio' }];
      if (ctx.publicar !== 'ninguna') {
        const d = await usar('diagnosticar_filtros', filtros);
        explicacion = explicarVacio(c, d, cob);
        sugerencias = alivios(c, d, cob);
      }
      const titular = [...previos, `No encontré avisos con lo que pides. ${explicacion}`, ...aparte].join('\n');
      const texto = [titular, '', redactarAvisos(r)].join('\n');
      return base({ titular, texto, tipo: 'vacio', consulta: c, estado: nuevoEstado([]), correcciones, entendido, sugerencias, resultados: null });
    }

    const mostrados = r.avisos.slice(0, MAXIMO);
    const tarjetas = mostrados.map(tarjeta);
    const resultados: ResultadosDeAvisos = { total: r.totalHallados, mostrados: tarjetas.length, orden: tarjetas.some((t) => t.pedidos > 0) ? ORDEN : ORDEN_SIN_CRITERIOS, tarjetas, notas: r.notas, limites: r.limites };

    let apertura = titularDeAvisos(r, MAXIMO);
    let modo: Respuesta['modo'] = 'reglas';
    let descartado = false;
    if (proveedor) {
      try {
        const propuesto = (await proveedor.redactar({ mensaje, consulta: c, salidas: herramientas.map((h) => h.salida), borrador: apertura })).trim();
        const v = verificarRespuesta(propuesto, herramientas.map((h) => h.salida), [mensaje, ...LIMITES]);
        if (v.ok && propuesto && propuesto.length <= 400 && !propuesto.includes('\n')) {
          apertura = propuesto;
          modo = 'modelo';
        } else descartado = true;
      } catch {
        descartado = true;
      }
    }
    const titular = [...previos, apertura, ...aparte].join('\n');
    const texto = [titular, '', cuerpoDeAvisos(r, MAXIMO)].join('\n');
    return base({
      titular, texto, tipo: 'resultado', consulta: c, estado: nuevoEstado(mostrados.map((a) => a.id)), avisos: r.avisos, correcciones, entendido, resultados, modo, descartadoPorVerificacion: descartado,
      sugerencias: siguientesPasos(c, { cobertura: cob, mostrados: tarjetas.length, hayPunto: Boolean(punto) }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return base({ titular: `No pude completar la búsqueda: ${msg}`, tipo: 'info', fallo: msg, estado: sinAvance(), sugerencias: [{ texto: 'Nueva búsqueda', ajuste: { accion: 'nueva' }, rol: 'respuesta' }] });
  }
}

