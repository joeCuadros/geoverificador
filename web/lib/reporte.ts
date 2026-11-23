/**
 * reporte.ts — La ficha de un punto armada para la web, como datos estructurados (no como HTML).
 *
 * Los datos salen de la base (`fichaDePunto`). Aquí se ordenan en torno a las preguntas de quien busca vivienda (qué se puede construir, qué hay cerca, cómo moverse, servicios
 * básicos, riesgos), cada elemento con su estado (cumple / no cumple / informativo / sin dato), su fuente y la fecha de sus datos a la vista, y el método y lo que el dato
 * no dice aparte, para desplegar. Los textos de las frases largas son los del núcleo de dominio (`Calculos`, `Reporte.limites`, `Verificaciones`), que usa también la
 * aplicación estática: no se escribe aquí ninguna cifra, umbral ni afirmación nueva. Lo que sí se corrige es la presentación: números a la española, un solo elemento
 * para un colegio que sirve a tres niveles, los escenarios volcánicos resumidos por su nivel más alto.
 *
 * No hay puntaje, ni «buen» o «mal» lugar: solo cuántas distancias de referencia se cumplen, que es lo que ya dice el asistente.
 */
import CONFIG from '@geoverificador/dominio/nucleo/config';
import Calculos from '@geoverificador/dominio/nucleo/calculos';
import Reporte from '@geoverificador/dominio/nucleo/reporte';
import Rutas from '@geoverificador/dominio/nucleo/rutas';
import Verificaciones from '@geoverificador/dominio/nucleo/verificaciones';
import type { Base, Fila } from '@geoverificador/datos/cliente';
import { fuentes as leerFuentes, type PeligroDePunto, type Punto } from '@geoverificador/datos/consultas';
import { fichaDePunto, type FichaDePunto } from '@geoverificador/datos/ficha';

export type EstadoDeItem = 'cumple' | 'no_cumple' | 'informativo' | 'sin_dato';

export interface Referencia {
  /** Distancia de referencia en metros. */
  m: number;
  texto: string;
  /** De dónde sale (norma o convención del proyecto). */
  origen: string | null;
  /** Hasta dónde se llena el medidor: la distancia entre el doble de la referencia, de 0 a 1. null sin distancia. */
  proporcion: number | null;
  /** Dónde está la referencia en el medidor (siempre en la mitad). */
  marca: number;
}

export interface DistanciaDeItem {
  m: number | null;
  texto: string;
  /** El punto está dentro del área (distancia 0). */
  dentro: boolean;
}

export interface CriterioDeItem {
  etiqueta: string;
  estado: EstadoDeItem;
  referencia: Referencia | null;
}

export interface ItemDeFicha {
  id: string;
  /** La categoría: «Establecimiento de salud», «Paradero»… */
  titulo: string;
  /** Cumple, no cumple, informativo o sin dato. null cuando el elemento junta varios criterios (cada uno trae el suyo). */
  estado: EstadoDeItem | null;
  /** El lugar: el nombre del establecimiento, del cauce… */
  nombre: string | null;
  /** Una frase en lenguaje llano con lo esencial; es lo que se lee primero en los elementos sin distancia. */
  resumen: string;
  distancia: DistanciaDeItem | null;
  referencia: Referencia | null;
  criterios: CriterioDeItem[] | null;
  /** Hechos cortos: categoría, gestión, superficie… */
  datos: { etiqueta: string; valor: string }[];
  /** Fuente y fecha de los datos, siempre a la vista. */
  fuente: { texto: string; fecha: string | null };
  /** El lugar de `lugares` que lo dibuja en el mapa. */
  lugarId: string | null;
  /** «Cómo se calculó». */
  metodo: string | null;
  /** «Qué no dice este dato». */
  noDice: string | null;
  /** Lo que se despliega: los escenarios volcánicos, los otros registros… */
  detalle: { titulo: string; lineas: string[] } | null;
}

export interface SubgrupoDeFicha {
  titulo: string | null;
  items: ItemDeFicha[];
  /** Todo lo del subgrupo es informativo (sin distancia de referencia): se dice una vez, no en cada fila. */
  informativo: boolean;
}

export interface GrupoDeFicha {
  id: 'construir' | 'cerca' | 'moverse' | 'servicios' | 'riesgos';
  /** Nombre corto para la navegación. */
  corto: string;
  titulo: string;
  /** Una frase que resume el grupo con lo que dicen los datos. */
  resumen: string;
  subgrupos: SubgrupoDeFicha[];
  /** Todo el grupo es informativo. */
  soloInformativo: boolean;
  /** Distancias de referencia que se cumplen, no se cumplen o no tienen dato en este grupo. */
  conteo: { cumple: number; noCumple: number; sinDato: number };
}

export interface LugarDeFicha {
  id: string;
  tipo: 'salud' | 'consultorio' | 'comercio' | 'colegio' | 'paradero' | 'parque' | 'acopio' | 'cauce' | 'geologico';
  nombre: string;
  lat: number;
  lon: number;
  /** Polígono o línea (área verde, cauce); null si es un punto. */
  forma: any | null;
  distanciaM: number | null;
  /** Etiquetas de las filas de la ficha que se refieren a este lugar. */
  filas: string[];
  /** «Salud: cumple», «Educación inicial: cumple»… una por fila. */
  rotulos: string[];
  /** Una letra para el marcador (la letra y el color nunca son lo único que informa: el título dice lo demás). */
  letra: string | null;
  fuente: string | null;
  osm: string | null;
}

export interface PasoDeFicha {
  id: string;
  titulo: string;
  detalle: string;
  enlaces: { texto: string; url: string }[];
}

export interface ReporteDePunto {
  punto: Punto;
  distrito: string | null;
  generado: string;
  aviso: string;
  /** Tres a cinco frases: lo que importa de este punto. Cada una lleva al grupo que la explica. */
  esencial: { texto: string; grupo: GrupoDeFicha['id'] }[];
  grupos: GrupoDeFicha[];
  /** Lo más cercano de cada elemento y los peligros con geometría, tal como los devolvió la ficha, para dibujarlos en el mapa. */
  lugares: LugarDeFicha[];
  pasos: PasoDeFicha[];
  /** Los pocos límites que se muestran siempre. */
  limitacionesClave: string[];
  /** Todos los límites, para desplegar. */
  limitaciones: string[];
}

