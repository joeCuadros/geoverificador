/**
 * Interrupciones del servicio de agua de SEDAPAR por distrito (SUNASS, Registro de interrupciones, datosabiertos.gob.pe, ODC-By): la lógica pura detrás de
 * scripts/descargar-interrupciones-sunass.mjs. Filtra la empresa y el servicio, cuenta cada interrupción una vez por distrito, mide su duración y la reparte por año
 * sin mezclar años completos con parciales. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const Interrupciones = require('../scripts/lib/interrupciones.js');

const fila = (extra: object = {}) => ({
  IDINTERRUPCION: 'a1', EPS: 'SEDAPAR', SEDE: 'SEDAPAR', TIPOINTERRUPCION: 'IMPREVISTA', TIPOSERVICIO: 'AGUA POTABLE', MOTIVOINTERRUPCION: 'FUGA EN CONEXIÓN',
  FECHAINICIO: '20210510', HORAINICIO: '08:00', FECHAFIN: '20210510', HORAFIN: '14:30', DEPARTAMENTO: 'AREQUIPA', PROVINCIA: 'AREQUIPA', DISTRITO: 'CAYMA',
  NUMCONEXDOM: '120', UNIDADESUSO: '130', NUMCAMIONESPUNTOS: '', ...extra,
});
const DISTRITOS = ['CAYMA', 'CERRO COLORADO', 'AREQUIPA', 'QUEQUEÑA', 'JACOBO HUNTER'];
const agregar = (filas: object[], extra: object = {}) => Interrupciones.agregar(filas, { distritos: DISTRITOS, ...extra });

describe('Interrupciones.agregar: qué cuenta y qué no', () => {
  it('cuenta cada interrupción de agua de SEDAPAR por distrito, con su duración en horas', () => {
    const r = agregar([fila(), fila({ IDINTERRUPCION: 'a2', FECHAFIN: '20210511', HORAFIN: '08:00' })]);
    expect(r.distritos.CAYMA.total).toMatchObject({ n: 2, horas: 30.5, imprevistas: 2, programadas: 0 });
    expect(r.distritos.CAYMA.total.horas_mediana).toBe(15.25); // 6,5 h y 24 h
  });
  it('separa las programadas de las imprevistas', () => {
    const r = agregar([fila(), fila({ IDINTERRUPCION: 'a2', TIPOINTERRUPCION: 'PROGRAMADA' })]);
    expect(r.distritos.CAYMA.total).toMatchObject({ imprevistas: 1, programadas: 1 });
  });
  it('deja fuera lo de otra empresa, lo que no es agua potable y lo que cae fuera de los distritos del proyecto, y lo cuenta', () => {
    const r = agregar([
      fila(), fila({ IDINTERRUPCION: 'b', EPS: 'SEDAPAL' }), fila({ IDINTERRUPCION: 'c', TIPOSERVICIO: 'ALCANTARILLADO' }),
      fila({ IDINTERRUPCION: 'd', DISTRITO: 'MOLLENDO', PROVINCIA: 'ISLAY' }), fila({ IDINTERRUPCION: 'e', DISTRITO: '' }),
    ]);
    expect(r.distritos.CAYMA.total.n).toBe(1);
    expect(Object.keys(r.distritos)).toEqual(['CAYMA']);
    expect(r.descartes).toMatchObject({ otra_eps: 1, otro_servicio: 1, fuera_de_los_distritos: 1, sin_distrito: 1 });
  });
  it('el EPS se compara sin espacios de más y los distritos sin tildes ni mayúsculas (QUEQUEÑA)', () => {
    const r = agregar([fila({ EPS: 'SEDAPAR ' }), fila({ IDINTERRUPCION: 'q', DISTRITO: 'Quequena' })]);
    expect(r.distritos.CAYMA.total.n).toBe(1);
    expect(r.distritos['QUEQUEÑA'].total.n).toBe(1);
  });
  it('una interrupción que afecta a varios sectores del mismo distrito cuenta una vez; la misma en otro distrito, una vez en cada uno', () => {
    const r = agregar([
      fila({ IDINTERRUPCION: 'x', NUMCONEXDOM: '100' }), fila({ IDINTERRUPCION: 'x', NUMCONEXDOM: '300' }), fila({ IDINTERRUPCION: 'x', DISTRITO: 'CERRO COLORADO' }),
    ]);
    expect(r.distritos.CAYMA.total.n).toBe(1);
    expect(r.distritos['CERRO COLORADO'].total.n).toBe(1);
    expect(r.descartes.repetidas).toBe(1);
  });
  it('una interrupción con fechas imposibles (termina antes de empezar, o no es una fecha) no cuenta y se anota', () => {
    const r = agregar([fila(), fila({ IDINTERRUPCION: 'm', FECHAFIN: '20210509' }), fila({ IDINTERRUPCION: 'n', FECHAINICIO: 'sin fecha' })]);
    expect(r.distritos.CAYMA.total.n).toBe(1);
    expect(r.descartes.fechas_invalidas).toBe(2);
  });
});

describe('Interrupciones.agregar: los años y el periodo', () => {
  const filas = [
    fila({ IDINTERRUPCION: '1', FECHAINICIO: '20191003', FECHAFIN: '20191003' }), // empieza en octubre de 2019
    fila({ IDINTERRUPCION: '2', FECHAINICIO: '20200115', FECHAFIN: '20200115' }),
    fila({ IDINTERRUPCION: '3', FECHAINICIO: '20200216', FECHAFIN: '20200216' }),
    fila({ IDINTERRUPCION: '4', FECHAINICIO: '20211201', FECHAFIN: '20211201' }),
    fila({ IDINTERRUPCION: '5', FECHAINICIO: '20220601', FECHAFIN: '20220601' }),
    fila({ IDINTERRUPCION: '6', FECHAINICIO: '20230601', FECHAFIN: '20230601' }),
    fila({ IDINTERRUPCION: '7', FECHAINICIO: '20240426', FECHAFIN: '20240426' }), // termina en abril de 2024
  ];
  it('el periodo es el de las filas de la empresa, y solo los años completos dentro de él lo son', () => {
    const r = agregar(filas);
    expect(r.periodo).toEqual({ desde: '2019-10-03', hasta: '2024-04-26' });
    expect(r.anios_completos).toEqual([2020, 2021, 2022, 2023]);
    expect(r.anios_parciales).toEqual([2019, 2024]);
  });
  it('cuenta por año de inicio y suma las horas de cada año', () => {
    const c = agregar(filas).distritos.CAYMA;
    expect(Object.fromEntries(Object.entries(c.por_anio).map(([a, v]: any) => [a, v.n]))).toEqual({ 2019: 1, 2020: 2, 2021: 1, 2022: 1, 2023: 1, 2024: 1 });
    expect(c.por_anio['2020'].horas).toBe(13); // 2 x 6,5 h
    expect(c.total.n).toBe(7);
  });
  it('el periodo se calcula con TODAS las filas de la empresa, aunque no sean de agua ni de los distritos del proyecto', () => {
    const r = agregar([fila({ FECHAINICIO: '20210510' }), fila({ IDINTERRUPCION: 'l', DISTRITO: 'LA JOYA', FECHAINICIO: '20191003', FECHAFIN: '20191003' })]);
    expect(r.periodo.desde).toBe('2019-10-03');
  });
});

// ------------------------------------------------------------------------------ Archivo real

const ruta = join(__dirname, '..', 'public', 'data', 'agua', 'interrupciones_sedapar.json');
(existsSync(ruta) ? describe : describe.skip)('archivo real de interrupciones de SEDAPAR', () => {
  const d = existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : { metadata: {}, distritos: {} };
  const m = d.metadata;
  it('trae la procedencia: SUNASS, la página y el CSV, ODC-By, la fecha de descarga, el periodo y lo que NO dice', () => {
    expect(m.fuente).toMatch(/SUNASS/);
    expect(m.url_pagina).toBe('https://www.datosabiertos.gob.pe/dataset/registro-de-interrupciones-del-servicio-de-agua-y-alcantarillado-imprevistas-y-programadas');
    expect(m.url_csv).toBe('https://www.datosabiertos.gob.pe/sites/default/files/Interrupciones_Dataset.csv');
    expect(m.licencia).toMatch(/ODC-By/);
    expect(m.fecha_descarga).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.periodo).toEqual({ desde: '2019-10-03', hasta: '2024-04-26' });
    expect(m.anios_completos).toEqual([2020, 2021, 2022, 2023]);
    expect(m.informativo).toMatch(/sin umbral/i);
    expect(m.no_dice).toMatch(/reportad/i);
    expect(m.no_dice).toMatch(/no dice/i);
  });
  it('los distritos de Arequipa metropolitana con más registros están ahí y los totales cuadran con los años', () => {
    for (const nombre of ['CERRO COLORADO', 'PAUCARPATA', 'CAYMA', 'ALTO SELVA ALEGRE', 'AREQUIPA']) {
      const c = d.distritos[nombre];
      expect(c.total.n).toBeGreaterThan(100);
      expect(Object.values(c.por_anio).reduce((t: number, v: any) => t + v.n, 0)).toBe(c.total.n);
      expect(Math.round(Object.values(c.por_anio).reduce((t: number, v: any) => t + v.horas, 0))).toBeCloseTo(Math.round(c.total.horas), 0);
      expect(c.total.imprevistas + c.total.programadas).toBe(c.total.n);
    }
  });
});
