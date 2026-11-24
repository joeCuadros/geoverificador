/**
 * presentacion.ts — Lo que la interfaz muestra además del texto: lo que se entendió (para verlo y corregirlo), las respuestas rápidas y la ayuda.
 *
 * Todo sale de datos estructurados (la consulta, las salidas de las herramientas): la interfaz no interpreta texto. Cada sugerencia lleva el mensaje que se
 * enviaría o un `ajuste` que el servidor aplica sobre lo ya entendido.
 */
import CONFIG from '@geoverificador/dominio/nucleo/config';
import type { Consulta, Faltante } from './consulta.ts';
import { nombreBonito } from './consulta.ts';
import { CRITERIOS, dist, type IdCriterio } from './criterios.ts';
import type { Ajuste, Aclaracion } from './dialogo.ts';
import type { Salida } from './herramientas.ts';
import { dolares, soles } from './redactar.ts';

export interface Sugerencia {
  /** Lo que dice el botón (y lo que se muestra como mensaje de la persona al tocarlo). */
  texto: string;
  /** Lo que se envía si no es un ajuste; por omisión, el mismo texto. */
  mensaje?: string;
  ajuste?: Ajuste;
  rol: 'respuesta' | 'siguiente' | 'alivio' | 'ejemplo' | 'punto';
}

export interface Chip {
  clave: string;
  etiqueta: string;
  valor: string;
  detalle: string | null;
  /** El valor viene de corregir lo que se escribió: se marca para que la persona lo confirme. */
  corregido: boolean;
  /** Quita este dato de la búsqueda (y la repite). null si no hay nada que quitar. */
  quitar: Ajuste | null;
  /** Otras opciones para este dato. */
  cambiar: Sugerencia[];
}

export type Cobertura = Salida<'cobertura_avisos'>;

const TIPOS = ['departamento', 'casa', 'terreno', 'local', 'oficina'] as const;
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dinero = (n: number, moneda: string | null) => (moneda === 'USD' ? dolares(n) : soles(n));

/** Cómo se dice lo pedido de un criterio, con su distancia. */
function valorDeCriterio(id: IdCriterio, p: { metros?: number; minPct?: number; maxMin?: number }): { valor: string; detalle: string | null } {
  const def = CRITERIOS[id];
  const referencia = p.metros === undefined && p.minPct === undefined && p.maxMin === undefined;
  const nota = referencia && def.convencion ? 'distancia de referencia del asistente' : null;
  if (def.clase === 'cerca') return { valor: `a ${dist(p.metros ?? def.omision)} o menos`, detalle: nota };
  if (def.clase === 'servicio') return { valor: `${p.minPct ?? def.omision} % o más de la manzana`, detalle: nota };
  if (def.clase === 'viaje') return { valor: `hasta ${p.maxMin ?? def.omision} min`, detalle: nota };
  if (id === 'lejos_de_cauce') return { valor: `a más de ${dist(p.metros ?? def.omision)}`, detalle: nota };
  return { valor: 'sí', detalle: null };
}

