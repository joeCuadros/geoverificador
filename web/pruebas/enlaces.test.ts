import { describe, expect, it } from 'vitest';
import { partirEnlaces } from '../lib/enlaces.ts';

describe('partirEnlaces', () => {
  it('deja el texto sin enlaces como una sola parte', () => {
    expect(partirEnlaces('Hola, ¿qué buscas?')).toEqual([{ tipo: 'texto', valor: 'Hola, ¿qué buscas?' }]);
  });
  it('separa un enlace del texto que lo rodea', () => {
    expect(partirEnlaces('Mira https://portal.example/a/1 y dime')).toEqual([
      { tipo: 'texto', valor: 'Mira ' },
      { tipo: 'enlace', valor: 'https://portal.example/a/1' },
      { tipo: 'texto', valor: ' y dime' },
    ]);
  });
  it('no incluye en el enlace la puntuación final', () => {
    const partes = partirEnlaces('Aviso (https://portal.example/a/1).');
    expect(partes.find((p) => p.tipo === 'enlace')!.valor).toBe('https://portal.example/a/1');
    expect(partes.at(-1)).toEqual({ tipo: 'texto', valor: ').' });
  });
  it('reconoce varios enlaces y conserva el orden', () => {
    const partes = partirEnlaces('1) https://a.example/x\n2) http://b.example/y');
    expect(partes.filter((p) => p.tipo === 'enlace').map((p) => p.valor)).toEqual(['https://a.example/x', 'http://b.example/y']);
    expect(partes.map((p) => p.valor).join('')).toBe('1) https://a.example/x\n2) http://b.example/y');
  });
  it('no convierte en enlace lo que no es http(s)', () => {
    expect(partirEnlaces('javascript:alert(1) o ftp://x.example')).toEqual([{ tipo: 'texto', valor: 'javascript:alert(1) o ftp://x.example' }]);
  });
});
