/**
 * diferencias.ts — Herramienta de diagnóstico: lista los campos en que la ficha desde la base difiere de la ficha desde archivos.
 *   DATABASE_URL=pglite://.pglite node packages/datos/pruebas/diferencias.ts
 */
import { crearEquipamiento } from '@geoverificador/dominio/nucleo/equipamiento';
import { abrirBase } from '../src/cliente.ts';
import { fichaDePunto } from '../src/ficha.ts';
import { PUNTOS_AUDITORIA, fetchArchivos, rejilla } from './apoyo.ts';

function diferencias(a: any, b: any, ruta = ''): string[] {
  if (a === b) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...claves].flatMap((k) => diferencias(a[k], b[k], `${ruta}.${k}`));
  }
  return [`${ruta}: base=${JSON.stringify(a)?.slice(0, 80)} archivos=${JSON.stringify(b)?.slice(0, 80)}`];
}

const base = await abrirBase();
const cuenta = new Map<string, { n: number; ejemplo: string }>();
for (const p of [...PUNTOS_AUDITORIA, ...rejilla(6)]) {
  const [x, y] = await Promise.all([fichaDePunto(base, p), crearEquipamiento({ fetch: fetchArchivos }).evaluar(p.lat, p.lon)]);
  for (const d of diferencias(JSON.parse(JSON.stringify(x.entorno)), JSON.parse(JSON.stringify(y)))) {
    const clave = d.split(':')[0].replace(/\.\d+(?=\.|$)/g, '.N');
    const previo = cuenta.get(clave) ?? { n: 0, ejemplo: `${p.nombre} ${d}` };
    cuenta.set(clave, { n: previo.n + 1, ejemplo: previo.ejemplo });
  }
}
for (const [k, v] of cuenta) console.log(`${String(v.n).padStart(3)}  ${k}\n       ${v.ejemplo}`);
console.log(cuenta.size ? `\n${cuenta.size} campos distintos.` : 'Sin diferencias.');
await base.cerrar();