/** El resumen de lo entendido como botones: cada uno se puede quitar o cambiar y la búsqueda se repite. */
export function entendidoDe(c: Consulta, o: { distritosConAvisos: string[]; corregidos?: { tipo?: boolean; distrito?: boolean; trabajo?: boolean; lugar?: boolean } }): Chip[] {
  const corregidos = o.corregidos ?? {};
  const chips: Chip[] = [];
  const tipos = (actual: string | null): Sugerencia[] => [
    ...TIPOS.filter((t) => t !== actual).map((t): Sugerencia => ({ texto: capitalizar(t), ajuste: { accion: 'poner_tipo', valor: t }, rol: 'respuesta' })),
    ...(c.tipoCualquiera ? [] : [{ texto: 'Cualquier tipo', ajuste: { accion: 'poner_tipo', valor: 'cualquiera' } as Ajuste, rol: 'respuesta' as const }]),
  ];
  if (c.tipo) chips.push({ clave: 'tipo', etiqueta: 'Tipo', valor: capitalizar(c.tipo), detalle: null, corregido: Boolean(corregidos.tipo), quitar: { accion: 'quitar', campo: 'tipo' }, cambiar: tipos(c.tipo) });
  else if (c.tipoCualquiera) chips.push({ clave: 'tipo', etiqueta: 'Tipo', valor: 'Cualquier tipo', detalle: null, corregido: false, quitar: null, cambiar: tipos(null) });

  if (c.distrito) {
    const otros = o.distritosConAvisos.filter((d) => d !== c.distrito).slice(0, 5);
    chips.push({
      clave: 'distrito', etiqueta: 'Distrito', valor: nombreBonito(c.distrito), detalle: null, corregido: Boolean(corregidos.distrito), quitar: { accion: 'quitar', campo: 'distrito' },
      cambiar: otros.map((d): Sugerencia => ({ texto: nombreBonito(d), ajuste: { accion: 'poner_distrito', valor: d }, rol: 'respuesta' })),
    });
  }
  if (c.precioMax !== null) {
    chips.push({
      clave: 'precio', etiqueta: 'Precio máximo', valor: dinero(c.precioMax, c.moneda), detalle: c.moneda ? null : 'falta la moneda', corregido: false, quitar: { accion: 'quitar', campo: 'precio' },
      cambiar: [{ texto: 'Más barato', mensaje: 'más barato', rol: 'respuesta' }, { texto: 'Más caro', mensaje: 'más caro', rol: 'respuesta' }],
    });
  }
  if (c.dormitoriosMin !== null) chips.push({ clave: 'dormitorios', etiqueta: 'Dormitorios', valor: `${c.dormitoriosMin} o más`, detalle: null, corregido: false, quitar: { accion: 'quitar', campo: 'dormitorios' }, cambiar: [] });
  if (c.areaMinM2 !== null) chips.push({ clave: 'area', etiqueta: 'Área', valor: `${c.areaMinM2} m² o más`, detalle: null, corregido: false, quitar: { accion: 'quitar', campo: 'area' }, cambiar: [] });

  for (const cr of c.criterios) {
    if (cr.id === 'trabajo') {
      const max = cr.maxMin ?? CRITERIOS.trabajo.omision;
      chips.push({ clave: 'trabajo', etiqueta: 'Trabajo', valor: c.trabajoLugar ?? 'sin lugar', detalle: `hasta ${max} min en combi o bus`, corregido: Boolean(corregidos.trabajo), quitar: { accion: 'quitar', campo: 'trabajo' }, cambiar: [] });
    } else if (cr.id === 'lugar') {
      chips.push({ clave: 'lugar', etiqueta: 'Cerca de', valor: c.lugarCerca ?? 'sin lugar', detalle: `a ${dist(cr.metros ?? CRITERIOS.lugar.omision)} o menos`, corregido: Boolean(corregidos.lugar), quitar: { accion: 'quitar', campo: 'lugar' }, cambiar: distancias(cr.id, cr.metros ?? CRITERIOS.lugar.omision) });
    } else {
      const { valor, detalle } = valorDeCriterio(cr.id, cr);
      chips.push({ clave: `criterio:${cr.id}`, etiqueta: CRITERIOS[cr.id].etiqueta, valor, detalle, corregido: false, quitar: { accion: 'quitar_criterio', id: cr.id }, cambiar: CRITERIOS[cr.id].clase === 'cerca' ? distancias(cr.id, cr.metros ?? CRITERIOS[cr.id].omision) : [] });
    }
  }
  return chips;
}

const DISTANCIAS = [150, 300, 500, 800, 1500];
function distancias(id: IdCriterio, actual: number): Sugerencia[] {
  return DISTANCIAS.filter((m) => m !== actual).map((m): Sugerencia => ({ texto: `A ${dist(m)}`, ajuste: { accion: 'poner_criterio', id, metros: m }, rol: 'respuesta' }));
}

