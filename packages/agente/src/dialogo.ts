/**
 * dialogo.ts — Cómo se entiende un mensaje dentro de una conversación (sin red ni base de datos).
 *
 * `entender` junta lo que la persona dice ahora con lo que ya se entendió antes, para que nada se pierda:
 *   · corrige erratas claras («aprtamente» → «apartamento») y lista aparte las dudosas, sin elegir por la persona;
 *   · si se había hecho una pregunta, el mensaje la contesta (también «cualquiera», «me da igual», «sin tope»);
 *   · si no, es una búsqueda nueva o un seguimiento («sin el colegio», «¿y en Cayma?», «más barato») que se aplica sobre la consulta anterior.
 * No decide nada que no esté en lo que la persona escribió: un dato que falta se pregunta o se declara, nunca se inventa.
 */
import { z } from 'zod';
import { normalizar } from '@geoverificador/dominio/texto';
import { CONSULTA_VACIA, CRITERIOS_TEXTO, TIPOS, distritoSuelto, interpretar, leerDistrito, leerLugarDeTrabajo, leerMoneda, leerMonto, nombreBonito, normalizarFrase, sinPreferencia, type Consulta, type Faltante } from './consulta.ts';
import { CRITERIOS, type IdCriterio } from './criterios.ts';
import { corregirPalabras, mejorDe, type Cambio, type Duda, type Entrada } from './difuso.ts';

export type Acto = 'busqueda' | 'respuesta' | 'seguimiento' | 'reinicio' | 'saludo' | 'fuente' | 'zonas' | 'punto' | 'comparar' | 'sin_preferencia' | 'ninguno';

/** Cuando un lugar quedó dudoso, las opciones que se le ofrecieron a la persona y a qué dato corresponden. */
export interface Aclaracion {
  campo: 'trabajoLugar' | 'lugarCerca';
  opciones: string[];
}

export interface Entendimiento {
  consulta: Consulta;
  acto: Acto;
  /** Erratas que se corrigieron: lo que se escribió y lo que se entendió. */
  correcciones: Cambio[];
  /** Palabras que podrían ser una errata pero no se pudo decidir cuál. */
  dudas: Duda[];
  /** Qué pregunta pendiente contestó este mensaje. */
  respondio: Faltante | null;
  /** Lo que se quitó o se cambió por un seguimiento: ids de criterios o nombres de campo. */
  cambios: string[];
  /** Había una pregunta pendiente y el mensaje no la contesta. */
  noSirvio: boolean;
  /** «cualquiera», «me da igual», «lo que sea». */
  sinPreferencia: boolean;
  /** Dato que ahora hace falta y la persona no dio (p. ej. «más barato» sin tope previo). */
  necesita: Faltante | null;
}

export interface ContextoEntender {
  distritos: string[];
  previa?: Consulta | null;
  pendiente?: Faltante | null;
  aclaracion?: Aclaracion | null;
}

// ------------------------------------------------------------------ Vocabulario de erratas

const palabras = (valor: string, ...textos: string[]): Entrada<string>[] => textos.map((texto) => ({ texto, valor }));

/** Las palabras largas del dominio que se corrigen si vienen con una errata clara. Las cortas (casa, mall, luz, agua) solo valen exactas. */
const VOCABULARIO: Entrada<string>[] = [
  ...palabras('departamento', 'departamento', 'departamentos', 'apartamento', 'apartamentos', 'minidepartamento'),
  ...palabras('terreno', 'terreno', 'terrenos'),
  ...palabras('oficina', 'oficina', 'oficinas'),
  ...palabras('universidad', 'universidad', 'universidades'),
  ...palabras('colegio', 'colegio', 'colegios'),
  ...palabras('salud', 'hospital', 'hospitales', 'clinica', 'clinicas'),
  ...palabras('paradero', 'paradero', 'paraderos'),
  ...palabras('mercado', 'mercado', 'mercados', 'supermercado', 'supermercados'),
  ...palabras('quebrada', 'quebrada', 'quebradas'),
  ...palabras('luz', 'electricidad'),
  ...palabras('desague', 'alcantarillado'),
  ...palabras('moneda', 'soles', 'dolares'),
  ...palabras('trabajo', 'trabajo'),
  ...palabras('dormitorios', 'dormitorios', 'habitaciones'),
  ...palabras('sinpref', 'cualquiera', 'indistinto', 'indiferente'),
];

