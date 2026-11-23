/**
 * consulta.ts — Qué pidió la persona, como estructura (sin red ni base de datos).
 *
 * `interpretar` es el intérprete de reglas: entiende frases en español con patrones explícitos. Sirve sin modelo de lenguaje (modo «reglas»),
 * es la línea base de la evaluación (tarea 6.6) y valida lo que proponga un modelo. `loQueFalta` decide la única pregunta de aclaración (6.3).
 */
import { normalizar } from '@geoverificador/dominio/texto';
import type { CriterioPedido, IdCriterio } from './criterios.ts';

export type Intencion = 'buscar_avisos' | 'buscar_zonas' | 'comparar' | 'verificar_punto' | 'fuente' | 'saludo' | 'otra';
export type Moneda = 'PEN' | 'USD';

export interface Consulta {
  intencion: Intencion;
  tipo: 'departamento' | 'casa' | 'terreno' | 'local' | 'oficina' | null;
  precioMax: number | null;
  moneda: Moneda | null;
  distrito: string | null;
  dormitoriosMin: number | null;
  areaMinM2: number | null;
  criterios: CriterioPedido[];
  /** Lugar de trabajo o destino del viaje, tal como lo dijo la persona; null si pidió «cerca de mi trabajo» sin decir dónde. */
  trabajoLugar: string | null;
  sinTrasbordo: boolean;
  /** Otro lugar con nombre del que quiere estar cerca («cerca de la plaza de Yanahuara»). */
  lugarCerca: string | null;
  /** Lo que pidió y no está en los datos (piso, ascensor…): se dice, no se inventa. */
  noDisponible: string[];
  /** Para `fuente`: de qué dato pregunta. Para `comparar`: los avisos nombrados. */
  tema: string | null;
  avisos: number[];
}

export const CONSULTA_VACIA: Consulta = {
  intencion: 'otra', tipo: null, precioMax: null, moneda: null, distrito: null, dormitoriosMin: null, areaMinM2: null, criterios: [], trabajoLugar: null, sinTrasbordo: false, lugarCerca: null, noDisponible: [], tema: null, avisos: [],
};

const NUMEROS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30 };
const numero = (t: string): number | null => (t in NUMEROS ? NUMEROS[t] : /^\d+([.,p]\d+)?$/.test(t) ? Number(t.replace(/[,p]/, '.')) : null);

/**
 * Normaliza una frase cuidando las cifras: «450,000» y «450 000» quedan «450000»; «1.5» queda «1p5» (la «p» es el punto decimal, que la
 * normalización general borraría).
 */
export function normalizarFrase(crudo: string): string {
  return normalizar(crudo.replace(/(\d{1,3})((?:[.,  ]\d{3})+)(?!\d)/g, (_, a: string, b: string) => a + b.replace(/\D/g, '')).replace(/(\d+)[.,](\d{1,2})(?!\d)/g, '$1p$2'));
}
/** Velocidad a pie de CONFIG.viaje.tiempo (MUTCD, 1,07 m/s): convierte «10 minutos a pie» en metros. */
const METROS_POR_MINUTO_A_PIE = 1.07 * 60;
const METROS_POR_CUADRA = 100;

const TIPOS: [RegExp, Consulta['tipo'], string | null][] = [
  [/\b(departamentos?|depas?|dptos?|deptos?|flat|duplex|minidepartamento|mini departamento)\b/, 'departamento', null],
  [/\b(cuartos?|habitacion(es)?|monoambiente)\b(?! (dormitorios|de bano))/, 'departamento', 'cuartos en alquiler (solo hay avisos de venta; busqué departamentos)'],
  [/\b(casas?|chalet)\b/, 'casa', null],
  [/\b(terrenos?|lotes?)\b/, 'terreno', null],
  [/\b(local(es)? comercial(es)?|locales?|tienda)\b/, 'local', null],
  [/\b(oficinas?)\b/, 'oficina', null],
];

const CRITERIOS_TEXTO: [RegExp, IdCriterio][] = [
  [/\b(mall|malls|centros? comercial(es)?|shopping)\b/, 'mall'],
  [/\b(universidad(es)?|la u\b|facultad)/, 'universidad'],
  [/\b(colegios?|escuelas?|inicial|primaria|secundaria|jardin|nido)\b/, 'colegio'],
  [/\b(hospital(es)?|clinicas?|centros? de salud|postas?|salud|medico)\b/, 'salud'],
  [/\b(paraderos?|transporte publico)\b/, 'paradero'],
  [/\b(mercados?|supermercados?|abastos)\b/, 'mercado'],
  [/\b(agua|saneamiento)\b/, 'agua'],
  [/\b(luz|electricidad|alumbrado|energia electrica)\b(?! verde)/, 'luz'],
  [/\b(desague|alcantarillado)\b/, 'desague'],
  [/\b(concesion electrica|concesion de distribucion)\b/, 'concesion_electrica'],
  [/\b(quebradas?|torrenteras?|rios?|cauces?|huaicos?)\b/, 'lejos_de_cauce'],
  [/\b(volcan(ico|ica)?|misti|lahares?)\b/, 'sin_peligro_volcanico_alto'],
  [/\b(zonificacion|zona).{0,25}\bcomerci(o|al)\b|\bpermita comercio\b|\buso comercial\b/, 'zona_comercio'],
];

