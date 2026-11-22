/**
 * avisos.ts — Reglas puras de la fase 3 «Avisos confiables» (sin red ni base de datos).
 *
 *   inferirTipo            3.3  tipo de un proyecto a partir de su título, marcado como inferido
 *   equivalenteEnSoles     3.4  precio original + equivalente en soles con tipo de cambio fechado; nunca inventa una cotización
 *   mismoInmueble          3.5  ¿dos avisos de portales distintos son el mismo inmueble?
 *   agruparDuplicados      3.5  grupos de avisos que son el mismo inmueble
 *   resumirCorrida         3.8  reporte por corrida: recibidos, descartados, sin coordenadas, sin distrito
 *
 * El aviso es el del esquema de scripts/lib/avisos/esquema.js: solo campos del inmueble, sin vendedor ni contacto.
 */

export type Moneda = 'PEN' | 'USD';
export type TipoInmueble = 'departamento' | 'casa' | 'terreno' | 'local' | 'oficina';

export interface AvisoRecolectado {
  fuente: string;
  id_fuente: string;
  url: string;
  titulo: string | null;
  tipo_inmueble: TipoInmueble | null;
  tipo_portal: string | null;
  es_proyecto: boolean;
  precio: number | null;
  precio_max: number | null;
  moneda: Moneda | null;
  area_total_m2: number | null;
  area_construida_m2: number | null;
  dormitorios: number | null;
  dormitorios_max: number | null;
  banos: number | null;
  estacionamientos: number | null;
  distrito: string | null;
  zona: string | null;
  direccion: string | null;
  lat: number | null;
  lon: number | null;
  fecha_publicacion: string | null;
  fecha_captura: string;
}

export interface TipoCambio {
  /** Día de la cotización (AAAA-MM-DD). */
  fecha: string;
  /** Soles por dólar, cotización de venta. */
  venta: number;
  fuente: string;
}

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PATRONES_TIPO: [RegExp, TipoInmueble][] = [
  [/\b(departamentos?|dptos?|deptos?|duplex|flat|penthouse|condominio|edificio|torres?|residencial)\b/, 'departamento'],
  [/\b(casas?|chalet|villas?)\b/, 'casa'],
  [/\b(terrenos?|lotes?|lotizacion|habilitacion urbana)\b/, 'terreno'],
  [/\b(oficinas?)\b/, 'oficina'],
  [/\b(local(es)? comercial(es)?|locales?|tiendas?)\b/, 'local'],
];

/**
 * Tipo de un aviso. Si el portal ya lo dio, se respeta. Si no (los proyectos cuando se busca «todos»), se busca en el título una palabra que lo
 * diga sin ambigüedad; si el título nombra dos tipos distintos o ninguno, queda en null: no se adivina.
 */
export function inferirTipo(aviso: Pick<AvisoRecolectado, 'tipo_inmueble' | 'titulo' | 'tipo_portal'>): { tipo: TipoInmueble | null; inferido: boolean } {
  if (aviso.tipo_inmueble) return { tipo: aviso.tipo_inmueble, inferido: false };
  const texto = sinTildes(`${aviso.titulo ?? ''} ${aviso.tipo_portal ?? ''}`);
  const hallados = new Set(PATRONES_TIPO.filter(([p]) => p.test(texto)).map(([, t]) => t));
  return hallados.size === 1 ? { tipo: [...hallados][0], inferido: true } : { tipo: null, inferido: false };
}

/** Antigüedad máxima de la cotización respecto del día en que se vio el aviso. */
export const MAX_DIAS_TIPO_CAMBIO = 7;

const diasEntre = (a: string, b: string): number => Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000;

/**
 * Precio en soles. En soles es el mismo precio. En dólares se multiplica por la cotización de venta, solo si la cotización es de la fecha del
 * aviso o de hasta MAX_DIAS_TIPO_CAMBIO días antes o después; si no hay cotización que sirva, el equivalente queda en null.
 */
export function equivalenteEnSoles(precio: number | null, moneda: Moneda | null, fechaAviso: string, tc: TipoCambio | null): { precioPen: number | null; tipoCambio: number | null; tipoCambioFecha: string | null } {
  const vacio = { precioPen: null, tipoCambio: null, tipoCambioFecha: null };
  if (precio === null || !(precio > 0) || moneda === null) return vacio;
  if (moneda === 'PEN') return { precioPen: precio, tipoCambio: null, tipoCambioFecha: null };
  if (!tc || !(tc.venta > 0) || diasEntre(tc.fecha, fechaAviso) > MAX_DIAS_TIPO_CAMBIO) return vacio;
  return { precioPen: Math.round(precio * tc.venta * 100) / 100, tipoCambio: tc.venta, tipoCambioFecha: tc.fecha };
}

