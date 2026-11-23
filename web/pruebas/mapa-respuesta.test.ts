import { describe, expect, it } from 'vitest';
import { mapaDeRespuesta } from '../lib/mapa-respuesta.ts';

const avisos = (entrada: Record<string, unknown>) => ({ nombre: 'buscar_avisos', entrada, salida: {} });
const consulta = (criterios: { id: string }[]) => ({ criterios }) as any;

describe('mapaDeRespuesta', () => {
  it('sin herramientas no dibuja nada', () => {
    expect(mapaDeRespuesta([], consulta([]))).toEqual({ lugares: [], sectores: [], pideViaje: false });
    expect(mapaDeRespuesta([], null)).toEqual({ lugares: [], sectores: [], pideViaje: false });
  });

  it('el lugar de trabajo que el asistente ubicó se dibuja con su nombre y su rol, y se pide el viaje', () => {
    const m = mapaDeRespuesta([avisos({ trabajo: { lat: -16.4179, lon: -71.5497, nombre: 'Parque Industrial' }, criterios: [{ id: 'trabajo' }] })], consulta([{ id: 'trabajo' }]));
    expect(m.lugares).toEqual([{ rol: 'trabajo', nombre: 'Parque Industrial', lat: -16.4179, lon: -71.5497 }]);
    expect(m.pideViaje).toBe(true);
  });

  it('el otro lugar pedido («cerca de…») se dibuja aparte del trabajo', () => {
    const m = mapaDeRespuesta([avisos({ lugar: { lat: -16.39, lon: -71.54, nombre: 'Plaza de Yanahuara' }, criterios: [{ id: 'lugar' }] })], consulta([{ id: 'lugar' }]));
    expect(m.lugares.map((l) => l.rol)).toEqual(['lugar']);
    expect(m.pideViaje).toBe(false);
  });

  it('un trabajo sin criterio «trabajo» se dibuja pero no pide el viaje', () => {
    const m = mapaDeRespuesta([avisos({ trabajo: { lat: -16.41, lon: -71.55, nombre: 'Oficina' }, criterios: [] })], consulta([]));
    expect(m.lugares).toHaveLength(1);
    expect(m.pideViaje).toBe(false);
  });

  it('descarta coordenadas que no son números o están fuera de Arequipa: no se dibuja lo que no se sabe dónde está', () => {
    const m = mapaDeRespuesta([avisos({ trabajo: { lat: NaN, lon: -71.5, nombre: 'X' } }), avisos({ lugar: { lat: -12.04, lon: -77.04, nombre: 'Lima' } })], consulta([]));
    expect(m.lugares).toEqual([]);
  });

  it('los sectores de buscar_zonas se numeran en el orden en que se dijeron', () => {
    const sectores = [
      { nombre: 'Cerca de la UNSA', distrito: 'AREQUIPA', hectareas: 12, lat: -16.4, lon: -71.52 },
      { nombre: null, distrito: 'CAYMA', hectareas: 7, lat: -16.37, lon: -71.55 },
    ];
    const m = mapaDeRespuesta([{ nombre: 'buscar_zonas', entrada: {}, salida: { sectores, texto: '', fecha: '2026-11-11' } }], consulta([]));
    expect(m.sectores).toEqual([
      { n: 1, nombre: 'Cerca de la UNSA', distrito: 'AREQUIPA', hectareas: 12, lat: -16.4, lon: -71.52 },
      { n: 2, nombre: null, distrito: 'CAYMA', hectareas: 7, lat: -16.37, lon: -71.55 },
    ]);
  });

  it('ignora las herramientas que no tienen nada que dibujar', () => {
    const m = mapaDeRespuesta([{ nombre: 'explicar_fuente', entrada: {}, salida: { fuentes: [] } }, { nombre: 'geocodificar_lugar', entrada: {}, salida: { candidatos: [] } }], consulta([]));
    expect(m).toEqual({ lugares: [], sectores: [], pideViaje: false });
  });
});
