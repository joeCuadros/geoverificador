import { describe, expect, it } from 'vitest';
import { aMarcadores, enlaceSeguro, textoPrecio } from '../lib/marcadores.ts';

const aviso = (extra = {}) => ({ id: 1, titulo: 'Departamento en Yanahuara', url: 'https://portal.example/1', lat: -16.3905, lon: -71.5435, cumplidos: 1, pedidos: 2, precio: 400000, moneda: 'PEN', distrito: 'YANAHUARA', ...extra });

describe('textoPrecio', () => {
  it('escribe soles y dólares con separador de miles', () => {
    expect(textoPrecio(400000, 'PEN')).toBe('S/ 400\u00a0000');
    expect(textoPrecio(120000, 'USD')).toBe('US$ 120\u00a0000');
  });
  it('dice «precio no indicado» y no inventa uno', () => {
    expect(textoPrecio(null, null)).toBe('Precio no indicado');
    expect(textoPrecio(1000, null)).toBe('Precio no indicado');
  });
});

describe('enlaceSeguro', () => {
  it('solo deja pasar http y https', () => {
    expect(enlaceSeguro('https://a.example/x')).toBe('https://a.example/x');
    expect(enlaceSeguro('http://a.example')).toBe('http://a.example');
    expect(enlaceSeguro('javascript:alert(1)')).toBeNull();
    expect(enlaceSeguro('data:text/html,hola')).toBeNull();
    expect(enlaceSeguro('')).toBeNull();
    expect(enlaceSeguro(undefined)).toBeNull();
  });
});

describe('aMarcadores', () => {
  it('convierte cada aviso con coordenadas en un marcador con su enlace y su detalle', () => {
    const [m] = aMarcadores([aviso()]);
    expect(m).toMatchObject({ id: 1, titulo: 'Departamento en Yanahuara', lat: -16.3905, lon: -71.5435, url: 'https://portal.example/1' });
    expect(m.detalle).toContain('S/ 400\u00a0000');
    expect(m.detalle).toContain('Yanahuara');
    expect(m.detalle).toContain('cumple 1 de 2');
  });
  it('omite los avisos sin coordenadas: no se ubica lo que no se sabe dónde está', () => {
    expect(aMarcadores([aviso({ lat: null, lon: null }), aviso({ id: 2 })]).map((m) => m.id)).toEqual([2]);
  });
  it('omite coordenadas imposibles o fuera de Arequipa', () => {
    expect(aMarcadores([aviso({ lat: 0, lon: 0 }), aviso({ id: 3, lat: 95, lon: -71 })])).toEqual([]);
  });
  it('descarta enlaces que no son http(s) pero conserva el marcador', () => {
    const [m] = aMarcadores([aviso({ url: 'javascript:alert(1)' })]);
    expect(m.url).toBeNull();
  });
  it('usa un título genérico si el aviso no trae uno', () => {
    expect(aMarcadores([aviso({ titulo: null })])[0].titulo).toBe('Aviso sin título');
  });
  it('no pide criterios en el detalle cuando la consulta no los tenía', () => {
    expect(aMarcadores([aviso({ pedidos: 0, cumplidos: 0 })])[0].detalle).not.toMatch(/cumple/);
  });
});
