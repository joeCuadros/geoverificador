/**
 * redactar.ts — La respuesta determinista: una lista corta de avisos con cada criterio, su valor medido, la fuente, la fecha y el enlace.
 * Es la respuesta del modo «reglas» y el respaldo cuando la verificación descarta el texto de un modelo.
 *
 *   · `titularDeAvisos`: la frase corta que abre la respuesta (es lo único que un modelo de lenguaje puede reescribir).
 *   · `cuerpoDeAvisos`: el detalle verificable (avisos, criterios, fuentes, fechas, enlaces y límites). Siempre determinista.
 */
import type { Salida } from './herramientas.ts';

export const soles = (n: number) => `S/ ${Math.round(n).toLocaleString('es-PE').replace(/,/g, ' ')}`;
export const dolares = (n: number) => `US$ ${Math.round(n).toLocaleString('es-PE').replace(/,/g, ' ')}`;

export function precioTexto(a: Salida<'buscar_avisos'>['avisos'][number]): string {
  if (a.precio === null) return 'precio no indicado';
  const base = a.moneda === 'USD' ? dolares(a.precio) : soles(a.precio);
  return a.moneda === 'USD' && a.precioPen !== null && a.tipoCambio !== null ? `${base} (≈ ${soles(a.precioPen)} al cambio de ${a.tipoCambio}, ${a.tipoCambioFecha})` : base;
}

export const marca = (c: boolean | null) => (c === true ? '✔' : c === false ? '✘' : '?');

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** La frase que abre una respuesta con avisos. Las cifras son las de la herramienta. */
export function titularDeAvisos(r: Salida<'buscar_avisos'>, maximo = 5): string {
  const mostrados = Math.min(maximo, r.avisos.length);
  const total = r.totalHallados;
  const hallados = `Encontré ${total} ${plural(total, 'aviso', 'avisos')}`;
  const conCriterios = r.avisos.some((a) => a.pedidos > 0);
  if (mostrados === total) return `${hallados}${total === 1 ? '' : conCriterios ? ', ordenados por cuántos de tus criterios cumplen' : ', del visto más recientemente al más antiguo'}.`;
  return conCriterios ? `${hallados} y te muestro los ${mostrados} que cumplen más de lo que pides.` : `${hallados} y te muestro los ${mostrados} vistos más recientemente.`;
}

/** El detalle de los avisos, sin la frase de apertura: lista, notas y límites. */
export function cuerpoDeAvisos(r: Salida<'buscar_avisos'>, maximo = 5): string {
  const lineas: string[] = [];
  r.avisos.slice(0, maximo).forEach((a, i) => {
    lineas.push(`${i + 1}. ${a.titulo ?? 'Aviso sin título'} — ${a.distrito ?? 'distrito sin dato'} — ${precioTexto(a)}`);
    if (a.pedidos > 0) lineas.push(`   Cumple ${a.cumplidos} de ${a.pedidos} criterios (${a.sinDato} sin dato).`);
    for (const c of a.criterios) lineas.push(`   ${marca(c.cumple)} ${c.etiqueta}: ${c.valor}${c.fuente ? ` · fuente: ${c.fuente}` : ''}${c.fecha ? ` (${c.fecha})` : ''}${c.nota ? ` — ${c.nota}` : ''}`);
    lineas.push(`   Fuente: ${a.fuente} · visto por última vez el ${a.vistoPorUltimaVez}${a.tambienEn.length ? ` · también en ${a.tambienEn.join(', ')}` : ''}`);
    lineas.push(`   ${a.url}`);
  });
  if (r.notas.length) lineas.push('', ...r.notas);
  lineas.push('', ...r.limites);
  return lineas.join('\n');
}

export function redactarAvisos(r: Salida<'buscar_avisos'>, maximo = 5): string {
  if (r.avisos.length === 0) {
    return [r.motivoVacio ?? 'No encontré avisos que cumplan lo que pides.', ...r.notas, ...r.limites].join('\n');
  }
  return [titularDeAvisos(r, maximo), '', cuerpoDeAvisos(r, maximo)].join('\n');
}
