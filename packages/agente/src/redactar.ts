/**
 * redactar.ts — La respuesta determinista: una lista corta de avisos con cada criterio, su valor medido, la fuente, la fecha y el enlace.
 * Es la respuesta del modo «reglas» y el respaldo cuando la verificación descarta el texto de un modelo.
 */
import type { Salida } from './herramientas.ts';

const soles = (n: number) => `S/ ${Math.round(n).toLocaleString('es-PE').replace(/,/g, ' ')}`;
const dolares = (n: number) => `US$ ${Math.round(n).toLocaleString('es-PE').replace(/,/g, ' ')}`;

export function precioTexto(a: Salida<'buscar_avisos'>['avisos'][number]): string {
  if (a.precio === null) return 'precio no indicado';
  const base = a.moneda === 'USD' ? dolares(a.precio) : soles(a.precio);
  return a.moneda === 'USD' && a.precioPen !== null && a.tipoCambio !== null ? `${base} (≈ ${soles(a.precioPen)} al cambio de ${a.tipoCambio}, ${a.tipoCambioFecha})` : base;
}

const marca = (c: boolean | null) => (c === true ? '✔' : c === false ? '✘' : '?');

export function redactarAvisos(r: Salida<'buscar_avisos'>, maximo = 5): string {
  if (r.avisos.length === 0) {
    return [r.motivoVacio ?? 'No encontré avisos que cumplan lo que pides.', ...r.notas, ...r.limites].join('\n');
  }
  const lineas: string[] = [`Encontré ${r.totalHallados} aviso${r.totalHallados === 1 ? '' : 's'} y te muestro los ${Math.min(maximo, r.avisos.length)} que mejor cumplen lo que pides:`, ''];
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