/** Palabras corrientes que se parecen a una del vocabulario pero son otra cosa. */
const PROTEGIDAS = new Set(['oficial', 'oficiales', 'comercial', 'comerciales', 'terrenal', 'apartado', 'apartados', 'departamental', 'colegial', 'hospitalario', 'universitario', 'universitaria', 'mercadeo', 'trabajos', 'trabajar']);

// ------------------------------------------------------------------ Piezas de lectura

const REINICIO = /\b(?:(?:empez\w+|comenz\w+|reinici\w+) (?:de nuevo|desde cero|otra vez|todo)|nueva busqueda|otra busqueda|borr\w+ todo|olvid\w+ todo|desde cero|volver a empezar|reiniciar|reinicia)\b/;
const SIN_TOPE = /\b(sin tope|sin limite|sin maximo|sin precio|sin presupuesto|no tengo tope|no tengo limite|no hay tope|no importa el precio|quitar el precio|sin restriccion de precio)\b/;
const NO_TRABAJO = /\b(no tengo trabajo|no trabajo|sin trabajo|ningun(?:o|a)?|prefiero no|no (?:quiero|necesito) (?:medir|decir)|mejor sin|trabajo desde casa|no aplica|olvidalo|omitir|saltar|no se)\b/;
const BARATO = /\b(mas barat[oa]s?|mas economic[oa]s?|menos caro|mas accesible|que cueste menos|baj\w+ el (?:precio|tope|presupuesto)|precio mas bajo|menor precio|presupuesto mas bajo)\b/;
const CARO = /\b(mas car[oa]s?|sub\w+ el (?:precio|tope|presupuesto)|precio mas alto|mayor precio|presupuesto mas alto|mas presupuesto)\b/;
const CUALQUIER_DISTRITO = /\b(?:en )?(?:cualquier|cualquiera|todos los|todo|sin)\s+(?:el\s+)?(?:distritos?|lado|zona)\b/;
const OTRO_DISTRITO = /\botro distrito\b/;

const CAMPOS = ['tipo', 'distrito', 'precio', 'dormitorios', 'area', 'trabajo', 'lugar'] as const;
export type Campo = (typeof CAMPOS)[number];

const QUITAR = /\b(?:sin|quit\w+|elimin\w+|sac\w+|borr\w+|olvid\w+|ya no (?:quiero |necesito |me importa )?|no (?:me )?importa(?:n)?)\s+(?:(?:el|la|los|las|lo)\s+)?(?:(?:tope|limite|maximo|presupuesto) de\s+)?([a-z ]{3,30}?)(?=\s+(?:y|e|pero|con|en|hasta|que)\b|\s*[,.;?!]|\s*$)/gi;

function objetivoDeQuitar(x: string): { criterio?: IdCriterio; campo?: Campo } | null {
  const n = normalizar(x);
  if (/\b(trasbordos?|transbordos?)\b/.test(n)) return null;
  for (const [patron, id] of CRITERIOS_TEXTO) if (patron.test(n)) return { criterio: id };
  if (/\b(precio|tope|presupuesto|monto|costo)\b/.test(n)) return { campo: 'precio' };
  if (/\b(distrito|zona)\b/.test(n)) return { campo: 'distrito' };
  if (/\b(trabajo|chamba)\b/.test(n)) return { campo: 'trabajo' };
  if (/\b(dormitorios?|habitaciones|cuartos)\b/.test(n)) return { campo: 'dormitorios' };
  if (/\b(area|metros|tamano)\b/.test(n)) return { campo: 'area' };
  if (/\b(tipo)\b/.test(n)) return { campo: 'tipo' };
  if (/\b(lugar|unsa|plaza)\b/.test(n)) return { campo: 'lugar' };
  return null;
}

