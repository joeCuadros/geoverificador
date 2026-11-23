/**
 * difuso.ts — Coincidencia tolerante a errores de tipeo, sin red ni base de datos.
 *
 * Una errata se corrige solo si es clara: la palabra es larga, queda a una o dos letras de UNA palabra del vocabulario y a ninguna otra de otro valor.
 * Si hay duda, no se elige: quien llama la lista y le pregunta a la persona. Las palabras cortas solo coinciden exactas («cosas» no es «casas»),
 * salvo cuando la persona está contestando una pregunta y su respuesta es una sola palabra (`tolerante`).
 */
import { normalizar } from '@geoverificador/dominio/texto';

/** Distancia de edición con transposición de letras vecinas (Damerau-Levenshtein restringida). */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const filas: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array.from({ length: b.length }, () => 0)]);
  for (let j = 0; j <= b.length; j++) filas[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      filas[i][j] = Math.min(filas[i - 1][j] + 1, filas[i][j - 1] + 1, filas[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) filas[i][j] = Math.min(filas[i][j], filas[i - 2][j - 2] + 1);
    }
  }
  return filas[a.length][b.length];
}

/** 1 si son iguales, 0 si no comparten nada. */
export function parecido(a: string, b: string): number {
  const largo = Math.max(a.length, b.length);
  return largo === 0 ? 1 : 1 - distancia(a, b) / largo;
}

export interface Entrada<T> {
  texto: string;
  valor: T;
}

export interface Coincidencia<T> {
  valor: T;
  /** La palabra del vocabulario a la que se llegó. */
  texto: string;
  distancia: number;
  exacta: boolean;
  /** false si otro valor distinto queda igual de cerca: no se debe elegir sin preguntar. */
  clara: boolean;
  /** Los demás valores igual de cerca (cuando no es clara). */
  empatados: Entrada<T>[];
}

/** Cuántas letras puede estar mal una palabra de ese largo. */
function tolerancia(largo: number, tolerante: boolean): number {
  if (largo <= 4) return tolerante ? 1 : 0;
  if (largo === 5) return tolerante ? 1 : 0;
  if (largo === 6) return 1;
  return 2;
}

/**
 * La palabra del vocabulario más cercana a `palabra`, o null si ninguna está dentro de la tolerancia.
 * Con `tolerante` (la persona está contestando una pregunta con una sola palabra) se aceptan también erratas de una letra en palabras cortas
 * si la primera letra coincide.
 */
export function mejorDe<T>(palabra: string, vocabulario: Entrada<T>[], { tolerante = false }: { tolerante?: boolean } = {}): Coincidencia<T> | null {
  const p = normalizar(palabra);
  if (!p) return null;
  let mejor: { e: Entrada<T>; d: number } | null = null;
  const candidatos: { e: Entrada<T>; d: number }[] = [];
  for (const e of vocabulario) {
    const v = normalizar(e.texto);
    if (v === p) return { valor: e.valor, texto: e.texto, distancia: 0, exacta: true, clara: true, empatados: [] };
    const d = distancia(p, v);
    const max = tolerancia(p.length, tolerante);
    if (max === 0 || d > max || d / Math.max(p.length, v.length) > 0.34) continue;
    if (p.length <= 5 && p[0] !== v[0]) continue;
    candidatos.push({ e, d });
    if (!mejor || d < mejor.d) mejor = { e, d };
  }
  if (!mejor) return null;
  const empatados = candidatos.filter((c) => c.d === mejor!.d && c.e.valor !== mejor!.e.valor).map((c) => c.e);
  return { valor: mejor.e.valor, texto: mejor.e.texto, distancia: mejor.d, exacta: false, clara: empatados.length === 0, empatados };
}

export interface Cambio {
  dicho: string;
  entendido: string;
}
export interface Duda {
  dicho: string;
  opciones: string[];
}

/**
 * Corrige las palabras de un texto que son erratas claras de una palabra del vocabulario (solo palabras de 6 letras o más; las demás se dejan).
 * Conserva la puntuación y las demás palabras. Lo dudoso no se cambia: va en `dudas`.
 */
export function corregirPalabras<T>(texto: string, vocabulario: Entrada<T>[], { minimo = 6, protegidas = new Set<string>() }: { minimo?: number; protegidas?: Set<string> } = {}): { texto: string; cambios: Cambio[]; dudas: Duda[] } {
  const cambios: Cambio[] = [];
  const dudas: Duda[] = [];
  const conocidas = new Set(vocabulario.map((e) => normalizar(e.texto)));
  const salida = texto.replace(/[\p{L}][\p{L}\p{N}]*/gu, (palabra) => {
    const n = normalizar(palabra);
    if (n.length < minimo || conocidas.has(n) || protegidas.has(n)) return palabra;
    const m = mejorDe(palabra, vocabulario);
    if (!m) return palabra;
    if (!m.clara) {
      dudas.push({ dicho: palabra, opciones: [...new Set([m.texto, ...m.empatados.map((x) => x.texto)])] });
      return palabra;
    }
    cambios.push({ dicho: palabra, entendido: m.texto });
    return m.texto;
  });
  return { texto: salida, cambios, dudas };
}
