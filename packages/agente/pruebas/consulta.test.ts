import { describe, expect, it } from 'vitest';
import { interpretar, leerMonto, loQueFalta, normalizarFrase } from '../src/consulta.ts';
import { cumplidos, ordenar } from '../src/criterios.ts';
import { verificarRespuesta } from '../src/verificar.ts';

const FRASE = 'Quiero un departamento cerca de mi trabajo, cerca de un mall, con agua y luz, cerca de un colegio y de una universidad, y que no cueste más de medio millón';

describe('interpretar', () => {
  it('entiende la frase del plan', () => {
    const c = interpretar(FRASE);
    expect(c.intencion).toBe('buscar_avisos');
    expect(c.tipo).toBe('departamento');
    expect(c.precioMax).toBe(500000);
    const ids = c.criterios.map((x) => x.id);
    for (const id of ['trabajo', 'mall', 'agua', 'luz', 'colegio', 'universidad']) expect(ids).toContain(id);
  });
  it('hace una sola pregunta: primero el trabajo, luego la moneda', () => {
    const c = interpretar(FRASE);
    expect(loQueFalta(c)).toBe('trabajo');
    const c2 = interpretar('en el Parque Industrial', { previa: c, pendiente: 'trabajo' });
    expect(c2.trabajoLugar).toBeTruthy();
    expect(loQueFalta(c2)).toBe('moneda');
    const c3 = interpretar('en soles', { previa: c2, pendiente: 'moneda' });
    expect(c3.moneda).toBe('PEN');
    expect(loQueFalta(c3)).toBeNull();
  });
  it('lee montos', () => {
    expect(leerMonto(normalizarFrase('hasta S/ 450,000'))).toBe(450000);
  });
});

describe('verificarRespuesta', () => {
  const salida = { avisos: [{ precio: 420000, url: 'https://urbania.pe/x', distancia: 312 }] };
  it('acepta cifras y enlaces de las herramientas', () => {
    expect(verificarRespuesta('Cuesta S/ 420 000, a 312 m. https://urbania.pe/x', [salida]).ok).toBe(true);
  });
  it('rechaza una cifra inventada', () => {
    const v = verificarRespuesta('Está a 250 m', [salida]);
    expect(v.ok).toBe(false);
    expect(v.cifrasSinOrigen).toContain('250');
  });
  it('rechaza un enlace inventado', () => {
    expect(verificarRespuesta('Mira https://falso.pe/y', [salida]).ok).toBe(false);
  });
});

describe('ordenar', () => {
  const mk = (cumple: (boolean | null)[], visto: string) => ({ criterios: cumple.map((c) => ({ cumple: c })) as any, ultimaVezVisto: visto });
  it('más cumplidos, menos sin dato, más reciente', () => {
    const a = mk([true, true, null], '2026-11-01');
    const b = mk([true, true, true], '2026-10-01');
    const c = mk([true, true, null], '2026-11-10');
    const o = ordenar([a, b, c]);
    expect(o[0]).toBe(b);
    expect(o[1]).toBe(c);
    expect(cumplidos(o[2])).toBe(2);
  });
});