/** «sin el colegio», «quita el tope de precio»: lo que la persona pide quitar. Devuelve el texto sin esas frases para no volver a leerlas como pedidos. */
function leerQuitar(sinAcentos: string): { texto: string; criterios: IdCriterio[]; campos: Campo[] } {
  const criterios: IdCriterio[] = [];
  const campos: Campo[] = [];
  const texto = sinAcentos.replace(QUITAR, (frase, x: string) => {
    const o = objetivoDeQuitar(x);
    if (!o) return frase;
    if (o.criterio) criterios.push(o.criterio);
    if (o.campo) campos.push(o.campo);
    return ' ';
  });
  return { texto, criterios, campos };
}

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const redondear5000 = (n: number): number => Math.max(5000, Math.round(n / 5000) * 5000);

const hayDatos = (c: Consulta): boolean =>
  Boolean(c.tipo) || c.tipoCualquiera || c.precioMax !== null || Boolean(c.distrito) || c.dormitoriosMin !== null || c.areaMinM2 !== null || c.criterios.length > 0 || Boolean(c.trabajoLugar) || Boolean(c.lugarCerca);

const copiar = (c: Consulta): Consulta => ({ ...c, criterios: c.criterios.map((x) => ({ ...x })), noDisponible: [...c.noDisponible], avisos: [...c.avisos], posiciones: [...c.posiciones] });

function quitarCampo(c: Consulta, campo: Campo): void {
  if (campo === 'precio') {
    c.precioMax = null;
    c.moneda = null;
  }
  else if (campo === 'distrito') c.distrito = null;
  else if (campo === 'dormitorios') c.dormitoriosMin = null;
  else if (campo === 'area') c.areaMinM2 = null;
  else if (campo === 'tipo') {
    c.tipo = null;
    c.tipoCualquiera = true;
  }
  else if (campo === 'trabajo') {
    c.trabajoLugar = null;
    c.criterios = c.criterios.filter((x) => x.id !== 'trabajo');
    c.sinTrasbordo = false;
  }
  else if (campo === 'lugar') {
    c.lugarCerca = null;
    c.criterios = c.criterios.filter((x) => x.id !== 'lugar');
  }
}

/** Suma lo nuevo a lo anterior: lo que se dice ahora gana; lo demás se conserva. */
export function combinar(previa: Consulta, nueva: Consulta): Consulta {
  const c = copiar(previa);
  c.intencion = 'buscar_avisos';
  c.posiciones = [];
  if (nueva.tipo) {
    c.tipo = nueva.tipo;
    c.tipoCualquiera = false;
  }
  if (nueva.tipoCualquiera) {
    c.tipo = null;
    c.tipoCualquiera = true;
  }
  if (nueva.precioMax !== null) {
    c.precioMax = nueva.precioMax;
    c.moneda = nueva.moneda ?? previa.moneda;
  }
  else if (nueva.moneda && c.precioMax !== null) c.moneda = nueva.moneda;
  if (nueva.distrito) c.distrito = nueva.distrito;
  if (nueva.dormitoriosMin !== null) c.dormitoriosMin = nueva.dormitoriosMin;
  if (nueva.areaMinM2 !== null) c.areaMinM2 = nueva.areaMinM2;
  if (nueva.trabajoLugar) c.trabajoLugar = nueva.trabajoLugar;
  if (nueva.lugarCerca) c.lugarCerca = nueva.lugarCerca;
  if (nueva.sinTrasbordo) c.sinTrasbordo = true;
  for (const cr of nueva.criterios) {
    const i = c.criterios.findIndex((x) => x.id === cr.id);
    if (i >= 0) c.criterios[i] = { ...c.criterios[i], ...cr };
    else c.criterios.push({ ...cr });
  }
  for (const n of nueva.noDisponible) if (!c.noDisponible.includes(n)) c.noDisponible.push(n);
  return c;
}

const vacia = (): Consulta => ({ ...CONSULTA_VACIA, criterios: [], noDisponible: [], avisos: [], posiciones: [] });

// ------------------------------------------------------------------ Entender un mensaje

