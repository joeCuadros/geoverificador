import { CRITERIOS } from '@geoverificador/agente/criterios';
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

  describe('el círculo de «cerca de»', () => {
    const plaza = { lat: -16.39, lon: -71.54, nombre: 'Plaza de Yanahuara' };

    it('el lugar con el criterio «lugar» trae el radio que se pidió, en metros', () => {
      const m = mapaDeRespuesta([avisos({ lugar: plaza, criterios: [{ id: 'lugar', metros: 800 }] })], consulta([{ id: 'lugar' }]));
      expect(m.lugares).toEqual([{ rol: 'lugar', ...plaza, radioM: 800 }]);
    });

    it('sin una distancia dicha usa la de referencia del criterio (la que el chat llama «convención del agente»)', () => {
      const m = mapaDeRespuesta([avisos({ lugar: plaza, criterios: [{ id: 'lugar' }] })], consulta([{ id: 'lugar' }]));
      expect(m.lugares[0].radioM).toBe(CRITERIOS.lugar.omision);
    });

    it('sin el criterio «lugar» (la persona lo quitó) no hay círculo, aunque el lugar siga ubicado', () => {
      const m = mapaDeRespuesta([avisos({ lugar: plaza, criterios: [{ id: 'colegio' }] })], consulta([{ id: 'colegio' }]));
      expect(m.lugares).toHaveLength(1);
      expect(m.lugares[0].radioM).toBeUndefined();
    });

    it('el trabajo no se mide por distancia (es tiempo de viaje): nunca trae radio', () => {
      const m = mapaDeRespuesta([avisos({ trabajo: { lat: -16.41, lon: -71.55, nombre: 'Parque Industrial' }, criterios: [{ id: 'trabajo', maxMin: 30 }] })], consulta([{ id: 'trabajo' }]));
      expect(m.lugares[0].radioM).toBeUndefined();
    });

    it('descarta un radio que no es un número positivo: no se dibuja lo que no se sabe de qué tamaño es', () => {
      for (const metros of [0, -50, NaN, Infinity]) {
        const m = mapaDeRespuesta([avisos({ lugar: plaza, criterios: [{ id: 'lugar', metros }] })], consulta([{ id: 'lugar' }]));
        expect(m.lugares[0].radioM, String(metros)).toBe(CRITERIOS.lugar.omision);
      }
    });
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
