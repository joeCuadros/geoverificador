/**
 * Pruebas de public/js/tour.js: el recorrido guiado de la primera visita. Se revisa que explique lo que debe (alcance y
 * límites, elegir un punto, leer una tarjeta, asistente, comparar), que la navegación no se salga de rango y que la
 * bandera de «visto» no rompa la página si el almacenamiento falla.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Tour = require('../public/js/tour.js');

const texto = (paso: any) => JSON.stringify(paso).toLowerCase();
const paso = (id: string) => Tour.PASOS.find((p: any) => p.id === id);

describe('Tour.PASOS', () => {
  it('tiene ids únicos y todo el contenido necesario', () => {
    const ids = Tour.PASOS.map((p: any) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    Tour.PASOS.forEach((p: any) => {
      expect(p.titulo.trim()).not.toBe('');
      expect(p.intro.trim()).not.toBe('');
      expect(p.bloques.length).toBeGreaterThan(0);
      p.bloques.forEach((b: any) => {
        expect(b.items.length).toBeGreaterThan(0);
        b.items.forEach((it: string) => expect(it.trim()).not.toBe(''));
      });
    });
    expect(Tour.total).toBe(Tour.PASOS.length);
  });

  it('explica el alcance: qué hace y qué no hace, con sus límites', () => {
    const t = texto(paso('alcance'));
    expect(t).toContain('qué no hace');
    expect(t).toContain('puntaje global');
    expect(t).toContain('no es un certificado');
    expect(t).toContain('línea recta');
    expect(t).toContain('openstreetmap');
  });

  it('explica cómo elegir un punto en sus tres pasos', () => {
    const t = texto(paso('punto'));
    ['buscar', 'usar mi ubicación', 'toca el mapa', 'mover el punto', 'sí, verificar'].forEach((f) => expect(t).toContain(f));
  });

  it('explica los estados de una tarjeta, el umbral, la fuente y la fecha', () => {
    const p = paso('tarjetas');
    const t = texto(p);
    ['cumple', 'no cumple', 'sin dato', 'informativo', 'mis umbrales', 'umbral', 'fuente', 'fecha'].forEach((f) => expect(t).toContain(f));
    expect(p.muestra).toBe('estados');
  });

  it('explica el asistente y que no inventa', () => {
    const t = texto(paso('asistente'));
    ['no usa un modelo de lenguaje', 'no inventa', 'por qué, fuente y límites', 'no son una probabilidad'].forEach((f) => expect(t).toContain(f));
  });

  it('explica cómo comparar puntos sin puntaje global', () => {
    const t = texto(paso('comparar'));
    ['guardar para comparar', '3 puntos', 'prioridad', 'no hay pesos ni puntaje global'].forEach((f) => expect(t).toContain(f));
  });

  it('recuerda las verificaciones antes de comprar', () => {
    const t = texto(paso('verificar'));
    ['verificaciones recomendadas', 'sunarp'].forEach((f) => expect(t).toContain(f));
  });
});

describe('Tour navegación', () => {
  it('avanza y retrocede sin salirse del rango', () => {
    expect(Tour.siguiente(0)).toBe(1);
    expect(Tour.anterior(1)).toBe(0);
    expect(Tour.anterior(0)).toBe(0);
    expect(Tour.siguiente(Tour.total - 1)).toBe(Tour.total - 1);
  });

  it('un índice inválido vuelve al primer paso', () => {
    expect(Tour.limitar(-4)).toBe(0);
    expect(Tour.limitar(99)).toBe(Tour.total - 1);
    expect(Tour.limitar(undefined)).toBe(0);
    expect(Tour.limitar(1.5)).toBe(0);
  });

  it('sabe cuál es el primero y el último', () => {
    expect(Tour.esPrimero(0)).toBe(true);
    expect(Tour.esPrimero(1)).toBe(false);
    expect(Tour.esUltimo(Tour.total - 1)).toBe(true);
    expect(Tour.esUltimo(0)).toBe(false);
  });

  it('dice en qué paso va', () => {
    expect(Tour.progreso(0)).toBe(`Paso 1 de ${Tour.total}`);
    expect(Tour.progreso(2)).toBe(`Paso 3 de ${Tour.total}`);
  });
});

describe('Tour «visto»', () => {
  const memoria = () => {
    const d: Record<string, string> = {};
    return { getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => { d[k] = v; }, d };
  };
  const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };

  it('la primera vez no está visto; después de marcarlo, sí', () => {
    const a = memoria();
    expect(Tour.tourVisto(a)).toBe(false);
    Tour.marcarTourVisto(a);
    expect(a.d[Tour.CLAVE_VISTO]).toBe('1');
    expect(Tour.tourVisto(a)).toBe(true);
  });

  it('no rompe si el almacenamiento falta o lanza', () => {
    expect(Tour.tourVisto(null)).toBe(false);
    expect(Tour.tourVisto(roto)).toBe(false);
    expect(() => Tour.marcarTourVisto(roto)).not.toThrow();
    expect(() => Tour.marcarTourVisto(null)).not.toThrow();
  });
});