export function entender(crudo: string, ctx: ContextoEntender): Entendimiento {
  const previa = ctx.previa ?? null;
  const avisos = previa && previa.intencion === 'buscar_avisos' ? previa : null;
  const { texto: corregido, cambios: correcciones, dudas } = corregirPalabras(crudo, VOCABULARIO, { protegidas: PROTEGIDAS });
  const salida = (acto: Acto, consulta: Consulta | null, extra: Partial<Entendimiento> = {}): Entendimiento => ({
    consulta: consulta ?? avisos ?? vacia(), acto, correcciones, dudas, respondio: null, cambios: [], noSirvio: false, sinPreferencia: false, necesita: null, ...extra,
  });
  const t = normalizarFrase(corregido);
  if (!t) return salida('ninguno', null);

  if (REINICIO.test(t)) return salida('reinicio', vacia());

  if (avisos && ctx.pendiente) {
    const r = responderPendiente(ctx, avisos, corregido, t, salida, correcciones);
    if (r) return r;
  }

  const sinAcentos = sinTildes(corregido);
  const quitar = avisos ? leerQuitar(sinAcentos) : { texto: sinAcentos, criterios: [], campos: [] as Campo[] };
  // Con una frase de «quitar» se lee el texto sin esa frase (y sin tildes); si no, el original, para no perder las tildes de los nombres de lugares.
  const textoALeer = quitar.texto === sinAcentos ? corregido : quitar.texto;
  const nueva = interpretar(textoALeer, { distritos: ctx.distritos });
  const distrito = leerDistrito(normalizarFrase(textoALeer), ctx.distritos);
  if (distrito?.dicho) correcciones.push({ dicho: distrito.dicho, entendido: nombreBonito(distrito.d) });

  // Intenciones que no tocan la búsqueda guardada.
  if (nueva.intencion === 'saludo') return salida('saludo', nueva);
  if (nueva.intencion === 'fuente') return salida('fuente', nueva);
  if (nueva.intencion === 'verificar_punto') return salida('punto', nueva);
  if (nueva.intencion === 'comparar') return salida('comparar', nueva);
  if (nueva.intencion === 'buscar_zonas' && /\b(zonas?|sectores?|barrios?|donde (puedo |me conviene |conviene )?vivir|en que parte)\b/.test(t)) return salida('zonas', nueva);

  if (avisos) {
    const t0 = normalizarFrase(quitar.texto);
    const suelto = !nueva.distrito ? distritoSuelto(t0, ctx.distritos) : null;
    if (suelto?.dicho) correcciones.push({ dicho: suelto.dicho, entendido: nombreBonito(suelto.d) });
    if (suelto) nueva.distrito = suelto.d;
    const campos = new Set<Campo>(quitar.campos);
    let necesita: Faltante | null = null;
    if (CUALQUIER_DISTRITO.test(t0)) campos.add('distrito');
    if (OTRO_DISTRITO.test(t0)) {
      campos.add('distrito');
      necesita = 'distrito';
    }
    const factor = BARATO.test(t0) ? 0.8 : CARO.test(t0) ? 1.25 : null;
    const sinCambios = !hayDatos(nueva) && quitar.criterios.length === 0 && campos.size === 0 && factor === null;
    if (sinCambios) {
      if (sinPreferencia(t0) && !/\b(no se|ni idea)\b/.test(t0)) return salida('sin_preferencia', avisos, { sinPreferencia: true });
      return salida('ninguno', avisos);
    }
    // Una frase que se basta sola (tipo más otro dato: «una casa en Cayma hasta 700 mil») es una búsqueda nueva y reemplaza la anterior;
    // lo corto («mejor una casa», «¿y en Cayma?», «hasta 350 mil», «sin el colegio») se suma a lo ya entendido.
    const seBasta = nueva.intencion === 'buscar_avisos' && Boolean(nueva.tipo) && (Boolean(nueva.distrito) || nueva.precioMax !== null || nueva.criterios.length > 0 || nueva.dormitoriosMin !== null || nueva.areaMinM2 !== null || Boolean(nueva.trabajoLugar) || Boolean(nueva.lugarCerca));
    if (seBasta && quitar.criterios.length === 0 && campos.size === 0 && factor === null) return salida('busqueda', nueva);
    const c = combinar(avisos, nueva);
    const cambios: string[] = [];
    for (const id of quitar.criterios) {
      if (!c.criterios.some((x) => x.id === id)) continue;
      c.criterios = c.criterios.filter((x) => x.id !== id);
      cambios.push(id);
    }
    for (const campo of campos) {
      quitarCampo(c, campo);
      cambios.push(campo);
    }
    if (factor !== null) {
      if (c.precioMax === null) necesita = 'precio';
      else {
        c.precioMax = redondear5000(c.precioMax * factor);
        cambios.push('precio');
      }
    }
    return salida('seguimiento', c, { cambios, necesita });
  }

  // Sin búsqueda previa.
  if (nueva.intencion === 'buscar_avisos') return salida('busqueda', nueva);
  if (nueva.intencion === 'buscar_zonas') return salida('zonas', nueva);
  const suelto = !nueva.distrito ? distritoSuelto(t, ctx.distritos) : null;
  if (suelto) {
    nueva.distrito = suelto.d;
    if (suelto.dicho) correcciones.push({ dicho: suelto.dicho, entendido: nombreBonito(suelto.d) });
  }
  if (hayDatos(nueva)) return salida('busqueda', { ...nueva, intencion: 'buscar_avisos' });
  if (sinPreferencia(t) && !/\b(no se|ni idea)\b/.test(t)) return salida('sin_preferencia', null, { sinPreferencia: true });
  return salida('ninguno', nueva.intencion === 'otra' ? null : nueva);
}