const AVISO = 'Ficha informativa con datos públicos. No es una recomendación de compra ni reemplaza los certificados municipales. Las distancias son en línea recta.';
const NOTA_PELIGROS =
  'Son datos de contexto, no una evaluación del predio ni un mapa de susceptibilidad: no predicen erupciones, lluvias ni sismos, y que no aparezca un peligro cerca no significa que el lugar sea seguro.';
const NOTA_PELIGROS_FUENTES = 'Las zonas volcánicas son de escala regional y los cauces vienen de fuentes que ninguna es completa. Consulta a la municipalidad, al CENEPRED (SIGRID) y al IGP o INGEMMET.';
const NOTA_INFORMATIVO = 'Los datos informativos no tienen una distancia de referencia: se muestran como contexto y no se dice si están cerca o lejos.';
const LIMITE_BORDE_ZONA =
  'Esta ficha no avisa si otra zona queda a 20 m o menos del punto (esa comparación con el borde de la zona aún no está en la base): cerca del límite entre dos zonas, confirma la zona con el certificado municipal.';
const MAX_POR_GRUPO = 10;
const RADIO_PELIGROS_M = 500;
const NBSP = ' ';

const BADGE_ZONA: Record<string, string> = { si: 'Construible', condicionado: 'Requiere consulta', no: 'No construible' };
const COMERCIO = Calculos.COMERCIO as Record<string, { etiqueta: string }>;
const LETRA_COMERCIO: Record<string, string> = { abastecimiento: 'A', compras_ocio: 'O', comercio_barrio: 'G', finanzas: '$', comida_fuera: 'R', recreacion: 'J' };
const LETRA_NIVEL: Record<string, string> = { inicial: 'I', primaria: 'P', secundaria: 'S' };
const NIVELES = ['inicial', 'primaria', 'secundaria'] as const;