/** Monto en una frase ya normalizada con normalizarFrase: «medio millon», «450 mil», «1.5 millones», «s 450 000», «120000». */
export function leerMonto(t: string): number | null {
  if (/\bmedio millon\b/.test(t)) return 500_000;
  if (/\bun millon y medio\b/.test(t)) return 1_500_000;
  let m = /\b(\d+(?:p\d+)?|un|dos|tres|cuatro|cinco) millon(es)?\b/.exec(t);
  if (m) return Math.round((numero(m[1]) ?? 0) * 1_000_000);
  m = /\b(\d+(?:p\d+)?) ?(mil|k)\b/.exec(t);
  if (m) return Math.round((numero(m[1]) ?? 0) * 1000);
  m = /\b(\d{4,})\b/.exec(t);
  return m ? Number(m[1]) : null;
}

export function leerMoneda(crudo: string): Moneda | null {
  const t = crudo.toLowerCase();
  if (/us\$|u\$s|\busd\b|d[oó]lar(es)?|\$\s?\d/.test(t) && !/s\/\s?\d/.test(t)) return 'USD';
  if (/s\/|\bsoles?\b|\bpen\b/.test(t)) return 'PEN';
  return null;
}

/** Distancia en metros dicha en un fragmento: «a menos de 800 m», «a 2 km», «a 5 cuadras», «a 10 minutos a pie». */
export function leerDistancia(t: string): number | null {
  let m = /\b(\d+(?:p\d+)?|un|una|dos|tres|cuatro|cinco|diez|quince|veinte) ?(km|kilometros?|m|metros?|cuadras?)\b(?! ?(2|cuadrados))/.exec(t);
  if (m) {
    const n = numero(m[1]) ?? 0;
    return Math.round(/^k/.test(m[2]) ? n * 1000 : /^cuadra/.test(m[2]) ? n * METROS_POR_CUADRA : n);
  }
  m = /\b(\d+|cinco|diez|quince|veinte|treinta) ?(min|minutos?) (a pie|caminando|andando)\b/.exec(t);
  return m ? Math.round((numero(m[1]) ?? 0) * METROS_POR_MINUTO_A_PIE) : null;
}

const limpiarLugar = (s: string): string =>
  s
    .replace(/^(el|la|los|las|al|del|de)\s+/i, '')
    .replace(/[\s,.;:!?¿¡]+$/g, '')
    .trim();

/** «trabajo en el Parque Industrial», «llegar a la UNSA», «combi directa al centro». Devuelve el lugar tal como se escribió, o null. */
export function leerLugarDeTrabajo(crudo: string): string | null {
  const patrones = [
    /\b(?:mi\s+)?trabaj[oa]\s+(?:queda|est[aá]|es)\s+(?:en|por|cerca\s+de)\s+(?:el\s+|la\s+|los\s+|las\s+)?([^,.;?!]+)/i,
    /\btrabajo\s+(?:en|por)\s+(?:el\s+|la\s+|los\s+|las\s+)?([^,.;?!]+)/i,
    /\b(?:llegar|ir|viajar|moverme)\s+(?:r[aá]pido\s+)?(?:a|al|hasta)\s+(?:el\s+|la\s+|los\s+|las\s+)?([^,.;?!]+)/i,
    /\b(?:combi|bus|ruta|transporte)\s+(?:directa?\s+)?(?:a|al|hasta|hacia)\s+(?:el\s+|la\s+|los\s+|las\s+)?([^,.;?!]+)/i,
  ];
  for (const p of patrones) {
    const m = p.exec(crudo);
    if (!m) continue;
    const lugar = limpiarLugar(m[1].replace(/\s+(sin\s+trasbordo|y\s+que|que\s+no|con\s+|cerca\s+de\s+).*$/i, ''));
    if (lugar.length >= 3 && !/^(mi|un|una)\b/i.test(lugar)) return lugar;
  }
  return null;
}

/**
 * Interpreta una frase. `ctx.distritos`: nombres de los distritos (como en el archivo de límites). `ctx.previa`: la consulta que se está
 * completando; `ctx.pendiente`: lo que se le preguntó a la persona en el turno anterior (su respuesta llena ese campo).
 */
