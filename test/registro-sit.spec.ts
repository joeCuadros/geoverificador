/**
 * Registro oficial del SIT de Arequipa (scripts/lib/registro-sit.js): lo que el anexo de las bases de la tercera licitación de operación de rutas de la
 * Municipalidad Provincial de Arequipa (2017) dice de las unidades de negocio C-1A a C-11 y de sus rutas, leído del texto del PDF, y la comparación con las rutas de
 * OpenStreetMap. Con un texto pequeño hecho a mano: no se lee el PDF.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Reg = require('../scripts/lib/registro-sit.js');

const TEXTO = `
2.2 RUTAS QUE COMPONEN CADA UNIDAD DE NEGOCIO

Unidad                  RUTAS QUE COMPONEN LA UNIDAD DE NEGOCIO
    de

Negocio

1 C1A BT1

2 C1B BT2

3 C2 A25 A27 A28

4 C3 A5 A26

                                                 UNIDAD DE NEGOCIO C2 CONO NORTE

Ruta  Pasajeros-     Km-Día   Flota   Tipo de   IPK  km día Longitud Velocidad
A25   5,824          812     5          Bus 60 6.5 162            12.5      18     1165 401 5,824 5,741 82 8.97 8.30 19.38

A27   7,968          1,148   12         Bus 42 6.3 96             10.8      18          664 284 7,968 4,601 3,367 8.88 2.94 13.80

                                             UNIDAD DE NEGOCIO C3 CAYMA - (Concesionada)

A5 85,182 9,361          55  Bus 80 8.2 170               24.9      15         1549 2,133 85,182 68,847 16,335 2.25 1.80 2.81
`;

describe('Registro.rutasPorUnidad', () => {
  it('lee de la tabla «rutas que componen cada unidad de negocio» el código de cada unidad y sus rutas', () => {
    const u = Reg.rutasPorUnidad(TEXTO);
    expect(u).toEqual({ C1A: ['BT1'], C1B: ['BT2'], C2: ['A25', 'A27', 'A28'], C3: ['A5', 'A26'] });
  });
  it('sin la tabla no inventa unidades', () => {
    expect(Reg.rutasPorUnidad('nada de esto')).toEqual({});
    expect(Reg.rutasPorUnidad(null)).toEqual({});
  });
});

describe('Registro.longitudesDeRutas', () => {
  it('lee la longitud (km) y el tipo de vehículo de cada ruta en la matriz de su unidad', () => {
    const l = Reg.longitudesDeRutas(TEXTO);
    expect(l.A25).toEqual({ unidad: 'C2', longitud_km: 12.5, vehiculo: 'Bus 60' });
    expect(l.A27).toMatchObject({ unidad: 'C2', longitud_km: 10.8, vehiculo: 'Bus 42' });
    expect(l.A5).toMatchObject({ unidad: 'C3', longitud_km: 24.9, vehiculo: 'Bus 80' });
  });
  it('descarta una fila desalineada por el PDF (sus pasajeros por día no vuelven a aparecer como EMB-G): su longitud sería de otra ruta', () => {
    const t = `UNIDAD DE NEGOCIO C10 SACHACA - HUNTER\nA22      10,016   1,826        8     Bus 60   4.2 121   14.2      18          563 485 5,065 4,615 449 5.20 5.78 21.85\n`;
    expect(Reg.longitudesDeRutas(t)).toEqual({});
  });
  it('una ruta de la lista que no aparece en la matriz no tiene longitud (null), no se estima', () => {
    const r = Reg.armarUnidades(TEXTO);
    const c2 = r.find((u: any) => u.codigo === 'C2');
    expect(c2.rutas.map((x: any) => [x.codigo, x.longitud_km])).toEqual([['A25', 12.5], ['A27', 10.8], ['A28', null]]);
  });
});

describe('Registro.armarUnidades', () => {
  const r = Reg.armarUnidades(TEXTO);
  it('trae el nombre oficial de la unidad (de la tabla del anexo) y el concesionario según el contrato publicado', () => {
    expect(r.find((u: any) => u.codigo === 'C2')).toMatchObject({ nombre: 'Cono Norte', concesionario: expect.stringMatching(/CONO NORTE/i) });
    expect(r.find((u: any) => u.codigo === 'C3')).toMatchObject({ nombre: 'Cayma', concesionario: expect.stringMatching(/TRANSCAYMA/i) });
  });
  it('una unidad sin concesionario identificado en los documentos lo deja en null', () => {
    expect(r.find((u: any) => u.codigo === 'C1B').concesionario).toBeNull();
  });
});

describe('Registro.comparar: rutas de OpenStreetMap frente al registro', () => {
  const unidades = Reg.armarUnidades(TEXTO);
  const osm = (linea: string, operador: string, ramal = 'x') => ({ properties: { tipo: 'ruta', linea, operador, ramal } });
  it('dice qué unidades oficiales tienen su línea en OSM y cuáles no, y qué líneas de OSM no están en el registro', () => {
    const c = Reg.comparar(unidades, [osm('C2', 'C2 - Cono Norte'), osm('C3', 'C3 - Transcayma'), osm('Albotran', 'Albotran')]);
    expect(c.unidades).toEqual({ oficiales: 4, enOsm: 2, faltanEnOsm: ['C1A', 'C1B'] });
    expect(c.lineasOsmFueraDelRegistro).toEqual(['Albotran']);
  });
  it('compara la empresa que etiqueta OSM con el concesionario del contrato, por línea', () => {
    const c = Reg.comparar(unidades, [osm('C2', 'C2 - Cono Norte'), osm('C2', 'C2 - Cono Norte'), osm('C2', 'C2 - Transcayma'), osm('C3', 'C3 - Transcayma')]);
    expect(c.empresa.C2).toEqual({ rutasOsm: 3, coincide: 2, sinEmpresa: 0 });
    expect(c.empresa.C3).toEqual({ rutasOsm: 1, coincide: 1, sinEmpresa: 0 });
    expect(c.empresa.total).toEqual({ rutasOsm: 4, coincide: 3 });
  });
  it('cuenta los ramales distintos de cada línea en OSM junto a las rutas oficiales de la unidad, sin igualarlos (son nombres distintos de cosas distintas)', () => {
    const c = Reg.comparar(unidades, [osm('C2', 'C2 - Cono Norte', 'Cettar'), osm('C2', 'C2 - Cono Norte', 'Cettar'), osm('C2', 'C2 - Cono Norte', 'Peruarbo')]);
    expect(c.rutas.C2).toEqual({ oficiales: 3, ramalesOsm: 2 });
  });
});