// ------------------------------------------------------------------ Contestar una pregunta pendiente

type Salida = (acto: Acto, consulta: Consulta | null, extra?: Partial<Entendimiento>) => Entendimiento;

const VOCABULARIO_TIPO: Entrada<NonNullable<Consulta['tipo']>>[] = [
  ...(['departamento', 'departamentos', 'apartamento', 'apartamentos', 'depa', 'depas', 'dpto', 'depto'] as const).map((texto) => ({ texto, valor: 'departamento' as const })),
  ...(['casa', 'casas', 'chalet'] as const).map((texto) => ({ texto, valor: 'casa' as const })),
  ...(['terreno', 'terrenos', 'lote', 'lotes'] as const).map((texto) => ({ texto, valor: 'terreno' as const })),
  ...(['local', 'locales', 'tienda'] as const).map((texto) => ({ texto, valor: 'local' as const })),
  ...(['oficina', 'oficinas'] as const).map((texto) => ({ texto, valor: 'oficina' as const })),
];

/** El tipo de inmueble de una respuesta corta: exacto, o con una errata aunque la palabra sea corta. */
export function leerTipoDeRespuesta(t: string): { tipo: NonNullable<Consulta['tipo']>; dicho: string | null; entendido: string } | null {
  for (const [patron, tipo] of TIPOS) if (tipo && patron.test(t)) return { tipo, dicho: null, entendido: tipo };
  for (const token of t.split(' ')) {
    const m = mejorDe(token, VOCABULARIO_TIPO, { tolerante: true });
    if (m && m.clara) return { tipo: m.valor, dicho: token, entendido: m.texto };
  }
  return null;
}

const MONEDAS: Entrada<'PEN' | 'USD'>[] = [
  ...(['soles', 'sol', 'pen', 'nuevos soles'] as const).map((texto) => ({ texto, valor: 'PEN' as const })),
  ...(['dolares', 'dolar', 'usd'] as const).map((texto) => ({ texto, valor: 'USD' as const })),
];