/** Un número como se escribe en español: espacio duro entre miles y coma decimal. */
export function numeroTexto(n: number, decimales = 0): string {
  const f = 10 ** decimales;
  const redondeado = Math.round(n * f) / f;
  const [entera, decimal] = Math.abs(redondeado).toFixed(decimales).split('.');
  const miles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${redondeado < 0 ? '-' : ''}${miles}${decimal ? `,${decimal}` : ''}`;
}

/** «265 m» bajo el kilómetro, «1,67 km» desde ahí; «sin dato» si no hay distancia. */
export function distanciaTexto(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return 'sin dato';
  return m < 1000 ? `${Math.round(m)} m` : `${String(Number((m / 1000).toFixed(2))).replace('.', ',')} km`;
}

const capitalizar = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sinPunto = (s: string) => s.replace(/[.\s]+$/, '');

/** La primera oración de un texto y el resto. */
function dividirOracion(texto: string): { primera: string; resto: string | null } {
  const m = /^(.+?[.!?])\s+(?=[A-ZÁÉÍÓÚÑ«¿¡])/s.exec(texto);
  return m ? { primera: m[1], resto: texto.slice(m[0].length) } : { primera: texto, resto: null };
}

/**
 * Los textos de método del dominio repiten «Sin umbral:» (la etiqueta del dato y la fuente del umbral lo dicen las dos): aquí se deja una vez. La raíz está en
 * packages/dominio (CONFIG.fuentesUmbral.* ya empieza con «Sin umbral:» y calculos.js lo antepone otra vez); no se toca porque lo usa la aplicación estática.
 */
const limpiarMetodo = (t: string | null | undefined): string | null => (t ? t.replace(/(Sin umbral:\s*)(?:Sin umbral:\s*)+/gi, '$1').trim() : null);

const ESTADOS: Record<string, EstadoDeItem> = { CUMPLE: 'cumple', 'NO CUMPLE': 'no_cumple', INFORMATIVO: 'informativo', 'SIN DATO': 'sin_dato' };
const estadoDe = (r: any): EstadoDeItem => (r?.error ? 'sin_dato' : (ESTADOS[String(r?.estado ?? '').toUpperCase()] ?? 'sin_dato'));

function distanciaDe(m: number | null | undefined): DistanciaDeItem | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  return m === 0 ? { m: 0, texto: 'dentro del área', dentro: true } : { m, texto: distanciaTexto(m), dentro: false };
}

function referenciaDe(umbralM: number | null | undefined, distanciaM: number | null | undefined, origen: string | null): Referencia | null {
  if (umbralM === null || umbralM === undefined || !Number.isFinite(umbralM)) return null;
  const proporcion = distanciaM === null || distanciaM === undefined || !Number.isFinite(distanciaM) ? null : Math.min(distanciaM / (2 * umbralM), 1);
  const texto = umbralM < 1000 ? `${numeroTexto(umbralM)} m` : `${numeroTexto(umbralM / 1000, Number.isInteger(umbralM / 1000) ? 0 : 1)} km`;
  return { m: umbralM, texto: `hasta ${texto}`, origen, proporcion, marca: 0.5 };
}

/** «Fuente corta» de un dato: el elemento oficial (con su código) o, si no hay, el nombre de la fuente sin el respaldo entre paréntesis. */
function fuenteDe(r: any): { texto: string; fecha: string | null } {
  const elemento = Calculos.textoFuenteElemento(r);
  const texto = elemento || String(r?.fuente ?? 'Fuente sin registrar').replace(/ \(fuente primaria\)( y .*)?$/, '');
  return { texto, fecha: typeof r?.fecha === 'string' ? r.fecha : null };
}

function fuenteDeBase(fuentes: Fila[], id: string, alternativa: string): { texto: string; fecha: string | null } {
  const f = fuentes.find((x) => x.id === id);
  return { texto: f?.nombre ?? alternativa, fecha: f?.fecha ?? null };
}

// ------------------------------------------------------------------ Lugares del mapa

interface FilaDeEntorno {
  etiqueta: string;
  tipo: LugarDeFicha['tipo'];
  letra: string | null;
  r: any;
}

/** Las filas de «lo más cercano de»: de ellas salen los lugares del mapa. */
function filasDeEntorno(ficha: FichaDePunto): FilaDeEntorno[] {
  const e = ficha.entorno;
  const filas: FilaDeEntorno[] = [];
  filas.push({ etiqueta: 'Salud', tipo: 'salud', letra: '+', r: e.salud });
  if (e.consultorio) filas.push({ etiqueta: 'Consultorio médico (informativo)', tipo: 'consultorio', letra: 'C', r: e.consultorio });
  for (const id of Object.keys(COMERCIO)) if (e[id]) filas.push({ etiqueta: `${COMERCIO[id].etiqueta} (informativo)`, tipo: 'comercio', letra: LETRA_COMERCIO[id] ?? null, r: e[id] });
  for (const n of NIVELES) filas.push({ etiqueta: `Educación ${n}`, tipo: 'colegio', letra: LETRA_NIVEL[n], r: e.educacion?.[n] });
  filas.push({ etiqueta: 'Transporte', tipo: 'paradero', letra: 'B', r: e.transporte });
  filas.push({ etiqueta: 'Área verde', tipo: 'parque', letra: null, r: e.areaVerde });
  if (e.acopio) filas.push({ etiqueta: 'Punto de acopio de agua (informativo)', tipo: 'acopio', letra: 'H', r: e.acopio });
  return filas;
}

const tieneLugar = (r: any): boolean => Boolean(r) && Number.isFinite(r.lat) && Number.isFinite(r.lon);

/** Un lugar por elemento: si el mismo colegio es el más cercano de dos niveles, es un solo lugar con las dos filas. Lo que la ficha dejó sin coordenadas no se dibuja. */
function lugaresDeEntorno(filas: FilaDeEntorno[]): LugarDeFicha[] {
  const porElemento = new Map<string, LugarDeFicha>();
  for (const f of filas) {
    if (!tieneLugar(f.r)) continue;
    const clave = `${f.tipo}|${f.r.osm ?? ''}|${f.r.lat},${f.r.lon}`; // el código modular de ESCALE es de cada nivel: un mismo local lleva uno por nivel
    let l = porElemento.get(clave);
    if (!l) {
      l = {
        id: `lugar-${porElemento.size + 1}`, tipo: f.tipo, nombre: f.r.nombre ?? f.r.direccion ?? 'Sin nombre', lat: f.r.lat, lon: f.r.lon, forma: f.r.forma ?? null,
        distanciaM: Number.isFinite(f.r.distanciaM) ? f.r.distanciaM : null, filas: [], rotulos: [], letra: f.letra, fuente: Calculos.textoFuenteElemento(f.r) || null, osm: f.r.osm ?? null,
      };
      porElemento.set(clave, l);
    }
    l.filas.push(f.etiqueta);
    l.rotulos.push(`${f.etiqueta}: ${String(f.r.estado ?? '').toLowerCase()}`);
  }
  return [...porElemento.values()];
}

/** El punto donde se ancla un peligro en el mapa: el punto mismo o, en una línea, el vértice más cercano al punto elegido (no se recalcula la distancia: es la de la ficha). */
function puntoDe(g: any, desde: Punto): { lat: number; lon: number } | null {
  if (!g) return null;
  if (g.type === 'Point') return { lon: g.coordinates[0], lat: g.coordinates[1] };
  const vertices: number[][] = g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates.flat() : [];
  let mejor: number[] | null = null;
  let mejorD = Infinity;
  const kx = Math.cos((desde.lat * Math.PI) / 180);
  for (const v of vertices) {
    const d = (v[1] - desde.lat) ** 2 + ((v[0] - desde.lon) * kx) ** 2;
    if (d < mejorD) {
      mejorD = d;
      mejor = v;
    }
  }
  return mejor ? { lon: mejor[0], lat: mejor[1] } : null;
}

const textoPeligro = (p: PeligroDePunto): string => {
  if (p.clase === 'volcanico') return `${p.props.etiqueta ?? (p.nivel ? `Peligro ${p.nivel}` : 'Zona de peligro')}: ${p.props.detalle ?? p.tipo ?? 'zona del Misti'}`;
  const nombre = p.nombre ?? p.props.subtipo ?? p.props.tipo ?? p.tipo ?? 'Registro sin nombre';
  return `${nombre}${p.clase === 'geologico' && p.props.anio ? ` (${p.props.anio})` : ''}`;
};

// ------------------------------------------------------------------ Elementos

interface Contexto {
  ficha: FichaDePunto;
  fuentes: Fila[];
  lugares: LugarDeFicha[];
  limites: string[];
}

const lugarDe = (c: Contexto, fila: string): string | null => c.lugares.find((l) => l.filas.includes(fila))?.id ?? null;
const limiteQueEmpieza = (c: Contexto, inicio: string): string | null => c.limites.find((l) => l.startsWith(inicio)) ?? null;

function vacio(id: string, titulo: string): ItemDeFicha {
  return { id, titulo, estado: 'informativo', nombre: null, resumen: '', distancia: null, referencia: null, criterios: null, datos: [], fuente: { texto: '', fecha: null }, lugarId: null, metodo: null, noDice: null, detalle: null };
}

function nombreDe(r: any, sinNombre: string): string {
  const n = typeof r?.nombre === 'string' ? r.nombre.trim() : '';
  return n || sinNombre;
}

/** Un elemento con distancia («lo más cercano de»): salud, consultorio, comercio, paradero, área verde. */
function itemDeDistancia(c: Contexto, o: { id: string; titulo: string; fila: string; r: any; umbralOrigen?: string | null; noDice?: string | null; sinNombre?: string }): ItemDeFicha {
  const { r } = o;
  const estado = estadoDe(r);
  const d = estado === 'sin_dato' ? null : distanciaDe(r.distanciaM);
  const i = vacio(o.id, o.titulo);
  i.estado = estado;
  i.nombre = d ? nombreDe(r, o.sinNombre ?? 'Sin nombre registrado') : null;
  i.distancia = d;
  i.referencia = referenciaDe(r.umbralM, d ? r.distanciaM : null, o.umbralOrigen ?? null);
  i.fuente = fuenteDe(r);
  i.lugarId = d ? lugarDe(c, o.fila) : null;
  i.metodo = limpiarMetodo(r.metodo);
  i.noDice = o.noDice ?? null;
  i.resumen = r.error ? `Sin dato: no se pudo obtener (${r.error}).` : d ? `${o.titulo}: ${i.nombre}, ${d.dentro ? 'el punto está dentro del área' : `a ${d.texto}`}.` : `${o.titulo}: sin dato.`;
  return i;
}

function itemsDeColegios(c: Contexto): ItemDeFicha[] {
  const e = c.ficha.entorno.educacion ?? {};
  const porElemento = new Map<string, { r: any; niveles: (typeof NIVELES)[number][] }>();
  const sinDato: { n: (typeof NIVELES)[number]; r: any }[] = [];
  for (const n of NIVELES) {
    const r = e[n];
    if (!r || estadoDe(r) === 'sin_dato' || !tieneLugar(r)) {
      sinDato.push({ n, r });
      continue;
    }
    const clave = `${r.osm ?? ''}|${r.lat},${r.lon}`; // el mismo local con un código modular por nivel es un solo colegio
    const g = porElemento.get(clave) ?? { r, niveles: [] };
    g.niveles.push(n);
    porElemento.set(clave, g);
  }
  const origen = (CONFIG.fuentesUmbral as Record<string, string>).educacion ?? null;
  const items: ItemDeFicha[] = [];
  let n = 0;
  for (const { r, niveles } of porElemento.values()) {
    n++;
    const d = distanciaDe(r.distanciaM);
    const i = vacio(`colegio-${n}`, 'Colegio');
    i.estado = null;
    i.nombre = nombreDe(r, 'Colegio sin nombre');
    i.distancia = d;
    i.criterios = niveles.map((nivel) => ({ etiqueta: mayuscula(nivel), estado: estadoDe(e[nivel]), referencia: referenciaDe(e[nivel].umbralM, e[nivel].distanciaM, origen) }));
    i.fuente = fuenteDe(r);
    i.lugarId = lugarDe(c, `Educación ${niveles[0]}`);
    i.metodo = limpiarMetodo(r.metodo);
    i.noDice = limiteQueEmpieza(c, 'Los locales de ESCALE');
    i.resumen = `Colegio ${i.nombre} (${niveles.join(', ')}): ${d?.dentro ? 'el punto está dentro del área' : `a ${d?.texto ?? 'sin dato'}`}.`;
    items.push(i);
  }
  for (const { n: nivel, r } of sinDato) {
    const i = vacio(`colegio-sin-${nivel}`, 'Colegio');
    i.estado = null;
    i.criterios = [{ etiqueta: mayuscula(nivel), estado: 'sin_dato', referencia: referenciaDe(r?.umbralM, null, origen) }];
    i.fuente = r ? fuenteDe(r) : { texto: 'Padrón de instituciones educativas de ESCALE (MINEDU)', fecha: null };
    i.metodo = limpiarMetodo(r?.metodo);
    i.resumen = `Colegio de nivel ${nivel}: sin dato.`;
    items.push(i);
  }
  return items;
}

function itemDeTransporte(c: Contexto): ItemDeFicha {
  const r = c.ficha.entorno.transporte;
  const i = itemDeDistancia(c, { id: 'transporte', titulo: 'Paradero', fila: 'Transporte', r, umbralOrigen: (CONFIG.fuentesUmbral as any).transporte ?? null, noDice: limiteQueEmpieza(c, 'Las líneas de transporte'), sinNombre: 'Paradero sin nombre en OSM' });
  const rutas = r?.rutas;
  if (rutas && !rutas.error) {
    i.datos.push({ etiqueta: `Líneas a ${numeroTexto(rutas.distanciaM)} m o menos`, valor: rutas.lineas.length ? (Rutas as any).listaTexto(rutas.lineas, 12) : 'ninguna mapeada en OpenStreetMap' });
    if (rutas.lineas.length) i.detalle = { titulo: 'Recorridos que pasan cerca', lineas: rutas.lineas.map((l: any) => `${Rutas.etiquetaLinea(l)} · trazado a ${distanciaTexto(l.distanciaM)}${l.parada ? ` · parada mapeada a ${distanciaTexto(l.parada.distanciaM)}` : ''}`) };
  }
  return i;
}

function itemDeAreaVerde(c: Contexto): ItemDeFicha {
  const r = c.ficha.entorno.areaVerde;
  const i = itemDeDistancia(c, { id: 'area-verde', titulo: 'Área verde', fila: 'Área verde', r, umbralOrigen: (CONFIG.fuentesUmbral as any).areaVerde ?? null, noDice: limiteQueEmpieza(c, 'Todas las distancias son en línea recta'), sinNombre: 'Área verde sin nombre en OSM' });
  const u = CONFIG.umbrales.areaVerde as { areaMinM2: number; areaGrandeM2: number; distanciaM: number };
  if (i.estado !== 'sin_dato' && r?.areaM2) {
    i.datos.push({ etiqueta: 'Superficie', valor: `${numeroTexto(r.areaM2)} m² (${numeroTexto(r.areaM2 / 10000, 2)} ha)` });
    i.datos.push({ etiqueta: `Con al menos ${numeroTexto(u.areaGrandeM2 / 10000, 0)} ha`, valor: r.cumple1ha ? `${r.nombre1ha ?? 'Área verde'} a ${distanciaTexto(r.distancia1haM)}` : `ninguna a ${numeroTexto(u.distanciaM)} m o menos (mínimo ${numeroTexto(u.areaGrandeM2)} m²)` });
    i.metodo = limpiarMetodo(`${i.metodo ?? ''} Criterio: un área verde de al menos ${numeroTexto(u.areaMinM2)} m² a ${numeroTexto(u.distanciaM)} m o menos.`);
  }
  return i;
}

/** Los elementos informativos que dependen de un texto del dominio: la primera oración a la vista, el resto como «qué no dice». */
function itemDeTexto(id: string, titulo: string, r: any, texto: string, nota: string | null, extra?: (i: ItemDeFicha) => void): ItemDeFicha {
  const { primera, resto } = dividirOracion(texto);
  const i = vacio(id, titulo);
  i.estado = estadoDe(r);
  i.resumen = primera;
  i.noDice = [resto, nota].filter(Boolean).join(' ') || null;
  i.fuente = fuenteDe(r);
  i.metodo = limpiarMetodo(r?.metodo);
  extra?.(i);
  return i;
}

function itemsDeServicios(c: Contexto): ItemDeFicha[] {
  const e = c.ficha.entorno;
  const out: ItemDeFicha[] = [];
  if (e.electricidad) out.push(itemDeTexto('electricidad', 'Electricidad: concesión de distribución', e.electricidad, Calculos.textoElectricidad(e.electricidad), Calculos.NOTA_ELECTRICIDAD));
  if (e.acopio) {
    const a = e.acopio;
    const conDato = estadoDe(a) !== 'sin_dato';
    const i = itemDeTexto('acopio', 'Agua: punto de acopio', a, Calculos.textoAcopio(a), Calculos.NOTA_ACOPIO, (x) => {
      if (conDato) {
        x.nombre = sinPunto(String(a.direccion ?? 'Punto de acopio sin dirección'));
        x.distancia = distanciaDe(a.distanciaM);
        x.lugarId = lugarDe(c, 'Punto de acopio de agua (informativo)');
        x.datos.push({ etiqueta: 'Datos de', valor: String(a.fechaDatos ?? '2017') });
      }
    });
    out.push(i);
  }
  if (e.censo) {
    const k = e.censo;
    const texto = Calculos.textoCenso(k);
    const conCifras = k.tieneCifras && !k.pocas;
    // Con cifras, los porcentajes van como datos y la frase se queda con lo que el dato no es (cifras de la manzana, no del predio); sin cifras, la frase del dominio dice por qué.
    const frases = texto.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/);
    out.push(
      itemDeTexto('censo', `Servicios de la manzana (censo ${k.anio ?? 2017})`, k, conCifras ? (frases.at(-1) ?? texto) : texto, Calculos.NOTA_CENSO, (x) => {
        if (conCifras) {
          const p = (v: any) => (v?.pct === null || v?.pct === undefined ? 'sin porcentaje' : `${numeroTexto(v.pct, v.pct % 1 ? 1 : 0)} %`);
          x.datos.push({ etiqueta: 'Alumbrado por red pública', valor: p(k.luz) }, { etiqueta: 'Agua por red pública', valor: p(k.agua) }, { etiqueta: 'Desagüe por red pública', valor: p(k.desague) });
          x.datos.push({ etiqueta: 'Viviendas ocupadas censadas', valor: numeroTexto(k.ocupadas) });
        }
      }),
    );
  }
  return out;
}

const NIVEL_VOLCAN: Record<string, number> = { bajo: 1, moderado: 2, alto: 3 };
const TIPO_VOLCAN: Record<string, string> = { ceniza: 'ceniza', lahar: 'lahares', flujo_piroclastico: 'flujos piroclásticos', lava: 'lava', avalancha: 'avalanchas' };

function itemsDeRiesgos(c: Contexto, lugares: LugarDeFicha[]): ItemDeFicha[] {
  const { ficha, fuentes } = c;
  const out: ItemDeFicha[] = [];
  const desde = ficha.punto;
  const de = (clase: string) => ficha.peligros.filter((p) => p.clase === clase);

  // Peligro volcánico: un resumen con el nivel más alto; los escenarios quedan en el detalle.
  const volcan = de('volcanico');
  const iv = vacio('peligro-volcanico', 'Peligro volcánico del Misti');
  iv.fuente = fuenteDeBase(fuentes, 'igp_volcan', 'IGP (CENVUL), zonas de peligro volcánico del Misti');
  iv.metodo = 'Zonas de peligro volcánico del IGP: se comprueba si el punto cae dentro de cada una (punto en polígono).';
  iv.noDice = `${NOTA_PELIGROS} Las zonas volcánicas son de escala regional, de la fecha del mapa del IGP, y cerca del borde de una zona el nivel no es exacto.`;
  if (volcan.length) {
    const max = Math.max(...volcan.map((p) => NIVEL_VOLCAN[String(p.nivel)] ?? 0));
    const nivel = Object.keys(NIVEL_VOLCAN).find((k) => NIVEL_VOLCAN[k] === max) ?? 'bajo';
    const tipos = [...new Set(volcan.filter((p) => (NIVEL_VOLCAN[String(p.nivel)] ?? 0) === max).map((p) => TIPO_VOLCAN[String(p.tipo)] ?? String(p.tipo ?? 'zona')))];
    const escenarios = [...new Set(volcan.map(textoPeligro))];
    iv.resumen = `El punto está dentro de zonas de peligro volcánico del Misti; el nivel más alto: ${nivel} (${tipos.join(', ')}).`;
    iv.detalle = { titulo: `${escenarios.length} escenarios que lo incluyen`, lineas: escenarios };
  } else iv.resumen = 'El punto no está dentro de ninguna zona de peligro volcánico del mapa del IGP.';
  out.push(iv);

  // Cauce más cercano.
  const cauces = de('cauce').sort((a, b) => a.distanciaM - b.distanciaM);
  const ic = vacio('cauce', 'Cauce o quebrada');
  ic.fuente = fuenteDeBase(fuentes, 'cauces', 'Cauces y quebradas: ANA, IGP y OpenStreetMap');
  ic.metodo = `Cauces del archivo (ANA, IGP y OpenStreetMap) a ${numeroTexto(RADIO_PELIGROS_M)} m o menos del punto; la distancia es a la línea del mapa.`;
  ic.noDice = limiteQueEmpieza(c, 'Quebradas y cauces:');
  if (cauces.length) {
    const p = cauces[0];
    ic.nombre = p.nombre ?? p.props.nombre ?? 'Cauce sin nombre';
    ic.distancia = distanciaDe(p.distanciaM);
    ic.resumen = `Cauce más cercano: ${ic.nombre}, a ${ic.distancia!.texto}.`;
    const g = puntoDe(p.geometria, desde);
    if (g && p.geometria) ic.lugarId = crearLugarDePeligro(lugares, p, ic.nombre!, g, ic.fuente.texto);
    if (cauces.length > 1) ic.detalle = { titulo: `Otros ${cauces.length - 1} cauces a ${numeroTexto(RADIO_PELIGROS_M)} m o menos`, lineas: cauces.slice(1, MAX_POR_GRUPO + 1).map((x) => `${x.nombre ?? x.props.nombre ?? 'Cauce sin nombre'} · ${distanciaTexto(x.distanciaM)}`) };
  } else ic.resumen = `Los datos no registran cauces a ${numeroTexto(RADIO_PELIGROS_M)} m o menos de este punto. Eso no significa que el lugar sea seguro.`;
  out.push(ic);

  // Peligros geológicos registrados.
  const geo = de('geologico').sort((a, b) => a.distanciaM - b.distanciaM);
  const ig = vacio('geologico', 'Peligros geológicos registrados');
  ig.fuente = fuenteDeBase(fuentes, 'ingemmet_peligros', 'INGEMMET, peligros geológicos');
  ig.metodo = `Inventario de eventos documentados por INGEMMET a ${numeroTexto(RADIO_PELIGROS_M)} m o menos del punto.`;
  ig.noDice = `${NOTA_PELIGROS} ${NOTA_PELIGROS_FUENTES}`;
  if (geo.length) {
    const p = geo[0];
    ig.nombre = textoPeligro(p);
    ig.distancia = distanciaDe(p.distanciaM);
    ig.resumen = `${geo.length === 1 ? '1 registro' : `${geo.length} registros`} a ${numeroTexto(RADIO_PELIGROS_M)} m o menos; el más cercano: ${ig.nombre}, a ${ig.distancia!.texto}.`;
    const g = puntoDe(p.geometria, desde);
    if (g && p.geometria) ig.lugarId = crearLugarDePeligro(lugares, p, ig.nombre, g, ig.fuente.texto);
    if (geo.length > 1) ig.detalle = { titulo: 'Los demás registros', lineas: geo.slice(1, MAX_POR_GRUPO + 1).map((x) => `${textoPeligro(x)} · ${distanciaTexto(x.distanciaM)}`).concat(geo.length > MAX_POR_GRUPO + 1 ? [`y ${geo.length - MAX_POR_GRUPO - 1} más, más lejanos`] : []) };
  } else ig.resumen = `Los datos no registran peligros geológicos a ${numeroTexto(RADIO_PELIGROS_M)} m o menos de este punto. Eso no significa que el lugar sea seguro.`;
  out.push(ig);

  // Concesión minera.
  const m = ficha.entorno.mineria;
  if (m) {
    out.push(
      itemDeTexto('mineria', 'Concesión minera', m, Calculos.textoMinera(m), Calculos.NOTA_MINERA, (x) => {
        if (m.dentro) m.concesiones.forEach((k: any) => x.datos.push({ etiqueta: `Concesión ${k.codigo}`, valor: [k.nombre, k.estado, k.sustancia, k.hectareas ? `${numeroTexto(k.hectareas)} ha` : null].filter(Boolean).join(' · ') }));
      }),
    );
  }
  return out;
}

function crearLugarDePeligro(lugares: LugarDeFicha[], p: PeligroDePunto, nombre: string, g: { lat: number; lon: number }, fuente: string): string {
  const id = `peligro-${lugares.length + 1}`;
  lugares.push({ id, tipo: p.clase === 'cauce' ? 'cauce' : 'geologico', nombre, lat: g.lat, lon: g.lon, forma: p.geometria.type === 'Point' ? null : p.geometria, distanciaM: p.distanciaM, filas: [], rotulos: [], letra: null, fuente, osm: null });
  return id;
}

// ------------------------------------------------------------------ Zona

function itemDeZona(c: Contexto): ItemDeFicha {
  const z = c.ficha.zona;
  const i = vacio('zona', 'Zonificación vigente');
  i.fuente = { texto: String(CONFIG.zonificacion.fuente), fecha: null };
  i.noDice = [limiteQueEmpieza(c, 'La zonificación vigente es la del PDM'), limiteQueEmpieza(c, 'Los polígonos de la zonificación'), LIMITE_BORDE_ZONA].filter(Boolean).join(' ');
  if (!z) {
    i.estado = 'sin_dato';
    i.resumen = 'El punto está fuera del área zonificada del plano: no tiene zona asignada.';
    i.metodo = 'Se comprueba si el punto cae dentro de algún polígono del plano de zonificación del PDM 2016-2025.';
    return i;
  }
  const r = z.regla ?? {};
  i.estado = null;
  i.nombre = z.codigo;
  const condicion = BADGE_ZONA[String(r.edificable)] ?? null;
  i.resumen = `${r.nombre ?? 'Código sin reglas en la tabla'}${condicion ? ` — ${condicion.toLowerCase()}` : ''}.`;
  const tiene = (v: unknown) => v !== null && v !== undefined && v !== '';
  const rango = (a: any, b: any) => (tiene(b) && b !== a ? `${a} (hasta ${b})` : `${a}`);
  if (tiene(r.pisos_base)) i.datos.push({ etiqueta: 'Pisos', valor: rango(r.pisos_base, r.pisos_max) });
  if (tiene(r.coef_base)) i.datos.push({ etiqueta: 'Coeficiente de edificación', valor: rango(String(r.coef_base).replace('.', ','), tiene(r.coef_max) ? String(r.coef_max).replace('.', ',') : null) });
  if (tiene(r.area_libre_pct)) i.datos.push({ etiqueta: 'Área libre mínima', valor: `${numeroTexto(Number(r.area_libre_pct))} %` });
  if (tiene(r.lote_min_m2)) i.datos.push({ etiqueta: 'Lote mínimo', valor: `${numeroTexto(Number(r.lote_min_m2))} m²` });
  if (tiene(r.frente_min_m)) i.datos.push({ etiqueta: 'Frente mínimo', valor: `${numeroTexto(Number(r.frente_min_m))} m` });
  i.metodo = `Parámetros del Reglamento del PDM Arequipa 2016-2025, Título III${r.articulo ? ` (${r.articulo})` : ''}.${r.nota ? ` ${r.nota}.` : ''}`.replace(/\.\./g, '.');
  return i;
}

// ------------------------------------------------------------------ Grupos

function conteoDe(items: ItemDeFicha[]): GrupoDeFicha['conteo'] {
  const criterios = items.flatMap((i) => i.criterios ?? [{ estado: i.estado }]);
  const cuenta = (e: EstadoDeItem) => criterios.filter((x) => x.estado === e).length;
  return { cumple: cuenta('cumple'), noCumple: cuenta('no_cumple'), sinDato: cuenta('sin_dato') };
}

/** Un subgrupo es informativo si todo lo que trae es informativo (o sin dato: que falte un dato no lo vuelve un veredicto). */
const esInformativo = (items: ItemDeFicha[]): boolean => items.some((i) => i.estado === 'informativo') && items.every((i) => i.estado === 'informativo' || i.estado === 'sin_dato');
const subgrupo = (titulo: string | null, items: ItemDeFicha[]): SubgrupoDeFicha => ({ titulo, items, informativo: esInformativo(items) });

function grupoConItems(g: Omit<GrupoDeFicha, 'conteo' | 'soloInformativo' | 'subgrupos'> & { subgrupos: [string | null, ItemDeFicha[]][] }, medidos: ItemDeFicha[] = []): GrupoDeFicha {
  const subgrupos = g.subgrupos.map(([t, items]) => subgrupo(t, items));
  return { ...g, subgrupos, soloInformativo: subgrupos.every((s) => s.informativo), conteo: conteoDe(medidos) };
}

function resumenDeCerca(conteo: GrupoDeFicha['conteo']): string {
  const total = conteo.cumple + conteo.noCumple + conteo.sinDato;
  if (!total) return 'No hay distancias de referencia medidas para este punto.';
  const partes = [`${conteo.cumple} de ${total} distancias de referencia se cumplen`];
  if (conteo.noCumple) partes.push(`${conteo.noCumple} no`);
  if (conteo.sinDato) partes.push(`${conteo.sinDato} sin dato`);
  return `${partes.join('; ')}.`;
}

function armarGrupos(c: Contexto, lugares: LugarDeFicha[]): GrupoDeFicha[] {
  const e = c.ficha.entorno;
  const origenSalud = (CONFIG.fuentesUmbral as any).salud ?? null;

  const zona = itemDeZona(c);
  const construir = grupoConItems({
    id: 'construir',
    corto: 'Construir',
    titulo: 'Qué se puede construir',
    // Sin zona, el elemento ya lo dice: el grupo no lo repite.
    resumen: c.ficha.zona ? `Zona ${c.ficha.zona.codigo}${BADGE_ZONA[String(c.ficha.zona.regla?.edificable)] ? `: ${BADGE_ZONA[String(c.ficha.zona.regla?.edificable)].toLowerCase()}` : ''}.` : '',
    subgrupos: [[null, [zona]]],
  });

  const salud = itemDeDistancia(c, { id: 'salud', titulo: 'Establecimiento de salud', fila: 'Salud', r: e.salud, umbralOrigen: origenSalud, noDice: limiteQueEmpieza(c, 'Salud sale de RENIPRESS'), sinNombre: 'Establecimiento sin nombre' });
  const colegios = itemsDeColegios(c);
  const verde = itemDeAreaVerde(c);
  const medidos = [salud, ...colegios, verde];
  const contexto: ItemDeFicha[] = [];
  if (e.consultorio) contexto.push(itemDeDistancia(c, { id: 'consultorio', titulo: 'Consultorio médico', fila: 'Consultorio médico (informativo)', r: e.consultorio, noDice: Calculos.NOTA_CONSULTORIO, sinNombre: 'Consultorio sin nombre' }));
  for (const id of Object.keys(COMERCIO)) {
    if (e[id]) contexto.push(itemDeDistancia(c, { id: `comercio-${id}`, titulo: COMERCIO[id].etiqueta, fila: `${COMERCIO[id].etiqueta} (informativo)`, r: e[id], noDice: Calculos.NOTA_COMERCIO, sinNombre: 'Sin nombre registrado en OpenStreetMap' }));
  }
  const conteo = conteoDe(medidos);
  const cerca = grupoConItems({
    id: 'cerca',
    corto: 'Cerca',
    titulo: 'Qué hay cerca',
    resumen: resumenDeCerca(conteo),
    subgrupos: [['Distancias de referencia', medidos], ...(contexto.length ? [['Comercio y vida diaria (informativo)', contexto] as [string, ItemDeFicha[]]] : [])],
  }, medidos);

  const transporte = itemDeTransporte(c);
  const lineas = e.transporte?.rutas && !e.transporte.rutas.error ? e.transporte.rutas.lineas.length : null;
  const moverse = grupoConItems(
    {
      id: 'moverse',
      corto: 'Moverse',
      titulo: 'Cómo moverse',
      resumen: transporte.distancia
        ? `El paradero más cercano está ${transporte.distancia.dentro ? 'en el punto' : `a ${transporte.distancia.texto}`}${lineas === null ? '' : lineas ? `; pasan ${lineas === 1 ? '1 línea' : `${lineas} líneas`} a ${numeroTexto(e.transporte.rutas.distanciaM)} m o menos` : `; ninguna línea mapeada pasa a ${numeroTexto(e.transporte.rutas.distanciaM)} m o menos`}.`
        : 'No hay dato del paradero más cercano.',
      subgrupos: [[null, [transporte]]],
    },
    [transporte],
  );

  const servicios = grupoConItems({
    id: 'servicios',
    corto: 'Servicios',
    titulo: 'Servicios básicos',
    resumen: 'Es información de contexto: dice a qué empresa le corresponde el servicio y qué hay cerca, no si el predio está conectado.',
    subgrupos: [[null, itemsDeServicios(c)]],
  });

  const riesgosItems = itemsDeRiesgos(c, lugares);
  const volcan = riesgosItems.find((i) => i.id === 'peligro-volcanico')!;
  const cauce = riesgosItems.find((i) => i.id === 'cauce')!;
  const geologico = riesgosItems.find((i) => i.id === 'geologico')!;
  const hayAlgo = Boolean(c.ficha.peligros.length);
  const riesgos = grupoConItems({
    id: 'riesgos',
    corto: 'Riesgos',
    titulo: 'Riesgos y restricciones',
    resumen: hayAlgo
      ? [volcan.resumen, cauce.distancia ? cauce.resumen : null, geologico.distancia ? geologico.resumen : null].filter(Boolean).join(' ')
      : `Los datos no registran peligros volcánicos, cauces ni peligros geológicos a ${numeroTexto(RADIO_PELIGROS_M)} m o menos. Eso no significa que el lugar sea seguro.`,
    subgrupos: [[null, riesgosItems]],
  });

  return [construir, cerca, moverse, servicios, riesgos];
}

function pasosDeFicha(c: Contexto): PasoDeFicha[] {
  const pasos: PasoDeFicha[] = [];
  const zona = (Verificaciones.ITEMS as any[]).find((x) => x.id === 'zonificacion-parametros');
  if (c.ficha.zona && zona) pasos.push({ id: zona.id, titulo: zona.titulo, detalle: `${zona.queConfirma}${zona.nota ? ` ${zona.nota}` : ''}`, enlaces: zona.enlaces ?? [] });
  const registro = (Verificaciones.ITEMS as any[]).find((x) => x.id === 'copia-literal-cargas');
  if (registro) pasos.push({ id: registro.id, titulo: registro.titulo, detalle: `${registro.queConfirma}${registro.nota ? ` ${registro.nota}` : ''}`, enlaces: registro.enlaces ?? [] });
  const titulos: Record<string, string> = { recibos: 'Recibos de agua y luz', factibilidad: 'Factibilidad de agua, desagüe y luz', datos: 'Datos de conexión de un predio' };
  for (const x of Calculos.LISTA_COMPRADOR as { id: string; texto: string }[]) pasos.push({ id: x.id, titulo: titulos[x.id] ?? x.id, detalle: x.texto, enlaces: [] });
  return pasos;
}

function datosDelInforme(ficha: FichaDePunto): Record<string, any> {
  const z = ficha.zona;
  return {
    punto: ficha.punto, zonaStatus: z ? 'ok' : 'outside', zona: z ? { codigo: z.codigo, regla: z.regla } : null, badgeZona: null, lote: null, potencial: null, avisoPDM: null, variables: ficha.entorno,
    departamento2025: CONFIG.censo.departamento2025, cauce: null, contextoRiesgo: null, precio: null, verificaciones: null, umbrales: CONFIG.umbrales, fuentesUmbral: CONFIG.fuentesUmbral, modulos: {},
    fuentes: { zonificacion: CONFIG.zonificacion.fuente },
  };
}

/** Los límites del informe del dominio, sin lo que habla de lo que esta ficha no muestra y con los que sí valen aquí. */
function limitacionesDe(ficha: FichaDePunto): string[] {
  const l = (Reporte.limites(datosDelInforme(ficha)) as string[])
    .filter((x) => !/^(El contexto de riesgo|El precio de oferta)/.test(x))
    .map((x) =>
      x
        .replace(' (por eso se avisa cuando otra zona queda a 20 m o menos)', '')
        .replace(' La zonificación proyectada no se muestra: solo se advierte su estado, con la fuente indicada.', '')
        .replace('salud (1000 m), transporte (400 m) y borde de zona (20 m)', 'salud (1000 m) y transporte (400 m)'),
    );
  l.splice(2, 0, LIMITE_BORDE_ZONA);
  return l;
}

function limitacionesClaveDe(ficha: FichaDePunto, limites: string[], grupos: GrupoDeFicha[]): string[] {
  const clave: string[] = [];
  const vigencia = limites.find((x) => x.startsWith('La zonificación vigente es la del PDM'));
  if (ficha.zona && vigencia) clave.push(dividirOracion(vigencia).primera);
  const rectas = limites.find((x) => x.startsWith('Todas las distancias son en línea recta'));
  if (rectas) clave.push(dividirOracion(rectas).primera);
  if (grupos.some((g) => g.subgrupos.some((s) => s.items.some((i) => i.estado === 'informativo' && i.referencia === null && i.distancia)))) clave.push(NOTA_INFORMATIVO);
  clave.push(dividirOracion(NOTA_PELIGROS).primera);
  return clave;
}

/** «ZRE-CH · Reglamentación especial centro histórico — requiere consulta» para lo esencial. */
const textoDeZona = (ficha: FichaDePunto, zona: ItemDeFicha): string => (ficha.zona ? `${ficha.zona.codigo} · ${zona.resumen}` : zona.resumen);

/** Arma la ficha para la web a partir de lo que devolvió `fichaDePunto` y de las fuentes de la base (`fuentes`). Función pura. */
export function armarReporte(ficha: FichaDePunto, fuentes: Fila[], ahora: Date = new Date()): ReporteDePunto {
  const lugares = lugaresDeEntorno(filasDeEntorno(ficha));
  const limitaciones = limitacionesDe(ficha);
  const c: Contexto = { ficha, fuentes, lugares, limites: limitaciones };
  const grupos = armarGrupos(c, lugares);
  const por = (id: GrupoDeFicha['id']) => grupos.find((g) => g.id === id)!;
  return {
    punto: ficha.punto,
    distrito: ficha.distrito ? capitalizar(ficha.distrito.nombre) : null,
    generado: ahora.toISOString(),
    aviso: AVISO,
    esencial: (['construir', 'cerca', 'moverse', 'riesgos'] as const).map((id) => ({ texto: id === 'construir' ? textoDeZona(ficha, por('construir').subgrupos[0].items[0]) : por(id).resumen, grupo: id })),
    grupos,
    lugares,
    pasos: pasosDeFicha(c),
    limitacionesClave: limitacionesClaveDe(ficha, limitaciones, grupos),
    limitaciones,
  };
}

/** La ficha completa de un punto: consulta la base y arma el informe. */
export async function reporteDePunto(base: Base, p: Punto): Promise<ReporteDePunto> {
  const [ficha, fuentes] = await Promise.all([fichaDePunto(base, p), leerFuentes(base)]);
  return armarReporte(ficha, fuentes);
}
