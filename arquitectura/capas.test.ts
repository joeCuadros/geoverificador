/**
 * capas.test.ts — El monorepo respeta su arquitectura por capas (ADR 0008).
 *
 *   apps/*  ->  packages/agente  ->  packages/datos  ->  packages/dominio
 *
 * Las dependencias solo apuntan hacia abajo; nadie importa de apps/*; las aplicaciones no se importan entre sí. Se comprueba en dos lugares:
 * las dependencias declaradas en cada package.json y los imports del código fuente (nombres `@geoverificador/*` y rutas relativas).
 */
import { describe, expect, it } from 'vitest';
import {
  APLICACIONES,
  EXCEPCIONES,
  NIVEL_DE_PAQUETE,
  RAIZ,
  aplicarExcepciones,
  dependenciaPermitida,
  descubrirEspacios,
  especificadoresDe,
  patronesDelEspacioDeTrabajo,
  violacionesDeImports,
  violacionesDeManifiestos,
  type Espacio,
} from './capas.ts';

const e = (grupo: 'apps' | 'packages', carpeta: string) => ({ grupo, carpeta });
const describir = (v: { origen: string; destino: string; donde: string; motivo: string }[]) => v.map((x) => `${x.origen} -> ${x.destino} (${x.donde}): ${x.motivo}`);

describe('regla de capas', () => {
  it('los paquetes solo dependen hacia abajo: agente -> datos -> dominio', () => {
    expect(dependenciaPermitida(e('packages', 'agente'), e('packages', 'datos')).ok).toBe(true);
    expect(dependenciaPermitida(e('packages', 'agente'), e('packages', 'dominio')).ok).toBe(true);
    expect(dependenciaPermitida(e('packages', 'datos'), e('packages', 'dominio')).ok).toBe(true);
  });

  it('dominio no importa ningún otro paquete y datos no importa agente', () => {
    expect(dependenciaPermitida(e('packages', 'dominio'), e('packages', 'datos')).ok).toBe(false);
    expect(dependenciaPermitida(e('packages', 'dominio'), e('packages', 'agente')).ok).toBe(false);
    expect(dependenciaPermitida(e('packages', 'datos'), e('packages', 'agente')).ok).toBe(false);
  });

  it('las aplicaciones pueden importar cualquier paquete', () => {
    for (const app of APLICACIONES) for (const p of Object.keys(NIVEL_DE_PAQUETE)) expect(dependenciaPermitida(e('apps', app), e('packages', p)).ok).toBe(true);
  });

  it('ningún paquete importa de apps/* y las aplicaciones no se importan entre sí', () => {
    for (const p of Object.keys(NIVEL_DE_PAQUETE)) for (const app of APLICACIONES) expect(dependenciaPermitida(e('packages', p), e('apps', app)).ok).toBe(false);
    expect(dependenciaPermitida(e('apps', 'web'), e('apps', 'api')).ok).toBe(false);
    expect(dependenciaPermitida(e('apps', 'estatica'), e('apps', 'web')).ok).toBe(false);
  });

  it('un paquete nuevo sin nivel asignado se rechaza hasta que se decida su capa', () => {
    expect(dependenciaPermitida(e('packages', 'nuevo'), e('packages', 'dominio')).ok).toBe(false);
  });
});

describe('deudas toleradas', () => {
  const v = { origen: 'apps/api', destino: 'apps/estatica', donde: 'apps/api/src/x.ts', motivo: 'las aplicaciones no se importan entre sí' };
  it('una violación cubierta por una excepción no cuenta, y una que no está en la lista sí', () => {
    const r = aplicarExcepciones([v, { ...v, donde: 'apps/api/src/y.ts' }], [{ donde: 'apps/api/src/x.ts', destino: 'apps/estatica', motivo: 'prueba' }]);
    expect(r.pendientes.map((x) => x.donde)).toEqual(['apps/api/src/y.ts']);
    expect(r.sinUsar).toEqual([]);
  });
  it('una excepción sin violación correspondiente queda como sin usar', () => {
    expect(aplicarExcepciones([], [{ donde: 'apps/api/src/x.ts', destino: 'apps/estatica', motivo: 'prueba' }]).sinUsar).toEqual(['apps/api/src/x.ts']);
  });
});

describe('lectura de imports', () => {
  it('reconoce import, import dinámico, export from y require, y no los de los comentarios', () => {
    const texto = [
      "import { a } from '@geoverificador/datos/cliente';",
      "import '../x.js';",
      "export * from './y.ts';",
      "const z = await import('@geoverificador/dominio/nucleo');",
      "const w = require('../../public/js/w.js');",
      "// import { fantasma } from '@geoverificador/agente/tool';",
      "/* require('../comentado.js') */",
      "const url = 'http://ejemplo.pe/ruta';",
    ].join('\n');
    expect(especificadoresDe(texto).sort()).toEqual(['../../public/js/w.js', '../x.js', './y.ts', '@geoverificador/datos/cliente', '@geoverificador/dominio/nucleo']);
  });
});

describe('el repositorio', () => {
  const espacios: Espacio[] = descubrirEspacios();
  const ids = espacios.map((x) => `${x.grupo}/${x.carpeta}`);

  it('declara apps/* y packages/* como espacios de trabajo', () => {
    expect(patronesDelEspacioDeTrabajo(RAIZ).sort()).toEqual(['apps/*', 'packages/*']);
  });

  it('tiene las tres aplicaciones y las tres capas de paquetes', () => {
    expect(ids).toEqual(['apps/api', 'apps/estatica', 'apps/web', 'packages/agente', 'packages/datos', 'packages/dominio']);
  });

  it('cada paquete tiene un nivel asignado en la regla', () => {
    for (const p of espacios.filter((x) => x.grupo === 'packages')) expect(NIVEL_DE_PAQUETE, p.carpeta).toHaveProperty(p.carpeta);
  });

  it('los nombres de package.json siguen el alcance @geoverificador/<carpeta>', () => {
    for (const x of espacios) expect(x.nombre).toBe(`@geoverificador/${x.carpeta}`);
  });

  it('las dependencias declaradas en package.json apuntan hacia abajo', () => {
    expect(describir(violacionesDeManifiestos(espacios))).toEqual([]);
  });

  it('los imports del código fuente apuntan hacia abajo y no salen de su espacio sin pasar por un paquete', () => {
    expect(describir(aplicarExcepciones(violacionesDeImports(espacios)).pendientes)).toEqual([]);
  });

  it('las deudas toleradas siguen existiendo (si una ya no hace falta, hay que borrarla de EXCEPCIONES)', () => {
    expect(aplicarExcepciones(violacionesDeImports(espacios)).sinUsar).toEqual([]);
  });

  it('la lista de deudas no crece: solo los dos controladores de Nest que comparten el núcleo de api/_lib', () => {
    expect(EXCEPCIONES.map((x) => x.donde).sort()).toEqual(['apps/api/src/auth.controller.ts', 'apps/api/src/chat.controller.ts']);
  });
});