/** Lo entendido como una frase corta para decirlo en una respuesta («departamento, en Yanahuara, hasta S/ 450 000, con colegio cerca»). */
export function resumenDe(c: Consulta): string {
  const partes: string[] = [];
  if (c.tipo) partes.push(capitalizar(c.tipo));
  else if (c.tipoCualquiera) partes.push('cualquier tipo');
  if (c.distrito) partes.push(`en ${nombreBonito(c.distrito)}`);
  if (c.precioMax !== null) partes.push(`hasta ${dinero(c.precioMax, c.moneda)}`);
  if (c.dormitoriosMin !== null) partes.push(`${c.dormitoriosMin} dormitorios o más`);
  if (c.areaMinM2 !== null) partes.push(`${c.areaMinM2} m² o más`);
  for (const cr of c.criterios) {
    if (cr.id === 'trabajo') partes.push(c.trabajoLugar ? `cerca del trabajo (${c.trabajoLugar})` : 'cerca del trabajo');
    else if (cr.id === 'lugar') partes.push(c.lugarCerca ? `cerca de ${c.lugarCerca}` : 'cerca de un lugar');
    else partes.push(`${CRITERIOS[cr.id].etiqueta.toLowerCase()} (${valorDeCriterio(cr.id, cr).valor})`);
  }
  return partes.join(', ');
}

// ------------------------------------------------------------------ Respuestas rápidas

const respuestaTipo = (): Sugerencia[] => [
  ...TIPOS.map((t): Sugerencia => ({ texto: capitalizar(t), ajuste: { accion: 'poner_tipo', valor: t }, rol: 'respuesta' })),
  { texto: 'Cualquiera', ajuste: { accion: 'poner_tipo', valor: 'cualquiera' }, rol: 'respuesta' },
];

export function sugerenciasDePregunta(f: Faltante, o: { cobertura: Cobertura | null; aclaracion?: Aclaracion | null; consulta?: Consulta | null }): Sugerencia[] {
  switch (f) {
    case 'tipo':
      return respuestaTipo();
    case 'moneda':
      return [
        { texto: 'Soles', mensaje: 'soles', rol: 'respuesta' },
        { texto: 'Dólares', mensaje: 'dólares', rol: 'respuesta' },
        { texto: 'Sin tope de precio', mensaje: 'sin tope', rol: 'respuesta' },
      ];
    case 'precio':
      return [
        { texto: 'Hasta 200 mil soles', mensaje: 'hasta 200 mil soles', rol: 'respuesta' },
        { texto: 'Hasta 400 mil soles', mensaje: 'hasta 400 mil soles', rol: 'respuesta' },
        { texto: 'Hasta 100 mil dólares', mensaje: 'hasta 100 mil dólares', rol: 'respuesta' },
        { texto: 'Sin tope de precio', mensaje: 'sin tope', rol: 'respuesta' },
      ];
    case 'trabajo':
      return [
        ...(CONFIG.destinos as { nombre: string }[]).slice(0, 4).map((d): Sugerencia => ({ texto: d.nombre, mensaje: d.nombre, rol: 'respuesta' })),
        { texto: 'No tengo trabajo fijo', mensaje: 'no tengo trabajo fijo', rol: 'respuesta' },
      ];
    case 'distrito':
      return [
        ...(o.cobertura?.distritos ?? []).slice(0, 6).map((d): Sugerencia => ({ texto: nombreBonito(d.nombre), ajuste: { accion: 'poner_distrito', valor: d.nombre }, rol: 'respuesta' })),
        { texto: 'Cualquier distrito', mensaje: 'en cualquier distrito', rol: 'respuesta' },
      ];
    case 'lugar':
    case 'aclarar':
      return [
        ...(o.aclaracion?.opciones ?? []).map((x): Sugerencia => ({ texto: x, mensaje: x, rol: 'respuesta' })),
        { texto: 'No medir ese lugar', mensaje: 'ninguno', rol: 'respuesta' },
      ];
  }
}