function responderPendiente(ctx: ContextoEntender, previa: Consulta, c1: string, t: string, salida: Salida, correcciones: Cambio[]): Entendimiento | null {
  const pendiente = ctx.pendiente!;
  const nueva = interpretar(sinTildes(c1), { distritos: ctx.distritos });
  const pref = sinPreferencia(t) && t.split(' ').length <= 6;
  const sinPregunta = (extra: Partial<Entendimiento> = {}) => salida('respuesta', previa, { noSirvio: true, sinPreferencia: pref, ...extra });
  const respondida = (c: Consulta, extra: Partial<Entendimiento> = {}) => salida('respuesta', c, { respondio: pendiente, sinPreferencia: pref, ...extra });
  const trae = hayDatos(nueva) && nueva.intencion === 'buscar_avisos';

  switch (pendiente) {
    case 'tipo': {
      const leido = leerTipoDeRespuesta(t);
      if (leido) {
        if (leido.dicho) correcciones.push({ dicho: leido.dicho, entendido: leido.entendido });
        return respondida(combinar(previa, { ...nueva, tipo: leido.tipo }));
      }
      if (pref) return respondida(combinar(previa, { ...vacia(), tipoCualquiera: true }));
      if (trae) return null;
      return sinPregunta();
    }
    case 'moneda': {
      if (SIN_TOPE.test(t)) return respondida({ ...copiar(previa), precioMax: null, moneda: null });
      const moneda = leerMoneda(c1) ?? t.split(' ').map((x) => mejorDe(x, MONEDAS, { tolerante: true })).find((m) => m?.clara)?.valor ?? null;
      if (moneda) return respondida({ ...combinar(previa, nueva), moneda });
      if (trae && nueva.precioMax !== null) return null;
      return sinPregunta();
    }
    case 'precio': {
      if (SIN_TOPE.test(t) || pref) return respondida({ ...copiar(previa), precioMax: null, moneda: null });
      const monto = nueva.precioMax ?? leerMonto(t);
      if (monto !== null && monto >= 5000) {
        const moneda = nueva.moneda ?? leerMoneda(c1) ?? previa.moneda;
        return respondida({ ...combinar(previa, nueva), precioMax: monto, moneda });
      }
      return trae ? null : sinPregunta();
    }
    case 'trabajo': {
      if (trae && nueva.tipo && nueva.trabajoLugar === null && !NO_TRABAJO.test(t)) return null;
      if (NO_TRABAJO.test(t) || pref) {
        const c = copiar(previa);
        quitarCampo(c, 'trabajo');
        return respondida(c, { cambios: ['trabajo'] });
      }
      const lugar = leerLugarDeTrabajo(c1) ?? c1.replace(/^\s*(queda|est[aá]|es|trabajo)?\s*(en|por|cerca de)?\s*/i, '').replace(/[\s,.;:!?¿¡]+$/g, '').trim();
      if (lugar.length >= 2 && lugar.split(/\s+/).length <= 8) return respondida({ ...combinar(previa, nueva), trabajoLugar: lugar });
      return sinPregunta();
    }
    case 'distrito': {
      const suelto = distritoSuelto(t, ctx.distritos) ?? leerDistrito(t, ctx.distritos);
      if (suelto) {
        if (suelto.dicho) correcciones.push({ dicho: suelto.dicho, entendido: nombreBonito(suelto.d) });
        return respondida({ ...combinar(previa, nueva), distrito: suelto.d });
      }
      if (pref || CUALQUIER_DISTRITO.test(t)) return respondida({ ...copiar(previa), distrito: null });
      return trae ? null : sinPregunta();
    }
    case 'lugar':
    case 'aclarar': {
      const aclaracion = ctx.aclaracion ?? null;
      const campo = aclaracion?.campo ?? 'lugarCerca';
      const elegido = aclaracion?.opciones.find((o) => normalizar(o) === t || (t.length >= 3 && normalizar(o).includes(t)));
      const quitar = pref || NO_TRABAJO.test(t);
      if (quitar) {
        const c = copiar(previa);
        quitarCampo(c, campo === 'trabajoLugar' ? 'trabajo' : 'lugar');
        return respondida(c, { cambios: [campo === 'trabajoLugar' ? 'trabajo' : 'lugar'] });
      }
      if (trae && !elegido) return null;
      const texto = elegido ?? c1.replace(/^\s*(en|por|cerca (?:de|a)|queda)?\s*/i, '').replace(/[\s,.;:!?¿¡]+$/g, '').trim();
      if (texto.length >= 2 && texto.split(/\s+/).length <= 8) {
        const c = copiar(previa);
        if (campo === 'trabajoLugar') c.trabajoLugar = texto;
        else {
          c.lugarCerca = texto;
          if (!c.criterios.some((x) => x.id === 'lugar')) c.criterios.push({ id: 'lugar' });
        }
        return respondida(c);
      }
      return sinPregunta();
    }
  }
}

