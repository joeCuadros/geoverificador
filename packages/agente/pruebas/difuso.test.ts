import { describe, expect, it } from 'vitest';
import { corregirPalabras, distancia, mejorDe, parecido } from '../src/difuso.ts';

describe('distancia de edición', () => {
  it('cuenta una transposición como un solo cambio', () => {
    expect(distancia('idnustrial', 'industrial')).toBe(1);
  });
  it('cuenta inserciones, borrados y cambios', () => {
    expect(distancia('parquie', 'parque')).toBe(1);
    expect(distancia('aprtamente', 'apartamento')).toBe(2);
    expect(distancia('departamente', 'departamento')).toBe(1);
    expect(distancia('casa', 'casa')).toBe(0);
  });
  it('parecido va de 0 a 1', () => {
    expect(parecido('casa', 'casa')).toBe(1);
    expect(parecido('abc', 'xyz')).toBe(0);
    expect(parecido('cayma', 'caima')).toBeGreaterThan(0.7);
  });
});

describe('mejorDe', () => {
  const vocab = [
    { texto: 'departamento', valor: 'departamento' },
    { texto: 'apartamento', valor: 'departamento' },
    { texto: 'terreno', valor: 'terreno' },
    { texto: 'oficina', valor: 'oficina' },
  ];
  it('acepta la palabra exacta sin marcarla como corrección', () => {
    expect(mejorDe('terreno', vocab)).toMatchObject({ valor: 'terreno', exacta: true, clara: true });
  });
  it('corrige una errata clara de una palabra larga', () => {
    expect(mejorDe('departamente', vocab)).toMatchObject({ valor: 'departamento', exacta: false, clara: true });
    expect(mejorDe('aprtamente', vocab)).toMatchObject({ valor: 'departamento', clara: true });
  });
  it('no corrige palabras cortas: «cosas» no es «casas»', () => {
    expect(mejorDe('cosas', [{ texto: 'casas', valor: 'casa' }])).toBeNull();
  });
  it('en una respuesta suelta tolera una letra también en palabras de 5 o 6 letras', () => {
    expect(mejorDe('ofcina', vocab, { tolerante: true })).toMatchObject({ valor: 'oficina' });
    expect(mejorDe('ofcina', vocab)).toMatchObject({ valor: 'oficina' });
  });
  it('si dos valores distintos están igual de cerca, no elige: es ambiguo', () => {
    const r = mejorDe('colegiu', [{ texto: 'colegio', valor: 'colegio' }, { texto: 'colegia', valor: 'otro' }]);
    expect(r?.clara).toBe(false);
  });
  it('no inventa nada con una palabra lejana', () => {
    expect(mejorDe('quiero', vocab)).toBeNull();
  });
});

describe('corregirPalabras', () => {
  const vocab = [
    { texto: 'departamento', valor: 'departamento' },
    { texto: 'apartamento', valor: 'departamento' },
    { texto: 'universidad', valor: 'universidad' },
  ];
  it('corrige cada palabra dudosa, conserva la puntuación y dice qué cambió', () => {
    const r = corregirPalabras('Quiero un departamente, cerca de la univercidad.', vocab);
    expect(r.texto).toBe('Quiero un departamento, cerca de la universidad.');
    expect(r.cambios).toEqual([
      { dicho: 'departamente', entendido: 'departamento' },
      { dicho: 'univercidad', entendido: 'universidad' },
    ]);
  });
  it('lista aparte lo que no pudo decidir', () => {
    const r = corregirPalabras('un colegiu', [{ texto: 'colegio', valor: 'colegio' }, { texto: 'colegia', valor: 'otro' }]);
    expect(r.texto).toBe('un colegiu');
    expect(r.dudas.map((d) => d.dicho)).toEqual(['colegiu']);
  });
  it('no toca palabras que ya son del vocabulario', () => {
    const r = corregirPalabras('un departamento', vocab);
    expect(r.cambios).toEqual([]);
  });
});
