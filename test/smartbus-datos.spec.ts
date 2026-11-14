/**
 * Pruebas del núcleo puro del recolector de SmartBus (scripts/lib/smartbus/smartbus.js): línea y empresa, partido de la geometría
 * en los saltos, orden de coordenadas [lat, lng] → GeoJSON [lng, lat], paradas, validación, conteos, metadatos y los tres formatos
 * de salida. Con un extracto recortado de respuestas reales del 2026-11-12 (test/fixtures/smartbus/). Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const S = require('../scripts/lib/smartbus/smartbus.js');

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'smartbus', n), 'utf8'));
const lista = fx('routes-muestra.json').data as Array<Record<string, any>>;
const detalle = fx('ruta-17664795.json').data as Record<string, any>;
const AHORA = new Date('2026-11-12T12:00:00.000Z');
type F = { type: string; geometry: { type: string; coordinates: any }; properties: Record<string, any> };

describe('Smartbus.lineaYEmpresa', () => {
  it('separa «C2 - Cono Norte» en línea y empresa', () => {
    expect(S.lineaYEmpresa('C2 - Cono Norte')).toEqual({ linea: 'C2', empresa: 'Cono Norte' });
    expect(S.lineaYEmpresa('C10 - MegaBus')).toEqual({ linea: 'C10', empresa: 'MegaBus' });
  });
  it('las que no llevan código (Albotran, Chiguata) usan su nombre como línea', () => {
    expect(S.lineaYEmpresa('Albotran')).toEqual({ linea: 'Albotran', empresa: 'Albotran' });
  });
});

describe('Smartbus.sentidoDe', () => {
  it('quita el prefijo «ramal : » del nombre largo', () => {
    expect(S.sentidoDe({ shortName: 'Cettar', longName: 'Cettar : Ciudad Municipal → Terminal Terrestre' })).toBe('Ciudad Municipal → Terminal Terrestre');
  });
  it('si no trae el prefijo deja el nombre tal cual', () => {
    expect(S.sentidoDe({ shortName: 'X', longName: 'Otro nombre' })).toBe('Otro nombre');
  });
});

describe('Smartbus.tramos', () => {
  it('invierte [lat, lng] a [lng, lat] (orden de GeoJSON) y redondea a 6 decimales', () => {
    expect(S.tramos([[-16.3972066, -71.4997216], [-16.3973087, -71.4997185]])).toEqual([[[-71.499722, -16.397207], [-71.499718, -16.397309]]]);
  });
  it('parte la línea donde hay un salto de más de 300 m y descarta los tramos de un solo punto', () => {
    const a = [-16.4, -71.5];
    const b = [-16.4001, -71.5];
    const lejos = [-16.41, -71.5]; // ≈ 1,1 km
    const lejos2 = [-16.4101, -71.5];
    const solo = [-16.5, -71.5];
    expect(S.tramos([a, b, lejos, lejos2])).toEqual([[[-71.5, -16.4], [-71.5, -16.4001]], [[-71.5, -16.41], [-71.5, -16.4101]]]);
    expect(S.tramos([a, b, solo])).toEqual([[[-71.5, -16.4], [-71.5, -16.4001]]]);
  });
  it('una geometría vacía o de un punto no da tramos', () => {
    expect(S.tramos([])).toEqual([]);
    expect(S.tramos([[-16.4, -71.5]])).toEqual([]);
  });
});

describe('Smartbus.construir con el detalle real de la ruta 17664795 (Atalaya, C5)', () => {
  const ruta = lista.find((r) => r.id === '17664795') as Record<string, any>;
  const r = S.construir([ruta], new Map([['17664795', detalle]]));
  const linea: F = r.rutas[0];

  it('una ruta como LineString con las propiedades de la ruta, sin problemas', () => {
    expect(r.problemas).toEqual([]);
    expect(r.rutas).toHaveLength(1);
    expect(linea.geometry.type).toBe('LineString');
    expect(linea.properties).toMatchObject({ tipo: 'ruta', linea: 'C5', empresa: 'EtraBus', ramal: 'Atalaya', nombre: 'Atalaya : Atalaya → Estadio Melgar', sentido: 'Atalaya → Estadio Melgar', id_ruta: '17664795', color: '#FF0000', paradas: 14 });
  });

  it('GeoJSON en orden [lng, lat]: la primera coordenada del API era [-16.3972066, -71.4997216]', () => {
    expect(linea.geometry.coordinates[0]).toEqual([-71.499722, -16.397207]);
    for (const [lng, lat] of linea.geometry.coordinates) {
      expect(lng).toBeLessThan(-70);
      expect(lat).toBeGreaterThan(-17);
    }
  });

  it('14 paradas como Point [lng, lat] con orden desde 1, nombre, id de la parada y de la ruta', () => {
    expect(r.paradas).toHaveLength(14);
    const p: F = r.paradas[0];
    expect(p.geometry).toEqual({ type: 'Point', coordinates: [-71.499722, -16.397207] });
    expect(p.properties).toMatchObject({ tipo: 'parada', nombre: 'Atalaya - 1', linea: 'C5', ramal: 'Atalaya', orden: 1, id_ruta: '17664795', id_parada: 'vs_17664795_0' });
    expect(r.paradas.map((x: F) => x.properties.orden)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it('una ruta con un salto se guarda como MultiLineString', () => {
    const d = { ...detalle, geometry: [[-16.4, -71.5], [-16.4001, -71.5], [-16.41, -71.5], [-16.4101, -71.5]] };
    const x = S.construir([ruta], new Map([['17664795', d]]));
    expect(x.rutas[0].geometry.type).toBe('MultiLineString');
    expect(x.rutas[0].geometry.coordinates).toHaveLength(2);
  });

  it('informa como problema: geometría vacía, vértice o parada fuera de Arequipa, coordenadas inválidas', () => {
    const vacia = S.construir([ruta], new Map([['17664795', { ...detalle, geometry: [] }]]));
    expect(vacia.problemas.join('\n')).toMatch(/geometría vacía/);
    const fuera = S.construir([ruta], new Map([['17664795', { ...detalle, geometry: [[-12, -77], [-12.0001, -77]] }]]));
    expect(fuera.problemas.join('\n')).toMatch(/fuera de Arequipa/);
    const paradaMala = S.construir([ruta], new Map([['17664795', { ...detalle, stops: [{ id: 'a', name: 'X', lat: 'no', lng: -71.5, sequence: 0 }] }]]));
    expect(paradaMala.problemas.join('\n')).toMatch(/parada «X»/);
    expect(paradaMala.paradas).toHaveLength(0);
  });
});

describe('Smartbus.seleccionarRutas', () => {
  it('«todas» deja la lista completa; --max-rutas la recorta desde el principio', () => {
    expect(S.seleccionarRutas(lista, { linea: 'todas', maxRutas: null })).toHaveLength(6);
    expect(S.seleccionarRutas(lista, { linea: 'todas', maxRutas: 3 }).map((r: any) => r.id)).toEqual(lista.slice(0, 3).map((r) => r.id));
  });
  it('filtra por línea sin distinguir mayúsculas, y luego aplica el máximo', () => {
    expect(S.seleccionarRutas(lista, { linea: 'c2', maxRutas: null }).map((r: any) => r.shortName)).toEqual(['Cettar', 'BR']);
    expect(S.seleccionarRutas(lista, { linea: 'C2', maxRutas: 1 })).toHaveLength(1);
    expect(S.seleccionarRutas(lista, { linea: 'albotran', maxRutas: null })).toHaveLength(1);
  });
  it('una línea que no existe es un error que lista las disponibles', () => {
    expect(() => S.seleccionarRutas(lista, { linea: 'C99', maxRutas: null })).toThrow(/C99[\s\S]*C5[\s\S]*C2/);
  });
});

describe('Smartbus.validarLista y validarDetalle', () => {
  it('la lista debe ser {ok, data[]} con ids y agencia', () => {
    expect(() => S.validarLista({ ok: true, data: lista })).not.toThrow();
    expect(() => S.validarLista({ ok: false })).toThrow(/forma esperada/);
    expect(() => S.validarLista({ ok: true, data: [{ id: '1' }] })).toThrow(/forma esperada/);
  });
  it('el detalle debe traer stops y geometry como listas', () => {
    expect(() => S.validarDetalle({ ok: true, data: detalle }, '17664795')).not.toThrow();
    expect(() => S.validarDetalle({ ok: true, data: { stops: [] } }, '9')).toThrow(/ruta 9/);
    expect(() => S.validarDetalle(null, '9')).toThrow(/ruta 9/);
  });
  it('una corrida completa exige una lista completa (≥ 200 rutas y ≥ 10 líneas); una parcial no', () => {
    expect(() => S.validarCompletitud(lista, { completa: true })).toThrow(/parcial/);
    expect(() => S.validarCompletitud(lista, { completa: false })).not.toThrow();
  });
});

describe('Smartbus.contar', () => {
  it('cuenta líneas, rutas, registros de parada, posiciones distintas de parada y vértices', () => {
    const rutas = [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] }, properties: { linea: 'C2', empresa: 'A', ramal: 'x' } },
      { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[5, 5], [6, 6]]] }, properties: { linea: 'C3', empresa: 'B', ramal: 'y' } },
    ];
    const paradas = [{ geometry: { coordinates: [-71.5, -16.4] } }, { geometry: { coordinates: [-71.5, -16.4] } }, { geometry: { coordinates: [-71.6, -16.4] } }];
    expect(S.contar(rutas, paradas)).toEqual({ lineas: 2, empresas: 2, ramales: 2, rutas: 2, paradas: 3, posiciones_de_parada_distintas: 2, vertices: 7 });
  });
});

describe('Smartbus.crearMetadata', () => {
  const m = S.crearMetadata({ ahora: AHORA, filtros: { linea: 'todas', maxRutas: null }, conteos: { rutas: 1 }, lineas: ['C5'], userAgent: 'UA/1' });
  it('declara la fuente, la fecha de captura y que no hay licencia ni se puede redistribuir', () => {
    expect(m.fuente).toBe('SmartBus (smartbus.app)');
    expect(m.url_fuente).toBe('https://smartbus.app/smartbus/pe/arequipa/routes');
    expect(m.fecha_captura).toBe('2026-11-12T12:00:00.000Z');
    expect(m.uso).toBe('uso local de análisis; sin licencia; no redistribuir');
    expect(m.licencia).toMatch(/ninguna/i);
  });
  it('no afirma ningún permiso', () => {
    expect(JSON.stringify(m)).not.toMatch(/permiso|autoriza/i);
  });
});

describe('Smartbus.serializar', () => {
  const ruta = lista.find((r) => r.id === '17664795') as Record<string, any>;
  const r = S.construir([ruta], new Map([['17664795', detalle]]));
  const metadata = S.crearMetadata({ ahora: AHORA, filtros: {}, conteos: S.contar(r.rutas, r.paradas), lineas: ['C5'], userAgent: 'UA/1' });

  it('geojson: FeatureCollection con el bloque metadata, rutas y paradas', () => {
    const [{ contenido, sufijo }] = S.serializar('geojson', { ...r, metadata });
    expect(sufijo).toBe('');
    const g = JSON.parse(contenido);
    expect(g.type).toBe('FeatureCollection');
    expect(g.metadata.uso).toMatch(/no redistribuir/);
    expect(g.features).toHaveLength(15);
    expect(g.features.filter((f: F) => f.geometry.type === 'Point')).toHaveLength(14);
  });

  it('json: metadatos, rutas con sus paradas y geometría', () => {
    const [{ contenido }] = S.serializar('json', { ...r, metadata });
    const j = JSON.parse(contenido);
    expect(j.metadata.uso).toMatch(/no redistribuir/);
    expect(j.rutas).toHaveLength(1);
    expect(j.rutas[0]).toMatchObject({ linea: 'C5', id_ruta: '17664795' });
    expect(j.rutas[0].paradas).toHaveLength(14);
    expect(j.rutas[0].paradas[0]).toMatchObject({ orden: 1, nombre: 'Atalaya - 1', lat: -16.397207, lon: -71.499722 });
    expect(j.rutas[0].geometria.type).toBe('LineString');
  });

  it('csv: una fila por parada con lat y lon (lat primero) y un archivo de metadatos al lado', () => {
    const salidas = S.serializar('csv', { ...r, metadata });
    const filas = salidas[0].contenido.replace(/^﻿/, '').trim().split('\n');
    expect(filas).toHaveLength(15);
    expect(filas[0]).toBe('linea,empresa,ramal,id_ruta,nombre_ruta,sentido,orden,id_parada,nombre_parada,lat,lon');
    expect(filas[1]).toContain('C5,EtraBus,Atalaya,17664795,');
    expect(filas[1].endsWith(',1,vs_17664795_0,Atalaya - 1,-16.397207,-71.499722')).toBe(true);
    expect(salidas[1].sufijo).toBe('.metadata.json');
    expect(JSON.parse(salidas[1].contenido).uso).toMatch(/no redistribuir/);
  });
});