/** Ejemplos para empezar: con distritos que de verdad tienen avisos cuando se sabe cuáles son. */
export function ejemplos(cobertura: Cobertura | null, hayPunto: boolean): Sugerencia[] {
  const distrito = cobertura?.distritos[0] ? nombreBonito(cobertura.distritos[0].nombre) : null;
  const lista = [
    distrito ? `Un departamento en ${distrito} cerca de un colegio` : 'Un departamento cerca de un colegio',
    'Una casa cerca de la UNSA hasta 400 mil soles',
    'Un departamento cerca de mi trabajo en el Parque Industrial',
    'Zonas con salud y colegio cerca',
  ];
  const e: Sugerencia[] = lista.map((texto) => ({ texto, rol: 'ejemplo' as const }));
  if (hayPunto) e.push({ texto: '¿Qué hay en el punto que elegí?', ajuste: { accion: 'punto' }, rol: 'punto' });
  return e;
}

/** Siguientes pasos razonables después de una búsqueda con resultados. */
export function siguientesPasos(c: Consulta, o: { cobertura: Cobertura | null; mostrados: number; hayPunto: boolean }): Sugerencia[] {
  const pasos: Sugerencia[] = [];
  if (o.mostrados >= 2) pasos.push({ texto: 'Compara el 1 y el 2', mensaje: 'compara el 1 y el 2', rol: 'siguiente' });
  if (c.precioMax !== null) pasos.push({ texto: 'Más barato', mensaje: 'más barato', rol: 'siguiente' });
  else pasos.push({ texto: 'Poner un tope de precio', ajuste: { accion: 'preguntar', campo: 'precio' }, rol: 'siguiente' });
  const otros = (o.cobertura?.distritos ?? []).filter((d) => d.nombre !== c.distrito).slice(0, 2);
  if (!c.distrito) for (const d of otros.length ? o.cobertura!.distritos.slice(0, 2) : []) pasos.push({ texto: `Solo en ${nombreBonito(d.nombre)}`, ajuste: { accion: 'poner_distrito', valor: d.nombre }, rol: 'siguiente' });
  else if (otros.length) pasos.push({ texto: `¿Y en ${nombreBonito(otros[0].nombre)}?`, ajuste: { accion: 'poner_distrito', valor: otros[0].nombre }, rol: 'siguiente' });
  const faltan = (['colegio', 'mercado', 'paradero', 'salud'] as const).filter((id) => !c.criterios.some((x) => x.id === id)).slice(0, 2);
  for (const id of faltan) pasos.push({ texto: `Medir ${CRITERIOS[id].etiqueta.toLowerCase()}`, ajuste: { accion: 'poner_criterio', id }, rol: 'siguiente' });
  if (o.hayPunto) pasos.push({ texto: '¿Qué hay en el punto que elegí?', ajuste: { accion: 'punto' }, rol: 'punto' });
  pasos.push({ texto: 'Nueva búsqueda', ajuste: { accion: 'nueva' }, rol: 'siguiente' });
  return pasos.slice(0, 7);
}

/** Cuando una búsqueda no devuelve nada: un toque por cada filtro que, quitado, trae avisos. */
export function alivios(c: Consulta, d: Salida<'diagnosticar_filtros'>, cob: Cobertura | null = null): Sugerencia[] {
  const a: Sugerencia[] = [];
  const hay = (f: string) => d.sinFiltro.find((x) => x.filtro === f);
  const precio = hay('precio');
  if (precio && precio.total > 0) {
    a.push({ texto: 'Quitar el tope de precio', ajuste: { accion: 'quitar', campo: 'precio' }, rol: 'alivio' });
    if (precio.precioMinimoPen !== null) a.push({ texto: `Subir el tope a ${soles(precio.precioMinimoPen)}`, ajuste: { accion: 'poner_precio', valor: precio.precioMinimoPen, moneda: 'PEN' }, rol: 'alivio' });
  }
  if ((hay('distrito')?.total ?? 0) > 0) a.push({ texto: 'Buscar en cualquier distrito', ajuste: { accion: 'quitar', campo: 'distrito' }, rol: 'alivio' });
  if ((hay('tipo')?.total ?? 0) > 0) a.push({ texto: 'Cualquier tipo', ajuste: { accion: 'poner_tipo', valor: 'cualquiera' }, rol: 'alivio' });
  if ((hay('dormitorios')?.total ?? 0) > 0) a.push({ texto: 'Quitar los dormitorios', ajuste: { accion: 'quitar', campo: 'dormitorios' }, rol: 'alivio' });
  if ((hay('area')?.total ?? 0) > 0) a.push({ texto: 'Quitar el área mínima', ajuste: { accion: 'quitar', campo: 'area' }, rol: 'alivio' });
  if (a.length === 0 && d.sinNingunFiltro > 0) a.push({ texto: `Ver todos los avisos (${d.sinNingunFiltro})`, ajuste: { accion: 'sin_filtros' }, rol: 'alivio' });
  if (a.length === 0 || cob === null) a.push({ texto: 'Nueva búsqueda', ajuste: { accion: 'nueva' }, rol: 'alivio' });
  void c;
  return a;
}

