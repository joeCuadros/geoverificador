import { describe, expect, it } from 'vitest';
import { leerPunto } from '../lib/punto.ts';

const q = (s: string) => new URLSearchParams(s);

describe('leerPunto', () => {
  it('lee latitud y longitud en grados decimales', () => {
    expect(leerPunto(q('lat=-16.39883&lon=-71.53697'))).toEqual({ ok: true, punto: { lat: -16.39883, lon: -71.53697 } });
  });
  it('acepta la coma decimal que escribe una persona', () => {
    expect(leerPunto(q('lat=-16,4&lon=-71,5'))).toEqual({ ok: true, punto: { lat: -16.4, lon: -71.5 } });
  });
  it.each([
    ['falta la longitud', 'lat=-16.4'],
    ['falta la latitud', 'lon=-71.5'],
    ['vacíos', 'lat=&lon='],
    ['texto', 'lat=abc&lon=-71.5'],
    ['infinito', 'lat=Infinity&lon=-71.5'],
    ['varios valores', 'lat=-16.4&lat=-16.5&lon=-71.5'],
  ])('rechaza coordenadas inválidas (%s)', (_nombre, consulta) => {
    const r = leerPunto(q(consulta));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/lat y lon/i);
  });
  it('rechaza un punto fuera de Arequipa y lo dice', () => {
    const r = leerPunto(q('lat=-12.0464&lon=-77.0428'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fuera de Arequipa/i);
  });
  it('rechaza latitudes imposibles sin tratarlas como «fuera de Arequipa»', () => {
    const r = leerPunto(q('lat=120&lon=-71.5'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/lat y lon/i);
  });
});

describe('leerPunto con otros nombres de parámetro', () => {
  it('lee origenLat y origenLon', () => {
    expect(leerPunto(q('origenLat=-16.39&origenLon=-71.54'), 'origenLat', 'origenLon')).toEqual({ ok: true, punto: { lat: -16.39, lon: -71.54 } });
  });
  it('el error nombra los parámetros que se esperaban', () => {
    const r = leerPunto(q('lat=-16.39&lon=-71.54'), 'destinoLat', 'destinoLon');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/destinoLat y destinoLon/);
  });
});
