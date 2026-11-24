import { describe, expect, it } from 'vitest';
import { coordenadasTexto, decimales, metros, numero, pieDeFuente, referenciaTexto, SIN_FECHA } from '../app/componentes/chat-formato.ts';

describe('números y coordenadas del chat (es-PE)', () => {
  it('las coordenadas llevan punto decimal y una coma con espacio, nunca «;»', () => {
    expect(coordenadasTexto(-16.39883, -71.53697)).toBe('-16.39883, -71.53697');
    expect(coordenadasTexto(-16.4, -71.5)).toBe('-16.40000, -71.50000');
    expect(coordenadasTexto(-16.39883, -71.53697)).not.toContain(';');
  });

  it('los decimales usan punto', () => {
    expect(decimales(1.5, 1)).toBe('1.5');
    expect(numero(85.5)).toBe('85.5');
    expect(numero(120)).toBe('120');
  });

  it('las distancias: metros por debajo de 1 km, kilómetros con punto decimal', () => {
    expect(metros(157.4)).toBe('157 m');
    expect(metros(1500)).toBe('1.50 km');
    expect(referenciaTexto(500)).toBe('500 m');
    expect(referenciaTexto(1500)).toBe('1.5 km');
    for (const t of [metros(1500), referenciaTexto(1500)]) expect(t).not.toContain(',');
  });
});

describe('pie de fuente de un dato', () => {
  it('con fuente y fecha', () => {
    expect(pieDeFuente('OpenStreetMap', '2026-11-03')).toBe('Fuente: OpenStreetMap · datos del 2026-11-03');
  });
  it('sin fecha usa una sola frase: «sin fecha registrada»', () => {
    expect(SIN_FECHA).toBe('sin fecha registrada');
    expect(pieDeFuente('IGP', null)).toBe('Fuente: IGP · sin fecha registrada');
    expect(pieDeFuente(null, '2026-11-03')).toBe('Fuente: sin registrar · datos del 2026-11-03');
  });
  it('sin fuente ni fecha no inventa un pie', () => {
    expect(pieDeFuente(null, null)).toBeNull();
  });
});
