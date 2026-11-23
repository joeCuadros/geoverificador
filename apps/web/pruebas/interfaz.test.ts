import { afterEach, describe, expect, it, vi } from 'vitest';
import { alAbrirSuperficie, avisarSuperficie, indiceDeResultado } from '../app/componentes/interfaz.ts';

describe('indiceDeResultado: el foco en la lista de resultados del buscador', () => {
  it('↓ entra desde el campo (-1) en el primer resultado y recorre la lista sin dar la vuelta', () => {
    expect(indiceDeResultado(-1, 3, 'ArrowDown')).toBe(0);
    expect(indiceDeResultado(0, 3, 'ArrowDown')).toBe(1);
    expect(indiceDeResultado(2, 3, 'ArrowDown')).toBe(2);
  });

  it('↑ sube y, desde el primer resultado, vuelve al campo (-1); desde el campo se queda', () => {
    expect(indiceDeResultado(2, 3, 'ArrowUp')).toBe(1);
    expect(indiceDeResultado(0, 3, 'ArrowUp')).toBe(-1);
    expect(indiceDeResultado(-1, 3, 'ArrowUp')).toBe(-1);
  });

  it('Inicio y Fin saltan al primero y al último', () => {
    expect(indiceDeResultado(1, 5, 'Home')).toBe(0);
    expect(indiceDeResultado(1, 5, 'End')).toBe(4);
  });

  it('con una sola entrada, ↓ se queda en ella; sin resultados o con otras teclas no mueve nada', () => {
    expect(indiceDeResultado(0, 1, 'ArrowDown')).toBe(0);
    expect(indiceDeResultado(-1, 0, 'ArrowDown')).toBeNull();
    expect(indiceDeResultado(1, 3, 'a')).toBeNull();
    expect(indiceDeResultado(1, 3, 'Enter')).toBeNull();
  });
});

describe('superficies que se abren sobre el mapa (buscador y capas)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('abrir una avisa a la otra, y solo a ella', () => {
    vi.stubGlobal('window', new EventTarget());
    const plegarCapas = vi.fn();
    const plegarBuscador = vi.fn();
    const dejarCapas = alAbrirSuperficie('buscador', plegarCapas);
    const dejarBuscador = alAbrirSuperficie('capas', plegarBuscador);
    avisarSuperficie('buscador');
    expect(plegarCapas).toHaveBeenCalledTimes(1);
    expect(plegarBuscador).not.toHaveBeenCalled();
    avisarSuperficie('capas');
    expect(plegarBuscador).toHaveBeenCalledTimes(1);
    expect(plegarCapas).toHaveBeenCalledTimes(1);
    dejarCapas();
    dejarBuscador();
  });

  it('quien deja de escuchar ya no se entera', () => {
    vi.stubGlobal('window', new EventTarget());
    const plegar = vi.fn();
    const dejar = alAbrirSuperficie('capas', plegar);
    dejar();
    avisarSuperficie('capas');
    expect(plegar).not.toHaveBeenCalled();
  });
});