/** Qué filtro excluyó los avisos, dicho con las cifras de la herramienta. */
export function explicarVacio(c: Consulta, d: Salida<'diagnosticar_filtros'>, cob: Cobertura | null = null): string {
  const partes: string[] = [];
  const hay = (f: string) => d.sinFiltro.find((x) => x.filtro === f);
  const p = hay('precio');
  if (p && p.total > 0) {
    partes.push(`Con el tope de precio de ${dinero(c.precioMax!, c.moneda)} no hay avisos; sin ese tope hay ${p.total}${p.precioMinimoPen !== null ? ` y el más barato cuesta ${soles(p.precioMinimoPen)}` : ''}.`);
  }
  const di = hay('distrito');
  if (di && di.total > 0) partes.push(`En ${nombreBonito(c.distrito!)} no hay avisos con esos filtros; en cualquier distrito hay ${di.total}.`);
  const ti = hay('tipo');
  if (ti && ti.total > 0) partes.push(`De ese tipo no hay avisos con esos filtros; de cualquier tipo hay ${ti.total}.`);
  const dor = hay('dormitorios');
  if (dor && dor.total > 0) partes.push(`Con ${c.dormitoriosMin} dormitorios o más no hay avisos; sin ese filtro hay ${dor.total}.`);
  const ar = hay('area');
  if (ar && ar.total > 0) partes.push(`Con ${c.areaMinM2} m² o más no hay avisos; sin ese filtro hay ${ar.total}.`);
  if (partes.length === 0) {
    if (d.sinNingunFiltro === 0) partes.push('No hay avisos vigentes en este momento.');
    else {
      partes.push('Con esa combinación de filtros no hay avisos y quitar uno solo no alcanza.');
      if (cob && cob.vigentes > 0) partes.push(`Lo que tengo ahora: ${cob.vigentes} ${cob.vigentes === 1 ? 'aviso vigente' : 'avisos vigentes'} (${cob.tipos.map((t) => `${t.tipo} ${t.total}`).join(', ')}) en ${cob.distritos.slice(0, 4).map((x) => `${nombreBonito(x.nombre)} (${x.total})`).join(', ')}${cob.distritos.length > 4 ? ' y otros' : ''}.`);
    }
  }
  return partes.join(' ');
}

// ------------------------------------------------------------------ Cuando no se entendió