/** El precio pedido en la moneda de la consulta, llevado a soles con la misma regla. null si no se puede convertir. */
export function topeEnSoles(monto: number, moneda: Moneda, hoy: string, tc: TipoCambio | null): number | null {
  return equivalenteEnSoles(monto, moneda, hoy, tc).precioPen;
}

export interface AvisoComparable {
  id: number | string;
  fuente: string;
  tipo: string | null;
  esProyecto: boolean;
  precioPen: number | null;
  areaM2: number | null;
  dormitorios: number | null;
  distrito: string | null;
  titulo: string | null;
  lat: number | null;
  lon: number | null;
}

const RADIO_TIERRA_M = 6371008.8;
function distanciaM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h));
}

const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'en', 'y', 'a', 'con', 'venta', 'vendo', 'se', 'vende', 'ocasion', 'oportunidad', 'lindo', 'hermoso', 'amplio']);
const palabras = (t: string | null): Set<string> => new Set(sinTildes(t ?? '').split(/[^a-z0-9]+/).filter((p) => p.length > 1 && !PALABRAS_VACIAS.has(p)));

/** Parecido de dos títulos entre 0 y 1 (palabras en común sobre palabras en total). */
export function parecidoDeTitulos(a: string | null, b: string | null): number {
  const x = palabras(a);
  const y = palabras(b);
  if (x.size === 0 || y.size === 0) return 0;
  let comunes = 0;
  for (const p of x) if (y.has(p)) comunes++;
  return comunes / (x.size + y.size - comunes);
}

const cerca = (a: number, b: number, tolerancia: number): boolean => Math.abs(a - b) <= tolerancia * Math.max(a, b);

/** Tolerancias de la regla de duplicados. Son una convención del proyecto: se revisan con el reporte de cada corrida. */
export const DUPLICADO = { precio: 0.02, area: 0.03, distanciaM: 100, titulo: 0.6 };

/**
 * ¿Dos avisos son el mismo inmueble publicado en dos portales? Tienen que ser de fuentes distintas, del mismo tipo y coincidir en precio (±2 %) y
 * área (±3 %). Además: si los dos tienen coordenadas, estar a 100 m o menos; si no, ser del mismo distrito y tener títulos parecidos.
 * Sin precio o sin área en alguno de los dos no se afirma que sean el mismo. Los proyectos (rangos «desde») no se cruzan.
 */
export function mismoInmueble(a: AvisoComparable, b: AvisoComparable): boolean {
  if (a.fuente === b.fuente || a.esProyecto || b.esProyecto) return false;
  if (!a.tipo || a.tipo !== b.tipo) return false;
  if (a.precioPen === null || b.precioPen === null || a.areaM2 === null || b.areaM2 === null) return false;
  if (!cerca(a.precioPen, b.precioPen, DUPLICADO.precio) || !cerca(a.areaM2, b.areaM2, DUPLICADO.area)) return false;
  if (a.dormitorios !== null && b.dormitorios !== null && a.dormitorios !== b.dormitorios) return false;
  if (a.lat !== null && a.lon !== null && b.lat !== null && b.lon !== null) return distanciaM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) <= DUPLICADO.distanciaM;
  return !!a.distrito && a.distrito === b.distrito && parecidoDeTitulos(a.titulo, b.titulo) >= DUPLICADO.titulo;
}

/**
 * Agrupa los avisos que son el mismo inmueble. Devuelve, por cada aviso que tiene al menos un duplicado, el id del grupo (el menor id del grupo).
 * Un aviso sin duplicados no aparece.
 */
