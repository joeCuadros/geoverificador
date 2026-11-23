import { describe, expect, it } from 'vitest';
import { etiquetaDeRadio, radioValido } from '../lib/radio.ts';

describe('etiquetaDeRadio', () => {
  it('escribe la distancia como la dice el chat: metros hasta 999 y kilómetros con coma decimal después', () => {
    expect(etiquetaDeRadio(150)).toBe('150 m');
    expect(etiquetaDeRadio(800)).toBe('800 m');
    expect(etiquetaDeRadio(1500)).toBe('1,5 km');
    expect(etiquetaDeRadio(3000)).toBe('3,0 km');
    expect(etiquetaDeRadio(10_000)).toBe('10,0 km');
  });

  it('redondea los metros enteros y los kilómetros a un decimal', () => {
    expect(etiquetaDeRadio(149.6)).toBe('150 m');
    expect(etiquetaDeRadio(1549)).toBe('1,5 km');
  });
});

describe('radioValido', () => {
  it('solo acepta números finitos y positivos', () => {
    expect(radioValido(1500)).toBe(true);
    for (const x of [0, -1, NaN, Infinity, '1500', null, undefined]) expect(radioValido(x), String(x)).toBe(false);
  });
});