/** Texto de ayuda que cambia en cada intento: nunca la misma respuesta dos veces. `intentos` es cuántos turnos seguidos no avanzaron. */
export function ayudaSinEntender(intentos: number, mensaje: string, c: Consulta | null): { titular: string; sugerencias: Sugerencia[] } {
  const eco = mensaje.trim().length > 60 ? `${mensaje.trim().slice(0, 57)}…` : mensaje.trim();
  const lo = c && (c.tipo || c.tipoCualquiera || c.distrito || c.precioMax !== null || c.criterios.length) ? resumenDe(c) : null;
  const entendido = lo ? `Hasta ahora entendí: ${lo}.` : 'Todavía no tengo ningún dato de tu búsqueda.';
  const variantes = [
    `No logré entender «${eco}» como una búsqueda. ${entendido} Dime, por ejemplo, el tipo, el distrito o qué quieres tener cerca; o toca una opción.`,
    `Sigo sin poder interpretar «${eco}». ${entendido} Puedo buscar avisos de venta, buscar zonas con lo que te importa o decirte qué hay en un punto del mapa. ¿Cuál de las tres?`,
    `Probemos con algo más concreto: «${eco}» no me da datos que pueda usar. ${entendido} Si prefieres, te muestro los avisos que tengo sin ningún filtro y los afinamos juntos.`,
    `Todavía no puedo interpretar «${eco}». ${entendido} Escribe una sola cosa, por ejemplo «casa en Cayma» o «cerca de un colegio», o elige una opción de abajo.`,
  ];
  const sugerencias: Sugerencia[] = [
    { texto: 'Buscar un departamento', ajuste: { accion: 'poner_tipo', valor: 'departamento' }, rol: 'respuesta' },
    { texto: 'Buscar una casa', ajuste: { accion: 'poner_tipo', valor: 'casa' }, rol: 'respuesta' },
    { texto: 'Ver todos los avisos', ajuste: { accion: 'poner_tipo', valor: 'cualquiera' }, rol: 'respuesta' },
    { texto: 'Zonas con salud y colegio', mensaje: 'zonas con salud y colegio', rol: 'respuesta' },
  ];
  if (lo) sugerencias.push({ texto: 'Empezar de nuevo', ajuste: { accion: 'nueva' }, rol: 'respuesta' });
  return { titular: variantes[intentos % variantes.length], sugerencias };
}

/** Repite una pregunta pendiente con otras palabras cuando la respuesta no sirvió. */
export function repreguntar(f: Faltante, intentos: number, mensaje: string): string {
  const eco = mensaje.trim().length > 40 ? `${mensaje.trim().slice(0, 37)}…` : mensaje.trim();
  const por: Record<Faltante, string[]> = {
    tipo: [
      `No pude usar «${eco}» como tipo. Elige uno: departamento, casa, terreno, local u oficina; o di «cualquiera» si te da igual.`,
      `Todavía me falta el tipo para buscar. Toca una opción de abajo o escribe una sola palabra, por ejemplo «casa».`,
    ],
    moneda: [
      `No pude usar «${eco}» como moneda. ¿El precio máximo es en soles o en dólares? Si no quieres poner tope, dime «sin tope».`,
      `La moneda importa porque 300 mil soles y 300 mil dólares son montos muy distintos. Toca «Soles», «Dólares» o «Sin tope de precio».`,
    ],
    precio: [`No pude leer «${eco}» como un monto. Escríbelo así: «400 mil soles» o «90 mil dólares», o toca «Sin tope de precio».`, `Necesito un monto para fijar el tope, por ejemplo «hasta 350 mil soles». También puedes tocar «Sin tope de precio».`],
    trabajo: [
      `No pude ubicar «${eco}» como lugar de trabajo. Dime un lugar conocido o una dirección, o toca una opción; si no tienes trabajo fijo, dilo y sigo sin medirlo.`,
      `Para medir el viaje necesito un lugar de referencia, por ejemplo «Parque Industrial». Si prefieres no medirlo, toca «No tengo trabajo fijo».`,
    ],
    distrito: [`No reconocí «${eco}» como distrito. Elige uno de los de abajo o escribe su nombre; «cualquier distrito» también sirve.`, `Escribe solo el nombre del distrito, por ejemplo «Cayma», o toca una opción.`],
    lugar: [`No pude usar «${eco}» como lugar. Dime su nombre o una dirección, o toca «No medir ese lugar».`, `Prueba con un lugar conocido (una universidad, un mall, una plaza) o una dirección con la calle.`],
    aclarar: [`No reconocí «${eco}» entre las opciones. Toca la que querías o dime «ninguno» y lo escribes de otra forma.`, `Elige una de las opciones de abajo; si ninguna es la tuya, toca «No medir ese lugar».`],
  };
  const lista = por[f];
  return lista[intentos % lista.length];
}