export function agruparDuplicados(avisos: AvisoComparable[]): Map<AvisoComparable['id'], AvisoComparable['id']> {
  const padre = new Map<AvisoComparable['id'], AvisoComparable['id']>();
  const raiz = (x: AvisoComparable['id']): AvisoComparable['id'] => {
    let r = x;
    while (padre.has(r) && padre.get(r) !== r) r = padre.get(r)!;
    return r;
  };
  // Solo se comparan avisos del mismo tipo y distrito cercano en precio: se ordena por precio y se mira una ventana.
  const lista = avisos.filter((a) => a.precioPen !== null && a.tipo && !a.esProyecto).sort((a, b) => a.precioPen! - b.precioPen!);
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length && lista[j].precioPen! <= lista[i].precioPen! * (1 + DUPLICADO.precio) + 1; j++) {
      if (!mismoInmueble(lista[i], lista[j])) continue;
      const [x, y] = [raiz(lista[i].id), raiz(lista[j].id)];
      const menor = x < y ? x : y;
      padre.set(x, menor);
      padre.set(y, menor);
      padre.set(lista[i].id, menor);
      padre.set(lista[j].id, menor);
    }
  }
  const grupos = new Map<AvisoComparable['id'], AvisoComparable['id']>();
  for (const id of padre.keys()) grupos.set(id, raiz(id));
  return grupos;
}

/**
 * Caja que contiene los 25 distritos de public/data/distritos_aqp.geojson (redondeada hacia afuera). Es más grande que la del mapa (CONFIG.viewbox):
 * La Joya, Yura o Polobaya se extienden más allá. Una coordenada fuera de aquí no es de un aviso de la provincia. test/…/avisos.test.ts comprueba que
 * la caja sigue conteniendo a los distritos.
 */
export const CAJA_AREQUIPA = { oeste: -71.92, sur: -16.79, este: -70.8, norte: -15.92 };
export const enArequipa = (lat: number, lon: number): boolean => lat >= CAJA_AREQUIPA.sur && lat <= CAJA_AREQUIPA.norte && lon >= CAJA_AREQUIPA.oeste && lon <= CAJA_AREQUIPA.este;

export interface ReporteCorrida {
  recibidos: number;
  aceptados: number;
  descartados: number;
  motivosDescarte: Record<string, number>;
  sinCoordenadas: number;
  sinDistrito: number;
  sinPrecio: number;
  sinTipo: number;
  porFuente: Record<string, { recibidos: number; aceptados: number; sinCoordenadas: number }>;
  distritos: string[];
  pctConCoordenadas: number | null;
}

/** Motivo por el que un aviso no entra a la base, o null si entra. */
export function motivoDescarte(a: AvisoRecolectado): string | null {
  if (!a.id_fuente || !a.url) return 'sin identificador o enlace';
  if (!/^https?:\/\//i.test(a.url)) return 'enlace no válido';
  if (a.lat !== null && a.lon !== null && !enArequipa(a.lat, a.lon)) return 'coordenada fuera de Arequipa';
  if (a.precio !== null && a.moneda === null) return 'precio sin moneda';
  return null;
}

/** Reporte de una corrida (tarea 3.8). `aceptados` son los avisos que pasaron motivoDescarte. */
export function resumirCorrida(recibidos: AvisoRecolectado[], aceptados: AvisoRecolectado[]): ReporteCorrida {
  const motivos: Record<string, number> = {};
  for (const a of recibidos) {
    const m = motivoDescarte(a);
    if (m) motivos[m] = (motivos[m] ?? 0) + 1;
  }
  const porFuente: ReporteCorrida['porFuente'] = {};
  for (const a of recibidos) (porFuente[a.fuente] ??= { recibidos: 0, aceptados: 0, sinCoordenadas: 0 }).recibidos++;
  for (const a of aceptados) {
    const f = (porFuente[a.fuente] ??= { recibidos: 0, aceptados: 0, sinCoordenadas: 0 });
    f.aceptados++;
    if (a.lat === null || a.lon === null) f.sinCoordenadas++;
  }
  const sinCoordenadas = aceptados.filter((a) => a.lat === null || a.lon === null).length;
  return {
    recibidos: recibidos.length,
    aceptados: aceptados.length,
    descartados: recibidos.length - aceptados.length,
    motivosDescarte: motivos,
    sinCoordenadas,
    sinDistrito: aceptados.filter((a) => !a.distrito).length,
    sinPrecio: aceptados.filter((a) => a.precio === null).length,
    sinTipo: aceptados.filter((a) => !inferirTipo(a).tipo).length,
    porFuente,
    distritos: [...new Set(aceptados.map((a) => a.distrito).filter((d): d is string => !!d))].sort(),
    pctConCoordenadas: aceptados.length ? Math.round(((aceptados.length - sinCoordenadas) / aceptados.length) * 1000) / 10 : null,
  };
}
