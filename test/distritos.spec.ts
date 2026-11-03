/**
 * Pruebas de public/js/distritos.js: los distritos como concepto propio (lista, polígono por nombre) y el buscador de
 * nombres que tolera tildes, mayúsculas y errores de tipeo sin confundir palabras comunes con un distrito.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Distritos = require('../public/js/distritos.js');

describe('Distritos.buscarNombre', () => {
  const nombre = (t: string) => Distritos.buscarNombre(t)?.distrito ?? null;

  it('reconoce el nombre exacto sin importar mayúsculas ni tildes', () => {
    expect(nombre('Paucarpata')).toBe('PAUCARPATA');
    expect(nombre('SABANDÍA')).toBe('SABANDIA');
    expect(nombre('quequeña')).toBe('QUEQUEÑA');
    expect(nombre('yanahuara')).toBe('YANAHUARA');
  });

  it('tolera errores de tipeo en el nombre', () => {
    expect(nombre('pauccarpata')).toBe('PAUCARPATA');
    expect(nombre('paucartara')).toBe('PAUCARPATA');
    expect(nombre('cerro colorao')).toBe('CERRO COLORADO');
    expect(nombre('socabaia')).toBe('SOCABAYA');
  });

  it('reconoce abreviaturas y nombres cortos de uso común', () => {
    expect(nombre('jlbyr')).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
    expect(nombre('bustamante')).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
    expect(nombre('selva alegre')).toBe('ALTO SELVA ALEGRE');
    expect(nombre('hunter')).toBe('JACOBO HUNTER');
    expect(nombre('melgar')).toBe('MARIANO MELGAR');
  });

  it('encuentra el distrito dentro de una frase', () => {
    expect(nombre('quiero vivir en pauccarpata cuantos colegios hay ahi')).toBe('PAUCARPATA');
    expect(nombre('yo quiero que me busques la mejor zona para vivir en paucartara')).toBe('PAUCARPATA');
    expect(nombre('¿cuántos colegios hay en Cerro Colorado?')).toBe('CERRO COLORADO');
    expect(nombre('algo en mira flores')).toBe('MIRAFLORES');
  });

  it('no confunde palabras comunes con un distrito', () => {
    [
      'hola', 'buenas tardes', 'quiero vivir cerca de un colegio y un parque', 'busco la mejor zona para vivir',
      'cuantas casas hay cerca', 'colegios', 'secundaria', 'parque', 'cerca', 'mejor', 'sector', 'caminar', 'sismos', 'quebradas',
      'yo quiero una zona tranquila', 'una joya', 'que zona es mi punto', 'dame un resumen', 'mi punto', 'socorro',
      'cayó', 'sabana', 'miraculos', 'paucar', 'cuantos hospitales', 'una calle',
    ].forEach((frase) => expect(nombre(frase)).toBeNull());
  });

  it('«Arequipa» sola es la ciudad, no el distrito; «cercado» o «distrito de Arequipa» sí', () => {
    expect(nombre('colegios en la ciudad de Arequipa')).toBeNull();
    expect(nombre('cuantos colegios hay en el cercado')).toBe('AREQUIPA');
    expect(nombre('colegios en el distrito de Arequipa')).toBe('AREQUIPA');
  });

  it('con dos nombres en la frase devuelve el que aparece primero', () => {
    expect(nombre('de cayma a yanahuara')).toBe('CAYMA');
  });

  it('un distrito de la provincia que no está en los datos se reconoce y se marca', () => {
    const r = Distritos.buscarNombre('colegios en Vítor');
    expect(r?.distrito).toBe('VITOR');
    expect(r?.enDatos).toBe(false);
    expect(Distritos.buscarNombre('santa rita de siguas')?.enDatos).toBe(false);
    expect(Distritos.buscarNombre('paucarpata')?.enDatos).toBe(true);
  });
});

describe('Distritos.titulo', () => {
  it('escribe el nombre como una persona lo leería', () => {
    expect(Distritos.titulo('PAUCARPATA')).toBe('Paucarpata');
    expect(Distritos.titulo('JOSE LUIS BUSTAMANTE Y RIVERO')).toBe('José Luis Bustamante y Rivero');
    expect(Distritos.titulo('SABANDIA')).toBe('Sabandía');
    expect(Distritos.titulo('QUEQUEÑA')).toBe('Quequeña');
    expect(Distritos.titulo('ALTO SELVA ALEGRE')).toBe('Alto Selva Alegre');
  });
});

describe('Distritos.lista y polígonos', () => {
  const cuadro = (x: number, y: number, l: number) => [[[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]]];
  const fc = {
    features: [
      { properties: { distrito: 'PAUCARPATA', provincia: 'AREQUIPA', ubigeo: '040112', departamento: 'AREQUIPA' }, geometry: { type: 'Polygon', coordinates: cuadro(-71.5, -16.4, 0.1) } },
      { properties: { distrito: 'CAYMA', provincia: 'AREQUIPA', ubigeo: '040103', departamento: 'AREQUIPA' }, geometry: { type: 'MultiPolygon', coordinates: [cuadro(-71.6, -16.3, 0.1), cuadro(-71.8, -16.3, 0.05)] } },
    ],
  };
  beforeAll(() => { Distritos.cargarParaPruebas(fc); });

  it('lista los distritos cargados con nombre, título y caja', () => {
    const l = Distritos.lista();
    expect(l.map((d: { nombre: string }) => d.nombre).sort()).toEqual(['CAYMA', 'PAUCARPATA']);
    const p = l.find((d: { nombre: string }) => d.nombre === 'PAUCARPATA');
    expect(p.titulo).toBe('Paucarpata');
    p.bbox.forEach((v: number, i: number) => expect(v).toBeCloseTo([-71.5, -16.4, -71.4, -16.3][i], 6));
  });

  it('da los polígonos y el Feature de un distrito por su nombre', () => {
    expect(Distritos.poligonos('PAUCARPATA')).toHaveLength(1);
    expect(Distritos.poligonos('CAYMA')).toHaveLength(2);
    expect(Distritos.poligonos('NO EXISTE')).toEqual([]);
    const f = Distritos.feature('CAYMA');
    expect(f.type).toBe('Feature');
    expect(f.geometry.type).toBe('MultiPolygon');
    expect(Distritos.feature('NO EXISTE')).toBeNull();
  });

  it('dice si un punto está dentro de un distrito', () => {
    expect(Distritos.contiene('PAUCARPATA', -16.35, -71.45)).toBe(true);
    expect(Distritos.contiene('PAUCARPATA', -16.2, -71.45)).toBe(false);
    expect(Distritos.contiene('CAYMA', -16.275, -71.775)).toBe(true);
  });

  it('el buscador marca como «sin datos» los distritos que no están cargados', () => {
    expect(Distritos.buscarNombre('en paucarpata')?.enDatos).toBe(true);
    // Uchumayo existe en la provincia, pero este archivo de prueba no lo trae.
    expect(Distritos.buscarNombre('en uchumayo')?.enDatos).toBe(false);
  });
});
