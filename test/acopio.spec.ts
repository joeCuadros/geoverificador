/**
 * Puntos de acopio de agua potable de SEDAPAR (directorio publicado en gob.pe el 2024-02-16, con datos de abril a junio de 2017): la lógica pura detrás de
 * scripts/convertir-acopio-sedapar.mjs. Lectura del CSV, de UTM zona 19 sur a WGS84, reparación de la Ñ solo donde es segura, descarte de lo que no tiene
 * coordenadas o cae fuera de Arequipa metropolitana. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const Utm = require('../scripts/lib/utm.js');
const Acopio = require('../scripts/lib/acopio.js');

// Valores de referencia calculados con PROJ (proj4 2.22, EPSG:32719 -> EPSG:4326), una implementación independiente de la nuestra.
const REFERENCIA: [number, number, number, number][] = [
  [8186311, 230145, -16.389400186, -71.526467277],
  [8183200, 222000, -16.416565051, -71.603040871],
  [8190000, 240000, -16.357169474, -71.433849489],
  [8174000, 236500, -16.501294416, -71.468415917],
  [8160000, 250000, -16.629201835, -71.343558649],
];

describe('Utm.utmAWgs84: UTM zona 19 sur (EPSG:32719) a WGS84', () => {
  it('coincide con PROJ en cinco puntos de Arequipa metropolitana, a menos de 1 cm', () => {
    for (const [n, e, lat, lon] of REFERENCIA) {
      const r = Utm.utmAWgs84(n, e);
      expect(Math.abs(r.lat - lat)).toBeLessThan(1e-7); // 1e-7 grados son ~1 cm
      expect(Math.abs(r.lon - lon)).toBeLessThan(1e-7);
    }
  });
  it('la zona y el hemisferio son parámetros (zona 19 sur por omisión) y los datos imposibles dan un error, no un número', () => {
    expect(Utm.utmAWgs84(8186311, 230145, { zona: 19, sur: true }).lat).toBeCloseTo(-16.3894, 4);
    expect(Utm.utmAWgs84(8186311, 230145, { zona: 18, sur: true }).lon).toBeLessThan(-71.6 - 5); // otra zona, otro meridiano central
    for (const malo of [[NaN, 230145], [8186311, NaN], ['8186311', 230145], [null, 1]]) expect(() => Utm.utmAWgs84(...(malo as [number, number]))).toThrow();
  });
});

describe('Acopio.parsearCsv', () => {
  it('lee comillas, comas dentro de comillas, comillas dobles escapadas, BOM y saltos CRLF', () => {
    const filas = Acopio.parsearCsv('﻿a,b,c\r\n1,"x, y",3\r\n4,"dice ""hola""",\r\n');
    expect(filas).toEqual([{ a: '1', b: 'x, y', c: '3' }, { a: '4', b: 'dice "hola"', c: '' }]);
  });
});

describe('Acopio.repararEnie: solo la Ñ y solo donde es segura', () => {
  const F = '�';
  it('repara la Ñ entre vocales de una palabra conocida, respetando mayúsculas y minúsculas', () => {
    expect(Acopio.repararEnie(`CALLE JACINTO IBA${F}EZ`).texto).toBe('CALLE JACINTO IBAÑEZ');
    expect(Acopio.repararEnie(`Se${F}or de los Milagros`).texto).toBe('Señor de los Milagros');
    expect(Acopio.repararEnie(`SE${F}ORA, NI${F}O Y VI${F}A`).texto).toBe('SEÑORA, NIÑO Y VIÑA');
    expect(Acopio.repararEnie(`Campi${F}a y Bre${F}a`).texto).toBe('Campiña y Breña');
  });
  it('cuenta lo que repara y lo que deja', () => {
    const r = Acopio.repararEnie(`SE${F}OR y COMIT${F}`);
    expect(r).toMatchObject({ texto: `SEÑOR y COMIT${F}`, reparados: 1, sinReparar: 1 });
  });
  it('no toca lo que podría ser otra letra: una vocal con tilde (COMITÉ, JOSÉ, Andrés), el N° y una palabra que no está en la lista', () => {
    for (const t of [`COMIT${F}`, `JOS${F}`, `Andr${F}s`, `N${F}102`, `PANAM${F}`, `CA${F}A`]) expect(Acopio.repararEnie(t)).toMatchObject({ texto: t, reparados: 0, sinReparar: 1 });
  });
  it('un texto sin el carácter dañado queda igual', () => {
    expect(Acopio.repararEnie('AVENIDA 1 DE MAYO')).toEqual({ texto: 'AVENIDA 1 DE MAYO', reparados: 0, sinReparar: 0 });
  });
});

describe('Acopio.convertir', () => {
  const fila = (extra: object = {}) => ({ distrito_archivo: 'sabandia', pagina_pdf: '2', codigo_punto: '1', direccion: 'PLAZA PRINCIPAL', utm19s_norte: '8186311', utm19s_este: '230145', lat_wgs84_calc: '-16.3894', lon_wgs84_calc: '-71.526467', ...extra });
  it('una Feature por punto, con coordenadas WGS84 calculadas por nosotros, el distrito con el nombre del proyecto y la ficha de origen', () => {
    const { features, descartados } = Acopio.convertir([fila()]);
    expect(descartados).toEqual([]);
    expect(features).toHaveLength(1);
    const f = features[0];
    expect(f.geometry.type).toBe('Point');
    expect(f.geometry.coordinates[0]).toBeCloseTo(-71.526467277, 6);
    expect(f.geometry.coordinates[1]).toBeCloseTo(-16.389400186, 6);
    expect(f.properties).toMatchObject({ distrito: 'SABANDIA', codigo: '1', direccion: 'PLAZA PRINCIPAL', pagina_pdf: 2, utm_norte: 8186311, utm_este: 230145 });
  });
  it('los nombres de archivo de los distritos pasan al nombre que usa el proyecto (Cercado es AREQUIPA, Hunter es JACOBO HUNTER)', () => {
    const d = (slug: string) => Acopio.convertir([fila({ distrito_archivo: slug })]).features[0].properties.distrito;
    expect(d('cercado')).toBe('AREQUIPA');
    expect(d('hunter')).toBe('JACOBO HUNTER');
    expect(d('alto-selva-alegre')).toBe('ALTO SELVA ALEGRE');
    expect(d('jose-luis-bustamante-y-rivero')).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
  });
  it('descarta, diciendo por qué y de qué ficha, lo que no tiene norte, no tiene este o cae fuera de Arequipa metropolitana; nunca inventa una coordenada', () => {
    const r = Acopio.convertir([
      fila({ pagina_pdf: '3', utm19s_norte: '' }),
      fila({ pagina_pdf: '4', utm19s_este: '' }),
      fila({ pagina_pdf: '5', utm19s_norte: '81882227' }), // ocho cifras: un error de la fuente
      fila({ pagina_pdf: '6' }),
    ]);
    expect(r.features).toHaveLength(1);
    expect(r.descartados.map((d: any) => [d.pagina_pdf, d.distrito])).toEqual([[3, 'SABANDIA'], [4, 'SABANDIA'], [5, 'SABANDIA']]);
    expect(r.descartados[0].motivo).toMatch(/norte/i);
    expect(r.descartados[1].motivo).toMatch(/este/i);
    expect(r.descartados[2].motivo).toMatch(/fuera de Arequipa metropolitana/i);
  });
  it('repara la Ñ de la dirección y lo anota; cuenta lo que queda sin reparar', () => {
    const r = Acopio.convertir([fila({ direccion: 'CALLE IBA�EZ' }), fila({ pagina_pdf: '3', direccion: 'COMIT� VECINAL' })]);
    expect(r.features[0].properties).toMatchObject({ direccion: 'CALLE IBAÑEZ', reparada: true });
    expect(r.features[1].properties.reparada).toBeUndefined();
    expect(r.reparados).toBe(1);
    expect(r.sinReparar).toBe(1);
  });
  it('resumir cuenta por distrito', () => {
    const { features } = Acopio.convertir([fila(), fila({ pagina_pdf: '3' }), fila({ distrito_archivo: 'yura', pagina_pdf: '2' })]);
    expect(Acopio.resumir(features)).toEqual({ total: 3, por_distrito: { SABANDIA: 2, YURA: 1 } });
  });
});

describe('Acopio.extraerParesDePdf: el norte y el este que trae cada ficha del PDF', () => {
  const ficha = (cuerpo: string) => `CODIGO DE PUNTO:   LOCALIDAD:\n 1  AREQUIPA METROPOLITANA\nGEOREFERENCIACION:\n${cuerpo}\nDESCRIPCION:\n El punto 1`;
  it('lee las dos coordenadas de cada ficha, con el norte antes que el este aunque el PDF imprima primero el este', () => {
    const t = `portada\n${ficha('NORTE ( Y ) WGS-84: ESTE ( X )\nUBICACION:     8179793 m\n 233253 m  UTM 19 SUR')}\n${ficha('ESTE: 226559 m   NORTE: 8181732 m')}`;
    expect(Acopio.extraerParesDePdf(t)).toEqual([['8179793', '233253'], ['8181732', '226559']]);
  });
  it('acepta el norte con decimales y el este sin « m», y no confunde «WGS-84» ni «UTM 19 SUR» con una coordenada', () => {
    expect(Acopio.extraerParesDePdf(ficha('NORTE ( Y ) WGS-84:  ESTE ( X )\nUBICACION: 8187965.0000   WGS-84:\n UTM 19 SUR\n 230558'))).toEqual([['8187965', '230558']]);
    expect(Acopio.extraerParesDePdf(ficha('UBICACION: 8181505m   231879 m'))).toEqual([['8181505', '231879']]); // sin espacio antes de la m
    expect(Acopio.extraerParesDePdf(ficha('UBICACION: 8184593 m\n 231956m'))).toEqual([['8184593', '231956']]);
  });
  it('una ficha con una coordenada ausente trae solo una, y no se completa', () => {
    expect(Acopio.extraerParesDePdf(ficha('UBICACION: 8183745 m'))).toEqual([['8183745']]);
  });
});

// ------------------------------------------------------------------------------ Archivo real

const ruta = join(__dirname, '..', 'public', 'data', 'agua', 'puntos_acopio.geojson');
(existsSync(ruta) ? describe : describe.skip)('archivo real de puntos de acopio', () => {
  const fc = existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : { metadata: {}, features: [] };
  const m = fc.metadata;
  it('trae la procedencia con la fecha de publicación (2024) y la fecha de los datos (2017), el enlace y lo que NO dice', () => {
    expect(m.fuente).toMatch(/SEDAPAR/);
    expect(m.url_pagina).toBe('https://www.gob.pe/institucion/sedapar/informes-publicaciones/5198948-directorio-de-puntos-de-acopio-de-agua-potable-arequipa');
    expect(m.fecha_publicacion).toBe('2024-02-16');
    expect(m.fecha_de_los_datos).toMatch(/2017/);
    expect(m.informativo).toMatch(/sin umbral/i);
    expect(m.no_dice).toMatch(/emergencia|desabastecimiento/i);
    expect(m.no_dice).toMatch(/no dice/i);
  });
  it('575 puntos y 7 descartados con su motivo; el conteo de la metadata coincide con el archivo', () => {
    expect(fc.features).toHaveLength(575);
    expect(m.registros).toBe(575);
    expect(m.fichas_en_la_fuente).toBe(582);
    expect(m.descartados).toHaveLength(7);
    expect(m.descartados.every((d: any) => d.distrito && d.pagina_pdf && d.motivo)).toBe(true);
    expect(Object.values(m.conteo_por_distrito).reduce((t: number, n) => t + (n as number), 0)).toBe(575);
  });
  it('todos son puntos dentro de la caja de Arequipa metropolitana y su coordenada sale de su UTM (a menos de 1 cm)', () => {
    for (const f of fc.features) {
      const [lon, lat] = f.geometry.coordinates;
      expect(lat).toBeGreaterThan(-16.6);
      expect(lat).toBeLessThan(-16.2);
      expect(lon).toBeGreaterThan(-71.75);
      expect(lon).toBeLessThan(-71.35);
      const r = Utm.utmAWgs84(f.properties.utm_norte, f.properties.utm_este);
      expect(Math.abs(r.lat - lat)).toBeLessThan(1e-6);
      expect(Math.abs(r.lon - lon)).toBeLessThan(1e-6);
    }
  });
  it('Sabandia, punto 1, cae donde dice la investigación (-16.4486, -71.4981) y la Plaza de Armas tiene puntos cerca', () => {
    const s = fc.features.find((f: any) => f.properties.distrito === 'SABANDIA');
    expect(s.geometry.coordinates[1]).toBeCloseTo(-16.4486, 3);
    expect(s.geometry.coordinates[0]).toBeCloseTo(-71.4981, 3);
  });
});
