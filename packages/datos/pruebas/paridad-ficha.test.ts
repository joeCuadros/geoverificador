/**
 * Criterio de «hecho» de la fase 2: la ficha de un punto armada con consultas a la base da los mismos valores que la aplicación actual
 * (que lee los archivos completos) en los puntos de validación. Se comparan los cuatro puntos de la auditoría y una rejilla de 36 puntos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Calculos from '@geoverificador/dominio/nucleo/calculos';
import { crearEquipamiento } from '@geoverificador/dominio/nucleo/equipamiento';
import type { Base } from '../src/cliente.ts';
import { fichaDePunto } from '../src/ficha.ts';
import { PUNTOS_AUDITORIA, baseDePrueba, fetchArchivos, leerDato, rejilla } from './apoyo.ts';

let base: Base;
beforeAll(async () => {
  base = await baseDePrueba();
});
afterAll(() => base?.cerrar());

const dentro = (lat: number, lon: number, g: any) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some((anillos: any) => Calculos.puntoEnPoligono(lat, lon, anillos));

/** Zona como la resuelve public/js/zonificacion.js: el último polígono del archivo que contiene el punto. */
const zonaDeArchivo = (() => {
  let zonas: any;
  return (lat: number, lon: number): string | null => {
    zonas ??= leerDato('zonas_aqp.geojson').features;
    let hit = null;
    for (const z of zonas) if (dentro(lat, lon, z.geometry)) hit = z.properties.codigo;
    return hit;
  };
})();

/** Distrito como lo resuelve public/js/distritos.js: el primero del archivo que contiene el punto. */
const distritoDeArchivo = (() => {
  let distritos: any;
  return (lat: number, lon: number): string | null => {
    distritos ??= leerDato('distritos_aqp.geojson').features;
    return distritos.find((d: any) => dentro(lat, lon, d.geometry))?.properties.distrito ?? null;
  };
})();

const sinRuido = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('ficha de un punto: base frente a archivos', () => {
  for (const p of [...PUNTOS_AUDITORIA, ...rejilla(6)]) {
    it(`${p.nombre} (${p.lat}, ${p.lon})`, async () => {
      const [deLaBase, deArchivos] = await Promise.all([fichaDePunto(base, p), crearEquipamiento({ fetch: fetchArchivos }).evaluar(p.lat, p.lon)]);
      expect(sinRuido(deLaBase.entorno)).toEqual(sinRuido(deArchivos));
      expect(deLaBase.zona?.codigo ?? null).toBe(zonaDeArchivo(p.lat, p.lon));
      expect(deLaBase.distrito?.nombre ?? null).toBe(distritoDeArchivo(p.lat, p.lon));
    });
  }

  it('los puntos de la auditoría dan lo que anotó la auditoría', async () => {
    const [plaza, cerro, yura, parque] = await Promise.all(PUNTOS_AUDITORIA.map((p) => fichaDePunto(base, p)));
    expect(plaza.distrito?.nombre).toBe('AREQUIPA');
    expect(cerro.distrito?.nombre).toBe('CERRO COLORADO');
    expect(cerro.zona?.codigo).toBe('ZA');
    expect(yura.distrito?.nombre).toBe('YURA');
    expect(yura.zona).toBeNull(); // fuera del área zonificada
    expect(yura.entorno.electricidad.dentro).toBe(false); // fuera de concesión eléctrica (la auditoría anotó 764 m con el punto sin redondear)
    expect(yura.entorno.electricidad.distanciaM).toBeGreaterThan(700);
    expect(yura.entorno.electricidad.distanciaM).toBeLessThan(800);
    expect(parque.zona?.codigo).toBe('RDM-1');
    expect(parque.entorno.salud.distanciaM).toBeGreaterThan(600); // la auditoría anotó 657 m
    expect(parque.entorno.salud.distanciaM).toBeLessThan(700);
  });
});
