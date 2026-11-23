import { describe, expect, it } from 'vitest';
import { crearLimitador } from '../lib/limite.ts';

describe('crearLimitador', () => {
  it('deja pasar hasta el máximo y rechaza el siguiente', () => {
    const permitido = crearLimitador(2, 1000, () => 0);
    expect([permitido('a'), permitido('a'), permitido('a')]).toEqual([true, true, false]);
  });
  it('cuenta por separado a cada cliente', () => {
    const permitido = crearLimitador(1, 1000, () => 0);
    expect([permitido('a'), permitido('b'), permitido('a')]).toEqual([true, true, false]);
  });
  it('vuelve a permitir cuando termina la ventana', () => {
    let ahora = 0;
    const permitido = crearLimitador(1, 1000, () => ahora);
    expect(permitido('a')).toBe(true);
    expect(permitido('a')).toBe(false);
    ahora = 1001;
    expect(permitido('a')).toBe(true);
  });
});
