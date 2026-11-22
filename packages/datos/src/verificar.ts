/**
 * verificar.ts — Compara la base contra los archivos de public/data (tarea 2.5). Lo usa `pnpm datos:verificar` cuando hay DATABASE_URL.
 *
 * Por cada archivo: que esté cargado, que su SHA-256 sea el del archivo y que la tabla tenga tantas filas como elementos trae. Además, que no
 * quede en la base un archivo que ya no existe, y que cada fuente tenga fecha y su frase de límite.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Base } from './cliente.ts';
import { definicionDe } from './catalogo.ts';
import { listarArchivos } from './cargar.ts';

export interface Comprobacion {
  ok: boolean;
  nombre: string;
  detalle: string;
}

const TABLAS_DE: Record<string, string[]> = { ruta_y_paradero: ['ruta', 'paradero'] };

export async function verificarBase(base: Base, carpeta: string): Promise<Comprobacion[]> {
  const out: Comprobacion[] = [];
  const rutas = listarArchivos(carpeta);
  const enBase = new Map((await base.consulta<{ ruta: string; tabla: string; sha256: string; registros: number }>('SELECT ruta, tabla, sha256, registros FROM archivo_dato')).map((a) => [a.ruta, a]));

  for (const ruta of rutas) {
    const def = definicionDe(ruta);
    if (!def) {
      out.push({ ok: false, nombre: `Base: ${ruta} está en el catálogo`, detalle: 'falta su entrada en packages/datos/src/catalogo.ts' });
      continue;
    }
    const fila = enBase.get(ruta);
    if (!fila) {
      out.push({ ok: false, nombre: `Base: ${ruta} está cargado`, detalle: 'no está en la base; corra pnpm bd:cargar' });
      continue;
    }
    const bytes = fs.readFileSync(path.join(carpeta, ruta));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const json = JSON.parse(bytes.toString('utf8'));
    const esperados = json.type === 'FeatureCollection' ? json.features.length : 1;
    let filas = 0;
    for (const tabla of TABLAS_DE[fila.tabla] ?? [fila.tabla]) filas += Number((await base.consulta(`SELECT count(*)::int AS n FROM ${tabla} WHERE archivo = $1`, [ruta]))[0].n);
    const ok = fila.sha256 === sha && filas === esperados && fila.registros === esperados;
    out.push({
      ok,
      nombre: `Base: ${ruta} coincide con el archivo`,
      detalle: ok ? `${filas} registros en ${fila.tabla}` : fila.sha256 !== sha ? 'el archivo cambió después de cargarlo; corra pnpm bd:cargar' : `${filas} filas en la base, ${esperados} elementos en el archivo`,
    });
  }

  const sobran = [...enBase.keys()].filter((r) => !rutas.includes(r));
  out.push({ ok: sobran.length === 0, nombre: 'Base: no hay archivos cargados que ya no existen', detalle: sobran.length ? sobran.join(', ') : `${rutas.length} archivos` });

  const invalidas = await base.consulta<{ tabla: string; n: number }>(
    `SELECT 'zona' AS tabla, count(*)::int AS n FROM zona WHERE NOT ST_IsValid(geom)
     UNION ALL SELECT 'distrito', count(*)::int FROM distrito WHERE NOT ST_IsValid(geom)
     UNION ALL SELECT 'manzana_censo', count(*)::int FROM manzana_censo WHERE NOT ST_IsValid(geom)`,
  );
  for (const i of invalidas) out.push({ ok: true, nombre: `Base: geometrías de ${i.tabla}`, detalle: i.n === 0 ? 'todas válidas según PostGIS' : `${i.n} no válidas según PostGIS (informativo: ST_Covers puede fallar en ellas)` });

  const fuentes = await base.consulta<{ id: string; fecha: string | null; limite: string | null; archivos: number }>(
    `SELECT f.id, f.fecha::text AS fecha, f.limite, (SELECT count(*) FROM archivo_dato a WHERE a.fuente_id = f.id)::int AS archivos FROM fuente f`,
  );
  const conDatos = fuentes.filter((f) => f.archivos > 0);
  const sinLimite = conDatos.filter((f) => !f.limite).map((f) => f.id);
  out.push({ ok: sinLimite.length === 0, nombre: 'Base: cada fuente con datos tiene su frase de límite', detalle: sinLimite.length ? sinLimite.join(', ') : `${conDatos.length} fuentes` });
  const sinFecha = conDatos.filter((f) => !f.fecha).map((f) => f.id);
  out.push({ ok: true, nombre: 'Base: fuentes sin fecha en el archivo', detalle: sinFecha.length ? `${sinFecha.join(', ')} (informativo: el archivo no la declara)` : 'ninguna' });
  return out;
}
