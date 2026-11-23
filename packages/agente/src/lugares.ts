/**
 * lugares.ts — De lo que la persona escribió («UNSA», «parquie idnustrial») a un lugar que el geocodificador local conoce.
 *
 * Primero se prueba el nombre tal cual con `geocodificar_lugar`. Si no hay un punto preciso, se compara con los nombres que existen en los datos
 * (destinos de la configuración, universidades, malls, mercados, salud, colegios, parques y distritos) tolerando erratas:
 *   · una coincidencia clara se usa y se dice («Entendí «parquie idnustrial» como «Parque Industrial»»);
 *   · una coincidencia dudosa no se usa: se devuelven las opciones para que la persona elija;
 *   · si no hay nada parecido, se dice que no se ubicó.
 */
import CONFIG from '@geoverificador/dominio/nucleo/config';
import { normalizar } from '@geoverificador/dominio/texto';
import type { Base } from '@geoverificador/datos/cliente';
import { parecido } from './difuso.ts';
import type { Salida } from './herramientas.ts';

export type Geocodificar = (texto: string) => Promise<Salida<'geocodificar_lugar'>>;

export type ResultadoLugar =
  | { estado: 'ok'; nombre: string; lat: number; lon: number; /** Lo que se escribió, si hubo que corregirlo. */ corregidoDe: string | null }
  | { estado: 'dudoso'; opciones: string[] }
  | { estado: 'no_hallado'; nota: string | null };

const CATEGORIAS = ['educacion_superior', 'malls', 'mercados', 'supermercados', 'salud', 'educacion', 'areasVerdes'];
const enMemoria = new WeakMap<object, Promise<string[]>>();

/** Los nombres de lugares que el geocodificador sabe ubicar. Se leen una vez por conexión. */
export function nombresConocidos(base: Base): Promise<string[]> {
  let p = enMemoria.get(base);
  if (!p) {
    p = (async () => {
      const filas = await base.consulta(`SELECT DISTINCT nombre FROM lugar WHERE categoria = ANY ($1::text[]) AND nombre IS NOT NULL AND length(nombre) > 2`, [CATEGORIAS]);
      const destinos = (CONFIG.destinos as { nombre: string; alias?: string[] }[]).flatMap((d) => [d.nombre, ...(d.alias ?? [])]);
      // Los distritos no están: un distrito es demasiado amplio para medir cercanía, así que no sirve como lugar.
      return [...new Set([...destinos, ...filas.map((f) => String(f.nombre))])];
    })().catch((e) => {
      enMemoria.delete(base);
      throw e;
    });
    enMemoria.set(base, p);
  }
  return p;
}

const palabras = (n: string): string[] => n.split(' ').filter((w) => w.length > 1);

/** Qué tanto se parece lo escrito a un nombre: por frase completa y palabra por palabra (cada palabra escrita busca la suya). */
export function puntaje(q: string, nombre: string): number {
  const v = normalizar(nombre);
  const entera = parecido(q, v);
  const pq = palabras(q);
  const pv = palabras(v);
  if (pq.length === 0 || pv.length === 0) return entera;
  const porPalabra = pq.reduce((suma, w) => suma + Math.max(...pv.map((x) => parecido(w, x))), 0) / pq.length;
  // Si el nombre tiene más palabras que lo escrito, las que faltan restan un poco: «parque industrial» no es «parque industrial de Arequipa».
  const cobertura = Math.min(1, pq.length / pv.length);
  return Math.max(entera, porPalabra * (0.85 + 0.15 * cobertura));
}

const UMBRAL_CLARO = 0.8;
const UMBRAL_DUDOSO = 0.62;
const SEPARACION = 0.06;

export async function resolverLugar(base: Base, texto: string, geocodificar: Geocodificar): Promise<ResultadoLugar> {
  const intento = await geocodificar(texto);
  const util = intento.candidatos.find((c) => c.sirveParaMedir);
  if (util) return { estado: 'ok', nombre: util.nombre, lat: util.lat, lon: util.lon, corregidoDe: null };

  const q = normalizar(texto);
  if (q.length < 3) return { estado: 'no_hallado', nota: intento.nota };
  const conocidos = await nombresConocidos(base);
  const clasificados = conocidos.map((nombre) => ({ nombre, n: normalizar(nombre), p: puntaje(q, nombre) })).filter((x) => x.p >= UMBRAL_DUDOSO).sort((a, b) => b.p - a.p);
  // Un mismo lugar con dos escrituras («Universidad Nacional de San Agustín» y «…Agustin de Arequipa») cuenta una vez.
  const distintos: typeof clasificados = [];
  for (const c of clasificados) if (!distintos.some((d) => d.n === c.n)) distintos.push(c);
  const mejor = distintos[0];
  if (!mejor) return { estado: 'no_hallado', nota: intento.nota };
  const segundo = distintos.find((d) => d.n !== mejor.n && d.p >= mejor.p - SEPARACION);
  if (mejor.p >= UMBRAL_CLARO && !segundo) {
    const g = await geocodificar(mejor.nombre);
    const ubicado = g.candidatos.find((c) => c.sirveParaMedir);
    if (ubicado) return { estado: 'ok', nombre: ubicado.nombre, lat: ubicado.lat, lon: ubicado.lon, corregidoDe: texto };
    return { estado: 'no_hallado', nota: g.nota ?? intento.nota };
  }
  return { estado: 'dudoso', opciones: distintos.slice(0, 3).map((d) => d.nombre) };
}