export function interpretar(crudo: string, ctx: { distritos?: string[]; previa?: Consulta | null; pendiente?: 'tipo' | 'trabajo' | 'moneda' | null } = {}): Consulta {
  const t = normalizarFrase(crudo);
  const previa = ctx.previa ?? null;

  // Respuesta a una pregunta de aclaración: llena el campo pendiente de la consulta anterior.
  if (previa && ctx.pendiente) {
    const c: Consulta = { ...previa, criterios: [...previa.criterios] };
    if (ctx.pendiente === 'moneda') {
      const moneda = leerMoneda(crudo) ?? (/\b(soles?|sol)\b/.test(t) ? 'PEN' : /\bdolares?\b/.test(t) ? 'USD' : null);
      if (moneda) return { ...c, moneda };
    }
    if (ctx.pendiente === 'tipo') {
      const tipo = TIPOS.find(([p]) => p.test(t));
      if (tipo) return { ...c, tipo: tipo[1] };
    }
    if (ctx.pendiente === 'trabajo') {
      const lugar = leerLugarDeTrabajo(crudo) ?? limpiarLugar(crudo.replace(/^\s*(queda|est[aá]|es|trabajo)?\s*(en|por|cerca de)?\s*/i, ''));
      if (lugar.length >= 3 && lugar.split(/\s+/).length <= 8) return { ...c, trabajoLugar: lugar };
    }
  }

  const c: Consulta = { ...CONSULTA_VACIA, criterios: [], noDisponible: [], avisos: [] };
  if (!t) return c;

  for (const [patron, tipo, nota] of TIPOS) {
    if (!patron.test(t)) continue;
    c.tipo = tipo;
    if (nota) c.noDisponible.push(nota);
    break;
  }

  // Precio: solo si hay una palabra de precio cerca, para no tomar «200 m2» por un monto.
  const frasePrecio = /\b(?:no cueste mas de|no pase de|no mas de|cueste menos de|menos de|hasta|maximo(?: de)?|presupuesto(?: de)?|tope(?: de)?|por debajo de|que cueste|precio(?: de)?)\s+((?:s |us |usd |\$ ?)?[a-z0-9 .,]{2,30})/.exec(t);
  const candidatos = [frasePrecio?.[1], /\b(?:s |us |usd )\d[\dp]*(?: ?mil| millon(?:es)?)?/.exec(t)?.[0], /\b\d[\dp]*(?: ?mil| millon(?:es)?)? ?(?:soles|dolares)\b/.exec(t)?.[0], /\bmedio millon\b/.exec(t)?.[0], /\b\d[\dp]* millon(?:es)?\b/.exec(t)?.[0]];
  for (const cand of candidatos) {
    const monto = cand ? leerMonto(cand) : null;
    if (monto && monto >= 5000) {
      c.precioMax = monto;
      break;
    }
  }
  if (c.precioMax !== null) c.moneda = leerMoneda(crudo);

  const dorm = /\b(\d+|un|una|dos|tres|cuatro|cinco) (dormitorios?|habitaciones|cuartos|dorm)\b/.exec(t);
  if (dorm) c.dormitoriosMin = numero(dorm[1]);
  const area = /\b(?:mas de|minimo(?: de)?|al menos|desde|de) (\d{2,6}) ?(?:m2|m 2|metros cuadrados|metros)\b/.exec(t) ?? /\b(\d{2,6}) ?(?:m2|m 2|metros cuadrados)\b/.exec(t);
  if (area) c.areaMinM2 = Number(area[1]);

  const distrito = (ctx.distritos ?? []).map((d) => ({ d, n: normalizar(d) })).sort((a, b) => b.n.length - a.n.length).find(({ n }) => new RegExp(`\\b(en|de|por|distrito de|distrito) ${n}\\b`).test(t));
  if (distrito) c.distrito = distrito.d;

  // Criterios: cada uno toma la distancia que se diga en su mismo tramo de la frase (entre comas o «y»).
  const tramos = crudo.split(/[;]|,(?!\d)|\s+y\s+que\s+|\s+pero\s+/i).map(normalizarFrase).filter(Boolean);
  const agregar = (id: IdCriterio, extra: Partial<CriterioPedido> = {}) => {
    if (!c.criterios.some((x) => x.id === id)) c.criterios.push({ id, ...extra });
  };
  for (const [patron, id] of CRITERIOS_TEXTO) {
    if (!patron.test(t)) continue;
    if (id === 'paradero' && !/\bparaderos?\b/.test(t)) continue;
    if (id === 'lejos_de_cauce' && !/\b(lejos|fuera|sin|no|lejos de)\b/.test(t)) continue;
    const tramo = tramos.find((x) => patron.test(x)) ?? t;
    const metros = leerDistancia(tramo);
    agregar(id, metros !== null && id !== 'agua' && id !== 'luz' && id !== 'desague' ? { metros } : {});
  }

  c.trabajoLugar = leerLugarDeTrabajo(crudo);
  c.sinTrasbordo = /\b(sin trasbordos?|sin transbordos?|directa|directo|sin cambiar de)\b/.test(t) && /\b(combi|bus|ruta|transporte|trasbordo|transbordo)\b/.test(t);
  if (/\b(mi|del|al|el) (trabajo|oficina|chamba|centro de labores)\b|\bdonde trabajo\b/.test(t) || c.trabajoLugar) {
    const min = /\b(\d+|quince|veinte|treinta) ?(min|minutos?)\b(?! (a pie|caminando))/.exec(t);
    agregar('trabajo', min ? { maxMin: numero(min[1]) ?? undefined } : {});
  }

  for (const [patron, nota] of [[/\b(primer piso|planta baja)\b/, 'el piso del departamento'], [/\bascensor\b/, 'si el edificio tiene ascensor'], [/\b(cochera|estacionamiento)\b/, null], [/\b(amoblado|amoblada)\b/, 'si está amoblado'], [/\b(estreno|nuevo)\b/, 'si es de estreno'], [/\b(seguro|seguridad|tranquilo)\b/, 'la seguridad de la zona']] as [RegExp, string | null][]) {
    if (nota && patron.test(t)) c.noDisponible.push(nota);
  }

  const ids = [...t.matchAll(/\baviso(?:s)? (?:numero |n |#)?(\d+)(?: y (?:el )?(?:aviso )?(?:numero |n |#)?(\d+))?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean).map(Number);
  c.avisos = [...new Set(ids)];

  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|gracias|ayuda|que puedes hacer)\b/.test(t) && !c.tipo && !c.criterios.length) c.intencion = 'saludo';
  else if (/\b(cual|que aviso|compar[ae]|entre estos|entre los dos|mejor para llegar)\b/.test(t) && (c.avisos.length >= 2 || /\b(estos dos|los dos|ambos)\b/.test(t))) c.intencion = 'comparar';
  else if (/\b(de donde sale|que fuente|fuente de|de que fecha|que tan actual|licencia|de donde sacas|como sabes)\b/.test(t)) {
    c.intencion = 'fuente';
    c.tema = c.criterios[0]?.id ?? (/\bprecio|aviso/.test(t) ? 'avisos' : /\bzonific/.test(t) ? 'zona_comercio' : /\bruta|combi|bus/.test(t) ? 'trabajo' : null);
  } else if (/\b(me ofrecen|que deberia revisar|que debo revisar|que reviso|es seguro comprar|verificar este|revisar este)\b/.test(t)) c.intencion = 'verificar_punto';
  else if (/\b(zonas?|sectores?|barrios?|donde (puedo |me conviene |conviene )?vivir|en que parte)\b/.test(t) && !c.tipo && c.precioMax === null) c.intencion = 'buscar_zonas';
  else if (c.tipo || c.precioMax !== null || c.dormitoriosMin !== null || /\b(avisos?|proyectos?|inmuebles?|propiedad(?:es)?|vivienda|comprar|venta|vendo|vende|busco|quiero|necesito)\b/.test(t)) c.intencion = c.tipo || c.precioMax !== null || c.criterios.length ? 'buscar_avisos' : 'otra';
  else if (c.criterios.length) c.intencion = 'buscar_zonas';
  return c;
}

export type Faltante = 'tipo' | 'trabajo' | 'moneda';

/**
 * Lo primero que falta para poder buscar, o null. Se pregunta UNA sola cosa por turno (tarea 6.3), en este orden: el tipo de inmueble,
 * dónde queda el trabajo, y la moneda del precio.
 */
export function loQueFalta(c: Consulta): Faltante | null {
  if (c.intencion !== 'buscar_avisos') return null;
  if (!c.tipo) return 'tipo';
  if (c.criterios.some((x) => x.id === 'trabajo') && !c.trabajoLugar) return 'trabajo';
  if (c.precioMax !== null && !c.moneda) return 'moneda';
  return null;
}

export const PREGUNTA: Record<Faltante, string> = {
  tipo: '¿Qué tipo de inmueble buscas: departamento, casa, terreno, local u oficina?',
  trabajo: '¿Dónde queda tu trabajo? Dime un lugar conocido o una dirección (por ejemplo, «Parque Industrial» o «cerca de la UNSA»).',
  moneda: '¿El precio máximo es en soles o en dólares?',
};
