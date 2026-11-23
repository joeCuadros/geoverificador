/**
 * capas.ts — Reglas de dependencia entre las capas del monorepo y el explorador que las comprueba (ADR 0008).
 *
 * Capas, de abajo hacia arriba: dominio (reglas puras) -> datos (infraestructura) -> agente (aplicación) -> apps (api, web, estatica).
 * Una dependencia solo puede apuntar hacia abajo; las aplicaciones no se importan entre sí.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Lugar de cada paquete en la pila: un paquete solo puede depender de los de nivel MENOR. */
export const NIVEL_DE_PAQUETE: Record<string, number> = { dominio: 0, datos: 1, agente: 2 };
/** Las aplicaciones están por encima de todos los paquetes. */
export const APLICACIONES = ['api', 'estatica', 'web'];
export const ALCANCE = '@geoverificador/';

export interface Espacio {
  /** `packages` o `apps`. */
  grupo: 'packages' | 'apps';
  /** Nombre de la carpeta: `dominio`, `web`, … */
  carpeta: string;
  /** Ruta absoluta. */
  ruta: string;
  /** Nombre en package.json (`@geoverificador/dominio`). */
  nombre: string;
  dependencias: string[];
}

export interface Violacion {
  origen: string;
  destino: string;
  donde: string;
  motivo: string;
}

/** Id corto de un espacio: `packages/dominio`, `apps/web`. */
export const idDe = (e: Pick<Espacio, 'grupo' | 'carpeta'>) => `${e.grupo}/${e.carpeta}`;

/** ¿Puede `origen` depender de `destino`? Solo hacia abajo; entre aplicaciones, nunca. */
export function dependenciaPermitida(origen: Pick<Espacio, 'grupo' | 'carpeta'>, destino: Pick<Espacio, 'grupo' | 'carpeta'>): { ok: boolean; motivo: string } {
  if (origen.grupo === destino.grupo && origen.carpeta === destino.carpeta) return { ok: true, motivo: '' };
  if (destino.grupo === 'apps') return { ok: false, motivo: origen.grupo === 'apps' ? 'las aplicaciones no se importan entre sí' : 'ningún paquete importa de apps/*' };
  if (origen.grupo === 'apps') return { ok: true, motivo: '' };
  const nOrigen = NIVEL_DE_PAQUETE[origen.carpeta];
  const nDestino = NIVEL_DE_PAQUETE[destino.carpeta];
  if (nOrigen === undefined || nDestino === undefined) return { ok: false, motivo: 'paquete sin nivel asignado en NIVEL_DE_PAQUETE' };
  if (nDestino < nOrigen) return { ok: true, motivo: '' };
  return { ok: false, motivo: `${origen.carpeta} (nivel ${nOrigen}) no puede depender de ${destino.carpeta} (nivel ${nDestino}): las dependencias apuntan hacia abajo` };
}

/** Carpetas de salida o de terceros que no son código del espacio. */
const IGNORAR = new Set(['node_modules', '.next', '.next-e2e', 'dist', 'tipos', 'test-results', 'playwright-report', 'coverage', 'data']);
const EXTENSIONES = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

/** Lee la lista `packages:` de pnpm-workspace.yaml (sin dependencia de un lector de YAML). */
export function patronesDelEspacioDeTrabajo(raiz = RAIZ): string[] {
  const texto = fs.readFileSync(path.join(raiz, 'pnpm-workspace.yaml'), 'utf8');
  const bloque = /^packages:\s*\r?\n((?:[ \t]+-[^\r\n]*\r?\n?)+)/m.exec(texto);
  if (!bloque) return [];
  return [...bloque[1].matchAll(/-\s*['"]?([^'"\r\n#]+?)['"]?\s*(?:#.*)?$/gm)].map((m) => m[1].trim());
}

/** Los espacios de trabajo que declaran los patrones `apps/*` y `packages/*`. */
export function descubrirEspacios(raiz = RAIZ): Espacio[] {
  const espacios: Espacio[] = [];
  for (const patron of patronesDelEspacioDeTrabajo(raiz)) {
    const [grupo, comodin] = patron.split('/');
    if ((grupo !== 'apps' && grupo !== 'packages') || comodin !== '*') continue;
    const base = path.join(raiz, grupo);
    if (!fs.existsSync(base)) continue;
    for (const entrada of fs.readdirSync(base, { withFileTypes: true })) {
      const manifiesto = path.join(base, entrada.name, 'package.json');
      if (!entrada.isDirectory() || !fs.existsSync(manifiesto)) continue;
      const pkg = JSON.parse(fs.readFileSync(manifiesto, 'utf8'));
      const dependencias = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
      espacios.push({ grupo, carpeta: entrada.name, ruta: path.join(base, entrada.name), nombre: pkg.name, dependencias });
    }
  }
  return espacios.sort((a, b) => idDe(a).localeCompare(idDe(b)));
}

/** Archivos de código de un espacio (sin dependencias instaladas ni salidas de compilación). */
export function archivosDeCodigo(carpeta: string): string[] {
  const lista: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!IGNORAR.has(e.name) && !e.name.startsWith('.')) recorrer(path.join(dir, e.name));
      } else if (EXTENSIONES.has(path.extname(e.name))) lista.push(path.join(dir, e.name));
    }
  };
  recorrer(carpeta);
  return lista;
}

