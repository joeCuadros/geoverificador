import { describe, expect, it } from 'vitest';
import { CLAVE_VISTO, PASOS, TOTAL, almacenDelNavegador, anterior, esPrimero, esUltimo, limitar, marcarVisto, progreso, siguiente, textoDelModelo, yaVisto } from '../lib/onboarding.ts';

/** Un almacenamiento en memoria con la forma de `localStorage`. */
function almacenEnMemoria() {
  const datos = new Map<string, string>();
  return { datos, getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
}

describe('los pasos de la guía', () => {
  it('son pocos, con identificador único y texto en cada uno', () => {
    expect(TOTAL).toBeGreaterThanOrEqual(5);
    expect(TOTAL).toBeLessThanOrEqual(7);
    expect(new Set(PASOS.map((p) => p.id)).size).toBe(TOTAL);
    for (const p of PASOS) {
      expect(p.titulo.trim(), p.id).not.toBe('');
      expect(p.intro.trim(), p.id).not.toBe('');
      expect(p.puntos.length, p.id).toBeGreaterThan(0);
    }
  });

  it('empiezan por la bienvenida y explican los cuatro controles clave', () => {
    expect(PASOS[0].id).toBe('bienvenida');
    expect(PASOS.map((p) => p.id)).toEqual(expect.arrayContaining(['buscar', 'capas', 'ficha', 'asistente']));
    const conObjetivo = PASOS.filter((p) => p.objetivo).map((p) => p.id);
    expect(conObjetivo).toEqual(['buscar', 'capas', 'ficha', 'asistente']);
  });

  it('la nota de consulta referencial es solo de la bienvenida y la privacidad va al final', () => {
    expect(PASOS.filter((p) => p.aviso).map((p) => p.id)).toEqual(['bienvenida']);
    expect(PASOS.at(-1)!.privacidad).toBe(true);
    expect(PASOS.filter((p) => p.privacidad)).toHaveLength(1);
  });

  it('la privacidad dice qué sale hacia Google y cuándo, sin prometer más de lo que hace el servidor', () => {
    const texto = PASOS.find((p) => p.privacidad)!.puntos.join(' ');
    expect(texto).toContain('GEMINI_API_KEY');
    expect(texto).toContain('Google');
    expect(texto).toMatch(/tu mensaje/);
    expect(texto).toMatch(/lo que se entendió de tu búsqueda/);
    expect(texto).toMatch(/resumen de lo que devolvieron las herramientas/);
    expect(texto).toMatch(/sin coordenadas/);
    expect(texto).toMatch(/solo con reglas/);
  });

  it('nunca llama a nada «la mejor zona» ni promete un puntaje', () => {
    const todo = PASOS.flatMap((p) => [p.titulo, p.intro, ...p.puntos, p.aviso ?? '']).join(' ');
    expect(todo).toMatch(/No da un puntaje/);
    expect(todo.replace('«la mejor zona»', '')).not.toMatch(/mejor zona/i);
  });
});

describe('la navegación', () => {
  it('avanza y retrocede sin salirse de los pasos', () => {
    expect(siguiente(0)).toBe(1);
    expect(anterior(1)).toBe(0);
    expect(anterior(0)).toBe(0);
    expect(siguiente(TOTAL - 1)).toBe(TOTAL - 1);
    expect(limitar(-3)).toBe(0);
    expect(limitar(99)).toBe(TOTAL - 1);
    expect(limitar(Number.NaN)).toBe(0);
    expect(limitar(1.5)).toBe(0);
  });

  it('sabe cuál es el primero y cuál el último, y dice el progreso', () => {
    expect(esPrimero(0)).toBe(true);
    expect(esPrimero(1)).toBe(false);
    expect(esUltimo(TOTAL - 1)).toBe(true);
    expect(esUltimo(0)).toBe(false);
    expect(progreso(0)).toBe(`Paso 1 de ${TOTAL}`);
    expect(progreso(TOTAL - 1)).toBe(`Paso ${TOTAL} de ${TOTAL}`);
  });
});

describe('recordar que la guía ya se vio', () => {
  it('no se vio hasta que se marca, y se recuerda', () => {
    const a = almacenEnMemoria();
    expect(yaVisto(a)).toBe(false);
    marcarVisto(a);
    expect(a.datos.get(CLAVE_VISTO)).toBe('1');
    expect(yaVisto(a)).toBe(true);
  });

  it('sin almacenamiento (null o undefined) no se rompe: nunca se da por vista', () => {
    expect(yaVisto(null)).toBe(false);
    expect(yaVisto(undefined)).toBe(false);
    expect(() => marcarVisto(null)).not.toThrow();
    expect(() => marcarVisto(undefined)).not.toThrow();
  });

  it('un almacenamiento que lanza al leer o al escribir (ventana privada, datos bloqueados) tampoco rompe nada', () => {
    const roto = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(yaVisto(roto)).toBe(false);
    expect(() => marcarVisto(roto)).not.toThrow();
  });

  it('solo el valor «1» cuenta como visto', () => {
    const a = almacenEnMemoria();
    a.datos.set(CLAVE_VISTO, 'si');
    expect(yaVisto(a)).toBe(false);
  });

  it('fuera del navegador no hay almacenamiento', () => {
    expect(almacenDelNavegador()).toBeNull();
  });

  it('si leer `localStorage` lanza, tampoco hay almacenamiento y no se propaga el error', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage() {
          throw new Error('SecurityError');
        },
      },
    });
    try {
      expect(almacenDelNavegador()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'window', original);
      else delete (globalThis as { window?: unknown }).window;
    }
  });
});

describe('el texto del estado del modelo', () => {
  it('dice si el modelo está activo o no, y calla si no se sabe', () => {
    expect(textoDelModelo(true)).toMatch(/está activo/);
    expect(textoDelModelo(true)).toMatch(/se envían a Google/);
    expect(textoDelModelo(false)).toMatch(/no está activo/);
    expect(textoDelModelo(false)).toMatch(/no se envía a Google/);
    expect(textoDelModelo(null)).toBeNull();
  });
});
