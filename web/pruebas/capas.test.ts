import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Base } from '@geoverificador/datos/cliente';
import { capaRecortada } from '@geoverificador/datos/capas';
import { baseDePrueba } from '../../packages/datos/pruebas/apoyo.ts';
import { CAPAS_MAPA, capaParaMapa, catalogoDeCapas, leerCajaYZoom, radioSismoPx } from '../lib/capas.ts';

const CIUDAD: [number, number, number, number] = [-71.62, -16.46, -71.46, -16.33];
let base: Base;
beforeAll(async () => {
  base = await baseDePrueba();
});
afterAll(() => base?.cerrar());

describe('catálogo de capas', () => {
  it('cada capa tiene un identificador único, un título, un grupo y su leyenda', () => {
    const ids = CAPAS_MAPA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAPAS_MAPA) {
      expect(c.titulo.length, c.id).toBeGreaterThan(3);
      expect(['Servicios', 'Zonificación', 'Riesgo', 'Movilidad', 'Límites']).toContain(c.grupo);
      expect(c.leyenda.length, c.id).toBeGreaterThan(0);
    }
  });

  it('solo ofrece capas que la base tiene: cada clave se puede consultar', async () => {
    for (const c of CAPAS_MAPA) {
      const r = await capaRecortada(base, c.clave, CIUDAD, 14);
      expect(r.type, c.id).toBe('FeatureCollection');
    }
  });

  it('cada capa dice su fuente, su fecha y su licencia cuando la base las tiene', async () => {
    const catalogo = await catalogoDeCapas(base);
    expect(catalogo.map((c) => c.id)).toEqual(CAPAS_MAPA.map((c) => c.id));
    for (const c of catalogo) {
      expect(c.fuente.nombre, c.id).toBeTruthy();
      expect(typeof c.zoomMin).toBe('number');
      expect(c.maximo).toBeGreaterThan(0);
      if (c.id !== 'zonificacion') expect(c.fuente.fecha, `${c.id} sin fecha`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // El plano de zonificación no trae fecha en la base: se dice, no se inventa.
    expect(catalogo.find((c) => c.id === 'zonificacion')!.fuente.fecha).toBeNull();
    expect(catalogo.find((c) => c.id === 'colegios')!.fuente.nombre).toMatch(/ESCALE/);
    expect(catalogo.find((c) => c.id === 'salud')!.fuente.nombre).toMatch(/RENIPRESS/);
  });

  it('no ofrece las capas que la aplicación estática tiene pero la base no sirve (censo, CENEPRED, denuncias)', () => {
    const ids = CAPAS_MAPA.map((c) => c.id);
    for (const fuera of ['censo', 'cenepred', 'delitos', 'denuncias']) expect(ids.some((i) => i.includes(fuera))).toBe(false);
  });
});

describe('capaParaMapa', () => {
  it('colegios: cada elemento trae título, nivel y letra, y nunca un nombre vacío', async () => {
    const r = await capaParaMapa(base, 'colegios', CIUDAD, 15);
    expect(r.features.length).toBeGreaterThan(0);
    for (const f of r.features) {
      expect(f.properties.titulo.length).toBeGreaterThan(0);
      expect(['inicial', 'primaria', 'secundaria']).toContain(f.properties.nivel);
      expect(f.properties.letra).toMatch(/^[IPS]$/);
    }
  });

  it('un elemento sin nombre se dice «sin nombre», no se inventa uno', async () => {
    const r = await capaParaMapa(base, 'paraderos', CIUDAD, 15);
    const sinNombre = r.features.find((f) => /sin nombre/i.test(f.properties.titulo));
    expect(sinNombre).toBeTruthy();
  });

  it('zonificación: el título es el código y el detalle el nombre de la regla del plano', async () => {
    const r = await capaParaMapa(base, 'zonificacion', [-71.545, -16.405, -71.53, -16.395], 15);
    const zre = r.features.find((f) => f.properties.titulo === 'ZRE-CH');
    expect(zre).toBeTruthy();
    expect(zre!.properties.detalle).toMatch(/centro histórico/i);
    expect(zre!.properties.color).toMatch(/^#/);
  });

  it('peligro volcánico: color por nivel y sin ceniza', async () => {
    const r = await capaParaMapa(base, 'volcan', [-71.6, -16.4, -71.3, -16.15], 11);
    expect(r.features.length).toBeGreaterThan(0);
    for (const f of r.features) {
      expect(f.properties.titulo).not.toMatch(/ceniza/i);
      expect(f.properties.color).toMatch(/^#/);
    }
  });

  it('sismos: radio en píxeles según la magnitud y la fecha en el detalle', async () => {
    const r = await capaParaMapa(base, 'sismos', [-72.5, -17.4, -70.5, -15.4], 8);
    expect(r.features.length).toBeGreaterThan(0);
    for (const f of r.features) {
      expect(f.properties.titulo).toMatch(/^Sismo de magnitud \d+(,\d)?$/);
      expect(f.properties.detalle).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(f.properties.radioPx).toBeGreaterThanOrEqual(3);
    }
  });

  it('rutas de bus: la línea en el título, el color de la ruta y el recorrido', async () => {
    const r = await capaParaMapa(base, 'rutas', CIUDAD, 13);
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.features[0].properties.titulo).toMatch(/^Línea /);
    expect(r.features[0].geometry.type).toMatch(/LineString/);
  });

  it('lejos de lo que una capa admite, pide acercar el mapa y no devuelve elementos', async () => {
    const r = await capaParaMapa(base, 'geologicos', CIUDAD, 9);
    expect(r).toMatchObject({ requiereZoom: 11, features: [] });
  });

  it('una capa que no existe se rechaza', async () => {
    await expect(capaParaMapa(base, 'no-existe', CIUDAD, 14)).rejects.toThrow(/desconocida/);
  });

  it('no devuelve las propiedades crudas de la base, solo lo que el mapa dibuja', async () => {
    const r = await capaParaMapa(base, 'mineria', [-71.75, -16.6, -71.35, -16.2], 11);
    for (const f of r.features) expect(Object.keys(f.properties).sort()).toEqual(['color', 'detalle', 'titulo']);
  });
});

describe('radioSismoPx', () => {
  it('crece con la magnitud, entre 3 y 16', () => {
    expect(radioSismoPx(1)).toBe(3);
    expect(radioSismoPx(4)).toBeGreaterThan(radioSismoPx(3));
    expect(radioSismoPx(9)).toBe(16);
  });
});

describe('leerCajaYZoom', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('lee la caja oeste,sur,este,norte y el zoom', () => {
    expect(leerCajaYZoom(q('bbox=-71.6,-16.45,-71.5,-16.35&zoom=14'))).toEqual({ ok: true, caja: [-71.6, -16.45, -71.5, -16.35], zoom: 14 });
  });
  it.each([
    ['sin caja', 'zoom=14'],
    ['sin zoom', 'bbox=-71.6,-16.45,-71.5,-16.35'],
    ['con tres valores', 'bbox=-71.6,-16.45,-71.5&zoom=14'],
    ['con texto', 'bbox=a,b,c,d&zoom=14'],
    ['con zoom que no es número', 'bbox=-71.6,-16.45,-71.5,-16.35&zoom=cerca'],
    ['con zoom fuera de rango', 'bbox=-71.6,-16.45,-71.5,-16.35&zoom=40'],
    ['con una caja invertida', 'bbox=-71.5,-16.35,-71.6,-16.45&zoom=14'],
    ['con una caja enorme', 'bbox=-75,-20,-70,-15&zoom=14'],
  ])('rechaza una consulta %s', (_n, consulta) => {
    const r = leerCajaYZoom(q(consulta));
    expect(r.ok).toBe(false);
  });
});