// ------------------------------------------------------------------ Ajustes estructurados (los chips y botones de la interfaz)

const idCriterio = z.enum(Object.keys(CRITERIOS) as [IdCriterio, ...IdCriterio[]]);
const tipoInmueble = z.enum(['departamento', 'casa', 'terreno', 'local', 'oficina']);

/** Lo que la interfaz le pide al asistente sin escribir: quitar o cambiar una parte de lo entendido, o empezar de nuevo. */
export const ESQUEMA_AJUSTE = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('quitar'), campo: z.enum(CAMPOS) }),
  z.object({ accion: z.literal('quitar_criterio'), id: idCriterio }),
  z.object({ accion: z.literal('poner_tipo'), valor: z.union([tipoInmueble, z.literal('cualquiera')]) }),
  z.object({ accion: z.literal('poner_distrito'), valor: z.string().min(2).max(60) }),
  z.object({ accion: z.literal('poner_precio'), valor: z.number().positive().max(100_000_000), moneda: z.enum(['PEN', 'USD']) }),
  z.object({ accion: z.literal('poner_criterio'), id: idCriterio, metros: z.number().positive().max(50_000).optional() }),
  z.object({ accion: z.literal('nueva') }),
  /** Quita tipo, distrito, precio, dormitorios y área, y conserva los criterios de cercanía. */
  z.object({ accion: z.literal('sin_filtros') }),
  z.object({ accion: z.literal('punto') }),
  /** Hace una de las preguntas pendientes («poner un tope de precio»): el asistente pregunta y espera la respuesta. */
  z.object({ accion: z.literal('preguntar'), campo: z.enum(['precio', 'distrito', 'tipo', 'trabajo', 'lugar']) }),
]);
export type Ajuste = z.infer<typeof ESQUEMA_AJUSTE>;

/** Aplica un ajuste sobre la consulta. null si el ajuste no tiene sentido (p. ej. un distrito que no existe). */
export function aplicarAjuste(previa: Consulta | null, a: Ajuste, distritos: string[]): Consulta | null {
  if (a.accion === 'nueva') return vacia();
  if (a.accion === 'punto' || a.accion === 'preguntar') return previa;
  const c = copiar(previa && previa.intencion === 'buscar_avisos' ? previa : { ...vacia(), intencion: 'buscar_avisos' });
  c.intencion = 'buscar_avisos';
  switch (a.accion) {
    case 'quitar':
      quitarCampo(c, a.campo);
      return c;
    case 'sin_filtros':
      for (const campo of ['tipo', 'distrito', 'precio', 'dormitorios', 'area'] as const) quitarCampo(c, campo);
      return c;
    case 'quitar_criterio':
      c.criterios = c.criterios.filter((x) => x.id !== a.id);
      return c;
    case 'poner_tipo':
      c.tipo = a.valor === 'cualquiera' ? null : a.valor;
      c.tipoCualquiera = a.valor === 'cualquiera';
      return c;
    case 'poner_distrito': {
      const d = distritos.find((x) => normalizar(x) === normalizar(a.valor));
      if (!d) return null;
      c.distrito = d;
      return c;
    }
    case 'poner_precio':
      c.precioMax = a.valor;
      c.moneda = a.moneda;
      return c;
    case 'poner_criterio': {
      const i = c.criterios.findIndex((x) => x.id === a.id);
      const nuevo = a.metros !== undefined ? { id: a.id, metros: a.metros } : { id: a.id };
      if (i >= 0) c.criterios[i] = nuevo;
      else c.criterios.push(nuevo);
      return c;
    }
  }
}
