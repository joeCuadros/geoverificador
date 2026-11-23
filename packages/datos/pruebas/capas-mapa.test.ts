/** Capas de riesgo y de concesiones que sirve el recorte por ventana (las que el mapa web ofrece además de las de siempre). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Base } from '../src/cliente.ts';
import { capaRecortada } from '../src/capas.ts';
import { baseDePrueba } from './apoyo.ts';

const CIUDAD: [number, number, number, number] = [-71.62, -16.46, -71.46, -16.33];
let base: Base;
beforeAll(async () => {
  base = await baseDePrueba();
});
afterAll(() => base?.cerrar());

describe('capas de riesgo', () => {
  it('sismos: puntos con magnitud, fecha y referencia del IGP', async () => {
    const r = await capaRecortada(base, 'sismos', [-72.5, -17.4, -70.5, -15.4], 8);
    expect(r.features.length).toBeGreaterThan(0);
    for (const f of r.features) {
      expect(f.geometry.type).toBe('Point');
      expect(typeof f.properties.magnitud).toBe('number');
      expect(f.properties.fecha).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it('peligros geológicos: solo se sirven acercando el mapa', async () => {
    expect(await capaRecortada(base, 'geologicos', CIUDAD, 9)).toMatchObject({ recortada: true, requiereZoom: 11, features: [] });
    const r = await capaRecortada(base, 'geologicos', [-71.7, -16.5, -71.4, -16.3], 12);
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.features[0].properties.tipo).toBeTruthy();
  });

  it('peligro volcánico: las zonas del Misti sin la ceniza, que cubre toda la ciudad', async () => {
    const r = await capaRecortada(base, 'volcanZonas', [-71.6, -16.4, -71.3, -16.15], 11);
    expect(r.features.length).toBeGreaterThan(0);
    for (const f of r.features) expect(f.properties.tipo).not.toBe('ceniza');
    expect(r.features.some((f) => ['lahar', 'flujo', 'lava', 'avalancha'].some((t) => String(f.properties.tipo).startsWith(t)))).toBe(true);
  });
});

describe('capas de concesiones', () => {
  it('concesión eléctrica: polígonos con la empresa y la situación', async () => {
    const r = await capaRecortada(base, 'electricidad', CIUDAD, 12);
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.features[0].geometry.type).toMatch(/Polygon/);
    expect(r.features[0].properties.concesionaria).toBeTruthy();
  });

  it('concesiones mineras: polígonos con su estado; no hay nombre del titular', async () => {
    const r = await capaRecortada(base, 'mineria', [-71.75, -16.6, -71.35, -16.2], 11);
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.features[0].properties.estado).toBeTruthy();
    expect(JSON.stringify(r.features[0].properties)).not.toMatch(/titular/i);
    for (const x of r.features) expect(x.properties.estado).not.toBe('EXTINGUIDO');
  });
});

describe('lugares de otras categorías', () => {
  it('puntos de acopio de agua del directorio de SEDAPAR', async () => {
    const r = await capaRecortada(base, 'lugar:acopio', CIUDAD, 13);
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.features[0].properties.categoria).toBe('acopio');
  });
});

describe('peligros de un punto con su geometría', () => {
  it('un cauce cercano trae su línea y un peligro geológico su punto; la zona volcánica no repite su polígono entero', async () => {
    const { peligrosDe } = await import('../src/consultas.ts');
    const r = await peligrosDe(base, { lat: -16.39883, lon: -71.53697 });
    const cauce = r.find((p) => p.clase === 'cauce')!;
    expect(cauce.geometria?.type).toMatch(/LineString/);
    const volcan = r.find((p) => p.clase === 'volcanico')!;
    expect(volcan.geometria).toBeNull();
    const geo = await peligrosDe(base, { lat: -16.3905, lon: -71.5435 }, { radioM: 5000, clases: ['geologico'] });
    if (geo.length) expect(geo[0].geometria?.type).toBe('Point');
  });
});