/** Quita comentarios para no confundir el texto de un comentario con un import. */
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\r\n]*/g, '$1');

/** Cadenas que se importan en un archivo: `import … from 'x'`, `import 'x'`, `import('x')`, `require('x')`. */
export function especificadoresDe(texto: string): string[] {
  const t = sinComentarios(texto);
  const patrones = [/\bfrom\s*['"]([^'"\r\n]+)['"]/g, /\bimport\s*['"]([^'"\r\n]+)['"]/g, /\bimport\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)/g];
  const salida = new Set<string>();
  for (const p of patrones) for (const m of t.matchAll(p)) salida.add(m[1]);
  return [...salida];
}

/** A qué espacio pertenece una ruta absoluta (o `null` si cae fuera de todos). */
export function espacioDe(ruta: string, espacios: Espacio[]): Espacio | null {
  return espacios.find((e) => !path.relative(e.ruta, ruta).startsWith('..') && !path.isAbsolute(path.relative(e.ruta, ruta))) ?? null;
}

/** Dependencias declaradas en package.json que rompen la regla. */
export function violacionesDeManifiestos(espacios: Espacio[]): Violacion[] {
  const porNombre = new Map(espacios.map((e) => [e.nombre, e]));
  const v: Violacion[] = [];
  for (const origen of espacios) {
    for (const dep of origen.dependencias) {
      if (!dep.startsWith(ALCANCE)) continue;
      const destino = porNombre.get(dep);
      if (!destino) {
        v.push({ origen: idDe(origen), destino: dep, donde: 'package.json', motivo: 'depende de un paquete del alcance que no es un espacio de trabajo' });
        continue;
      }
      const r = dependenciaPermitida(origen, destino);
      if (!r.ok) v.push({ origen: idDe(origen), destino: idDe(destino), donde: 'package.json', motivo: r.motivo });
    }
  }
  return v;
}

/** Imports del código fuente (por nombre de paquete o por ruta relativa) que rompen la regla. */
export function violacionesDeImports(espacios: Espacio[], raiz = RAIZ): Violacion[] {
  const porNombre = new Map(espacios.map((e) => [e.nombre, e]));
  const v: Violacion[] = [];
  for (const origen of espacios) {
    for (const archivo of archivosDeCodigo(origen.ruta)) {
      const donde = path.relative(raiz, archivo).replace(/\\/g, '/');
      for (const esp of especificadoresDe(fs.readFileSync(archivo, 'utf8'))) {
        if (esp.startsWith(ALCANCE)) {
          const nombre = esp.split('/').slice(0, 2).join('/');
          const destino = porNombre.get(nombre);
          if (!destino) {
            v.push({ origen: idDe(origen), destino: esp, donde, motivo: 'importa un paquete del alcance que no es un espacio de trabajo' });
            continue;
          }
          const r = dependenciaPermitida(origen, destino);
          if (!r.ok) v.push({ origen: idDe(origen), destino: idDe(destino), donde, motivo: r.motivo });
          else if (destino !== origen && !origen.dependencias.includes(nombre)) v.push({ origen: idDe(origen), destino: idDe(destino), donde, motivo: `importa ${nombre} sin declararlo en su package.json` });
        } else if (esp.startsWith('.')) {
          const resuelto = path.resolve(path.dirname(archivo), esp);
          const destino = espacioDe(resuelto, espacios);
          if (destino === origen) continue;
          if (!destino) {
            v.push({ origen: idDe(origen), destino: path.relative(raiz, resuelto).replace(/\\/g, '/'), donde, motivo: 'la ruta relativa sale del espacio de trabajo hacia código que no es de un espacio' });
            continue;
          }
          const r = dependenciaPermitida(origen, destino);
          if (!r.ok) v.push({ origen: idDe(origen), destino: idDe(destino), donde, motivo: r.motivo });
        }
      }
    }
  }
  return v;
}

/**
 * Deudas conocidas: imports que rompen la regla y que se toleran por ahora, cada una con su razón. La lista solo puede encogerse:
 * una excepción que ya no hace falta falla la prueba (hay que borrarla) y una violación nueva no se agrega aquí sin discutirlo en un ADR.
 */
export const EXCEPCIONES: { donde: string; destino: string; motivo: string }[] = [
  {
    donde: 'apps/api/src/chat.controller.ts',
    destino: 'apps/estatica',
    motivo: 'El controlador de Nest comparte con la función de Vercel el núcleo CommonJS apps/estatica/api/_lib/gemini.js. Se resuelve al retirar el front estático o al extraer ese núcleo a un paquete.',
  },
  {
    donde: 'apps/api/src/auth.controller.ts',
    destino: 'apps/estatica',
    motivo: 'Igual que chat.controller.ts, con apps/estatica/api/_lib/auth.js.',
  },
];

/** Separa las violaciones que quedan de las que cubre una excepción, y las excepciones que ya no se usan. */
export function aplicarExcepciones(violaciones: Violacion[], excepciones = EXCEPCIONES) {
  const usadas = new Set<number>();
  const pendientes = violaciones.filter((v) => {
    const i = excepciones.findIndex((x) => x.donde === v.donde && x.destino === v.destino);
    if (i < 0) return true;
    usadas.add(i);
    return false;
  });
  const sinUsar = excepciones.filter((_, i) => !usadas.has(i)).map((x) => x.donde);
  return { pendientes, sinUsar };
}
