/**
 * Pruebas de scripts/lib/riesgo-cenepred.js: cómo se arma el archivo del escenario de riesgo del CENEPRED a partir de los atributos
 * de las capas 4 y 5 del SIGRID. Se fija que el significado de los campos se compruebe con las tablas del estudio (clases 1 a 5), que
 * «Muy Alto» y «Muy alto» sean el mismo nivel y que un distrito que falta, un nivel desconocido o un campo que ya no cuadra impidan
 * escribir el archivo.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const R = require('../scripts/lib/riesgo-cenepred.js');

const geo = { features: [{ properties: { ubigeo: '040117', distrito: 'SACHACA' } }, { properties: { ubigeo: '040115', distrito: 'QUEQUEÑA' } }] };
const inu = (ubigeo: string, nombre: string, extra = {}) => ({ ubigeo, nombdist: nombre, nriesgo_in: 'Muy alto', viv_sinu: 7926, iiee_sinu: 50, eess_sinu: 6, viv_1: 5, eess_1: 5, ...extra });
const mm = (ubigeo: string, nombre: string, extra = {}) => ({ ubigeo, nombdist: nombre, nriesgo_mm: 'Muy Alto', vivsm_ma_a: 7926, iiee_smm: 23, eess_smm: 3, viv_1: 5, eess_1: 4, ...extra });
const entrada = () => ({
  inundacion: [inu('040117', 'SACHACA'), inu('040115', 'QUEQUEÑA', { nriesgo_in: 'Alto', viv_sinu: 4734, eess_sinu: 1, eess_1: 2 })],
  movimientos_masa: [mm('040117', 'SACHACA'), mm('040115', 'QUEQUEÑA', { nriesgo_mm: 'Medio', vivsm_ma_a: 4460, eess_smm: 0, eess_1: 1 })],
});

describe('clases de exposición de las Tablas 5 y 6 del estudio', () => {
  it('viviendas: 0 → 1; 1-100 → 2; 101-250 → 3; 251-1000 → 4; más de 1000 → 5', () => {
    expect([0, 1, 100, 101, 250, 251, 1000, 1001].map(R.claseViviendas)).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
  });
  it('establecimientos de salud: 0 → 1; 1 → 2; 2 → 3; 3 a 5 → 4; más de 5 → 5', () => {
    expect([0, 1, 2, 3, 5, 6].map(R.claseSalud)).toEqual([1, 2, 3, 4, 4, 5]);
  });
});

describe('normalizarNivel', () => {
  it('«Muy Alto» (capa 5) y «Muy alto» (capa 4) son el mismo nivel', () => {
    expect(R.normalizarNivel('Muy Alto')).toBe('Muy alto');
    expect(R.normalizarNivel(' muy alto ')).toBe('Muy alto');
    expect(R.normalizarNivel('Bajo')).toBe('Bajo');
  });
  it('lo desconocido es null', () => {
    expect(R.normalizarNivel('Extremo')).toBeNull();
    expect(R.normalizarNivel(null)).toBeNull();
    expect(R.normalizarNivel('Muy bajo')).toBeNull();
  });
});

describe('armar', () => {
  it('empareja por ubigeo y deja solo los campos confirmados', () => {
    const d = R.armar(entrada(), geo);
    expect(Object.keys(d)).toEqual(['040117', '040115']);
    expect(d['040117']).toEqual({
      distrito: 'SACHACA',
      inundacion: { nivel: 'Muy alto', viviendas: 7926, instituciones_educativas: 50, establecimientos_salud: 6 },
      movimientos_masa: { nivel: 'Muy alto', viviendas: 7926, instituciones_educativas: 23, establecimientos_salud: 3 },
    });
    expect(JSON.stringify(d)).not.toMatch(/pob_2017|viv_2017/);
  });

  it('falla si un distrito no está en las dos capas', () => {
    const e = entrada();
    e.movimientos_masa.pop();
    expect(() => R.armar(e, geo)).toThrow(/QUEQUEÑA.*sin movimientos en masa/);
  });

  it('falla con un nivel desconocido', () => {
    const e = entrada();
    e.inundacion[0].nriesgo_in = 'Extremo';
    expect(() => R.armar(e, geo)).toThrow(/nivel de riesgo desconocido/);
  });

  it('falla si el campo de viviendas ya no cuadra con la clase del estudio (el significado cambió)', () => {
    const e = entrada();
    e.inundacion[0].viv_sinu = 50; // clase 2, pero el servicio dice 5
    expect(() => R.armar(e, geo)).toThrow(/El significado del campo cambió/);
  });

  it('falla si los establecimientos de salud no cuadran con su clase', () => {
    const e = entrada();
    e.movimientos_masa[0].eess_smm = 0; // clase 1, pero el servicio dice 4
    expect(() => R.armar(e, geo)).toThrow(/eess_smm/);
  });

  it('falla si un conteo no es un entero', () => {
    const e = entrada();
    e.inundacion[0].iiee_sinu = null as unknown as number;
    expect(() => R.armar(e, geo)).toThrow(/no es un entero válido/);
  });

  it('falla si el nombre del servicio no es el del distrito del ubigeo', () => {
    const e = entrada();
    e.inundacion[0].nombdist = 'OTRO';
    expect(() => R.armar(e, geo)).toThrow(/no coincide con el nombre/);
  });
});

describe('resumenPorNivel', () => {
  it('cuenta los distritos por nivel y por fenómeno', () => {
    const r = R.resumenPorNivel(R.armar(entrada(), geo));
    expect(r.inundacion).toEqual({ Bajo: 0, Medio: 0, Alto: 1, 'Muy alto': 1 });
    expect(r.movimientos_masa).toEqual({ Bajo: 0, Medio: 1, Alto: 0, 'Muy alto': 1 });
  });
});
